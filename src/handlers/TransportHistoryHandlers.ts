import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type { TransportHistoryClient } from '../adt/TransportHistoryApi.js';
import type { ImpactAnalysisClient } from '../adt/ImpactAnalysisApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * ============================================================================
 * 传输历史只读二工具 MCP 处理器（analysis.history 行：cr_history + co_change）
 * ============================================================================
 *
 * 暴露三个只读工具（数据源为传输控制表/交叉引用表的自由 SQL SELECT）：
 *   - getCrHistory：一个对象被哪些传输/请求改过（E071 R3TR 精确 + LIMU
 *     前缀 → E070 任务→请求层级 + 用户/日期）
 *   - getCoChange：与目标对象共同变更的对象频次排行（同请求/任务共现统计）
 *   - getImpactAnalysis：反向影响面（impact 子操作收编，2026-10-07）——目标
 *     对象逐层 WBCROSSGT 反向引用 BFS（归一化/归属过滤/预算控界）
 *
 * 业务规则：
 *   - 只读工具（readOnlyHint=true、destructiveHint=false、approvalRequired=false；
 *     _meta.operationClass='read-only tenant'）。
 *   - 边界（notes 随结果返回）：E070A CR 属性联动未配置（cr 分组缺省）；
 *     tr_boundaries 已由 getTransportScope 组合链覆盖；impact 已收编。
 *   - 对象类型/名字处理器层 token 预检，API 层引号转义（纵深防御）。
 *   - 底层异常统一脱敏为 InternalError。
 */

/** 与既有只读处理器一致的只读工具定义强类型。 */
type TransportHistoryToolDefinition = ToolDefinition & {
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
const TRANSPORT_HISTORY_TOOL_NAMES = new Set(['getCrHistory', 'getCoChange', 'getImpactAnalysis']);

export class TransportHistoryHandlers {
  /**
   * @param transportHistory 传输历史只读客户端（集成时用
   *   src/adt/TransportHistoryApi.ts 的 createTransportHistoryClient(readClient) 构造）
   */
  constructor(
    private readonly transportHistory: TransportHistoryClient,
    private readonly impactAnalysis?: ImpactAnalysisClient
  ) {}

  /** 该工具名是否由本处理器负责。 */
  supports(toolName: string): boolean {
    return TRANSPORT_HISTORY_TOOL_NAMES.has(toolName);
  }

  /** 只读工具定义。 */
  getTools(): TransportHistoryToolDefinition[] {
    const readOnly: Pick<TransportHistoryToolDefinition, 'annotations' | '_meta'> = {
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
        name: 'getCrHistory',
        description:
          'Find the transports and change requests that touched an ABAP object: E071 (R3TR exact + LIMU prefix entries) resolved through the E070 task→request hierarchy with users and dates. CR grouping via the E070A transport attribute is not configured on this server and is reported in notes. Read-only SQL.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            objectType: {
              type: 'string',
              description: 'R3TR object type, e.g. PROG, CLAS, FUNC, TABL, DDLS.',
              minLength: 1,
              maxLength: 4
            },
            objectName: {
              type: 'string',
              description: 'Object name, e.g. ZCL_FOO or ZREPORT01.',
              minLength: 1,
              maxLength: 40
            }
          },
          required: ['objectType', 'objectName']
        },
        ...readOnly
      },
      {
        name: 'getCoChange',
        description:
          'Rank the objects that historically changed together with a target object: transports containing the target are resolved to their change requests (and sibling tasks), and all objects in those requests are frequency-counted. A co-change count is an argument for review, not a verdict. Read-only SQL.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            objectType: {
              type: 'string',
              description: 'R3TR object type, e.g. PROG, CLAS, FUNC, TABL.',
              minLength: 1,
              maxLength: 4
            },
            objectName: {
              type: 'string',
              description: 'Object name, e.g. ZCL_FOO.',
              minLength: 1,
              maxLength: 40
            },
            topN: {
              type: 'number',
              description: 'Maximum co-changed objects to return; default 20, cap 50.',
              minimum: 1,
              maximum: 50,
              optional: true
            }
          },
          required: ['objectType', 'objectName']
        },
        ...readOnly
      },
      {
        name: 'getImpactAnalysis',
        description:
          'Reverse-dependency impact analysis for one object: layer-by-layer WBCROSSGT reverse cross-reference acquisition (NAME LIKE target%, bounded rows per query), include names normalized to object level with ownership filtering, BFS frontier up to maxDepth (default 3, cap 5), with direct callers, per-depth affected sets, per-edge evidence (raw include pool names) and a query-budget note. Backbone only: dynamic calls are not resolved (VSP marks them DYNAMIC_CALL without extending the frontier either). Read-only SQL.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            objectType: {
              type: 'string',
              description: 'Target object type: CLAS, INTF, PROG, FUGR, FUNC, TABL, DTEL, DOMA, MSAG or DEVC.',
              enum: ['CLAS', 'INTF', 'PROG', 'FUGR', 'FUNC', 'TABL', 'DTEL', 'DOMA', 'MSAG', 'DEVC']
            },
            objectName: {
              type: 'string',
              description: 'Target object name, e.g. ZCL_FOO.',
              minLength: 1,
              maxLength: 40
            },
            maxDepth: {
              type: 'number',
              description: 'BFS depth cap; default 3, max 5.',
              minimum: 1,
              maximum: 5,
              optional: true
            }
          },
          required: ['objectType', 'objectName']
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
      if (toolName === 'getImpactAnalysis') {
        if (!this.impactAnalysis) {
          throw new McpError(ErrorCode.InternalError, `${toolName} requires the impact-analysis capability, which is not wired on this profile.`);
        }
        const impactType = typeof argumentsValue?.objectType === 'string' ? argumentsValue.objectType.trim().toUpperCase() : '';
        const impactName = typeof argumentsValue?.objectName === 'string' ? argumentsValue.objectName.trim().toUpperCase() : '';
        if (!impactName || impactName.length > 40 || !/^[A-Z0-9_/=$]+$/.test(impactName)) {
          throw invalid(`${toolName} requires objectName: a non-empty object name of at most 40 characters matching [A-Z0-9_/=$].`);
        }
        const maxDepth = this.boundedNumber(toolName, argumentsValue.maxDepth, 'maxDepth', 1, 5);
        return success(await this.impactAnalysis.getImpactAnalysis({
          objectType: impactType,
          objectName: impactName,
          ...(maxDepth !== undefined ? { maxDepth } : {})
        }));
      }
      if (toolName !== 'getCrHistory' && toolName !== 'getCoChange') {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown transport-history tool: ${toolName}`);
      }
      const objectType = typeof argumentsValue?.objectType === 'string' ? argumentsValue.objectType.trim().toUpperCase() : '';
      const objectName = typeof argumentsValue?.objectName === 'string' ? argumentsValue.objectName.trim().toUpperCase() : '';
      if (!objectType || objectType.length > 4 || !/^[A-Z0-9_/]+$/.test(objectType)) {
        throw invalid(`${toolName} requires objectType: an R3TR object type of at most 4 characters (e.g. PROG, CLAS, TABL).`);
      }
      if (!objectName || objectName.length > 40 || !/^[A-Z0-9_/]+$/.test(objectName)) {
        throw invalid(`${toolName} requires objectName: a non-empty object name of at most 40 characters matching [A-Z0-9_/].`);
      }
      if (toolName === 'getCrHistory') {
        return success(await this.transportHistory.getCrHistory({ objectType, objectName }));
      }
      const topN = this.boundedNumber(toolName, argumentsValue.topN, 'topN', 1, 50);
      return success(await this.transportHistory.getCoChange({
        objectType,
        objectName,
        ...(topN !== undefined ? { topN } : {})
      }));
    } catch (error) {
      if (error instanceof McpError) throw error;
      // impact：API 层的参数校验错误（object_type/object_name 非法）对调用方
      // 可排查，按 InvalidParams 透传；其余底层异常脱敏为 InternalError
      if (toolName === 'getImpactAnalysis') {
        const message = error instanceof Error ? error.message : String(error);
        if (/object_type .* is invalid|object_name .* is invalid/i.test(message)) {
          throw new McpError(ErrorCode.InvalidParams, message);
        }
      }
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
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
