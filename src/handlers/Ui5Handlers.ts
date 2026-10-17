import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type { Ui5FilestoreClient } from '../adt/Ui5FilestoreApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * ============================================================================
 * UI5/Fiori BSP 只读三工具 MCP 处理器（关闭能力矩阵缺口 ui5.read）
 * ============================================================================
 *
 * 暴露三个只读工具，语义对齐 VSP vibing-steampunk 的 UI5_LIST/UI5_APP/UI5_FILE
 * 只读方向（internal/mcp/handlers_ui5.go L56-151；底层 filestore 协议见
 * src/adt/Ui5FilestoreApi.ts 注释）：
 *   - ui5ListApps：列出 UI5- BSP filestore 应用（客户端通配符过滤）
 *   - ui5GetApp：单个应用的文件树
 *   - ui5GetFileContent：应用内单个文件的原始内容
 *
 * 业务规则：
 *   - 全部只读工具（readOnlyHint=true、destructiveHint=false、
 *     approvalRequired=false；_meta.operationClass='read-only tenant'）；
 *     底层仅三个 filestore GET，无任何写操作。VSP 的 upload/delete/create
 *     方向刻意不暴露（矩阵 ui5.write 维持缺口，RESTRICTION 方向不做）。
 *   - 应用名/文件路径在此做第一道白名单校验（MCP InvalidParams 语义），API 层
 *     normalizeUi5AppName/normalizeUi5FilePath 另有第二道同口径校验（含路径
 *     穿越拒绝）作为纵深防御；URL 一律由名称拼接并整体转义，不接受任意 URL。
 *   - 底层异常统一脱敏为 InternalError，绝不外泄远端响应细节。
 */

/** 与 CrossReferenceHandlers 一致的只读工具定义强类型。 */
type Ui5ToolDefinition = ToolDefinition & {
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

/** 本处理器认领的工具名；supports()/handle() 均以此集合为边界。 */
const UI5_TOOL_NAMES = new Set(['ui5ListApps', 'ui5GetApp', 'ui5GetFileContent']);

/** 应用名长度上限（与 API 层常量同口径）。 */
const APP_NAME_MAX_LENGTH = 40;
/** 文件路径长度上限（与 API 层常量同口径）。 */
const FILE_PATH_MAX_LENGTH = 240;
/** maxResults 的 schema 边界。 */
const MAX_RESULTS_CAP = 500;

export class Ui5Handlers {
  /**
   * @param ui5Filestore 只读 filestore 客户端（窄接口注入；集成时用
   *   src/adt/Ui5FilestoreApi.ts 的 createUi5FilestoreClient(readClient.httpClient)
   *   构造，与 CDS 分析同型绑定）
   */
  constructor(private readonly ui5Filestore: Ui5FilestoreClient) {}

  /** 该工具名是否由本处理器负责。 */
  supports(toolName: string): boolean {
    return UI5_TOOL_NAMES.has(toolName);
  }

  /** 三个只读工具定义（schema 含 additionalProperties:false 与参数边界）。 */
  getTools(): Ui5ToolDefinition[] {
    const readOnly: Pick<Ui5ToolDefinition, 'annotations' | '_meta'> = {
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      },
      _meta: { operationClass: 'read-only tenant', approvalRequired: false }
    };
    return [
      {
        name: 'ui5ListApps',
        description:
          'List UI5/Fiori BSP applications from the ADT filestore (ui5-bsp/objects, Atom feed). Supports a client-side wildcard filter (* = any run) because some systems ignore the server-side name parameter. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: {
              type: 'string',
              description: 'Name filter with * wildcards, e.g. Z*. Empty lists everything (may be large).',
              maxLength: 60,
              optional: true
            },
            maxResults: {
              type: 'number',
              description: `Maximum applications to return; default 100, hard cap ${MAX_RESULTS_CAP}.`,
              minimum: 1,
              maximum: MAX_RESULTS_CAP,
              optional: true
            }
          }
        },
        ...readOnly
      },
      {
        name: 'ui5GetApp',
        description:
          'Show one UI5/Fiori BSP application from the ADT filestore: its file tree (folders and files, paths relative to the application root). Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            appName: {
              type: 'string',
              description: 'Exact application name, e.g. ZMY_APP or namespaced /NS/APP.',
              minLength: 1,
              maxLength: APP_NAME_MAX_LENGTH
            }
          },
          required: ['appName']
        },
        ...readOnly
      },
      {
        name: 'ui5GetFileContent',
        description:
          'Read one file from a UI5/Fiori BSP application in the ADT filestore. The path is relative to the application root (e.g. .project, WebContent/index.html); traversal segments are rejected. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            appName: {
              type: 'string',
              description: 'Exact application name.',
              minLength: 1,
              maxLength: APP_NAME_MAX_LENGTH
            },
            filePath: {
              type: 'string',
              description: `File path relative to the application root, at most ${FILE_PATH_MAX_LENGTH} characters.`,
              minLength: 1,
              maxLength: FILE_PATH_MAX_LENGTH
            }
          },
          required: ['appName', 'filePath']
        },
        ...readOnly
      }
    ];
  }

  /**
   * 分派到注入的只读客户端。
   * 错误处理对齐 CrossReferenceHandlers：MCP 语义错误原样透传；其余底层异常
   * 统一脱敏为 InternalError（"<tool> failed."）。
   */
  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      switch (toolName) {
        case 'ui5ListApps':
          return success(await this.ui5Filestore.ui5ListApps(this.listArgs(toolName, argumentsValue)));
        case 'ui5GetApp':
          return success(await this.ui5Filestore.ui5GetApp({ appName: this.appName(toolName, argumentsValue) }));
        case 'ui5GetFileContent':
          return success(await this.ui5Filestore.ui5GetFileContent({
            appName: this.appName(toolName, argumentsValue),
            filePath: this.filePath(toolName, argumentsValue)
          }));
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown UI5 tool: ${toolName}`);
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      // 底层 ADT 通道错误可能包含目标系统细节；对外只报告工具级失败
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }

  /** ui5ListApps 参数校验：query 可选字符串、maxResults 收敛到 [1, 500]。 */
  private listArgs(toolName: string, argumentsValue: Record<string, unknown>): {
    query?: string;
    maxResults?: number;
  } {
    const result: { query?: string; maxResults?: number } = {};
    const rawQuery = argumentsValue?.query;
    if (rawQuery !== undefined) {
      if (typeof rawQuery !== 'string') throw invalid(`${toolName} requires query to be a string.`);
      if (rawQuery.trim().length > 60) throw invalid(`${toolName} requires query of at most 60 characters.`);
      result.query = rawQuery.trim();
    }
    const rawMax = argumentsValue?.maxResults;
    if (rawMax !== undefined) {
      if (typeof rawMax !== 'number' || !Number.isFinite(rawMax)) {
        throw invalid(`${toolName} requires maxResults to be a finite number.`);
      }
      result.maxResults = Math.min(Math.max(Math.floor(rawMax), 1), MAX_RESULTS_CAP);
    }
    return result;
  }

  /** 应用名共用校验：非空字符串，长度上限（白名单细节由 API 层复检）。 */
  private appName(toolName: string, argumentsValue: Record<string, unknown>): string {
    const raw = argumentsValue?.appName;
    if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > APP_NAME_MAX_LENGTH) {
      throw invalid(
        `${toolName} requires appName: a non-empty application name of at most ${APP_NAME_MAX_LENGTH} characters.`
      );
    }
    return raw.trim();
  }

  /**
   * 文件路径共用校验：非空字符串、长度上限，并在此完成穿越/元字符预检
   * （'..' 段、查询串/转义符号、反斜杠）——路径穿越是参数错误，应向 MCP
   * 调用方返回 InvalidParams 而不是底层 InternalError；API 层的
   * normalizeUi5FilePath 保留同口径校验作为纵深防御。
   */
  private filePath(toolName: string, argumentsValue: Record<string, unknown>): string {
    const raw = typeof argumentsValue?.filePath === 'string' ? argumentsValue.filePath.trim() : '';
    if (!raw || raw.length > FILE_PATH_MAX_LENGTH) {
      throw invalid(
        `${toolName} requires filePath: a non-empty path of at most ${FILE_PATH_MAX_LENGTH}`
        + ' characters relative to the application root.'
      );
    }
    const segments = raw.replace(/^\/+/, '').split('/');
    const malicious = segments.some(segment => segment === '..' || segment === '.')
      || !segments.every(segment => /^[A-Za-z0-9_.$\- ]+$/.test(segment));
    if (malicious) {
      throw invalid(
        `${toolName} requires filePath without traversal segments ("..") and within `
        + '[A-Za-z0-9_.$\\- space]; query markers, percent signs and backslashes are rejected.'
      );
    }
    return raw;
  }
}

/** 成功响应包装：content 文本与 structuredContent 同构（对齐 CrossReferenceHandlers）。 */
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
