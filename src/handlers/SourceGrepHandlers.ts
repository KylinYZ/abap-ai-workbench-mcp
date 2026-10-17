import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type {
  GrepObjectsInput,
  GrepPackageInput,
  SourceGrepClient,
  SourceGrepObjectType
} from '../adt/SourceGrepApi.js';
import { SOURCE_GREP_OBJECT_TYPES } from '../adt/SourceGrepApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * ============================================================================
 * 源码内容 grep 只读 MCP 工具处理器（对应能力矩阵 search.content-grep 行）
 * ============================================================================
 *
 * 暴露两个只读工具，语义对齐 VSP vibing-steampunk 的 SAP(action=grep) 与
 * focused GrepObjects / GrepPackages（VSP 注册见 internal/mcp/tools_focused.go，
 * 底层 ADT 协议见 src/adt/SourceGrepApi.ts 中各函数注释）：
 *
 *   1. grepPackage —— 包内源码对象按正则搜索（枚举包内容 → 逐个拉源码本地匹配）
 *   2. grepObjects —— 显式对象名列表（1..20）按正则搜索（URI 由服务端推导）
 *
 * 业务规则：
 *   - 两个工具全部只读（readOnlyHint=true、destructiveHint=false、
 *     approvalRequired=false）：包枚举为查询 POST（nodestructure）、源码读取为
 *     GET（text/plain），均无 SAP 副作用，operationClass 为 read-only tenant。
 *   - 输入只接受包名/对象名+类型白名单；对象 URI 一律由服务端推导，
 *     绝不接受调用方传入的任意 URL/XML（项目安全边界）。
 *   - pattern 在进入底层客户端之前完成长度与编译校验，正则非法给
 *     InvalidParams 友好失败；结果规模由 API 层多重上限约束（见 API 常量）。
 *   - 本文件只定义工具与分派，不接入 src/index.ts / ToolProfiles（由后续
 *     集成任务完成）；测试直接 import 本模块。
 */

/** 与 CdsAnalysisHandlers 一致的只读工具定义强类型。 */
type SourceGrepToolDefinition = ToolDefinition & {
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

/** 本处理器认领的两个工具名；supports()/handle() 均以此集合为边界。 */
const SOURCE_GREP_TOOL_NAMES = new Set(['grepPackage', 'grepObjects']);

/** 输入边界（与 SourceGrepApi 常量保持一致；schema 与校验共用）。 */
const NAME_MAX_LENGTH = 40;
const PATTERN_MAX_LENGTH = 256;
const CONTEXT_LINES_MAX = 5;
const MAX_RESULTS_DEFAULT = 100;
const MAX_RESULTS_MAX = 500;
const OBJECTS_MAX = 20;
const OBJECT_TYPES_FILTER_MAX = 10;

export class SourceGrepHandlers {
  /**
   * @param sourceGrep 只读源码 grep 客户端（窄接口注入，风格对齐
   *   CdsAnalysisHandlers；集成时可用 src/adt/SourceGrepApi.ts 的
   *   createSourceGrepClient(client.h) 构造）
   */
  constructor(private readonly sourceGrep: SourceGrepClient) {}

  /** 该工具名是否由本处理器负责。 */
  supports(toolName: string): boolean {
    return SOURCE_GREP_TOOL_NAMES.has(toolName);
  }

  /** 两个只读工具的 MCP 定义（schema 含 additionalProperties:false 与全部长度限制）。 */
  getTools(): SourceGrepToolDefinition[] {
    return [
      readOnlyTool(
        'grepPackage',
        'Grep a regex pattern across source objects of one ABAP package: enumerates package contents, reads each source object (PROG/CLAS/INTF/FUGR/includes/CDS DDL) and matches line-by-line client-side. Read-only; bounded results (max 200 objects per package, max 500 hits), never returns full sources.',
        grepPackageInputSchema()
      ),
      readOnlyTool(
        'grepObjects',
        'Grep a regex pattern across 1-20 explicitly named ABAP source objects (PROG/CLAS/INTF/FUGR/INCL/DDLS): reads each source and matches line-by-line client-side. Object URIs are derived server-side from name+type. Read-only; bounded results, never returns full sources.',
        grepObjectsInputSchema()
      )
    ];
  }

  /**
   * 按工具名分派到注入的只读客户端。
   * 错误处理对齐 CdsAnalysisHandlers：MCP 语义错误（参数校验等）原样透传；
   * 其余底层异常统一脱敏为 InternalError（"failed."），绝不外泄远端响应体、
   * 头或目标系统细节。
   */
  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'grepPackage') {
        return success(await this.sourceGrep.grepPackage(this.packageInput(toolName, argumentsValue)));
      }
      if (toolName === 'grepObjects') {
        return success(await this.sourceGrep.grepObjects(this.objectsInput(toolName, argumentsValue)));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown source grep tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      // 底层 ADT 响应可能包含目标系统细节；对外只报告工具级失败
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }

  /* ------------------------------------------------------------------ *
   * 参数校验与规范化（全部在进入底层客户端之前拦截，失败抛 InvalidParams）
   * ------------------------------------------------------------------ */

  /** grepPackage 入参规范化。 */
  private packageInput(toolName: string, args: Record<string, unknown>): GrepPackageInput {
    // objectTypes 只做一次校验（避免重复调用校验逻辑）
    const objectTypes = this.objectTypesFilter(toolName, args);
    return {
      packageName: this.sapName(toolName, args?.packageName, 'packageName'),
      pattern: this.pattern(toolName, args),
      ...(objectTypes.length > 0 ? { objectTypes } : {}),
      caseInsensitive: this.boolean(toolName, args, 'caseInsensitive'),
      maxResults: this.int(toolName, args, 'maxResults', 1, MAX_RESULTS_MAX, MAX_RESULTS_DEFAULT),
      contextLines: this.int(toolName, args, 'contextLines', 0, CONTEXT_LINES_MAX, 0)
    };
  }

  /** grepObjects 入参规范化。 */
  private objectsInput(toolName: string, args: Record<string, unknown>): GrepObjectsInput {
    const rawObjects = args?.objects;
    if (!Array.isArray(rawObjects) || rawObjects.length === 0 || rawObjects.length > OBJECTS_MAX) {
      throw invalid(`${toolName} requires objects: an array of 1 to ${OBJECTS_MAX} object references.`);
    }
    const objects = rawObjects.map(entry => {
      const record = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
      return {
        name: this.sapName(toolName, record.name, 'name'),
        objectType: this.objectType(toolName, record.objectType)
      };
    });
    return {
      objects,
      pattern: this.pattern(toolName, args),
      caseInsensitive: this.boolean(toolName, args, 'caseInsensitive'),
      contextLines: this.int(toolName, args, 'contextLines', 0, CONTEXT_LINES_MAX, 0)
    };
  }

  /** 包名/对象名校验：字符串、非空、<=40、SAP 命名字符白名单，统一大写。 */
  private sapName(toolName: string, value: unknown, field: string): string {
    const raw = typeof value === 'string' ? value.trim() : '';
    const upper = raw.toUpperCase();
    // 包名额外允许 $（本地包如 $TMP）与命名空间斜杠；对象名允许命名空间斜杠
    const namePattern = field === 'packageName' ? /^[A-Z0-9_$/]+$/ : /^[A-Z0-9_/]+$/;
    if (!upper || upper.length > NAME_MAX_LENGTH || !namePattern.test(upper)) {
      throw invalid(
        `${toolName} requires ${field}: a non-empty SAP name of at most ${NAME_MAX_LENGTH} characters (letters, digits, underscore${field === 'packageName' ? ', $ and /' : ' and /'}) — normalized to upper case.`
      );
    }
    return upper;
  }

  /** pattern 校验：trim 后非空、<=256、可被 new RegExp 编译（友好失败）。 */
  private pattern(toolName: string, args: Record<string, unknown>): string {
    const raw = typeof args?.pattern === 'string' ? args.pattern : '';
    // 纯空白 pattern 无搜索意义，trim 后按空串拒绝
    if (!raw.trim() || raw.length > PATTERN_MAX_LENGTH) {
      throw invalid(
        `${toolName} requires pattern: a non-empty regular expression of at most ${PATTERN_MAX_LENGTH} characters.`
      );
    }
    const caseInsensitive = this.boolean(toolName, args, 'caseInsensitive');
    try {
      // 编译探针：正则语法错误在此转为 InvalidParams，避免进入底层后失败
      new RegExp(raw, caseInsensitive ? 'i' : '');
    } catch (error) {
      throw invalid(
        `${toolName} rejected pattern: invalid regular expression (${error instanceof Error ? error.message : String(error)}).`
      );
    }
    return raw;
  }

  /** grepPackage 的 objectTypes 过滤：可选字符串数组（<=10 条、白名单字符）。 */
  private objectTypesFilter(toolName: string, args: Record<string, unknown>): string[] {
    const raw = args?.objectTypes;
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.length > OBJECT_TYPES_FILTER_MAX) {
      throw invalid(`${toolName} supports at most ${OBJECT_TYPES_FILTER_MAX} objectTypes entries.`);
    }
    return raw.map(entry => {
      const upper = typeof entry === 'string' ? entry.trim().toUpperCase() : '';
      if (!upper || upper.length > 30 || !/^[A-Z0-9_/]+$/.test(upper)) {
        throw invalid(
          `${toolName} requires each objectTypes entry to be 1-30 characters of letters, digits, underscore or slash.`
        );
      }
      return upper;
    });
  }

  /** grepObjects 单对象类型：必须在白名单枚举内（无缺省，避免歧义 URI）。 */
  private objectType(toolName: string, value: unknown): SourceGrepObjectType {
    if (typeof value === 'string' && (SOURCE_GREP_OBJECT_TYPES as string[]).includes(value)) {
      return value as SourceGrepObjectType;
    }
    throw invalid(
      `${toolName} requires objectType to be one of: ${SOURCE_GREP_OBJECT_TYPES.join(', ')}.`
    );
  }

  /** 可选布尔参数：缺省 false；显式非布尔值拒绝（避免隐式真值转换）。 */
  private boolean(toolName: string, args: Record<string, unknown>, field: string): boolean {
    const raw = args?.[field];
    if (raw === undefined || raw === null) return false;
    if (typeof raw !== 'boolean') throw invalid(`${toolName} requires ${field} to be a boolean.`);
    return raw;
  }

  /** 可选整数参数：缺省 fallback；必须落在 [min,max] 且为整数。 */
  private int(toolName: string, args: Record<string, unknown>, field: string, min: number, max: number, fallback: number): number {
    const raw = args?.[field];
    if (raw === undefined || raw === null) return fallback;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
      throw invalid(`${toolName} requires ${field} to be an integer between ${min} and ${max}.`);
    }
    return raw;
  }
}

/** grepPackage 输入 schema（包名/正则必填，其余可选并有界）。 */
function grepPackageInputSchema(): ToolDefinition['inputSchema'] {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      packageName: {
        type: 'string',
        description: 'Exact package name, e.g. ZPACKAGE or $TMP; normalized to upper case.',
        minLength: 1,
        maxLength: NAME_MAX_LENGTH
      },
      pattern: {
        type: 'string',
        description: 'JavaScript regular expression matched line-by-line against object sources; compiled before any request.',
        minLength: 1,
        maxLength: PATTERN_MAX_LENGTH
      },
      objectTypes: {
        type: 'array',
        description: 'Optional source-object type filter; entries match exactly or as type prefix (PROG matches PROG/P and PROG/I).',
        items: { type: 'string', minLength: 1, maxLength: 30 },
        maxItems: OBJECT_TYPES_FILTER_MAX,
        optional: true
      },
      caseInsensitive: {
        type: 'boolean',
        description: 'Perform case-insensitive matching (default false).',
        optional: true
      },
      maxResults: {
        type: 'integer',
        description: 'Maximum number of matching objects to return (default 100, max 500); extra hits are reported as truncated.',
        minimum: 1,
        maximum: MAX_RESULTS_MAX,
        optional: true
      },
      contextLines: {
        type: 'integer',
        description: 'Context lines before/after each match (default 0, max 5).',
        minimum: 0,
        maximum: CONTEXT_LINES_MAX,
        optional: true
      }
    },
    required: ['packageName', 'pattern']
  };
}

/** grepObjects 输入 schema（对象引用列表 + 正则必填）。 */
function grepObjectsInputSchema(): ToolDefinition['inputSchema'] {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      objects: {
        type: 'array',
        description: 'Explicit source objects to search; URIs are derived server-side from name+type (never client URLs).',
        minItems: 1,
        maxItems: OBJECTS_MAX,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: {
              type: 'string',
              description: 'Exact object name, e.g. ZCL_FOO or ZC_TRAVEL_U; normalized to upper case.',
              minLength: 1,
              maxLength: NAME_MAX_LENGTH
            },
            objectType: {
              type: 'string',
              description: 'Source object type used to derive the ADT URI.',
              enum: [...SOURCE_GREP_OBJECT_TYPES]
            }
          },
          required: ['name', 'objectType']
        }
      },
      pattern: {
        type: 'string',
        description: 'JavaScript regular expression matched line-by-line against object sources; compiled before any request.',
        minLength: 1,
        maxLength: PATTERN_MAX_LENGTH
      },
      caseInsensitive: {
        type: 'boolean',
        description: 'Perform case-insensitive matching (default false).',
        optional: true
      },
      contextLines: {
        type: 'integer',
        description: 'Context lines before/after each match (default 0, max 5).',
        minimum: 0,
        maximum: CONTEXT_LINES_MAX,
        optional: true
      }
    },
    required: ['objects', 'pattern']
  };
}

/** 只读工具定义工厂（元数据固定：只读、非破坏、幂等、开放世界）。 */
function readOnlyTool(
  name: string,
  description: string,
  inputSchema: ToolDefinition['inputSchema']
): SourceGrepToolDefinition {
  return {
    name,
    description,
    inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    _meta: { operationClass: 'read-only tenant', approvalRequired: false }
  };
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
