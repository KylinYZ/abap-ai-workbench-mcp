import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type { RevisionSourceClient, RevisionSourceKind } from '../adt/RevisionSourceApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * ============================================================================
 * 版本源码/版本对比只读 MCP 工具处理器（关闭能力矩阵缺口 revisions.source
 * 与 revisions.compare）
 * ============================================================================
 *
 * 暴露两个只读工具：
 *   - getRevisionSource：按版本标签或清单序号读取历史版本源码（不带选择器
 *     为发现模式，返回版本清单）
 *   - compareRevisions：对比两个版本（或 current）的源码，输出 LCS unified
 *     diff 与增删行计数（对齐 VSP SAP(action=revisions, params={op:compare})
 *     与 focused CompareVersions，handlers_revisions.go L58-77）
 *
 * 与 VSP 的差异：不接受调用方传入的 version_uri（任意 URL），版本与源 URI 由
 * 服务端从 revisions 清单解析（安全取舍，详见 src/adt/RevisionSourceApi.ts）。
 *
 * 业务规则：
 *   - 只读工具（readOnlyHint=true、destructiveHint=false、approvalRequired=false；
 *     _meta.operationClass='read-only tenant'）。
 *   - 底层仅 searchObject/revisions/objectStructure/源码 GET 只读链。
 *   - 底层异常统一脱敏为 InternalError；版本未找到等语义错误按 InvalidParams。
 */

/** 与 CrossReferenceHandlers 一致的只读工具定义强类型。 */
type RevisionSourceToolDefinition = ToolDefinition & {
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
const REVISION_SOURCE_TOOL_NAMES = new Set(['getRevisionSource', 'compareRevisions', 'compareSourceObjects']);

const SUPPORTED_KINDS: readonly RevisionSourceKind[] = ['CLAS', 'INTF', 'FUNC', 'PROG'];

export class RevisionSourceHandlers {
  /**
   * @param revisionSource 版本源码只读客户端（集成时用
   *   src/adt/RevisionSourceApi.ts 的 createRevisionSourceClient(readClient)
   *   构造，readClient 为具备 searchObject/revisions/getObjectSource 的会话）
   */
  constructor(private readonly revisionSource: RevisionSourceClient) {}

  /** 该工具名是否由本处理器负责。 */
  supports(toolName: string): boolean {
    return REVISION_SOURCE_TOOL_NAMES.has(toolName);
  }

  /** 只读工具定义。 */
  getTools(): RevisionSourceToolDefinition[] {
    const readOnly: Pick<RevisionSourceToolDefinition, 'annotations' | '_meta'> = {
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
        name: 'getRevisionSource',
        description:
          'Read the source code of one specific revision of an ABAP object (CLAS/INTF/FUNC/PROG). Without a version selector it returns the available revision list (discovery mode); pass version (the label from that list, case-insensitive) or index (1-based position, newest first) to read that revision\'s source. Version URIs are resolved server-side; arbitrary URLs are not accepted. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            objectType: {
              type: 'string',
              description: 'Object type: CLAS, INTF, FUNC or PROG.',
              enum: [...SUPPORTED_KINDS]
            },
            objectName: {
              type: 'string',
              description: 'Exact object name, e.g. ZCL_FOO.',
              minLength: 1,
              maxLength: 40
            },
            version: {
              type: 'string',
              description: 'Revision label from the version list (case-insensitive exact match), e.g. ACTIVE.',
              optional: true
            },
            index: {
              type: 'number',
              description: '1-based position in the revision list as returned (newest first); alternative to version.',
              minimum: 1,
              optional: true
            }
          },
          required: ['objectType', 'objectName']
        },
        ...readOnly
      },
      {
        name: 'compareRevisions',
        description:
          'Compare two revisions of one ABAP object and return a unified diff (LCS-based, 3 context lines) plus added/removed line counts. Either side accepts a revision label, a 1-based list position (digits), or "current" for the active source; version2 defaults to "current". Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            objectType: {
              type: 'string',
              description: 'Object type: CLAS, INTF, FUNC or PROG.',
              enum: [...SUPPORTED_KINDS]
            },
            objectName: {
              type: 'string',
              description: 'Exact object name, e.g. ZCL_FOO.',
              minLength: 1,
              maxLength: 40
            },
            version1: {
              type: 'string',
              description: 'Baseline: revision label, 1-based list position (digits), or "current".',
              minLength: 1,
              maxLength: 60
            },
            version2: {
              type: 'string',
              description: 'Comparison side: same forms as version1; defaults to "current".',
              optional: true
            }
          },
          required: ['objectType', 'objectName', 'version1']
        },
        ...readOnly
      },
      {
        name: 'compareSourceObjects',
        description:
          'Compare the current source code of two ABAP objects (CLAS/INTF/FUNC/PROG) and return a unified diff (LCS-based, 3 context lines) plus added/removed line counts. Read-only; both source URLs are resolved server-side from name+type.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            objectType1: {
              type: 'string',
              description: 'Baseline object type: CLAS, INTF, FUNC or PROG.',
              enum: [...SUPPORTED_KINDS]
            },
            objectName1: {
              type: 'string',
              description: 'Baseline object name.',
              minLength: 1,
              maxLength: 40
            },
            objectType2: {
              type: 'string',
              description: 'Comparison object type: CLAS, INTF, FUNC or PROG.',
              enum: [...SUPPORTED_KINDS]
            },
            objectName2: {
              type: 'string',
              description: 'Comparison object name.',
              minLength: 1,
              maxLength: 40
            }
          },
          required: ['objectType1', 'objectName1', 'objectType2', 'objectName2']
        },
        ...readOnly
      }
    ];
  }

  /**
   * 分派到注入的只读客户端。MCP 语义错误透传；底层异常脱敏为 InternalError。
   */
  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'getRevisionSource') {
        return success(await this.revisionSource.getRevisionSource(this.args(toolName, argumentsValue)));
      }
      if (toolName === 'compareRevisions') {
        // compareRevisions 复用共用校验：version1 暂借 version 字段传递
        // （必填、≤60），version2 单独校验
        const normalizedInput: Record<string, unknown> = { ...argumentsValue, version: argumentsValue.version1 };
        const args = this.args(toolName, normalizedInput);
        if (args.version === undefined) {
          throw invalid(`${toolName} requires version1 (baseline: a revision label, a 1-based list position, or "current").`);
        }
        const rawVersion2 = typeof argumentsValue?.version2 === 'string' ? argumentsValue.version2.trim() : undefined;
        if (rawVersion2 !== undefined && rawVersion2.length > 60) {
          throw invalid(`${toolName} requires version2 of at most 60 characters.`);
        }
        return success(await this.revisionSource.compareRevisions({
          objectType: args.objectType,
          objectName: args.objectName,
          version1: args.version,
          ...(rawVersion2 !== undefined ? { version2: rawVersion2 } : {})
        }));
      }
      if (toolName === 'compareSourceObjects') {
        // 四字段必填 + 枚举/白名单校验，字段名携带序号便于调用方定位
        const kind1 = this.kind(toolName, argumentsValue, 'objectType1');
        const name1 = this.name(toolName, argumentsValue, 'objectName1');
        const kind2 = this.kind(toolName, argumentsValue, 'objectType2');
        const name2 = this.name(toolName, argumentsValue, 'objectName2');
        return success(await this.revisionSource.compareSourceObjects({
          objectType1: kind1, objectName1: name1, objectType2: kind2, objectName2: name2
        }));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown revision-source tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      // 版本未找到等 API 层语义错误对调用方有排查价值，按 InvalidParams 透出；
      // 其余底层异常脱敏为 InternalError，不外泄远端细节。
      const message = error instanceof Error ? error.message : String(error);
      if (/not found|is not a repository name|objectType must be|is required/.test(message)) {
        throw new McpError(ErrorCode.InvalidParams, message);
      }
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }

  /** 参数校验与规范化：objectType 枚举、objectName 白名单、version/index 二选一。 */
  /** objectType 枚举校验（field 支持带序号字段名，如 objectType1/objectType2）。 */
  private kind(toolName: string, argumentsValue: Record<string, unknown>, field = 'objectType'): RevisionSourceKind {
    const raw = typeof argumentsValue?.[field] === 'string' ? (argumentsValue[field] as string).trim().toUpperCase() : '';
    if (!SUPPORTED_KINDS.includes(raw as RevisionSourceKind)) {
      throw invalid(`${toolName} requires ${field} to be one of ${SUPPORTED_KINDS.join(', ')}.`);
    }
    return raw as RevisionSourceKind;
  }

  /** 名字校验：非空、≤40、仓库名字符白名单（field 支持带序号字段名）。 */
  private name(toolName: string, argumentsValue: Record<string, unknown>, field = 'objectName'): string {
    const raw = typeof argumentsValue?.[field] === 'string' ? (argumentsValue[field] as string).trim().toUpperCase() : '';
    if (!raw || raw.length > 40 || !/^[A-Z0-9_/$]+$/.test(raw)) {
      throw invalid(
        `${toolName} requires ${field}: a non-empty repository name of at most 40`
        + ' characters matching [A-Z0-9_/$] (namespaces use leading slashes).'
      );
    }
    return raw;
  }

  private args(toolName: string, argumentsValue: Record<string, unknown>): {
    objectType: RevisionSourceKind;
    objectName: string;
    version?: string;
    index?: number;
  } {
    const rawType = typeof argumentsValue?.objectType === 'string'
      ? argumentsValue.objectType.trim().toUpperCase()
      : '';
    if (!SUPPORTED_KINDS.includes(rawType as RevisionSourceKind)) {
      throw invalid(`${toolName} requires objectType to be one of ${SUPPORTED_KINDS.join(', ')}.`);
    }
    const rawName = typeof argumentsValue?.objectName === 'string' ? argumentsValue.objectName.trim() : '';
    const objectName = rawName.toUpperCase();
    if (!objectName || objectName.length > 40 || !/^[A-Z0-9_/$]+$/.test(objectName)) {
      throw invalid(
        `${toolName} requires objectName: a non-empty repository name of at most 40`
        + ' characters matching [A-Z0-9_/$] (namespaces use leading slashes).'
      );
    }
    const result: { objectType: RevisionSourceKind; objectName: string; version?: string; index?: number } = {
      objectType: rawType as RevisionSourceKind,
      objectName
    };
    const rawVersion = argumentsValue?.version;
    if (rawVersion !== undefined) {
      if (typeof rawVersion !== 'string' || !rawVersion.trim() || rawVersion.trim().length > 60) {
        throw invalid(`${toolName} requires version to be a revision label of at most 60 characters.`);
      }
      result.version = rawVersion.trim();
    }
    const rawIndex = argumentsValue?.index;
    if (rawIndex !== undefined) {
      if (typeof rawIndex !== 'number' || !Number.isFinite(rawIndex)) {
        throw invalid(`${toolName} requires index to be a finite number.`);
      }
      result.index = Math.max(Math.floor(rawIndex), 1);
    }
    return result;
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
