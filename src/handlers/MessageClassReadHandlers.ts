import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type { MessageClassReadClient } from '../adt/MessageClassReadApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * ============================================================================
 * 消息类文本只读 MCP 工具处理器（关闭能力矩阵缺口 read.message-class-texts）
 * ============================================================================
 *
 * 暴露一个只读工具 getMessages：给定消息类名（可选语言键），读取其全部消息
 * 号与短文本。语义对齐 VSP vibing-steampunk 的 SAP(action=read, target="MSAG")
 * 与 focused GetMessages（internal/mcp/handlers_read.go L421-437；底层
 * messageclass GET 协议见 src/adt/MessageClassReadApi.ts 注释）。
 *
 * 业务规则：
 *   - 只读工具（readOnlyHint=true、destructiveHint=false、approvalRequired=false；
 *     _meta.operationClass='read-only tenant'）；底层仅一个 messageclass GET。
 *   - 写入方向（消息文本维护）刻意不暴露：属矩阵 i18n.write 缺口（RESTRICTION
 *     方向不做）。
 *   - 消息类名在此做第一道白名单校验（MCP InvalidParams 语义），API 层
 *     normalizeMessageClassName 另有第二道同口径校验作为纵深防御。
 *   - 底层异常统一脱敏为 InternalError（对齐 CrossReferenceHandlers 口径）。
 */

/** 与 CrossReferenceHandlers 一致的只读工具定义强类型。 */
type MessageClassToolDefinition = ToolDefinition & {
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
const MESSAGE_CLASS_TOOL_NAMES = new Set(['getMessages']);

/** 消息类名长度上限（与 API 层常量同口径）。 */
const MESSAGE_CLASS_MAX_LENGTH = 20;

export class MessageClassReadHandlers {
  /**
   * @param messageClassRead 只读消息类客户端（窄接口注入；集成时用
   *   src/adt/MessageClassReadApi.ts 的 createMessageClassReadClient(readClient.httpClient)
   *   构造，与 CDS 分析同型绑定）
   */
  constructor(private readonly messageClassRead: MessageClassReadClient) {}

  /** 该工具名是否由本处理器负责。 */
  supports(toolName: string): boolean {
    return MESSAGE_CLASS_TOOL_NAMES.has(toolName);
  }

  /** 只读工具定义。 */
  getTools(): MessageClassToolDefinition[] {
    return [
      {
        name: 'getMessages',
        description:
          'Read all message texts of one ABAP message class (SE91) over the ADT messageclass resource: message numbers and short texts, sorted by number. Optional sap-language override to read texts in a specific language instead of the logon language. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            messageClass: {
              type: 'string',
              description: 'Exact message class name, e.g. ZMC_TEST or namespaced /NS/NAME.',
              minLength: 1,
              maxLength: MESSAGE_CLASS_MAX_LENGTH
            },
            language: {
              type: 'string',
              description: 'SAP language key override (1-2 letters, e.g. EN, DE, ZH). Defaults to the logon language.',
              optional: true
            }
          },
          required: ['messageClass']
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
   * 分派到注入的只读客户端。MCP 语义错误透传；底层异常脱敏为 InternalError。
   */
  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'getMessages') {
        const rawClass = argumentsValue?.messageClass;
        if (typeof rawClass !== 'string' || !rawClass.trim() || rawClass.trim().length > MESSAGE_CLASS_MAX_LENGTH) {
          throw invalid(
            `${toolName} requires messageClass: a non-empty message class name of at most `
            + `${MESSAGE_CLASS_MAX_LENGTH} characters.`
          );
        }
        // 名字白名单预检（A-Z 0-9 _ / $，可选单级命名空间）：注入样本是参数
        // 错误，返回 InvalidParams 而非底层 InternalError；API 层保留同口径
        // 校验作为纵深防御。
        const normalized = rawClass.trim().toUpperCase();
        if (!/^(?:\/[A-Z0-9_]{1,9}\/)?[A-Z0-9_]+$/.test(normalized)) {
          throw invalid(
            `${toolName} requires messageClass to be a message class name `
            + '(A-Z 0-9 _ optionally with a one-level namespace like /NS/NAME).'
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
        return success(await this.messageClassRead.getMessages({
          messageClass: rawClass.trim(),
          ...(language !== undefined ? { language } : {})
        }));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown message-class tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      // 底层 ADT 通道错误可能包含目标系统细节；对外只报告工具级失败
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
