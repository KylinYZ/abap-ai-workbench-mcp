/**
 * 受控 UI5/Fiori BSP filestore 写入工具处理器（ui5.write 受控链——F5）。
 *
 * 三工具（仅 DEV 角色 + development/development-workbench；门控同文本池受控链）：
 *   1. previewUi5Operation   —— 只读预检（存在性/漂移基线/内容上限）并冻结 immutable plan
 *   2. applyUi5Operation     —— 原生确认后单次执行（漂移复核 → 写 → readback）
 *   3. getUi5OperationStatus —— 本地 plan 状态查询
 */
import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ElicitRequestFormParams, ElicitResult } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import { SafeAbapError } from '../safe/errors.js';
import type { Ui5WriteWorkflow } from '../safe/Ui5WriteWorkflow.js';
import { serializeJsonText } from '../lib/jsonResponse';

const UI5_WRITE_TOOL_NAMES = new Set(['previewUi5Operation', 'applyUi5Operation', 'getUi5OperationStatus']);

export interface Ui5WriteConfirmationOptions {
  supportsFormElicitation: () => boolean;
  elicitInput: (params: ElicitRequestFormParams, timeoutMs: number) => Promise<ElicitResult>;
  /** 部署级自动确认开关（SAP_MCP_CONFIRMATION_MODE=auto 且 DEV 时由接线层注入）。 */
  autoApprove?: () => boolean;
  /** 确认表单摘要（接线层用 workflow.status 包装）。 */
  planSummary: (planId: string) => {
    kind: string; appName: string; filePath?: string; fileCount?: number; systemHost: string; client: string;
  };
}

export class Ui5WriteHandlers {
  constructor(
    private readonly workflow: Ui5WriteWorkflow,
    private readonly confirmation: Ui5WriteConfirmationOptions
  ) {}

  supports(toolName: string): boolean {
    return UI5_WRITE_TOOL_NAMES.has(toolName);
  }

  getTools(): ToolDefinition[] {
    const common = {
      appName: { type: 'string', description: 'Target UI5 BSP application name (A-Z 0-9 _ $, optional one-level namespace like /NS/APP).', minLength: 1, maxLength: 40 },
      transport: { type: 'string', description: 'Optional transport/correction number (corrNr; create_app/delete_app).', optional: true }
    };
    return [
      {
        name: 'previewUi5Operation',
        description: 'Read-only precheck for one UI5 filestore write (kind: create_app/upload_file/delete_file/delete_app): existence + drift baseline + content limits, then freeze an immutable plan for native confirmation.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', description: 'Write operation kind.', enum: ['create_app', 'upload_file', 'delete_file', 'delete_app'] },
            ...common,
            description: { type: 'string', description: 'create_app: application description (<=60 chars).', optional: true },
            packageName: { type: 'string', description: 'create_app: development package (required).', optional: true },
            filePath: { type: 'string', description: 'upload_file/delete_file: file path relative to the app root.', optional: true },
            content: { type: 'string', description: 'upload_file: file content (<=2 MiB).', optional: true },
            contentType: { type: 'string', description: 'upload_file: Content-Type (default application/octet-stream).', optional: true }
          },
          required: ['kind', 'appName']
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      },
      {
        name: 'applyUi5Operation',
        description: 'Open one native confirmation and apply one frozen UI5 write plan exactly once (drift recheck → POST/PUT/DELETE → readback). Requires a stateful ADT session.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { ui5WritePlanId: { type: 'string', minLength: 1 } },
          required: ['ui5WritePlanId']
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        _meta: { operationClass: 'mutating tenant', approvalRequired: true }
      },
      {
        name: 'getUi5OperationStatus',
        description: 'Read local status for one UI5 write plan without contacting SAP.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { ui5WritePlanId: { type: 'string', minLength: 1 } },
          required: ['ui5WritePlanId']
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { operationClass: 'local-only', approvalRequired: false }
      }
    ];
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'previewUi5Operation') {
        return success(await this.workflow.preview(argumentsValue as never));
      }
      if (toolName === 'applyUi5Operation') {
        const planId = String(argumentsValue.ui5WritePlanId || '');
        if (!planId) throw new McpError(ErrorCode.InvalidParams, 'applyUi5Operation requires ui5WritePlanId.');
        await this.confirm(planId);
        return success(await this.workflow.applyConfirmed(planId));
      }
      if (toolName === 'getUi5OperationStatus') {
        const planId = String(argumentsValue.ui5WritePlanId || '');
        if (!planId) throw new McpError(ErrorCode.InvalidParams, 'getUi5OperationStatus requires ui5WritePlanId.');
        return success(this.workflow.status(planId));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown UI5 write tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError || error instanceof SafeAbapError) throw error;
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }

  private async confirm(planId: string): Promise<void> {
    // 部署级自动确认开关：SAP_MCP_CONFIRMATION_MODE=auto（仅 DEV）时跳过人工表单；
    // plan 状态校验仍由 workflow.applyConfirmed 执行。
    if (this.confirmation.autoApprove?.()) return;
    if (!this.confirmation.supportsFormElicitation()) {
      throw new SafeAbapError('CONFIRMATION_UNSUPPORTED', 'confirmation', 'UI5 filestore writes require MCP form elicitation.');
    }
    const plan = this.confirmation.planSummary(planId);
    const target = `${plan.appName}${plan.filePath ? `/${plan.filePath}` : ''}`;
    const impact = plan.kind === 'delete_app' && plan.fileCount !== undefined ? ` ${plan.fileCount} tree entries` : '';
    const params: ElicitRequestFormParams = {
      mode: 'form',
      message: `${plan.kind} on UI5 app ${target}${impact} · ${plan.systemHost}/${plan.client} · This is a repository write executed once.`,
      requestedSchema: {
        type: 'object',
        properties: { decision: { type: 'string', enum: ['apply', 'cancel'] } },
        required: ['decision']
      }
    };
    const elicited = await this.confirmation.elicitInput(params, 60000);
    if (elicited.action !== 'accept' || elicited.content?.decision !== 'apply') {
      throw new SafeAbapError('POLICY_DENIED', 'confirmation', 'UI5 filestore write was not confirmed by the user.');
    }
  }
}

function success(result: unknown): Record<string, any> {
  const structuredContent = { status: 'success', result };
  return {
    content: [{ type: 'text', text: serializeJsonText(structuredContent) }],
    structuredContent
  };
}
