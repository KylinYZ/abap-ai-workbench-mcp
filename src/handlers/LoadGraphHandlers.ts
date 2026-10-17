/**
 * D010INC 加载图只读工具处理器（矩阵行 analysis.history 的 loads 子操作）。
 *
 * 单工具 getLoadGraph：
 *   - D010INC 编译期加载图（MASTER loads INCLUDE），down/up/双向；
 *   - 与 getCrHistory/getCoChange 同一 datapreview SQL 通道（只读、decode、不重试）；
 *   - 对象名处理器层 token 预检，API 层引号转义（纵深防御）。
 */
import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type { LoadGraphClient } from '../adt/LoadGraphApi.js';
import { buildLoadDependencyGraph, LoadDependencyInputError, type LoadDependencyInput } from '../adt/LoadDependencyGraph.js';
import { serializeJsonText } from '../lib/jsonResponse';

type LoadGraphToolDefinition = ToolDefinition & {
  annotations: {
    readOnlyHint: true;
    destructiveHint: false;
    idempotentHint: true;
    openWorldHint: true;
  };
  _meta: {
    operationClass: 'read-only tenant';
    approvalRequired: false;
  };
};

const LOAD_GRAPH_TOOL_NAMES = new Set(['getLoadGraph', 'buildLoadDependencyGraph']);

export class LoadGraphHandlers {
  constructor(private readonly loadGraph: LoadGraphClient) {}

  supports(toolName: string): boolean {
    return LOAD_GRAPH_TOOL_NAMES.has(toolName);
  }

  getTools(): LoadGraphToolDefinition[] {
    return [
      {
        name: 'buildLoadDependencyGraph',
        description: 'Build a bounded multi-hop D010INC LOADS graph using serial read-only queries. loaded_by (default) follows reverse loads and includes snapshot impact; loads follows dependencies. Not CALLS, not system-wide impact. Always inspect collection issues/unexpanded nodes and limits; empty results do not prove no impact. FUGR reverse expansion is unsupported. No new writes, locks or automatic retries.',
        inputSchema: {
          type: 'object', additionalProperties: false, required: ['objectType', 'objectName'],
          properties: {
            objectType: { type: 'string', enum: ['CLAS', 'INTF', 'PROG', 'FUGR'] },
            objectName: { type: 'string', minLength: 1, maxLength: 40 },
            direction: { type: 'string', enum: ['loads', 'loaded_by'], description: 'Default loaded_by. FUGR root requires loads.' },
            maxDepth: { type: 'integer', minimum: 1, maximum: 3, description: 'Default 2. Frontier nodes are returned as unexpanded.' },
            maxQueries: { type: 'integer', minimum: 1, maximum: 10, description: 'Default 5, strict total sequential query budget.' },
            maxNodes: { type: 'integer', minimum: 1, maximum: 500, description: 'Default 100, including root.' },
            maxEdges: { type: 'integer', minimum: 1, maximum: 2000, description: 'Default 200.' }
          }
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      },
      {
        name: 'getLoadGraph',
        description:
          'Read the compile-time load graph from D010INC: what a compiled unit must load to run (loads), or what loads it (loaded_by). Unlike cross-reference tables this captures INCLUDE-split dependencies that appear nowhere else; loads are not calls. Padded pool names are normalized back to repository objects, containment and kernel-machinery rows are dropped. Read-only SQL.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            objectName: {
              type: 'string',
              description: 'Object name, e.g. ZCL_FOO, ZREPORT01 or a function group ZFG.',
              minLength: 1,
              maxLength: 40
            },
            direction: {
              type: 'string',
              description: '"loads" (what this pulls in), "loaded_by" (what pulls this in), or "both". Default "loads".',
              enum: ['loads', 'loaded_by', 'both'],
              optional: true
            }
          },
          required: ['objectName']
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      }
    ];
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'buildLoadDependencyGraph') {
        const allowed = ['objectType', 'objectName', 'direction', 'maxDepth', 'maxQueries', 'maxNodes', 'maxEdges'];
        if (!argumentsValue || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)
          || Object.keys(argumentsValue).some(key => !allowed.includes(key))) throw invalid('Unsupported load dependency graph arguments.');
        const result = await buildLoadDependencyGraph(this.loadGraph, argumentsValue as unknown as LoadDependencyInput);
        const structuredContent = { status: 'success', result };
        return { content: [{ type: 'text', text: serializeJsonText(structuredContent) }], structuredContent };
      }
      if (toolName !== 'getLoadGraph') {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown load-graph tool: ${toolName}`);
      }
      const objectName = typeof argumentsValue?.objectName === 'string' ? argumentsValue.objectName.trim().toUpperCase() : '';
      if (!objectName || objectName.length > 40 || !/^[A-Z0-9_/]+$/.test(objectName)) {
        throw invalid('getLoadGraph requires objectName: a non-empty object name of at most 40 characters matching [A-Z0-9_/].');
      }
      const direction = typeof argumentsValue?.direction === 'string' ? argumentsValue.direction : undefined;
      const result = await this.loadGraph.getLoadGraph({ objectName, ...(direction ? { direction } : {}) });
      return {
        content: [{ type: 'text', text: serializeJsonText({ status: 'success', result }) }],
        structuredContent: { status: 'success', result }
      };
    } catch (error) {
      if (error instanceof McpError) throw error;
      if (error instanceof LoadDependencyInputError) throw invalid(error.message);
      // API 层的参数校验错误（direction/token 语义）按 InvalidParams 透传，
      // 其余底层异常脱敏为 InternalError
      const message = error instanceof Error ? error.message : String(error);
      if (/must be "loads"|is invalid \(A-Z 0-9/.test(message)) {
        throw invalid(message);
      }
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }
}

function invalid(message: string): McpError {
  return new McpError(ErrorCode.InvalidParams, message);
}
