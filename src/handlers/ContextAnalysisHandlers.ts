import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type {
  ContextAnalysisClient,
  SourceKind
} from '../adt/ContextCompressionApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * ============================================================================
 * 依赖上下文四工具 MCP 处理器（补齐能力矩阵 codeintel.context 的
 * dependency-context-spike）
 * ============================================================================
 *
 * 暴露四个只读工具，语义对齐 VSP vibing-steampunk 的 analyze type=context/
 * parse_abap/analyze_deps/effects 与 focused GetContext（internal/mcp/
 * handlers_context.go、handlers_effects.go；底层算法见
 * src/adt/ContextCompressionApi.ts 注释）：
 *   - getDependencyContext：压缩依赖上下文（prologue + 统计）
 *   - analyzeDependencies：正则层依赖发现（含疑似误报标注）
 *   - parseAbapSource：客户端词法/分句/分类
 *   - analyzeSourceEffects：副作用与 LUW 归类（本地分析，边界随答案返回）
 *
 * 业务规则：
 *   - 全部只读工具（readOnlyHint=true、destructiveHint=false、
 *     approvalRequired=false；_meta.operationClass='read-only tenant'）。
 *   - SAP 交互只有"按名字取对象源码"的 GET 链（searchObject →
 *     objectStructure → getObjectSource），全程串行，无锁无激活无写入。
 *   - 对象名在此做第一道白名单校验（MCP InvalidParams 语义），API 层
 *     createSourceFetcher 另有精确匹配兜底。
 *   - 底层异常统一脱敏为 InternalError，绝不外泄远端响应细节（对齐
 *     CrossReferenceHandlers 的错误处理口径）。
 */

/** 与 CrossReferenceHandlers 一致的只读工具定义强类型。 */
type ContextToolDefinition = ToolDefinition & {
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

/** 本处理器认领的四个工具名；supports()/handle() 均以此集合为边界。 */
const CONTEXT_TOOL_NAMES = new Set([
  'getDependencyContext',
  'analyzeDependencies',
  'parseAbapSource',
  'analyzeSourceEffects'
]);

/** 顶层对象可取源类型（依赖展开只产生 CLAS/INTF/FUNC；顶层额外允许 PROG）。 */
const SUPPORTED_SOURCE_KINDS: readonly SourceKind[] = ['CLAS', 'INTF', 'FUNC', 'PROG'];

/**
 * 对象名白名单：大写字母/数字/_/$，外加命名空间斜杠 /（与 CrossReferenceHandlers
 * 同口径）。名字只进 quick search 查询串与结果匹配，不拼 URL 路径（URL 一律
 * 来自 ADT 返回的 adtcore:uri），但白名单仍先行拦截注入样本。
 */
const OBJECT_NAME_PATTERN = /^[A-Z0-9_/$]+$/;
const OBJECT_NAME_MAX_LENGTH = 40;

/** 源码输入上限：解析与压缩都是 O(行数×名字数) 的客户端计算，超大输入既慢又
 *  会撑爆 MCP 响应；1,000,000 字符约两万行代码，远超单对象合理体量。 */
const MAX_SOURCE_LENGTH = 1_000_000;

/** maxDeps/depth 的 schema 边界（与 API 层常量同口径）。 */
const MAX_DEPS_CAP = 50;
const MAX_DEPTH = 3;

export class ContextAnalysisHandlers {
  /**
   * @param contextAnalysis 四能力只读客户端（窄接口注入；集成时用
   *   src/adt/ContextCompressionApi.ts 的 createContextAnalysisClient(readClient)
   *   构造，内部绑定 searchObject/objectStructure/getObjectSource 只读取源链）
   */
  constructor(private readonly contextAnalysis: ContextAnalysisClient) {}

  /** 该工具名是否由本处理器负责。 */
  supports(toolName: string): boolean {
    return CONTEXT_TOOL_NAMES.has(toolName);
  }

  /** 四个只读工具定义（schema 含 additionalProperties:false 与参数边界）。 */
  getTools(): ContextToolDefinition[] {
    // 共享的只读注解块：显式取 ContextToolDefinition 的字面量类型，避免
    // 对象字面量把 true/false 放宽成 boolean
    const readOnly: Pick<ContextToolDefinition, 'annotations' | '_meta'> = {
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
        name: 'getDependencyContext',
        description:
          'Compressed dependency context for one ABAP object: extracts the classes/interfaces/function modules it references, fetches their public API contracts over read-only ADT source reads, ranks them by reader value (obligations, signature types, collaborators, exceptions) and returns a compact prologue plus stats. Unresolvable names are reported, never silently dropped.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            objectType: {
              type: 'string',
              description: 'Object type of the analyzed object: CLAS, INTF, FUNC or PROG.',
              enum: [...SUPPORTED_SOURCE_KINDS]
            },
            objectName: {
              type: 'string',
              description: 'Exact object name, e.g. ZCL_FOO.',
              minLength: 1,
              maxLength: OBJECT_NAME_MAX_LENGTH
            },
            maxDeps: {
              type: 'number',
              description: 'Contract budget: how many dependencies to resolve (default 20, cap 50). Failed fetches cost a fetch, not a slot.',
              minimum: 1,
              maximum: MAX_DEPS_CAP,
              optional: true
            },
            depth: {
              type: 'number',
              description: 'Dependency expansion depth: 1 = direct deps only (default), up to 3 = deps of deps.',
              minimum: 1,
              maximum: MAX_DEPTH,
              optional: true
            }
          },
          required: ['objectType', 'objectName']
        },
        ...readOnly
      },
      {
        name: 'analyzeDependencies',
        description:
          'Client-side dependency discovery over ABAP source (regex layer): reports referenced classes/interfaces/function modules with confidence, first line, and a suspect flag when every occurrence sits inside strings or comments. Pass source directly, or objectType+objectName to read it over ADT.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            source: {
              type: 'string',
              description: 'ABAP source to analyze. Optional: give objectType+objectName instead to fetch it.',
              maxLength: MAX_SOURCE_LENGTH,
              optional: true
            },
            objectType: {
              type: 'string',
              description: 'Object type when reading by name: CLAS, INTF, FUNC or PROG.',
              enum: [...SUPPORTED_SOURCE_KINDS],
              optional: true
            },
            objectName: {
              type: 'string',
              description: 'Exact object name when reading by name.',
              minLength: 1,
              maxLength: OBJECT_NAME_MAX_LENGTH,
              optional: true
            }
          }
        },
        ...readOnly
      },
      {
        name: 'parseAbapSource',
        description:
          'Tokenize and parse ABAP source into classified statements (client-side lexer port; zero SAP round-trips). Statements are split on periods with string literals respected and classified (DATA/SQL/LOOP/CALL_FUNCTION/...). Pass source directly, or objectType+objectName to fetch it.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            source: {
              type: 'string',
              description: 'ABAP source to parse. Optional: give objectType+objectName instead to fetch it.',
              maxLength: MAX_SOURCE_LENGTH,
              optional: true
            },
            objectType: {
              type: 'string',
              description: 'Object type when reading by name: CLAS, INTF, FUNC or PROG.',
              enum: [...SUPPORTED_SOURCE_KINDS],
              optional: true
            },
            objectName: {
              type: 'string',
              description: 'Exact object name when reading by name.',
              minLength: 1,
              maxLength: OBJECT_NAME_MAX_LENGTH,
              optional: true
            }
          }
        },
        ...readOnly
      },
      {
        name: 'analyzeSourceEffects',
        description:
          'Classify the side effects and LUW behaviour of one ABAP source unit (client-side analysis): custom-table reads/writes, COMMIT/ROLLBACK ownership, deferred-update registration (IN UPDATE TASK / BACKGROUND TASK), async RFC, background jobs, HTTP/APC usage, state access, and the resulting safe/participant/owner/unsafe LUW class with the consequence for callers. Local analysis only: effects inside called units are not counted.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            source: {
              type: 'string',
              description: 'ABAP source to analyze. Optional: give objectType+objectName instead to fetch it.',
              maxLength: MAX_SOURCE_LENGTH,
              optional: true
            },
            objectType: {
              type: 'string',
              description: 'Object type when reading by name: CLAS, INTF, FUNC or PROG.',
              enum: [...SUPPORTED_SOURCE_KINDS],
              optional: true
            },
            objectName: {
              type: 'string',
              description: 'Exact object name when reading by name.',
              minLength: 1,
              maxLength: OBJECT_NAME_MAX_LENGTH,
              optional: true
            }
          }
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
        case 'getDependencyContext':
          return success(await this.contextAnalysis.getDependencyContext(this.contextArgs(toolName, argumentsValue)));
        case 'analyzeDependencies':
          return success(await this.contextAnalysis.analyzeDependencies(this.analysisArgs(toolName, argumentsValue)));
        case 'parseAbapSource':
          return success(await this.contextAnalysis.parseAbapSource(this.analysisArgs(toolName, argumentsValue)));
        case 'analyzeSourceEffects':
          return success(await this.contextAnalysis.analyzeSourceEffects(this.analysisArgs(toolName, argumentsValue)));
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown context-analysis tool: ${toolName}`);
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      // 底层 ADT 通道错误可能包含目标系统细节；对外只报告工具级失败
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }

  /**
   * getDependencyContext 参数校验：objectType/objectName 必填（白名单同口径），
   * maxDeps/depth 为可选数字并收敛到边界。
   */
  private contextArgs(toolName: string, argumentsValue: Record<string, unknown>): {
    objectType: SourceKind;
    objectName: string;
    maxDeps?: number;
    depth?: number;
  } {
    const { objectType, objectName } = this.requireObject(toolName, argumentsValue);
    const result: { objectType: SourceKind; objectName: string; maxDeps?: number; depth?: number } = {
      objectType,
      objectName
    };
    const maxDeps = optionalBoundedNumber(toolName, argumentsValue.maxDeps, 'maxDeps', 1, MAX_DEPS_CAP);
    if (maxDeps !== undefined) result.maxDeps = maxDeps;
    const depth = optionalBoundedNumber(toolName, argumentsValue.depth, 'depth', 1, MAX_DEPTH);
    if (depth !== undefined) result.depth = depth;
    return result;
  }

  /**
   * 三个纯分析工具共用参数校验：source 与 objectType+objectName 二选一；
   * source 超长拒绝（客户端解析成本与响应体积保护）。
   */
  private analysisArgs(toolName: string, argumentsValue: Record<string, unknown>): {
    source?: string;
    objectType?: SourceKind;
    objectName?: string;
  } {
    const rawSource = argumentsValue?.source;
    const hasSource = typeof rawSource === 'string' && rawSource.trim() !== '';
    const rawType = argumentsValue?.objectType;
    const rawName = argumentsValue?.objectName;
    const hasObject = rawType !== undefined || rawName !== undefined;

    if (!hasSource && !hasObject) {
      throw invalid(`${toolName} requires either source, or objectType together with objectName.`);
    }
    const result: { source?: string; objectType?: SourceKind; objectName?: string } = {};
    if (hasSource) {
      if (rawSource.length > MAX_SOURCE_LENGTH) {
        throw invalid(`${toolName} requires source of at most ${MAX_SOURCE_LENGTH} characters.`);
      }
      result.source = rawSource;
    }
    if (rawType !== undefined) {
      if (typeof rawType !== 'string') throw invalid(`${toolName} requires objectType to be a string.`);
      const upper = rawType.trim().toUpperCase() as SourceKind;
      if (!SUPPORTED_SOURCE_KINDS.includes(upper)) {
        throw invalid(`${toolName} requires objectType to be one of ${SUPPORTED_SOURCE_KINDS.join(', ')}.`);
      }
      result.objectType = upper;
    }
    if (rawName !== undefined) {
      if (typeof rawName !== 'string') throw invalid(`${toolName} requires objectName to be a string.`);
      const normalized = rawName.trim().toUpperCase();
      if (!normalized || normalized.length > OBJECT_NAME_MAX_LENGTH || !OBJECT_NAME_PATTERN.test(normalized)) {
        throw invalid(
          `${toolName} requires objectName: a non-empty repository name of at most ${OBJECT_NAME_MAX_LENGTH}`
          + ' characters matching [A-Z0-9_/$] (namespaces use leading slashes).'
        );
      }
      result.objectName = normalized;
    }
    // 按对象读取（未给源码）时两者都必须齐备；给了源码则 objectName 仅作
    // 标注用，允许单独出现
    if (!hasSource && (result.objectType !== undefined || result.objectName !== undefined)) {
      if (!result.objectType || !result.objectName) {
        throw invalid(`${toolName} requires objectType together with objectName when reading by name.`);
      }
    }
    return result;
  }

  /** objectType+objectName 必填组合的共用校验（getDependencyContext 用）。 */
  private requireObject(toolName: string, argumentsValue: Record<string, unknown>): {
    objectType: SourceKind;
    objectName: string;
  } {
    const rawType = typeof argumentsValue?.objectType === 'string' ? argumentsValue.objectType.trim().toUpperCase() : '';
    if (!SUPPORTED_SOURCE_KINDS.includes(rawType as SourceKind)) {
      throw invalid(`${toolName} requires objectType to be one of ${SUPPORTED_SOURCE_KINDS.join(', ')}.`);
    }
    const rawName = typeof argumentsValue?.objectName === 'string' ? argumentsValue.objectName.trim() : '';
    const normalized = rawName.toUpperCase();
    if (!normalized || normalized.length > OBJECT_NAME_MAX_LENGTH || !OBJECT_NAME_PATTERN.test(normalized)) {
      throw invalid(
        `${toolName} requires objectName: a non-empty repository name of at most ${OBJECT_NAME_MAX_LENGTH}`
        + ' characters matching [A-Z0-9_/$] (namespaces use leading slashes).'
      );
    }
    return { objectType: rawType as SourceKind, objectName: normalized };
  }
}

/** 可选有界数字：undefined 透传；非法类型拒绝；越界收敛到边界（只读无副作用）。 */
function optionalBoundedNumber(
  toolName: string,
  value: unknown,
  label: string,
  min: number,
  max: number
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(`${toolName} requires ${label} to be a finite number.`);
  }
  return Math.min(Math.max(Math.floor(value), min), max);
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
