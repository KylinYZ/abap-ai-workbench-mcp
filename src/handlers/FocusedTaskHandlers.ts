import { McpError, ErrorCode } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import { serializeJsonText } from '../lib/jsonResponse';

type ToolCall = (toolName: string, argumentsValue: Record<string, unknown>) => Promise<unknown>;
type Healthcheck = () => unknown;

const ACTIONS = ['help', 'system', 'read', 'search', 'table', 'dump', 'diagnose', 'edit', 'create', 'check', 'test', 'debug', 'quality', 'transport'] as const;
type FocusedAction = typeof ACTIONS[number];

export class FocusedTaskHandlers {
  constructor(
    private readonly callTool: ToolCall,
    private readonly healthcheck: Healthcheck
  ) {}

  supports(toolName: string): boolean {
    return toolName === 'sap' || toolName === 'sapDoctor';
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'sap',
        description: 'Task-oriented ABAP workbench entry point. Use action=help first when unsure; actions delegate to the existing focused tools and return the next suggested step.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', enum: [...ACTIONS], description: 'help, system, read, search, table, dump, diagnose, edit, create, check, test, debug, quality, or transport' },
            params: { type: 'object', additionalProperties: true, description: 'Arguments for the selected action. Use the exact fields shown by sap(action=help).' }
          },
          required: ['action']
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      },
      {
        name: 'sapDoctor',
        description: 'Run a compact onboarding and troubleshooting preflight: local configuration plus bounded SAP ADT capability probes. Never writes SAP.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      }
    ];
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (toolName === 'sapDoctor') return this.runDoctor();
    if (toolName !== 'sap') throw new McpError(ErrorCode.MethodNotFound, `Unknown focused task tool: ${toolName}`);

    const action = String(argumentsValue.action || '').trim().toLowerCase() as FocusedAction;
    if (!ACTIONS.includes(action)) {
      throw new McpError(400, `sap action must be one of: ${ACTIONS.join(', ')}.`);
    }
    if (action === 'help') return render({ action, actions: this.help() });
    const params = isRecord(argumentsValue.params) ? argumentsValue.params : {};
    const delegatedTool = this.delegatedTool(action, params);
    if (!delegatedTool) throw new McpError(400, `sap action '${action}' is not available.`);
    const result = unwrapResult(await this.callTool(delegatedTool.name, delegatedTool.argumentsValue));
    return render({
      action,
      delegatedTool: delegatedTool.name,
      result,
      nextStep: nextStep(action)
    });
  }

  private delegatedTool(action: FocusedAction, params: Record<string, unknown>): { name: string; argumentsValue: Record<string, unknown> } | undefined {
    switch (action) {
      case 'system': return { name: 'inspectSapSystem', argumentsValue: {} };
      case 'read': return { name: 'inspectAbapObject', argumentsValue: params };
      case 'search': return { name: 'searchObject', argumentsValue: params };
      case 'table': return { name: 'describeClassicTable', argumentsValue: params };
      case 'dump': return { name: 'readRuntimeDumps', argumentsValue: params };
      case 'edit': return { name: 'previewAbapChange', argumentsValue: params };
      case 'create': return { name: 'previewAbapObjectCreation', argumentsValue: params };
      case 'check': return { name: 'syntaxCheckCode', argumentsValue: params };
      case 'test': return { name: 'unitTestEvaluation', argumentsValue: params };
      case 'debug': return { name: 'debuggerStackTrace', argumentsValue: params };
      case 'quality': return { name: 'previewQualityCheck', argumentsValue: params };
      case 'transport': return { name: 'transportInfo', argumentsValue: params };
      case 'diagnose':
        if (typeof params.from === 'string' || typeof params.to === 'string') return { name: 'readRuntimeDumps', argumentsValue: params };
        if (typeof params.tableName === 'string') return { name: 'describeClassicTable', argumentsValue: params };
        if (typeof params.objectName === 'string') return { name: 'inspectAbapObject', argumentsValue: params };
        return { name: 'inspectSapSystem', argumentsValue: {} };
      default: return undefined;
    }
  }

  private help(): Array<Record<string, unknown>> {
    return [
      { action: 'system', purpose: 'Check SAP ADT capability and target identity', params: {} },
      { action: 'read', purpose: 'Read one complete ABAP object', params: { objectType: 'CLASS', objectName: 'ZCL_EXAMPLE' } },
      { action: 'search', purpose: 'Search ABAP objects', params: { query: 'ZCL_*' } },
      { action: 'table', purpose: 'Describe a classic Dictionary table', params: { tableName: 'T000' } },
      { action: 'dump', purpose: 'Read bounded ST22 summaries', params: { from: '2026-01-01T00:00:00+08:00', to: '2026-01-01T01:00:00+08:00' } },
      { action: 'diagnose', purpose: 'Start with system checks, or use from/to for dumps', params: {} },
      { action: 'edit', purpose: 'Preview a complete source change; apply remains confirmation-bound', params: { objectType: 'PROGRAM', objectName: 'ZEXAMPLE', newSource: 'REPORT zexample.', transportRequest: 'DEVK900001' } },
      { action: 'create', purpose: 'Preview creation of one or more ABAP objects', params: { objects: [{ objectType: 'PROGRAM', objectName: 'ZEXAMPLE', source: 'REPORT zexample.' }], transportRequest: 'DEVK900001' } },
      { action: 'check', purpose: 'Run an ABAP syntax check', params: { code: 'WRITE / \'hello\'.' } },
      { action: 'test', purpose: 'Read the existing unit-test evaluation', params: {} },
      { action: 'debug', purpose: 'Read an existing debug stack', params: {} },
      { action: 'quality', purpose: 'Preview an ABAP Unit or ATC check', params: { kind: 'ABAP_UNIT', objects: [{ objectType: 'CLASS', objectName: 'ZCL_EXAMPLE' }] } },
      { action: 'transport', purpose: 'Read transport information for an object', params: { objectUrl: '/sap/bc/adt/oo/classes/zcl_example' } }
    ];
  }

  private async runDoctor(): Promise<Record<string, unknown>> {
    const local = this.healthcheck();
    const localRecord = isRecord(local) ? local : {};
    const target = isRecord(localRecord.configuredTarget) ? localRecord.configuredTarget : {};
    const localReady = ['host', 'client', 'toolProfile', 'systemRole'].every(key => String(target[key] || '').trim().length > 0);
    const checks: Array<Record<string, unknown>> = [
      { name: 'local-process', status: localRecord.status === 'healthy' ? 'PASS' : 'WARN', detail: local },
      { name: 'local-config', status: localReady ? 'PASS' : 'FAIL', detail: localReady ? 'Required target identity is configured.' : 'Missing host, client, profile, or system role.' }
    ];
    let remote: unknown;
    try {
      remote = await this.callTool('inspectSapSystem', {});
      const result = unwrapResult(remote) as Record<string, unknown>;
      const capabilities = isRecord(result.capabilities) ? result.capabilities : {};
      const statuses = Object.values(capabilities).map(value => isRecord(value) ? String(value.status || '') : '');
      checks.push({ name: 'sap-adt', status: result.sapConnectionVerified === true ? 'PASS' : 'WARN', detail: result });
      for (const [name, value] of Object.entries(capabilities)) {
        const status = isRecord(value) ? String(value.status || '') : '';
        checks.push({ name, status: status === 'CONFIRMED' ? 'PASS' : 'WARN', detail: isRecord(value) ? value.reasonCategory || value.summary : undefined });
      }
      return render({ status: localReady && statuses.length > 0 && statuses.every(status => status === 'CONFIRMED') ? 'READY' : 'CHECK_REQUIRED', checks, nextSteps: doctorNextSteps(checks) });
    } catch (error) {
      checks.push({ name: 'sap-adt', status: 'FAIL', detail: 'SAP capability probe failed.' });
      return render({ status: 'CHECK_REQUIRED', checks, nextSteps: ['Verify SAP_URL, SAP_USER, SAP_CLIENT, SAP_MCP_ALLOWED_HOSTS, and SAP_MCP_ALLOWED_CLIENTS.', 'Retry sapDoctor after confirming ADT login and authorization.'] });
    }
  }
}

function render(result: Record<string, unknown>): Record<string, unknown> {
  const structuredContent = { status: 'success', result };
  return { content: [{ type: 'text', text: serializeJsonText(structuredContent) }], structuredContent };
}

function unwrapResult(value: unknown): unknown {
  if (isRecord(value) && isRecord(value.structuredContent)) {
    if ('result' in value.structuredContent) return value.structuredContent.result;
    if ('plan' in value.structuredContent || value.structuredContent.status === 'preview') return value.structuredContent;
  }
  return value;
}

function nextStep(action: FocusedAction): string {
  if (action === 'edit') return 'Review the preview diff, then use the dedicated apply tool with its server-generated plan ID when ready.';
  if (action === 'create') return 'Review the object graph, then use the dedicated apply tool with its server-generated creation plan ID when ready.';
  if (action === 'quality') return 'Review the frozen check scope, then use the quality apply tool after native confirmation.';
  if (action === 'debug') return 'Use a dedicated debug preview before any control action; this entry point only reads the existing stack.';
  if (action === 'diagnose' || action === 'system') return 'Use the returned capability or error category to choose the next focused action.';
  return 'Use the delegated result to decide the next task action.';
}

function doctorNextSteps(checks: Array<Record<string, unknown>>): string[] {
  if (checks.every(check => check.status === 'PASS')) return ['SAP ADT is reachable. Start with sap(action=help) or sap(action=read/search).'];
  return ['Review the failed or warning check details.', 'Fix configuration, SAP authorization, or ADT availability, then run sapDoctor again.'];
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
