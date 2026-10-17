/**
 * 受控对象克隆工具处理器（矩阵行 crud.clone-object 的一站式受控克隆）。
 *
 * 三个工具（全部面向 DEV 受控 profiles）：
 *   1. previewCloneObject    —— 只读预检（读源快照+声明改名）并冻结 immutable plan
 *   2. applyCloneObject      —— 原生表单确认后单次执行（委托受控创建链）
 *   3. getCloneObjectStatus  —— 本地 plan 状态查询
 *
 * 门控：preview/status 为 read-only/local；apply 为受控写（advanced-mutation），
 * 仅 DEV + development/development-workbench（ToolOperationPolicy 控制）；
 * 确认仅走 MCP form elicitation（decision=apply），不支持调用方布尔确认。
 */
import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import { ConfirmationRequiredError } from '../lib/MrtrElicitation.js';
import type { ToolDefinition } from '../types/tools.js';
import { SafeAbapError } from '../safe/errors.js';
import type { CloneObjectWorkflow } from '../safe/CloneObjectWorkflow.js';
import type { ElicitRequestFormParams, ElicitResult } from '../lib/McpErrorCompat.js';
import { serializeJsonText } from '../lib/jsonResponse';

const CLONE_TOOL_NAMES = new Set([
  'previewCloneObject', 'applyCloneObject', 'getCloneObjectStatus'
]);

type CloneToolDefinition = ToolDefinition & {
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  _meta: { operationClass: 'read-only tenant' | 'mutating tenant' | 'local-only'; approvalRequired: boolean };
};

export interface CloneObjectConfirmationOptions {
  supportsFormElicitation: () => boolean;
  elicitInput: (params: ElicitRequestFormParams, timeoutMs: number) => Promise<ElicitResult>;
  /**
   * 部署级自动确认开关（SAP_MCP_CONFIRMATION_MODE=auto 且 DEV 时由接线层注入）：
   * 返回 true 时跳过人工表单确认，plan 状态校验仍由 workflow.applyConfirmed 执行。
   * 工具调用方永远无法通过参数触发此路径。
   */
  autoApprove?: () => boolean;
}

export class CloneObjectHandlers {
  constructor(
    private readonly workflow: CloneObjectWorkflow,
    private readonly confirmation: CloneObjectConfirmationOptions
  ) {}

  supports(toolName: string): boolean {
    return CLONE_TOOL_NAMES.has(toolName);
  }

  getTools(): CloneToolDefinition[] {
    const meta = {
      readOnly: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      local: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      write: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    } as const;
    const previewProps = {
      objectType: { type: 'string', enum: ['PROGRAM', 'ABAP_CLASS', 'ABAP_INTERFACE'], description: 'Object type to clone.' },
      sourceName: { type: 'string', description: 'Existing object name to clone from.', minLength: 3, maxLength: 40 },
      targetName: { type: 'string', description: 'New object name for the clone.', minLength: 3, maxLength: 40 },
      packageName: { type: 'string', description: 'Target package for the clone.', minLength: 3, maxLength: 30 },
      transport: { type: 'string', description: '10-character transport request for the write.', minLength: 10, maxLength: 10 },
      description: { type: 'string', description: 'Optional target description (default: "Copy of <sourceName>").', maxLength: 120, optional: true }
    };
    return [
      {
        name: 'previewCloneObject',
        description: 'Validate and preview a controlled object clone without writing SAP: reads the source snapshot, renames declarations locally, and freezes an immutable plan for native confirmation.',
        inputSchema: { type: 'object', additionalProperties: false, properties: previewProps, required: ['objectType', 'sourceName', 'targetName', 'packageName', 'transport'] },
        annotations: meta.readOnly,
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      },
      {
        name: 'applyCloneObject',
        description: 'Open one native confirmation and apply one frozen clone plan exactly once. Delegates to the controlled creation chain (shell create, lock, source write, syntax check, activation, source-hash verification, compensation on failure).',
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: { clonePlanId: { type: 'string', description: 'Plan id from previewCloneObject.', minLength: 1 } },
          required: ['clonePlanId']
        },
        annotations: meta.write,
        _meta: { operationClass: 'mutating tenant', approvalRequired: true }
      },
      {
        name: 'getCloneObjectStatus',
        description: 'Read local status for one clone plan without contacting SAP.',
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: { clonePlanId: { type: 'string', minLength: 1 } }, required: ['clonePlanId']
        },
        annotations: meta.local,
        _meta: { operationClass: 'local-only', approvalRequired: false }
      }
    ];
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'previewCloneObject') {
        return success(await this.workflow.preview(argumentsValue as never));
      }
      if (toolName === 'applyCloneObject') {
        const planId = String(argumentsValue.clonePlanId || '');
        if (!planId) throw new McpError(ErrorCode.InvalidParams, 'applyCloneObject requires clonePlanId.');
        // 原生确认（form elicitation）→ 单次执行
        await this.confirm(planId);
        return success(await this.workflow.applyConfirmed(planId));
      }
      if (toolName === 'getCloneObjectStatus') {
        return success(await Promise.resolve(this.workflow.status(String(argumentsValue.clonePlanId || ''))));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown clone object tool: ${toolName}`);
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
      throw new SafeAbapError('CONFIRMATION_UNSUPPORTED', 'confirmation', 'Clone requires MCP form elicitation.');
    }
    const plan = this.workflow.status(planId);
    const params: ElicitRequestFormParams = {
      mode: 'form',
      message: `Clone ${plan.objectType} ${plan.sourceName} -> ${plan.targetName} (package ${plan.packageName}) · ${plan.systemHost}/${plan.client} · This is a repository write executed once.`,
      requestedSchema: {
        type: 'object',
        properties: { decision: { type: 'string', enum: ['apply', 'cancel'] } },
        required: ['decision']
      }
    };
    const elicited = await this.confirmation.elicitInput(params, 60000);
    if (elicited.action !== 'accept' || elicited.content?.decision !== 'apply') {
      throw new SafeAbapError('POLICY_DENIED', 'confirmation', 'Clone was not confirmed by the user.');
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
