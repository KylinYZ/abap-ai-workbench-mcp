/**
 * 受控对象重命名工具处理器（矩阵行 refactor.rename 的一站式受控重命名）。
 *
 * 三个工具（全部面向 DEV 受控 profiles）：
 *   1. previewControlledRename   —— 只读预检（读源快照+声明改名）并冻结 immutable plan
 *   2. applyControlledRename     —— 原生表单确认后单次执行（克隆落地新对象+受控删除旧对象）
 *   3. getControlledRenameStatus —— 本地 plan 状态查询
 *
 * 门控：preview/status 为 read-only/local；apply 为受控写（advanced-mutation），
 * 仅 DEV + development/development-workbench（ToolOperationPolicy 控制）；
 * 确认仅走 MCP form elicitation（decision=apply），不支持调用方布尔确认。
 * 一次确认覆盖"创建新对象+删除旧对象"两步（删除旧对象是重命名语义的
 * 固有组成，确认消息显式标注两步副作用）。
 */
import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import { ConfirmationRequiredError } from '../lib/MrtrElicitation.js';
import type { ToolDefinition } from '../types/tools.js';
import { SafeAbapError } from '../safe/errors.js';
import type { RenameControlledWorkflow } from '../safe/RenameControlledWorkflow.js';
import type { ElicitRequestFormParams, ElicitResult } from '../lib/McpErrorCompat.js';
import { serializeJsonText } from '../lib/jsonResponse';

const RENAME_TOOL_NAMES = new Set([
  'previewControlledRename', 'applyControlledRename', 'getControlledRenameStatus'
]);

type RenameToolDefinition = ToolDefinition & {
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  _meta: { operationClass: 'read-only tenant' | 'mutating tenant' | 'local-only'; approvalRequired: boolean };
};

export interface RenameConfirmationOptions {
  supportsFormElicitation: () => boolean;
  elicitInput: (params: ElicitRequestFormParams, timeoutMs: number) => Promise<ElicitResult>;
  /**
   * 部署级自动确认开关（SAP_MCP_CONFIRMATION_MODE=auto 且 DEV 时由接线层注入）：
   * 返回 true 时跳过人工表单确认，plan 状态校验仍由 workflow.applyConfirmed 执行。
   * 工具调用方永远无法通过参数触发此路径。
   */
  autoApprove?: () => boolean;
}

export class RenameControlledHandlers {
  constructor(
    private readonly workflow: RenameControlledWorkflow,
    private readonly confirmation: RenameConfirmationOptions
  ) {}

  supports(toolName: string): boolean {
    return RENAME_TOOL_NAMES.has(toolName);
  }

  getTools(): RenameToolDefinition[] {
    const meta = {
      readOnly: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      local: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      write: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    } as const;
    const previewProps = {
      objectType: { type: 'string', enum: ['PROGRAM', 'ABAP_CLASS', 'ABAP_INTERFACE'], description: 'Object type to rename.' },
      oldName: { type: 'string', description: 'Existing object name to rename from.', minLength: 3, maxLength: 40 },
      newName: { type: 'string', description: 'New object name.', minLength: 3, maxLength: 40 },
      packageName: { type: 'string', description: 'Package of the renamed object.', minLength: 3, maxLength: 30 },
      transport: { type: 'string', description: '10-character transport request for both the create and the delete.', minLength: 10, maxLength: 10 },
      description: { type: 'string', description: 'Optional new object description (default: "Renamed from <oldName>").', maxLength: 120, optional: true }
    };
    return [
      {
        name: 'previewControlledRename',
        description: 'Validate and preview a controlled object rename without writing SAP: reads the source snapshot, renames declarations locally, and freezes an immutable plan for native confirmation (create-new + delete-old in one confirmed apply).',
        inputSchema: { type: 'object', additionalProperties: false, properties: previewProps, required: ['objectType', 'oldName', 'newName', 'packageName', 'transport'] },
        annotations: meta.readOnly,
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      },
      {
        name: 'applyControlledRename',
        description: 'Open one native confirmation and apply one frozen rename plan exactly once: creates the new object via the controlled creation chain (shell, lock, source write, syntax check, activation, source-hash verification) and deletes the old object via the controlled cleanup chain. If the delete fails, the new object is kept and the old is left untouched (partial rename).',
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: { renamePlanId: { type: 'string', description: 'Plan id from previewControlledRename.', minLength: 1 } },
          required: ['renamePlanId']
        },
        annotations: meta.write,
        _meta: { operationClass: 'mutating tenant', approvalRequired: true }
      },
      {
        name: 'getControlledRenameStatus',
        description: 'Read local status for one rename plan without contacting SAP.',
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: { renamePlanId: { type: 'string', minLength: 1 } }, required: ['renamePlanId']
        },
        annotations: meta.local,
        _meta: { operationClass: 'local-only', approvalRequired: false }
      }
    ];
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'previewControlledRename') {
        return success(await this.workflow.preview(argumentsValue as never));
      }
      if (toolName === 'applyControlledRename') {
        const planId = String(argumentsValue.renamePlanId || '');
        if (!planId) throw new McpError(ErrorCode.InvalidParams, 'applyControlledRename requires renamePlanId.');
        // 原生确认（form elicitation）→ 单次执行
        await this.confirm(planId);
        return success(await this.workflow.applyConfirmed(planId));
      }
      if (toolName === 'getControlledRenameStatus') {
        return success(await Promise.resolve(this.workflow.status(String(argumentsValue.renamePlanId || ''))));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown controlled rename tool: ${toolName}`);
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
      throw new SafeAbapError('CONFIRMATION_UNSUPPORTED', 'confirmation', 'Controlled rename requires MCP form elicitation.');
    }
    const plan = this.workflow.status(planId);
    const params: ElicitRequestFormParams = {
      mode: 'form',
      message: `Rename ${plan.objectType} ${plan.oldName} -> ${plan.newName} (package ${plan.packageName}) · ${plan.systemHost}/${plan.client} · This creates ${plan.newName} AND deletes ${plan.oldName} in one confirmed apply.`,
      requestedSchema: {
        type: 'object',
        properties: { decision: { type: 'string', enum: ['apply', 'cancel'] } },
        required: ['decision']
      }
    };
    const elicited = await this.confirmation.elicitInput(params, 60000);
    if (elicited.action !== 'accept' || elicited.content?.decision !== 'apply') {
      throw new SafeAbapError('POLICY_DENIED', 'confirmation', 'Rename was not confirmed by the user.');
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
