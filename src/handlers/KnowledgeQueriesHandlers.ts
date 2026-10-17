import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type { KnowledgeQueriesClient } from '../adt/KnowledgeQueriesApi.js';
import type { ClusterReadClient } from '../adt/ClusterReadApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * ============================================================================
 * 知识查询只读三工具 MCP 处理器（diagnostics.knowledge-queries 行：
 * documentation + img_search + img_activity 子集）
 * ============================================================================
 *
 * 暴露三个只读工具（数据源为 SAP 文档/IMG 表的自由 SQL SELECT）：
 *   - getAbapDocumentation：ABAP 文档正文或索引（DOKIL/DOKTL）
 *   - searchImgActivities：IMG 自定义活动与文件夹文本检索（CUS_IMGACT/
 *     CUS_IMGACH/TNODEIMGT）
 *   - getImgActivity：单个 IMG 活动完整详情——基础/文本/菜单路径递归
 *     （TNODEIMGR 引用 → TNODEIMG 向上走链 + TNODEIMGT 文本）/HY 文档
 *
 * 业务规则：
 *   - 只读工具（readOnlyHint=true、destructiveHint=false、approvalRequired=false；
 *     _meta.operationClass='read-only tenant'）。
 *   - cluster_read 已收编（2026-10-07）：readClusterTable——任意 INDX 型集群
 *     表通用读取（DD03L 动态结构发现 + 续块组装 + S/2 解码），knowledge-queries
 *     五子操作全覆盖。
 *   - 文本入参处理器层做长度预检，API 层引号转义 + 控制字符拒绝（纵深防御）。
 *   - "不存在"类错误按 InvalidParams 透出；底层异常统一脱敏为 InternalError。
 */

/** 与 CrossReferenceHandlers 一致的只读工具定义强类型。 */
type KnowledgeToolDefinition = ToolDefinition & {
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
const KNOWLEDGE_TOOL_NAMES = new Set(['getAbapDocumentation', 'searchImgActivities', 'getImgActivity', 'getFmTestDataSets', 'readClusterTable']);

export class KnowledgeQueriesHandlers {
  /**
   * @param knowledgeQueries 知识查询只读客户端（集成时用
   *   src/adt/KnowledgeQueriesApi.ts 的 createKnowledgeQueriesClient(readClient) 构造）
   */
  constructor(
    private readonly knowledgeQueries: KnowledgeQueriesClient,
    private readonly clusterRead?: ClusterReadClient
  ) {}

  /** 该工具名是否由本处理器负责。 */
  supports(toolName: string): boolean {
    return KNOWLEDGE_TOOL_NAMES.has(toolName);
  }

  /** 两个只读工具定义。 */
  getTools(): KnowledgeToolDefinition[] {
    const readOnly: Pick<KnowledgeToolDefinition, 'annotations' | '_meta'> = {
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
        name: 'getAbapDocumentation',
        description:
          'Read ABAP documentation (SE61-style) for an object: the content lines of the latest version in a given language (mode=content, default), or the index of all documented classes/languages for that object (mode=index). Data source: DOKIL/DOKTL via read-only SQL. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            docClass: {
              type: 'string',
              description: 'Documentation class (DOKIL.ID): DE=data element, RE=report, FU=function module, CL=class, TX=general text, etc.',
              minLength: 1,
              maxLength: 4
            },
            docObject: {
              type: 'string',
              description: 'Documentation object name (e.g. the data element or program name).',
              minLength: 1,
              maxLength: 40
            },
            language: {
              type: 'string',
              description: 'SAP language key (1-2 letters, default EN).',
              optional: true
            },
            mode: {
              type: 'string',
              enum: ['content', 'index'],
              description: 'content = read the latest version lines (default); index = list all documented classes/languages.',
              optional: true
            },
            maxLines: {
              type: 'number',
              description: 'Maximum content lines to return; default 500, cap 2000. Longer documents are truncated with a note.',
              minimum: 1,
              maximum: 2000,
              optional: true
            }
          },
          required: ['docClass', 'docObject']
        },
        ...readOnly
      },
      {
        name: 'searchImgActivities',
        description:
          'Search SAP IMG (customizing) activities and folder nodes by title text: activities come from CUS_IMGACT with their transaction codes (CUS_IMGACH), folders from TNODEIMGT. * wildcards allowed; a plain word is searched as %word%. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: {
              type: 'string',
              description: "A word or pattern (* wildcard) from the node's title.",
              minLength: 1,
              maxLength: 60
            },
            language: {
              type: 'string',
              description: 'SAP language key (1-2 letters, default EN).',
              optional: true
            },
            limit: {
              type: 'number',
              description: 'Maximum nodes to return; default 40, cap 100.',
              minimum: 1,
              maximum: 100,
              optional: true
            }
          },
          required: ['text']
        },
        ...readOnly
      },
      {
        name: 'getImgActivity',
        description:
          'Read the full detail of one SAP IMG (customizing) activity: base row (CUS_IMGACH), its description text in a language (CUS_IMGACT), the IMG menu paths to it (TNODEIMGR references walked up through TNODEIMG with TNODEIMGT texts), and its HY documentation when present. Auxiliary pieces degrade to notes instead of failing the read. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            activity: {
              type: 'string',
              description: "The activity's technical name from img_search (CUS_IMGACH.ACTIVITY), e.g. APOC_C_FORMV.",
              minLength: 1,
              maxLength: 40
            },
            language: {
              type: 'string',
              description: 'SAP language key (1-2 letters, default EN).',
              optional: true
            },
            maxRefs: {
              type: 'number',
              description: 'Maximum IMG reference nodes to expand into paths (each costs a few queries; the datapreview channel has a per-session budget). Default 20.',
              minimum: 1,
              maximum: 20,
              optional: true
            }
          },
          required: ['activity']
        },
        ...readOnly
      },
      {
        name: 'getFmTestDataSets',
        description:
          'Read the saved Function Builder test data sets of a function module: EUFUNC directory entries (set numbers with author/date/time), optionally with decoded payload contents (inputs/outputs from the EXPORT data clusters, keys = parameter names, fields numbered by position; per-set decode failures reported in notes). Data source: EUFUNC (relid=FL) via read-only SQL; payload decoding uses the built-in S/2 cluster decoder (cluster formats 5/6, LZH/LZC). Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            function: {
              type: 'string',
              description: 'Function module name, e.g. Z_MCP_SM21_READ.',
              minLength: 1,
              maxLength: 30
            },
            includePayload: {
              type: 'boolean',
              description: 'Decode EXPORT payloads (default false: directory view only). Each set then carries inputs/outputs/others, runtime, rc, exception; the saved interface snapshot appears as interface. A set whose cluster cannot be decoded keeps its directory entry and adds a note.',
              optional: true
            }
          },
          required: ['function']
        },
        ...readOnly
      },
      {
        name: 'readClusterTable',
        description:
          'Read records of one INDX-type cluster table (BALDAT, INDX, EUFUNC, STXL and their kin) with payloads decoded: dynamic table discovery via DD03L (SRTF2/CLUSTR/CLUSTD columns + key columns), fragment rows joined per key in SRTF2 order, EXPORT data clusters decoded via the built-in S/2 cluster decoder (formats 5/6, LZH/LZC). Truncation drops the last (possibly incomplete) cluster and is reported. Data source: read-only SQL. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            table: {
              type: 'string',
              description: 'Cluster table name, e.g. BALDAT, INDX, EUFUNC. Must have SRTF2/CLUSTR/CLUSTD columns (verified via DD03L).',
              minLength: 1,
              maxLength: 30
            },
            where: {
              type: 'string',
              description: "Optional WHERE clause on the key columns (Open SQL fragment form, e.g. \"relid = 'FL' AND name = 'MY_FM'\"). Control characters and semicolons rejected.",
              optional: true
            },
            maxRows: {
              type: 'number',
              description: 'Maximum database fragment rows to read; default 500, cap 1000. When the cap is reached the last (possibly incomplete) cluster is dropped and truncation is reported.',
              minimum: 1,
              maximum: 1000,
              optional: true
            }
          },
          required: ['table']
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
      if (toolName === 'getAbapDocumentation') {
        const docClass = typeof argumentsValue?.docClass === 'string' ? argumentsValue.docClass.trim().toUpperCase() : '';
        if (!docClass || docClass.length > 4 || !/^[A-Z0-9_/]+$/.test(docClass)) {
          throw invalid(`${toolName} requires docClass: a documentation class of at most 4 characters (e.g. DE, RE, TX).`);
        }
        const docObject = typeof argumentsValue?.docObject === 'string' ? argumentsValue.docObject.trim().toUpperCase() : '';
        if (!docObject || docObject.length > 40 || !/^[A-Z0-9_/$]+$/.test(docObject)) {
          throw invalid(
            `${toolName} requires docObject: a non-empty documentation object name of at most 40`
            + ' characters matching [A-Z0-9_/$].'
          );
        }
        const language = this.language(toolName, argumentsValue);
        const mode = argumentsValue?.mode;
        if (mode !== undefined && mode !== 'content' && mode !== 'index') {
          throw invalid(`${toolName} requires mode to be "content" or "index".`);
        }
        const maxLines = this.boundedNumber(toolName, argumentsValue.maxLines, 'maxLines', 1, 2000);
        return success(await this.knowledgeQueries.getAbapDocumentation({
          docClass,
          docObject,
          language,
          ...(mode !== undefined ? { mode } : {}),
          ...(maxLines !== undefined ? { maxLines } : {})
        }));
      }
      if (toolName === 'searchImgActivities') {
        const text = typeof argumentsValue?.text === 'string' ? argumentsValue.text.trim() : '';
        if (!text || text.length > 60) {
          throw invalid(`${toolName} requires text: a search word or * pattern of at most 60 characters.`);
        }
        const language = this.language(toolName, argumentsValue);
        const limit = this.boundedNumber(toolName, argumentsValue.limit, 'limit', 1, 100);
        return success(await this.knowledgeQueries.searchImgActivities({
          text,
          language,
          ...(limit !== undefined ? { limit } : {})
        }));
      }
      if (toolName === 'getImgActivity') {
        const activity = typeof argumentsValue?.activity === 'string' ? argumentsValue.activity.trim().toUpperCase() : '';
        if (!activity || activity.length > 40 || !/^[A-Z0-9_/]+$/.test(activity)) {
          throw invalid(
            `${toolName} requires activity: the technical name of an IMG activity of at most 40`
            + ' characters matching [A-Z0-9_/].'
          );
        }
        const language = this.language(toolName, argumentsValue);
        const maxRefs = this.boundedNumber(toolName, argumentsValue.maxRefs, 'maxRefs', 1, 20);
        return success(await this.knowledgeQueries.getImgActivity({ activity, language, ...(maxRefs !== undefined ? { maxRefs } : {}) }));
      }
      if (toolName === 'getFmTestDataSets') {
        const fmName = typeof argumentsValue?.function === 'string' ? argumentsValue.function.trim().toUpperCase() : '';
        if (!fmName || fmName.length > 30 || !/^[A-Z0-9_]+$/.test(fmName)) {
          throw invalid(`${toolName} requires function: a function module name of at most 30 characters matching [A-Z0-9_].`);
        }
        const includePayload = argumentsValue?.includePayload;
        if (includePayload !== undefined && typeof includePayload !== 'boolean') {
          throw invalid(`${toolName} supports includePayload as a boolean only.`);
        }
        return success(await this.knowledgeQueries.getFmTestDataSets({
          function: fmName,
          ...(includePayload === true ? { includePayload: true } : {})
        }));
      }
      if (toolName === 'readClusterTable') {
        if (!this.clusterRead) {
          throw new McpError(ErrorCode.InternalError, `${toolName} requires the cluster-read capability, which is not wired on this profile.`);
        }
        const table = typeof argumentsValue?.table === 'string' ? argumentsValue.table.trim().toUpperCase() : '';
        if (!table || table.length > 30 || !/^[A-Z$][A-Z0-9_/]*$/.test(table)) {
          throw invalid(`${toolName} requires table: a cluster table name of at most 30 characters matching [A-Z0-9_/] with a leading letter or $.`);
        }
        const where = argumentsValue?.where;
        if (where !== undefined && (typeof where !== 'string' || where.trim() === '')) {
          throw invalid(`${toolName} requires where to be a non-empty Open SQL fragment when provided.`);
        }
        const maxRows = this.boundedNumber(toolName, argumentsValue.maxRows, 'maxRows', 1, 1000);
        return success(await this.clusterRead.readClusterTable({
          table,
          ...(typeof where === 'string' && where.trim() !== '' ? { where: where.trim() } : {}),
          ...(maxRows !== undefined ? { maxRows } : {})
        }));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown knowledge-queries tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      // "不存在"类错误对调用方有排查价值，按 InvalidParams 透出；其余脱敏。
      const message = error instanceof Error ? error.message : String(error);
      if (/documentation for .* in language/.test(message) || /IMG activity .* does not exist/.test(message)) {
        throw new McpError(ErrorCode.InvalidParams, message);
      }
      // cluster_read：表名非法/非集群表/SQL 读取失败——调用方可排查，透传原文
      if (toolName === 'readClusterTable'
        && (/is invalid|is not a cluster table|no active DD03L|reading .*:|control characters or semicolons/i.test(message))) {
        throw new McpError(ErrorCode.InvalidParams, message);
      }
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }

  /** 语言键校验：1-2 位字母（API 层同口径复检）。 */
  private language(toolName: string, argumentsValue: Record<string, unknown>): string {
    const raw = typeof argumentsValue?.language === 'string' ? argumentsValue.language.trim() : '';
    if (raw !== '' && !/^[A-Za-z]{1,2}$/.test(raw)) {
      throw invalid(`${toolName} requires language to be a 1-2 letter SAP language key.`);
    }
    return raw === '' ? 'EN' : raw.toUpperCase();
  }

  /** 可选有界数字：undefined 透传；非法类型拒绝；越界收敛。 */
  private boundedNumber(
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
}

/** 参数校验失败的 MCP 语义错误。 */
function invalid(message: string): McpError {
  return new McpError(ErrorCode.InvalidParams, message);
}

/** 成功响应包装：content 文本与 structuredContent 同构。 */
function success(result: unknown): Record<string, any> {
  const structuredContent = { status: 'success', result };
  return {
    content: [{ type: 'text', text: serializeJsonText(structuredContent) }],
    structuredContent
  };
}
