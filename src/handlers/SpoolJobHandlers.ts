import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type {
  SpoolJobClient,
  SpoolFilterInput,
  JobFilterInput
} from '../adt/SpoolJobApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * ============================================================================
 * SPOOL/后台作业只读二工具 MCP 处理器（diagnostics.spool-jobs 只读子集）
 * ============================================================================
 *
 * 暴露两个只读工具，语义对齐 VSP vibing-steampunk 的 analyze type=spool_list /
 * job_list（internal/mcp/handlers_spool.go；底层自由 SQL 协议见
 * src/adt/SpoolJobApi.ts 注释）：
 *   - listSpoolRequests：spool 请求清单（TSP01 + TST01 头 + TBTCP 作业引用）
 *   - listJobs：后台作业清单（TBTCO + TBTCP 步骤增补）
 *
 * 业务规则：
 *   - 只读工具（readOnlyHint=true、destructiveHint=false、
 *     approvalRequired=false；_meta.operationClass='read-only tenant'）；
 *     底层仅对 TSP01/TST01/TBTCP/TBTCO 生成 SELECT。
 *   - 边界（随每个结果以 notes 返回）：spool 内容读取（TemSe/TST03 解码）与
 *     作业日志（RFC/XBP）不在本子集内——矩阵行以 PARTIAL 记录该边界。
 *   - 注入防线：名字类参数走仓库名白名单（API 层 normalizeRepositoryName），
 *     LIKE 模式与日期边界由 API 层引用/拒绝；处理器层做长度与类型预检。
 *   - 底层异常统一脱敏为 InternalError（对齐 CrossReferenceHandlers 口径）。
 */

/** 与 CrossReferenceHandlers 一致的只读工具定义强类型。 */
type SpoolJobToolDefinition = ToolDefinition & {
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
const SPOOL_JOB_TOOL_NAMES = new Set(['listSpoolRequests', 'listJobs', 'readSpoolContent']);

/** 日期参数长度上限（YYYY-MM-DD 为 10，容许 YYYYMMDD 为 8）。 */
const DATE_MAX_LENGTH = 10;
/** LIMIT 上限（与 API 层常量同口径）。 */
const MAX_LIST_LIMIT = 500;

export class SpoolJobHandlers {
  /**
   * @param spoolJob 只读 spool/作业客户端（窄接口注入；集成时用
   *   src/adt/SpoolJobApi.ts 的
   *   createSpoolJobClient(bindSpoolJobQueryRunner(readClient)) 构造）
   */
  constructor(private readonly spoolJob: SpoolJobClient) {}

  /** 该工具名是否由本处理器负责。 */
  supports(toolName: string): boolean {
    return SPOOL_JOB_TOOL_NAMES.has(toolName);
  }

  /** 两个只读工具定义。 */
  getTools(): SpoolJobToolDefinition[] {
    const readOnly: Pick<SpoolJobToolDefinition, 'annotations' | '_meta'> = {
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
        name: 'listSpoolRequests',
        description:
          'List spool requests from TSP01 with TemSe header enrichment (storage type, codepage, lines, bytes from TST01) and the producing background-job step (TBTCP), newest first. Read-only free SQL; spool content itself is not read by this tool.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            owner: { type: 'string', description: 'Filter by owner (exact, case-insensitive).', optional: true },
            title: { type: 'string', description: 'Filter by title, * wildcards allowed (SQL LIKE).', optional: true },
            program: { type: 'string', description: 'Filter by the writing program (matches RQ2NAME, first 12 characters).', optional: true },
            job: { type: 'string', description: 'Only spool requests written by this job name (resolved via TBTCP.LISTIDENT).', optional: true },
            from: { type: 'string', description: 'Creation date lower bound (YYYY-MM-DD).', optional: true },
            to: { type: 'string', description: 'Creation date upper bound (YYYY-MM-DD).', optional: true },
            limit: { type: 'number', description: `Maximum requests to return; default 50, cap ${MAX_LIST_LIMIT}.`, minimum: 1, maximum: MAX_LIST_LIMIT, optional: true }
          }
        },
        ...readOnly
      },
      {
        name: 'listJobs',
        description:
          'List background jobs from TBTCO with their steps (TBTCP: program, variant, user, spool list), latest start first, with status code and text. Read-only free SQL; job logs (TemSe/RFC-XBP in VSP) are not read by this tool.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', description: 'Job name filter: exact, or * wildcards (SQL LIKE).', optional: true },
            user: { type: 'string', description: 'Filter by scheduling user (exact).', optional: true },
            status: { type: 'string', description: 'Status codes, e.g. F (finished), R (active), A (cancelled); comma or space separated.', optional: true },
            program: { type: 'string', description: 'Only jobs with a step running this program.', optional: true },
            from: { type: 'string', description: 'Scheduled-date lower bound (YYYY-MM-DD).', optional: true },
            to: { type: 'string', description: 'Scheduled-date upper bound (YYYY-MM-DD).', optional: true },
            limit: { type: 'number', description: `Maximum jobs to return; default 50, cap ${MAX_LIST_LIMIT}.`, minimum: 1, maximum: MAX_LIST_LIMIT, optional: true }
          }
        },
        ...readOnly
      },
      {
        name: 'readSpoolContent',
        description:
          "Read one spool request's TemSe header (TST01) and content (TST03): text-like documents (LIST/TEXT) are returned as text; binary/OTF documents return a raw note instead of decoded content. Read-only.",
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            requestNumber: { type: 'number', description: 'Spool request number (RQIDENT).', minimum: 1 }
          },
          required: ['requestNumber']
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
      switch (toolName) {
        case 'listSpoolRequests':
          return success(await this.spoolJob.listSpoolRequests(this.filterArgs(toolName, argumentsValue)));
        case 'listJobs':
          return success(await this.spoolJob.listJobs(this.filterArgs(toolName, argumentsValue)));
        case 'readSpoolContent': {
          // spool 编号为必填正整数；校验留在进入客户端之前
          const requestNumber = Number(argumentsValue.requestNumber)
          if (!Number.isInteger(requestNumber) || requestNumber <= 0) {
            throw new McpError(ErrorCode.InvalidParams, 'readSpoolContent requires a positive requestNumber (RQIDENT).')
          }
          return success(await this.spoolJob.readSpoolContent(requestNumber))
        }
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown spool/job tool: ${toolName}`);
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      // 底层 SQL 通道错误可能包含目标系统细节；对外只报告工具级失败
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }

  /**
   * 共用过滤参数预检：
   *   - 名字类字段（owner/program/job/user）在处理器层就做仓库名白名单
   *     （A-Z 0-9 _ / $，≤40）——注入样本是参数错误，应返回 InvalidParams
   *     而不是底层 InternalError；API 层保留同口径校验作纵深防御；
   *   - 作业名（name）额外放行 * 与 % 通配（SQL LIKE 语义）；
   *   - title 允许更宽字符（含通配），由 API 层引用转义与控制字符拒绝兜底；
   *   - limit 收敛到 [1, 500]。
   */
  private filterArgs(toolName: string, argumentsValue: Record<string, unknown>): SpoolFilterInput & JobFilterInput {
    const result: SpoolFilterInput & JobFilterInput = {};
    const strictNamePattern = /^[A-Z0-9_/$]+$/;
    const wildcardNamePattern = /^[A-Z0-9_/$*%]+$/;
    const stringFields = ['owner', 'title', 'program', 'job', 'name', 'user', 'status', 'from', 'to'] as const;
    for (const field of stringFields) {
      const raw = argumentsValue?.[field];
      if (raw === undefined) continue;
      if (typeof raw !== 'string') {
        throw invalid(`${toolName} requires ${field} to be a string.`);
      }
      const value = raw.trim();
      const cap = field === 'from' || field === 'to' ? DATE_MAX_LENGTH : 60;
      if (value.length > cap) {
        throw invalid(`${toolName} requires ${field} of at most ${cap} characters.`);
      }
      if (value === '') continue;
      if (field === 'owner' || field === 'program' || field === 'job' || field === 'user') {
        const normalized = value.toUpperCase();
        if (!strictNamePattern.test(normalized) || normalized.length > 40) {
          throw invalid(
            `${toolName} requires ${field} to be a repository name (A-Z 0-9 _ / $, at most 40 characters).`
          );
        }
        result[field] = normalized;
        continue;
      }
      if (field === 'name') {
        const normalized = value.toUpperCase();
        if (!wildcardNamePattern.test(normalized) || normalized.length > 60) {
          throw invalid(
            `${toolName} requires name to be a job name (A-Z 0-9 _ / $ with optional * or % wildcards).`
          );
        }
        result[field] = normalized;
        continue;
      }
      result[field] = value;
    }
    const rawLimit = argumentsValue?.limit;
    if (rawLimit !== undefined) {
      if (typeof rawLimit !== 'number' || !Number.isFinite(rawLimit)) {
        throw invalid(`${toolName} requires limit to be a finite number.`);
      }
      result.limit = Math.min(Math.max(Math.floor(rawLimit), 1), MAX_LIST_LIMIT);
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
