/**
 * 受控消息类文本写入工具处理器（矩阵行 i18n.write 的 write_message_texts）。
 *
 * 三个工具（仅 DEV 受控 profiles；门控同描述/克隆受控链）：
 *   1. previewMessageTextChange   —— 只读读现文本并冻结 immutable plan
 *   2. applyMessageTextChange     —— 原生确认后单次执行（锁 → PUT → 解锁 → readback）
 *   3. getMessageTextChangeStatus —— 本地 plan 状态查询
 */
import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import { ConfirmationRequiredError } from '../lib/MrtrElicitation.js';
import type { ToolDefinition } from '../types/tools.js';
import { SafeAbapError } from '../safe/errors.js';
import type { MessageTextWorkflow } from '../safe/MessageTextWorkflow.js';
import type { ElicitRequestFormParams, ElicitResult } from '../lib/McpErrorCompat.js';
import { serializeJsonText } from '../lib/jsonResponse';

const MESSAGE_TEXT_TOOL_NAMES = new Set([
  'previewMessageTextChange', 'applyMessageTextChange', 'getMessageTextChangeStatus'
]);

type MessageTextToolDefinition = ToolDefinition & {
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  _meta: { operationClass: 'read-only tenant' | 'mutating tenant' | 'local-only'; approvalRequired: boolean };
};

export interface MessageTextConfirmationOptions {
  supportsFormElicitation: () => boolean;
  elicitInput: (params: ElicitRequestFormParams, timeoutMs: number) => Promise<ElicitResult>;
  /**
   * 部署级自动确认开关（SAP_MCP_CONFIRMATION_MODE=auto 且 DEV 时由接线层注入）：
   * 返回 true 时跳过人工表单确认，plan 状态校验仍由 workflow.applyConfirmed 执行。
   * 工具调用方永远无法通过参数触发此路径。
   */
  autoApprove?: () => boolean;
}

export class MessageTextHandlers {
  constructor(
    private readonly workflow: MessageTextWorkflow,
    private readonly confirmation: MessageTextConfirmationOptions
  ) {}

  supports(toolName: string): boolean {
    return MESSAGE_TEXT_TOOL_NAMES.has(toolName);
  }

  getTools(): MessageTextToolDefinition[] {
    const textsSchema = {
      type: 'array',
      description: 'Complete text list for this language (replaces the whole set).',
      minItems: 1, maxItems: 999,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          number: { type: 'string', description: '3-digit message number (001-999).', minLength: 3, maxLength: 3 },
          text: { type: 'string', description: 'Message text.', minLength: 1, maxLength: 200 }
        },
        required: ['number', 'text']
      }
    };
    const common = {
      messageClass: { type: 'string', description: 'Message class name.', minLength: 2, maxLength: 20 },
      language: { type: 'string', description: '2-letter ISO language code (EN/DE/ZH...).', minLength: 2, maxLength: 2 },
      transport: { type: 'string', description: 'Optional 10-character transport request.', optional: true }
    };
    return [
      {
        name: 'previewMessageTextChange',
        description: 'Read current message class texts and freeze an immutable plan (old/new lists) for native confirmation. Read-only.',
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: { ...common, texts: textsSchema },
          required: ['messageClass', 'language', 'texts']
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      },
      {
        name: 'applyMessageTextChange',
        description: 'Open one native confirmation and apply one frozen message text plan exactly once (lock → PUT → unlock → readback). Requires a stateful ADT session.',
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: { messageTextPlanId: { type: 'string', minLength: 1 } },
          required: ['messageTextPlanId']
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        _meta: { operationClass: 'mutating tenant', approvalRequired: true }
      },
      {
        name: 'getMessageTextChangeStatus',
        description: 'Read local status for one message text plan without contacting SAP.',
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: { messageTextPlanId: { type: 'string', minLength: 1 } },
          required: ['messageTextPlanId']
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { operationClass: 'local-only', approvalRequired: false }
      }
    ];
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'previewMessageTextChange') {
        return success(await this.workflow.preview(argumentsValue as never));
      }
      if (toolName === 'applyMessageTextChange') {
        const planId = String(argumentsValue.messageTextPlanId || '');
        if (!planId) throw new McpError(ErrorCode.InvalidParams, 'applyMessageTextChange requires messageTextPlanId.');
        await this.confirm(planId);
        return success(await this.workflow.applyConfirmed(planId));
      }
      if (toolName === 'getMessageTextChangeStatus') {
        return success(await Promise.resolve(this.workflow.status(String(argumentsValue.messageTextPlanId || ''))));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown message text tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError || error instanceof SafeAbapError || error instanceof ConfirmationRequiredError) throw error;
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }

  private async confirm(planId: string): Promise<void> {
    // 部署配置预授权：跳过人工表单确认，plan 状态校验由 workflow.applyConfirmed 兜底
    if (this.confirmation.autoApprove?.()) return;
    if (!this.confirmation.supportsFormElicitation()) {
      throw new SafeAbapError('CONFIRMATION_UNSUPPORTED', 'confirmation', 'Message text write requires MCP form elicitation.');
    }
    const plan = this.workflow.status(planId);
    const params: ElicitRequestFormParams = {
      mode: 'form',
      message: `Write ${plan.newTexts.length} message texts to class ${plan.messageClass} (${plan.language}) · ${plan.systemHost}/${plan.client} · This is a repository write executed once.`,
      requestedSchema: {
        type: 'object',
        properties: { decision: { type: 'string', enum: ['apply', 'cancel'] } },
        required: ['decision']
      }
    };
    const elicited = await this.confirmation.elicitInput(params, 60000);
    if (elicited.action !== 'accept' || elicited.content?.decision !== 'apply') {
      throw new SafeAbapError('POLICY_DENIED', 'confirmation', 'Message text write was not confirmed by the user.');
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
