import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type { ApplicationLogClient, ApplicationLogFilter } from '../adt/ApplicationLogApi.js';
import {
  APPLICATION_LOG_DEFAULT_MAX_RESULTS,
  APPLICATION_LOG_EXTERNAL_ID_MAX_LENGTH,
  APPLICATION_LOG_MAX_RESULTS_CAP,
  APPLICATION_LOG_MAX_WINDOW_DAYS,
  APPLICATION_LOG_OBJECT_MAX_LENGTH,
  APPLICATION_LOG_USER_MAX_LENGTH,
  sapDateWindowFromIso
} from '../adt/ApplicationLogApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * ============================================================================
 * BAL 应用日志只读 MCP 工具处理器（对应能力矩阵 diagnostics.application-log 行）
 * ============================================================================
 *
 * 暴露一个只读工具，语义对齐 VSP vibing-steampunk 的
 * SAP(action=analyze, type=application_log)（SLG1 应用日志读取；底层 ADT
 * 协议见 src/adt/ApplicationLogApi.ts 文件头注释，VSP 来源 pkg/adt/applog.go）：
 *
 *   readApplicationLog —— 按过滤器读取 BAL 应用日志头（BALHDR）条目
 *
 * 业务规则：
 *   - 只读（readOnlyHint=true、destructiveHint=false、approvalRequired=false），
 *     底层只发一条 SELECT 数据预览请求，不涉及任何 SAP 写操作。
 *   - 输入全部可选但有界：对象/子对象/用户名做大写规范化并限制 DDIC 长度；
 *     时间窗校验 ISO 形状、先后顺序与 31 天跨度上限（防全表扫描）；
 *     maxResults 限制 1..500。
 *   - 空结果返回空数组而非错误（对齐 CdsAnalysisHandlers 的容错语义）。
 *   - 本文件只定义工具与分派，不接入 src/index.ts / ToolProfiles / ToolOperationPolicy
 *     （由后续集成任务完成）；测试直接 import 本模块。
 */

/** 与 CdsAnalysisHandlers 一致的只读工具定义强类型。 */
type ApplicationLogToolDefinition = ToolDefinition & {
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
const APPLICATION_LOG_TOOL_NAMES = new Set(['readApplicationLog']);

export class ApplicationLogHandlers {
  /**
   * @param applicationLog 只读 BAL 日志客户端（窄接口注入，风格对齐
   *   CdsAnalysisHandlers 的构造注入；集成时可用 src/adt/ApplicationLogApi.ts
   *   的 createApplicationLogClient(client.h) 构造）
   */
  constructor(private readonly applicationLog: ApplicationLogClient) {}

  /** 该工具名是否由本处理器负责。 */
  supports(toolName: string): boolean {
    return APPLICATION_LOG_TOOL_NAMES.has(toolName);
  }

  /** 只读工具的 MCP 定义（schema 含 additionalProperties:false 与长度/数值边界）。 */
  getTools(): ApplicationLogToolDefinition[] {
    return [
      readOnlyTool(
        'readApplicationLog',
        'Read BAL application log headers (SLG1 semantics) filtered by log object, subobject, external ID, user and a bounded ISO time window (at most 31 days). Read-only; returns a trimmed JSON entry list (log handle, object, external ID, timestamp, message count, ...), never raw ADT XML.',
        applicationLogInputSchema()
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
      if (toolName === 'readApplicationLog') {
        return success(await this.applicationLog.readApplicationLog(this.filter(toolName, argumentsValue)));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown application log tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      // 底层 ADT 响应可能包含目标系统细节；对外只报告工具级失败
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }

  /**
   * 参数校验与规范化（业务规则，在进入底层客户端之前拦截）：
   * - object/objectSubobject：可选字符串，trim+大写，<=20 字符、无空白/控制字符；
   * - userName：可选字符串，trim+大写，<=12 字符、无空白/控制字符；
   * - externalId：可选字符串，trim 后按原样保留大小写（EXTNUMBER 按写入原样
   *   存储），<=100 字符、无控制字符；
   * - timeFrom/timeTo：可选 ISO 8601 时间窗，形状/日历/先后顺序/31 天跨度
   *   校验委托给 sapDateWindowFromIso（与 API 层同一套规则，防止两处漂移），
   *   校验失败转成 MCP InvalidParams 语义错误；
   * - maxResults：可选整数 1..500，缺省 100。
   */
  private filter(toolName: string, argumentsValue: Record<string, unknown>): ApplicationLogFilter {
    const object = this.nameField(toolName, argumentsValue?.object, 'object', APPLICATION_LOG_OBJECT_MAX_LENGTH);
    const objectSubobject = this.nameField(
      toolName,
      argumentsValue?.objectSubobject,
      'objectSubobject',
      APPLICATION_LOG_OBJECT_MAX_LENGTH
    );
    const userName = this.nameField(toolName, argumentsValue?.userName, 'userName', APPLICATION_LOG_USER_MAX_LENGTH);

    const externalIdRaw = this.optionalString(toolName, argumentsValue?.externalId, 'externalId');
    if (externalIdRaw.length > APPLICATION_LOG_EXTERNAL_ID_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(externalIdRaw)) {
      throw invalid(
        `${toolName} requires externalId to be a string of at most ${APPLICATION_LOG_EXTERNAL_ID_MAX_LENGTH} characters without control characters.`
      );
    }

    const timeFrom = this.optionalString(toolName, argumentsValue?.timeFrom, 'timeFrom');
    const timeTo = this.optionalString(toolName, argumentsValue?.timeTo, 'timeTo');
    if (timeFrom || timeTo) {
      try {
        // 时间窗形状/日历/顺序/跨度校验与 API 层共用同一实现，避免规则漂移
        sapDateWindowFromIso(timeFrom || undefined, timeTo || undefined);
      } catch (error) {
        throw invalid(`${toolName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const maxResultsRaw = argumentsValue?.maxResults;
    if (maxResultsRaw !== undefined) {
      if (
        typeof maxResultsRaw !== 'number'
        || !Number.isInteger(maxResultsRaw)
        || maxResultsRaw < 1
        || maxResultsRaw > APPLICATION_LOG_MAX_RESULTS_CAP
      ) {
        throw invalid(
          `${toolName} requires maxResults to be an integer between 1 and ${APPLICATION_LOG_MAX_RESULTS_CAP}.`
        );
      }
    }

    return {
      ...(object ? { object } : {}),
      ...(objectSubobject ? { objectSubobject } : {}),
      ...(externalIdRaw ? { externalId: externalIdRaw } : {}),
      ...(userName ? { userName } : {}),
      ...(timeFrom ? { timeFrom } : {}),
      ...(timeTo ? { timeTo } : {}),
      ...(maxResultsRaw !== undefined ? { maxResults: maxResultsRaw as number } : {})
    };
  }

  /**
   * 名称类可选字段（object/objectSubobject/userName）：必须为 string，
   * trim+大写后为空视为未提供；否则校验长度与空白/控制字符。
   */
  private nameField(toolName: string, value: unknown, label: string, maxLength: number): string {
    const name = this.optionalString(toolName, value, label).toUpperCase();
    if (!name) return '';
    if (name.length > maxLength || /\s/.test(name) || /[\u0000-\u001f\u007f]/.test(name)) {
      throw invalid(
        `${toolName} requires ${label} to be a string of at most ${maxLength} characters without whitespace or control characters.`
      );
    }
    return name;
  }

  /** 可选字符串字段：未提供返回 ''；类型不是 string 直接拒绝。 */
  private optionalString(toolName: string, value: unknown, label: string): string {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') {
      throw invalid(`${toolName} requires ${label} to be a string when provided.`);
    }
    return value.trim();
  }
}

/** readApplicationLog 的输入 schema（全部可选，附加属性禁止，边界写入 schema）。 */
function applicationLogInputSchema(): ToolDefinition['inputSchema'] {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      object: {
        type: 'string',
        description: 'SLG0 application log object (BALHDR OBJECT), e.g. ZMYOBJECT; matched upper-cased.',
        maxLength: APPLICATION_LOG_OBJECT_MAX_LENGTH,
        optional: true
      },
      objectSubobject: {
        type: 'string',
        description: 'SLG0 subobject of the log object (BALHDR SUBOBJECT); matched upper-cased.',
        maxLength: APPLICATION_LOG_OBJECT_MAX_LENGTH,
        optional: true
      },
      externalId: {
        type: 'string',
        description: 'External log identifier (BALHDR EXTNUMBER, e.g. a document number); matched verbatim as written.',
        maxLength: APPLICATION_LOG_EXTERNAL_ID_MAX_LENGTH,
        optional: true
      },
      timeFrom: {
        type: 'string',
        description: 'Inclusive start of the time window as an ISO 8601 date or timestamp (e.g. 2026-09-01 or 2026-09-01T08:00:00); applied at day granularity on BALHDR ALDATE.',
        optional: true
      },
      timeTo: {
        type: 'string',
        description: `Inclusive end of the time window as an ISO 8601 date or timestamp; together with timeFrom it may span at most ${APPLICATION_LOG_MAX_WINDOW_DAYS} days.`,
        optional: true
      },
      userName: {
        type: 'string',
        description: 'SAP user name that wrote the log (BALHDR ALUSER); matched upper-cased.',
        maxLength: APPLICATION_LOG_USER_MAX_LENGTH,
        optional: true
      },
      maxResults: {
        type: 'number',
        description: `Maximum number of log headers to return, newest first. Default ${APPLICATION_LOG_DEFAULT_MAX_RESULTS}, hard cap ${APPLICATION_LOG_MAX_RESULTS_CAP}.`,
        minimum: 1,
        maximum: APPLICATION_LOG_MAX_RESULTS_CAP,
        optional: true
      }
    }
  };
}

/** 只读工具定义工厂（元数据固定：只读、非破坏、幂等、开放世界）。 */
function readOnlyTool(
  name: string,
  description: string,
  inputSchema: ToolDefinition['inputSchema']
): ApplicationLogToolDefinition {
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
