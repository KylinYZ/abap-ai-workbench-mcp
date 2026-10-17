import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type {
  CrossReferenceClient,
  CrossReferenceObjectType
} from '../adt/CrossReferenceApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * ============================================================================
 * CALLEES 交叉引用只读 MCP 工具处理器（补齐能力矩阵 analysis.callgraph down 方向）
 * ============================================================================
 *
 * 暴露一个只读工具 getCallees：给定 objectType + objectName，查询该对象代码
 * 引用了谁（down 方向一跳）。语义对齐 VSP vibing-steampunk 的 callees 能力
 * （pkg/adt/callees.go；底层交叉表协议见 src/adt/CrossReferenceApi.ts 注释）。
 *
 * 业务规则：
 *   - 只读工具（readOnlyHint=true、destructiveHint=false、
 *     approvalRequired=false；_meta.operationClass='read-only tenant'）；
 *     底层只对 WBCROSSGT/CROSS/TFDIR 生成 SELECT，不涉及任何 SAP 写操作。
 *   - callers（up 方向）刻意不暴露：本项目 usageReferences 已覆盖 where-used，
 *     避免重复面。
 *   - 对象名在此做第一道白名单校验（MCP InvalidParams 语义），API 层还有
 *     第二道同口径校验（normalizeRepositoryName）作为注入纵深防御。
 *   - 本文件只定义工具与分派，不接入 src/index.ts / ToolProfiles（由后续
 *     集成任务完成）；测试直接 import 本模块。
 */

/** 与 CdsAnalysisHandlers 一致的只读工具定义强类型。 */
type CrossReferenceToolDefinition = ToolDefinition & {
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
const CROSS_REFERENCE_TOOL_NAMES = new Set(['getCallees']);

/** 支持的对象类型枚举（对齐 VSP calleeTargetFromURI 的类型集）。 */
const SUPPORTED_OBJECT_TYPES: readonly CrossReferenceObjectType[] = [
  'PROG',
  'CLAS',
  'INTF',
  'FUGR',
  'FUNC'
];

/**
 * 对象名白名单：大写字母/数字/_/$，外加 SAP 命名空间斜杠 /（VSP callees.go
 * 第 396 行 checkSQLLiteral 同样放行 /）。引号、分号、注释符（--、/*）、
 * 空格等一切 SQL 元字符都在拼接 SQL 之前被此白名单拒绝——这是注入防线，
 * 详细论证见 src/adt/CrossReferenceApi.ts 的 normalizeRepositoryName 注释。
 */
const OBJECT_NAME_PATTERN = /^[A-Z0-9_/$]+$/;

/** 对象名长度上限（WBCROSSGT-INCLUDE 为 CHAR(40)，取其容量为界）。 */
const OBJECT_NAME_MAX_LENGTH = 40;

/** maxResults 默认值/硬上限（与 API 层常量同口径，schema 里同时声明边界）。 */
const DEFAULT_MAX_RESULTS = 200;
const MAX_RESULTS_CAP = 1000;

export class CrossReferenceHandlers {
  /**
   * @param crossReference 只读交叉引用客户端（窄接口注入，风格对齐
   *   CdsAnalysisHandlers；集成时可用 src/adt/CrossReferenceApi.ts 的
   *   createCrossReferenceClient(bindRunSqlToAdtQuery(client, CALLEE_ROW_LIMIT))
   *   构造）
   */
  constructor(private readonly crossReference: CrossReferenceClient) {}

  /** 该工具名是否由本处理器负责。 */
  supports(toolName: string): boolean {
    return CROSS_REFERENCE_TOOL_NAMES.has(toolName);
  }

  /** 只读工具定义（schema 含 additionalProperties:false 与参数边界）。 */
  getTools(): CrossReferenceToolDefinition[] {
    return [
      {
        name: 'getCallees',
        description:
          'Query the callees (down direction) of one ABAP object: what its code references, read from the WBCROSSGT and CROSS cross-reference tables (OO half and procedural half). One hop only; INDIRECT type-reference noise is dropped; one failing source is reported as failedSources instead of failing the whole call. Read-only; callgraph-style analysis on systems where the ADT cai/callgraph endpoint is absent.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            objectType: {
              type: 'string',
              description:
                'Object type: PROG (report program), CLAS (class), INTF (interface), FUGR (function group) or FUNC (function module).',
              enum: [...SUPPORTED_OBJECT_TYPES]
            },
            objectName: {
              type: 'string',
              description: 'Exact object name, e.g. ZCL_FOO or ZREPORT01.',
              minLength: 1,
              maxLength: OBJECT_NAME_MAX_LENGTH
            },
            maxResults: {
              type: 'number',
              description: `Maximum callees to return; default ${DEFAULT_MAX_RESULTS}, hard cap ${MAX_RESULTS_CAP}.`,
              minimum: 1,
              maximum: MAX_RESULTS_CAP,
              optional: true
            }
          },
          required: ['objectType', 'objectName']
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
   * 分派到注入的只读客户端。
   * 错误处理对齐 CdsAnalysisHandlers：MCP 语义错误（参数校验等）原样透传；
   * 其余底层异常统一脱敏为 InternalError（"getCallees failed."），绝不外泄
   * 远端响应体、头或目标系统细节。
   */
  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'getCallees') {
        return success(await this.crossReference.getCallees(this.query(toolName, argumentsValue)));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown cross-reference tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      // 底层 ADT/SQL 通道错误可能包含目标系统细节；对外只报告工具级失败
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }

  /**
   * 参数校验与规范化（业务规则）：
   * - objectType 必填且只允许五类对象（交叉表按 include 键行，仅这些类型
   *   有确定的 include 形态）；
   * - objectName 必填：trim + 大写后必须整体命中 SAP 命名字符白名单
   *   （A-Z 0-9 _ / $）、<=40 字符——注入样本（引号/分号/注释符/空格）
   *   在此被拒，绝不会进入底层 SQL 拼装；
   * - maxResults 可选数字，1..1000 之外收敛到边界值。
   * 校验失败抛 McpError(InvalidParams)，在进入底层客户端之前拦截。
   */
  private query(toolName: string, argumentsValue: Record<string, unknown>): {
    objectType: CrossReferenceObjectType;
    objectName: string;
    maxResults?: number;
  } {
    // objectType 大小写不敏感：trim + 大写后必须命中五类白名单
    const rawType = typeof argumentsValue?.objectType === 'string'
      ? argumentsValue.objectType.trim().toUpperCase()
      : '';
    if (!SUPPORTED_OBJECT_TYPES.includes(rawType as CrossReferenceObjectType)) {
      throw invalid(
        `${toolName} requires objectType to be one of ${SUPPORTED_OBJECT_TYPES.join(', ')}`
        + ' (cross-reference tables are keyed by include, which is only known for these types).'
      );
    }
    const rawName = typeof argumentsValue?.objectName === 'string' ? argumentsValue.objectName.trim() : '';
    const normalized = rawName.toUpperCase();
    if (
      !normalized
      || normalized.length > OBJECT_NAME_MAX_LENGTH
      || !OBJECT_NAME_PATTERN.test(normalized)
    ) {
      throw invalid(
        `${toolName} requires objectName: a non-empty repository name of at most ${OBJECT_NAME_MAX_LENGTH}`
        + ' characters matching [A-Z0-9_/$] (namespaces use leading slashes). Quotes, semicolons,'
        + ' spaces and comment markers are rejected before any SQL is assembled.'
      );
    }
    const result: {
      objectType: CrossReferenceObjectType;
      objectName: string;
      maxResults?: number;
    } = {
      objectType: rawType as CrossReferenceObjectType,
      objectName: normalized
    };
    const rawMax = argumentsValue?.maxResults;
    if (rawMax !== undefined) {
      if (typeof rawMax !== 'number' || !Number.isFinite(rawMax)) {
        throw invalid(`${toolName} requires maxResults to be a finite number.`);
      }
      // 边界外收敛而非拒绝：只读查询无副作用，钳到 [1, 1000] 即可
      result.maxResults = Math.min(Math.max(Math.floor(rawMax), 1), MAX_RESULTS_CAP);
    }
    return result;
  }
}

/** 成功响应包装：content 文本与 structuredContent 同构（对齐 CdsAnalysisHandlers）。 */
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
