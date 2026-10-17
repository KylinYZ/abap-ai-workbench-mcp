/**
 * 受控程序文本池写入工具处理器（analysis/report 的 text pool 受控写——F1 完整方案）。
 *
 * 三工具（仅 DEV 受控 profiles；门控同消息文本受控链）：
 *   1. previewTextPoolChange   —— 只读读当前类别文本池并冻结 immutable plan
 *   2. applyTextPoolChange     —— 原生确认后单次执行（锁 → PUT → 解锁 → readback）
 *   3. getTextPoolChangeStatus —— 本地 plan 状态查询
 */
import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ElicitRequestFormParams, ElicitResult } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import { SafeAbapError } from '../safe/errors.js';
import type { TextPoolWorkflow } from '../safe/TextPoolWorkflow.js';
import { serializeJsonText } from '../lib/jsonResponse';

const TEXT_POOL_TOOL_NAMES = new Set(['previewTextPoolChange', 'applyTextPoolChange', 'getTextPoolChangeStatus']);

export interface TextPoolConfirmationOptions {
  supportsFormElicitation: () => boolean;
  elicitInput: (params: ElicitRequestFormParams, timeoutMs: number) => Promise<ElicitResult>;
  /** 部署级自动确认开关（SAP_MCP_CONFIRMATION_MODE=auto 且 DEV 时由接线层注入）。 */
  autoApprove?: () => boolean;
  /** 确认表单摘要（接线层用 workflow.status 包装）。 */
  planSummary: (planId: string) => { program: string; category: string; newCount: number; systemHost: string; client: string };
}

export class TextPoolHandlers {
  constructor(
    private readonly workflow: TextPoolWorkflow,
    private readonly confirmation: TextPoolConfirmationOptions
  ) {}

  supports(toolName: string): boolean {
    return TEXT_POOL_TOOL_NAMES.has(toolName);
  }

  getTools(): ToolDefinition[] {
    const elementsSchema = {
      type: 'array',
      description: 'Complete text pool list for this category (replaces the whole set).',
      minItems: 0,
      maxItems: 999,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text'],
        properties: {
          id: { type: 'string', description: 'symbols: 3-char number; selections: parameter name (<=8); headings: LISTHEADER/COLUMNHEADER_1-4.' },
          text: { type: 'string', description: 'Element text.' },
          maxLength: { type: 'number', description: 'symbols only: @MaxLength directive (default 132).', minimum: 1, maximum: 132, optional: true }
        }
      }
    };
    const common = {
      program: { type: 'string', description: 'Target program name.', minLength: 1, maxLength: 30 },
      category: { type: 'string', description: 'Text pool category.', enum: ['symbols', 'selections', 'headings'] }
    };
    return [
      {
        name: 'previewTextPoolChange',
        description: 'Read the current text pool of a program and freeze an immutable plan (old/new lists) for native confirmation. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { ...common, elements: elementsSchema, transport: { type: 'string', description: 'Optional transport/correction number.', optional: true } },
          required: ['program', 'category', 'elements']
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      },
      {
        name: 'applyTextPoolChange',
        description: 'Open one native confirmation and apply one frozen text pool plan exactly once (lock → PUT → unlock → readback). Requires a stateful ADT session.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { textPoolPlanId: { type: 'string', minLength: 1 } },
          required: ['textPoolPlanId']
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        _meta: { operationClass: 'mutating tenant', approvalRequired: true }
      },
      {
        name: 'getTextPoolChangeStatus',
        description: 'Read local status for one text pool plan without contacting SAP.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { textPoolPlanId: { type: 'string', minLength: 1 } },
          required: ['textPoolPlanId']
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { operationClass: 'local-only', approvalRequired: false }
      }
    ];
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'previewTextPoolChange') {
        return success(await this.workflow.preview(argumentsValue as never));
      }
      if (toolName === 'applyTextPoolChange') {
        const planId = String(argumentsValue.textPoolPlanId || '');
        if (!planId) throw new McpError(ErrorCode.InvalidParams, 'applyTextPoolChange requires textPoolPlanId.');
        await this.confirm(planId);
        return success(await this.workflow.applyConfirmed(planId));
      }
      if (toolName === 'getTextPoolChangeStatus') {
        const planId = String(argumentsValue.textPoolPlanId || '');
        if (!planId) throw new McpError(ErrorCode.InvalidParams, 'getTextPoolChangeStatus requires textPoolPlanId.');
        return success(this.workflow.status(planId));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown text pool tool: ${toolName}`);
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
      throw new SafeAbapError('CONFIRMATION_UNSUPPORTED', 'confirmation', 'Text pool write requires MCP form elicitation.');
    }
    const plan = this.confirmation.planSummary(planId);
    const params: ElicitRequestFormParams = {
      mode: 'form',
      message: `Write ${plan.newCount} text pool entries (${plan.category}) to program ${plan.program} · ${plan.systemHost}/${plan.client} · This is a repository write executed once.`,
      requestedSchema: {
        type: 'object',
        properties: { decision: { type: 'string', enum: ['apply', 'cancel'] } },
        required: ['decision']
      }
    };
    const elicited = await this.confirmation.elicitInput(params, 60000);
    if (elicited.action !== 'accept' || elicited.content?.decision !== 'apply') {
      throw new SafeAbapError('POLICY_DENIED', 'confirmation', 'Text pool write was not confirmed by the user.');
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
