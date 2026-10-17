import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition, ToolSchemaProperty } from '../types/tools.js';
import {
  dependencyGraphStats, dependencyImpact, GRAPH_EDGE_KINDS,
  type DependencySnapshot, type GraphEdgeKind
} from '../lib/DependencyGraph.js';
import { transportBoundaries } from '../lib/TransportBoundaries.js';
import { serializeJsonText } from '../lib/jsonResponse';

const MAX_NODES = 500;
const MAX_EDGES = 2000;
const token = (maxLength: number): ToolSchemaProperty => ({ type: 'string', minLength: 1, maxLength });
const snapshotSchema: ToolSchemaProperty = {
  type: 'object', additionalProperties: false, required: ['nodes', 'edges'],
  properties: {
    nodes: {
      type: 'array', maxItems: MAX_NODES,
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'name', 'type'],
        properties: { id: token(100), name: token(80), type: token(16), package: token(80) }
      }
    },
    edges: {
      type: 'array', maxItems: MAX_EDGES,
      items: {
        type: 'object', additionalProperties: false, required: ['from', 'to', 'kind', 'source'],
        properties: {
          from: token(100), to: token(100),
          kind: { type: 'string', enum: [...GRAPH_EDGE_KINDS] }, source: token(80)
        }
      }
    }
  }
};

/** Local snapshot analysis only: intentionally has no ADT/RFC client dependency. */
export class DependencyGraphHandlers {
  supports(name: string): boolean { return name === 'analyzeDependencyGraph'; }

  getTools(): ToolDefinition[] {
    return [{
      name: 'analyzeDependencyGraph',
      description: 'Offline dependency snapshot analysis: stats counts nodes/edges; impact follows incoming edges by BFS; boundaries inspects outgoing structural dependencies of an explicit TR/CR object set. Supply canonical TYPE:NAME nodes and edges FROM dependent TO dependency. No SAP reads or verified transport membership. LOADS is not CALLS; CO_TRANSPORTED is only correlation; DYNAMIC_CALL is unresolved. Boundary results are not deployment approval.',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['operation', 'graph'],
        properties: {
          operation: { type: 'string', enum: ['stats', 'impact', 'boundaries'] },
          graph: snapshotSchema,
          root: { ...token(100), description: 'Existing canonical node id, required for impact only.' },
          maxDepth: { type: 'integer', minimum: 1, maximum: 10, description: 'Impact only. Default 3.' },
          maxEntries: { type: 'integer', minimum: 1, maximum: 500, description: 'Impact or boundaries. Default 200; boundaries uses one shared detail budget, summary counts remain full.' },
          boundaryScope: {
            type: 'object', additionalProperties: false, required: ['label', 'objectIds'],
            description: 'Boundaries only. Explicit object set for one TR or a CR union; label is display-only and does not fetch transports.',
            properties: {
              label: token(120),
              objectIds: { type: 'array', minItems: 1, maxItems: MAX_NODES, items: token(100) }
            }
          },
          edgeKinds: {
            type: 'array', maxItems: GRAPH_EDGE_KINDS.length,
            items: { type: 'string', enum: [...GRAPH_EDGE_KINDS] },
            description: 'Impact only. Omitted or empty traverses all edge kinds, including transport correlation.'
          }
        }
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { operationClass: 'local-only', approvalRequired: false }
    }];
  }

  async handle(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this.supports(name)) throw new McpError(ErrorCode.MethodNotFound, 'Unknown dependency-graph tool.');
    const input = object(args, ['operation', 'graph', 'root', 'maxDepth', 'maxEntries', 'edgeKinds', 'boundaryScope'], 'arguments');
    if (typeof input.operation !== 'string' || !['stats', 'impact', 'boundaries'].includes(input.operation)) invalid('operation must be stats, impact or boundaries.');
    if (input.operation !== 'boundaries' && input.boundaryScope !== undefined) invalid('boundaryScope is only allowed for boundaries.');
    const graph = snapshot(input.graph);
    let analysis: unknown;
    if (input.operation === 'stats') {
      for (const key of ['root', 'maxDepth', 'maxEntries', 'edgeKinds']) {
        if (input[key] !== undefined) invalid(`${key} is only allowed for impact.`);
      }
      analysis = dependencyGraphStats(graph);
    } else if (input.operation === 'boundaries') {
      for (const key of ['root', 'maxDepth', 'edgeKinds']) {
        if (input[key] !== undefined) invalid(`${key} is only allowed for impact.`);
      }
      const scope = object(input.boundaryScope, ['label', 'objectIds'], 'boundaryScope');
      const label = text(scope.label, 120, 'boundaryScope.label');
      const objectIds = array(scope.objectIds, MAX_NODES, 'boundaryScope.objectIds').map(id => text(id, 100, 'boundaryScope.objectIds'));
      const members = new Set(objectIds);
      if (!members.size || members.size !== objectIds.length) invalid('Boundary objectIds must be non-empty and unique.');
      const nodes = new Map(graph.nodes.map(node => [node.id, node]));
      if (objectIds.some(id => !nodes.has(id) || ['TR', 'DYNAMIC', 'TVARVC'].includes(nodes.get(id)!.type))) {
        invalid('Boundary objectIds must reference existing repository nodes, not TR/DYNAMIC/TVARVC nodes.');
      }
      analysis = transportBoundaries(graph, { label, objectIds }, integer(input.maxEntries, 200, 500, 'maxEntries'));
    } else {
      const root = text(input.root, 100, 'root');
      if (!graph.nodes.some(node => node.id === root)) invalid('root must exist in graph.nodes.');
      const maxDepth = integer(input.maxDepth, 3, 10, 'maxDepth');
      const maxEntries = integer(input.maxEntries, 200, 500, 'maxEntries');
      let edgeKinds: GraphEdgeKind[] | undefined;
      if (input.edgeKinds !== undefined) {
        edgeKinds = array(input.edgeKinds, GRAPH_EDGE_KINDS.length, 'edgeKinds').map(edgeKind);
      }
      analysis = dependencyImpact(graph, root, { maxDepth, maxEntries, edgeKinds });
    }
    const result = {
      scope: 'caller-supplied-snapshot', sapConnectionVerified: false, evidenceVerified: false,
      operation: input.operation, analysis,
      notes: [
        'Local analysis only. Missing edges, stale data and dynamic calls outside this snapshot are not discovered; an empty impact is not proof of no SAP impact.',
        'Sources are caller-supplied labels, not verified evidence. LOADS is not CALLS; CO_TRANSPORTED is correlation, not a proven code dependency.',
        'Impact completeness refers only to reachable nodes in the supplied snapshot and selected edge kinds; it never means system-wide completeness.'
      ]
    };
    const structuredContent = { status: 'success', result };
    return { content: [{ type: 'text', text: serializeJsonText(structuredContent) }], structuredContent };
  }
}

function invalid(message: string): never { throw new McpError(ErrorCode.InvalidParams, message); }
function object(value: unknown, allowed: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object.`);
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid(`${label} contains unsupported fields.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || !value.length || value.length > max
    || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) invalid(`${label} must be a non-empty bounded string without surrounding whitespace or control characters.`);
  return value;
}
function array(value: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid(`${label} must be an array with at most ${max} entries.`);
  return value;
}
function integer(value: unknown, fallback: number, max: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) invalid(`${label} must be an integer between 1 and ${max}.`);
  return value;
}
function edgeKind(value: unknown): GraphEdgeKind {
  if (!GRAPH_EDGE_KINDS.includes(value as GraphEdgeKind)) invalid('Unsupported graph edge kind.');
  return value as GraphEdgeKind;
}
function snapshot(value: unknown): DependencySnapshot {
  const graph = object(value, ['nodes', 'edges'], 'graph');
  const ids = new Set<string>();
  const nodes = array(graph.nodes, MAX_NODES, 'nodes').map(value => {
    const raw = object(value, ['id', 'name', 'type', 'package'], 'node');
    const name = text(raw.name, 80, 'node.name');
    const type = text(raw.type, 16, 'node.type');
    const id = text(raw.id, 100, 'node.id');
    if (!/^[A-Z0-9_/=$%<>~.-]+$/.test(name) || !/^[A-Z0-9_]+$/.test(type)
      || id !== `${type}:${name}`) invalid('Node id must be canonical uppercase TYPE:NAME matching its type and name.');
    if (ids.has(id)) invalid('Duplicate node ids are not allowed.');
    ids.add(id);
    const packageName = raw.package === undefined ? undefined : text(raw.package, 80, 'node.package');
    return { id, name, type, ...(packageName === undefined ? {} : { package: packageName }) };
  });
  const edges = array(graph.edges, MAX_EDGES, 'edges').map(value => {
    const raw = object(value, ['from', 'to', 'kind', 'source'], 'edge');
    const from = text(raw.from, 100, 'edge.from');
    const to = text(raw.to, 100, 'edge.to');
    if (!ids.has(from) || !ids.has(to)) invalid('Every edge endpoint must exist in graph.nodes.');
    return { from, to, kind: edgeKind(raw.kind), source: text(raw.source, 80, 'edge.source') };
  });
  return { nodes, edges };
}
