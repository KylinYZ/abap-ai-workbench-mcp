/**
 * 受控描述修改工具处理器（矩阵行 crud.set-description 的受控写链）。
 *
 * 三个工具（全部面向 DEV 受控 profiles）：
 *   1. previewDescriptionChange    —— 只读预检并冻结 immutable plan
 *   2. applyDescriptionChange      —— 原生表单确认后单次执行（锁链内建）
 *   3. getDescriptionChangeStatus  —— 本地 plan 状态查询
 *
 * 门控：preview/read status 为 read-only/local；apply 为受控写（advanced-mutation），
 * 仅 DEV + development/development-workbench（ToolOperationPolicy 控制）；
 * 确认仅走 MCP form elicitation（decision=apply），不支持调用方布尔确认。
 */
import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import { ConfirmationRequiredError } from '../lib/MrtrElicitation.js';
import type { ToolDefinition } from '../types/tools.js';
import { SafeAbapError } from '../safe/errors.js';
import type { DescriptionChangeWorkflow } from '../safe/DescriptionChangeWorkflow.js';
import type { ElicitRequestFormParams, ElicitResult } from '../lib/McpErrorCompat.js';
import { serializeJsonText } from '../lib/jsonResponse';

const DESCRIPTION_TOOL_NAMES = new Set([
  'previewDescriptionChange', 'applyDescriptionChange', 'getDescriptionChangeStatus'
]);

type DescriptionToolDefinition = ToolDefinition & {
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  _meta: { operationClass: 'read-only tenant' | 'mutating tenant' | 'local-only'; approvalRequired: boolean };
};

export interface DescriptionChangeConfirmationOptions {
  supportsFormElicitation: () => boolean;
  elicitInput: (params: ElicitRequestFormParams, timeoutMs: number) => Promise<ElicitResult>;
  /**
   * 部署级自动确认开关（SAP_MCP_CONFIRMATION_MODE=auto 且 DEV 时由接线层注入）：
   * 返回 true 时跳过人工表单确认，plan 状态校验仍由 workflow.applyConfirmed 执行。
   * 工具调用方永远无法通过参数触发此路径。
   */
  autoApprove?: () => boolean;
}

export class DescriptionChangeHandlers {
  constructor(
    private readonly workflow: DescriptionChangeWorkflow,
    private readonly confirmation: DescriptionChangeConfirmationOptions
  ) {}

  supports(toolName: string): boolean {
    return DESCRIPTION_TOOL_NAMES.has(toolName);
  }

  getTools(): DescriptionToolDefinition[] {
    const meta = {
      readOnly: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      local: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      write: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    } as const;
    const objectProps = {
      objectType: { type: 'string', enum: ['PROG', 'CLAS', 'INTF', 'INCL'], description: 'Object type.' },
      name: { type: 'string', description: 'Exact SAP object name.', minLength: 1, maxLength: 40 },
      description: { type: 'string', description: 'New short text (1-120 characters).', minLength: 1, maxLength: 120 },
      transport: { type: 'string', description: 'Optional 10-character transport request for the write.', optional: true }
    };
    return [
      {
        name: 'previewDescriptionChange',
        description: 'Validate and preview a description change (object short text) without writing: freezes the old/new description into an immutable plan for native confirmation.',
        inputSchema: { type: 'object', additionalProperties: false, properties: objectProps, required: ['objectType', 'name', 'description'] },
        annotations: meta.readOnly,
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      },
      {
        name: 'applyDescriptionChange',
        description: 'Open one native confirmation and apply one frozen description change exactly once. Locks the object, rewrites the adtcore:description attribute, unlocks, and readbacks.',
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: { descriptionPlanId: { type: 'string', description: 'Plan id from previewDescriptionChange.', minLength: 1 } },
          required: ['descriptionPlanId']
        },
        annotations: meta.write,
        _meta: { operationClass: 'mutating tenant', approvalRequired: true }
      },
      {
        name: 'getDescriptionChangeStatus',
        description: 'Read local status for one description change plan without contacting SAP.',
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: { descriptionPlanId: { type: 'string', minLength: 1 } }, required: ['descriptionPlanId']
        },
        annotations: meta.local,
        _meta: { operationClass: 'local-only', approvalRequired: false }
      }
    ];
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'previewDescriptionChange') {
        return success(await this.workflow.preview(argumentsValue as never));
      }
      if (toolName === 'applyDescriptionChange') {
        const planId = String(argumentsValue.descriptionPlanId || '');
        if (!planId) throw new McpError(ErrorCode.InvalidParams, 'applyDescriptionChange requires descriptionPlanId.');
        // 原生确认（form elicitation）→ 单次执行
        await this.confirm(planId);
        return success(await this.workflow.applyConfirmed(planId));
      }
      if (toolName === 'getDescriptionChangeStatus') {
        return success(await Promise.resolve(this.workflow.status(String(argumentsValue.descriptionPlanId || ''))));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown description change tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError || error instanceof SafeAbapError || error instanceof ConfirmationRequiredError) throw error;
      // 底层异常脱敏（可能含目标系统细节）
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }

  /** 原生表单确认：不支持 elicitation 直接拒绝（不降级文本确认）。 */
  private async confirm(planId: string): Promise<void> {
    // 部署配置预授权：跳过人工表单确认，plan 状态校验由 workflow.applyConfirmed 兜底
    if (this.confirmation.autoApprove?.()) return;
    if (!this.confirmation.supportsFormElicitation()) {
      throw new SafeAbapError('CONFIRMATION_UNSUPPORTED', 'confirmation', 'Description change requires MCP form elicitation.');
    }
    const plan = this.workflow.status(planId);
    const params: ElicitRequestFormParams = {
      mode: 'form',
      message: `Change ${plan.objectType} ${plan.name} description · ${plan.systemHost}/${plan.client} · "${plan.oldDescription}" -> "${plan.newDescription}" · This is a repository write executed once.`,
      requestedSchema: {
        type: 'object',
        properties: { decision: { type: 'string', enum: ['apply', 'cancel'] } },
        required: ['decision']
      }
    };
    const elicited = await this.confirmation.elicitInput(params, 60000);
    if (elicited.action !== 'accept' || elicited.content?.decision !== 'apply') {
      throw new SafeAbapError('POLICY_DENIED', 'confirmation', 'Description change was not confirmed by the user.');
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
