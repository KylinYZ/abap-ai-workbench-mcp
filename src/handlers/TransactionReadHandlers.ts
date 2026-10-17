import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type { TransactionReadClient } from '../adt/TransactionReadApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * ============================================================================
 * 事务码元数据只读 MCP 工具处理器（关闭能力矩阵缺口 read.transaction）
 * ============================================================================
 *
 * 暴露一个只读工具 getTransaction：事务码 → 承载程序（TSTC.PGMNA）+ 描述
 * （TSTCT.TTEXT，按语言）。语义对齐 VSP focused GetTransaction
 * （handlers_read.go L437-457）；通道差异见 src/adt/TransactionReadApi.ts
 * （VSP 的 vit/wb 端点在专用 DEV 无 TRAN 映射，本实现走 TSTC/TSTCT 自由 SQL）。
 *
 * 业务规则：
 *   - 只读工具（readOnlyHint=true、destructiveHint=false、approvalRequired=false；
 *     _meta.operationClass='read-only tenant'）；底层仅两条 SELECT。
 *   - 事务码/语言键在处理器做白名单预检（InvalidParams），API 层纵深防御。
 *   - 底层异常统一脱敏为 InternalError。
 */

/** 与 CrossReferenceHandlers 一致的只读工具定义强类型。 */
type TransactionToolDefinition = ToolDefinition & {
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

/** 本处理器认领的工具名。 */
const TRANSACTION_TOOL_NAMES = new Set(['getTransaction']);

export class TransactionReadHandlers {
  /**
   * @param transactionRead 只读事务码客户端（集成时用
   *   src/adt/TransactionReadApi.ts 的 createTransactionReadClient(readClient) 构造）
   */
  constructor(private readonly transactionRead: TransactionReadClient) {}

  /** 该工具名是否由本处理器负责。 */
  supports(toolName: string): boolean {
    return TRANSACTION_TOOL_NAMES.has(toolName);
  }

  /** 只读工具定义。 */
  getTools(): TransactionToolDefinition[] {
    return [
      {
        name: 'getTransaction',
        description:
          'Read transaction code metadata: the reporting/program behind it (TSTC.PGMNA) and its description (TSTCT.TTEXT) in a specific language. Note: the ADT vit/wb TRAN endpoint is absent on some releases; this tool reads the classic TSTC/TSTCT tables via read-only SQL instead. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            transaction: {
              type: 'string',
              description: 'Transaction code, e.g. SE38 or SM37.',
              minLength: 1,
              maxLength: 20
            },
            language: {
              type: 'string',
              description: 'SAP language key for the description (1-2 letters, default EN).',
              optional: true
            }
          },
          required: ['transaction']
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true
        },
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      }
    ];
  }

  /**
   * 分派到注入的只读客户端。MCP 语义错误（含"事务码不存在"）透传；
   * 其余底层异常脱敏为 InternalError。
   */
  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'getTransaction') {
        const raw = typeof argumentsValue?.transaction === 'string' ? argumentsValue.transaction.trim() : '';
        if (!raw || raw.length > 20 || !/^[A-Za-z0-9_/]+$/.test(raw)) {
          throw invalid(
            `${toolName} requires transaction: a non-empty transaction code of at most 20`
            + ' characters matching [A-Za-z0-9_/].'
          );
        }
        let language: string | undefined;
        const rawLanguage = argumentsValue?.language;
        if (rawLanguage !== undefined) {
          if (typeof rawLanguage !== 'string' || !/^[A-Za-z]{1,2}$/.test(rawLanguage.trim())) {
            throw invalid(`${toolName} requires language to be a 1-2 letter SAP language key.`);
          }
          language = rawLanguage.trim();
        }
        return success(await this.transactionRead.getTransaction({
          transaction: raw,
          ...(language !== undefined ? { language } : {})
        }));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown transaction tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      // "事务码不存在"对调用方有排查价值，按 InvalidParams 透出；
      // 其余底层异常脱敏为 InternalError。
      const message = error instanceof Error ? error.message : String(error);
      if (/does not exist in TSTC|not a transaction code|not a valid SAP language key/.test(message)) {
        throw new McpError(ErrorCode.InvalidParams, message);
      }
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }
}

/** 成功响应包装：content 文本与 structuredContent 同构。 */
function success(result: unknown): Record<string, any> {
  const structuredContent = { status: 'success', result };
  return {
    content: [{ type: 'text', text: serializeJsonText(structuredContent) }],
    structuredContent
  };
}

/** 参数校验失败的 MCP 语义错误。 */
function invalid(message: string): McpError {
  return new McpError(ErrorCode.InvalidParams, message);
}
