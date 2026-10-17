import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type { ReportVariantsClient } from '../adt/ReportVariantsApi.js';
import type { ReportJobClient, RunReportInput } from '../adt/ReportJobApi.js';
import { HelperRfcBridge, HelperRfcBridgeError } from '../adt/HelperRfcApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * ============================================================================
 * 报表执行面 MCP 处理器（矩阵行 report.run / report.async / report.variants）
 * ============================================================================
 *
 * 暴露三个工具（所有者 2026-10-07 放开报表执行方向后收编）：
 *   - getReportVariants —— 变体清单（纯 ADT SQL：VARID+VARIT；只读，全 profile）
 *   - runReport         —— 同步运行报表并捕获 ALV 输出（ZADT_VSP 桥 report 域，
 *                          部署服务契约：SUBMIT + cl_salv_bs_runtime_info 捕获）
 *   - submitReportJob   —— 报表后台作业提交（受控执行核包装 JOB_OPEN/SUBMIT/
 *                          JOB_CLOSE；输出经既有 listJobs/readSpoolContent 面）
 *
 * 门控（执行语义，对齐 executeAbap 先例）：
 *   - runReport/submitReportJob 为 OTHER_MUTATION 执行类（运行系统内已有代码，
 *     DEV-only + 写槽串行）；报表名在调用中显式可见。无 preview/确认链——
 *     与 runClass/unitTestRun/executeAbap 同级（确认链保留给仓储变更）。
 *   - getReportVariants 为只读（readOnlyHint=true），全只读面收录。
 * 错误分层：调用方可排查的服务端语义（REPORT_NOT_FOUND/VALIDATION_FAILED/
 * 参数校验）按 InvalidParams 透传；其余桥/基础设施异常脱敏 InternalError。
 */

/** 本处理器认领的工具名。 */
const REPORT_TOOL_NAMES = new Set(['getReportVariants', 'runReport', 'submitReportJob', 'helperCallRfm']);

export class ReportHandlers {
  constructor(
    private readonly variants: ReportVariantsClient,
    private readonly reportJob: ReportJobClient,
    private readonly helperRfc?: HelperRfcBridge
  ) {}

  supports(toolName: string): boolean {
    return REPORT_TOOL_NAMES.has(toolName);
  }

  getTools(): ToolDefinition[] {
    const readOnly = {
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      _meta: { operationClass: 'read-only tenant', approvalRequired: false }
    } as const;
    const executing = {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      _meta: { operationClass: 'mutating tenant', approvalRequired: false }
    } as const;

    const reportNameProperty = {
      type: 'string' as const,
      description: 'Report name, e.g. RSUSR002 or Z_REPORT.',
      minLength: 1,
      maxLength: 40
    };
    const variantProperty = {
      type: 'string' as const,
      description: 'Variant name (alternative to params; takes precedence when provided).',
      minLength: 1,
      maxLength: 14,
      optional: true
    };
    const paramsProperty = {
      type: 'object' as const,
      description: "Selection parameters as an object of parameter name (max 8 chars, e.g. \"PA_DATE\") to string value; applied as RSPARAMS kind='P' rows.",
      additionalProperties: { type: 'string' },
      optional: true
    };

    return [
      {
        name: 'getReportVariants',
        description:
          'List the variants of one report: VARID directory entries (name, protected flag) merged with VARIT texts (English preferred). Pure read-only SQL - no helper needed. An empty list is a valid answer. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { report: reportNameProperty },
          required: ['report']
        },
        ...readOnly
      },
      {
        name: 'runReport',
        description:
          'Run one report and return its list output: the report is scheduled as a background job (JOB_OPEN -> SUBMIT VIA JOB -> JOB_CLOSE via the controlled execution chain), the server polls TBTCO until finished (default 60s, cap 300s) and decodes the step spool (LIST text via the built-in TemSe decoder). Accepts a variant or selection params. Executing operation: runs existing system code (same class as executeAbap); DEV-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            report: reportNameProperty,
            variant: variantProperty,
            params: paramsProperty,
            waitSeconds: {
              type: 'number',
              description: 'Seconds to wait for the job to finish before returning (default 60, cap 300). On timeout the result is marked pollTimeout and the job keeps running (continue with listJobs).',
              minimum: 5,
              maximum: 300,
              optional: true
            }
          },
          required: ['report']
        },
        ...executing
      },
      {
        name: 'submitReportJob',
        description:
          'Submit one report as a background job and return jobname/jobcount immediately: a one-shot wrapper program schedules the job (JOB_OPEN -> SUBMIT VIA JOB -> JOB_CLOSE, start immediately); the job runs on SAP background workers. Poll with listJobs and read the list output with listSpoolRequests/readSpoolContent. Executing operation: schedules existing system code (same class as executeAbap); DEV-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            report: reportNameProperty,
            variant: variantProperty,
            params: paramsProperty
          },
          required: ['report']
        },
        ...executing
      },
      {
        name: 'helperCallRfm',
        description:
          'Call one function module via the ZADT_VSP helper-bridge rfc domain (WebSocket): the CALL FUNCTION executes inside the SAP application process, so non-remote-enabled FMs are also reachable (unlike callRfm which goes through the SAP gateway and is gateway-restricted to remote-enabled). Hard allowlist gate (default: the same read-only standard-FM set as callRfm; extendable only via server-side constructor injection) - non-allowlisted FMs are rejected before any network round trip. Returns sy-subrc, export values, and table results. Executing operation: runs existing system code; DEV-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            function: {
              type: 'string',
              description: 'Function module name (must be on the helper-bridge allowlist).',
              minLength: 1,
              maxLength: 30
            },
            importing: {
              type: 'object',
              description: 'IMPORT parameters as an object of parameter name to string value.',
              additionalProperties: { type: 'string' },
              optional: true
            }
          },
          required: ['function']
        },
        ...executing
      }
    ];
  }

  /** 只读面（getReportVariants）：并入 analyticReadTools——development/diagnostic
   *  组合面经 runtimeTools 获得只读变体清单。 */
  getVariantsTool(): ToolDefinition {
    return this.getTools().find(tool => tool.name === 'getReportVariants')!;
  }

  /** 执行面（runReport/submitReportJob/helperCallRfm）：并入 coverageTools——
   *  legacy-full 与 workbench 显式名单（DEV-only，OTHER_MUTATION）。 */
  getExecutionTools(): ToolDefinition[] {
    return this.getTools().filter(tool => tool.name !== 'getReportVariants');
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'getReportVariants') {
        const report = this.reportName(toolName, argumentsValue);
        return this.success(await this.variants.getReportVariants({ report }));
      }
      if (toolName === 'runReport') {
        const report = this.reportName(toolName, argumentsValue);
        const { variant, params } = this.selection(toolName, argumentsValue);
        const waitSeconds = this.boundedNumber(toolName, argumentsValue.waitSeconds, 'waitSeconds', 5, 300);
        const input: RunReportInput = {
          report,
          ...(variant !== undefined ? { variant } : {}),
          ...(params !== undefined ? { params } : {}),
          ...(waitSeconds !== undefined ? { waitSeconds } : {})
        };
        return this.success(await this.reportJob.runReport(input));
      }
      if (toolName === 'submitReportJob') {
        const report = this.reportName(toolName, argumentsValue);
        const { variant, params } = this.selection(toolName, argumentsValue);
        return this.success(await this.reportJob.submitReportJob({
          report,
          ...(variant !== undefined ? { variant } : {}),
          ...(params !== undefined ? { params } : {})
        }));
      }
      if (toolName === 'helperCallRfm') {
        if (!this.helperRfc) {
          throw new McpError(ErrorCode.InternalError, `${toolName} requires the helper-bridge rfc capability, which is not wired on this profile.`);
        }
        const fm = typeof argumentsValue?.function === 'string' ? argumentsValue.function.trim().toUpperCase() : '';
        if (!fm || fm.length > 30 || !/^[A-Z0-9_/]+$/.test(fm)) {
          throw invalid(`${toolName} requires function: a function module name of at most 30 characters matching [A-Z0-9_/].`);
        }
        let importing: Record<string, string> | undefined;
        if (argumentsValue?.importing !== undefined) {
          if (typeof argumentsValue.importing !== 'object' || argumentsValue.importing === null || Array.isArray(argumentsValue.importing)) {
            throw invalid(`${toolName} requires importing to be an object of parameter name to string value.`);
          }
          importing = {};
          for (const [k, v] of Object.entries(argumentsValue.importing as Record<string, unknown>)) {
            if (typeof v !== 'string') throw invalid(`${toolName} requires importing values to be strings (got ${k}).`);
            importing[k] = v;
          }
        }
        return this.success(await this.helperRfc.callFunction(fm, importing));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown report tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      // 调用方可排查的服务端语义按 InvalidParams 透传；其余脱敏
      if (/is invalid|REPORT_NOT_FOUND|VALIDATION_FAILED|no active PROG version|job API failed|job submission failed|not on the helper-bridge allowlist/i.test(message)) {
        // runReport/submitReportJob 共用 job 客户端——语义错误均透传
        throw new McpError(ErrorCode.InvalidParams, `${toolName}: ${message}`);
      }
      throw new McpError(ErrorCode.InternalError, `${toolName} failed: ${message.slice(0, 160)}`);
    }
  }

  /** 有界数值参数（与 KnowledgeQueriesHandlers 同款）。 */
  private boundedNumber(toolName: string, value: unknown, name: string, min: number, max: number): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
      throw invalid(`${toolName} requires ${name} to be an integer between ${min} and ${max}.`);
    }
    return value;
  }

  /** 报表名处理器层预检（API 层二次校验）。 */
  private reportName(toolName: string, argumentsValue: Record<string, unknown>): string {
    const report = typeof argumentsValue?.report === 'string' ? argumentsValue.report.trim().toUpperCase() : '';
    if (!report || report.length > 40 || !/^[A-Z0-9_/=$]+$/.test(report)) {
      throw invalid(`${toolName} requires report: a report name of at most 40 characters matching [A-Z0-9_/=$].`);
    }
    return report;
  }

  /** variant/params/maxRows 预检（runReport 与 submitReportJob 共用）。 */
  private selection(toolName: string, argumentsValue: Record<string, unknown>): {
    variant?: string;
    params?: Record<string, string>;
    maxRows?: number;
  } {
    const variant = argumentsValue?.variant;
    if (variant !== undefined && (typeof variant !== 'string' || variant.trim() === '')) {
      throw invalid(`${toolName} requires variant to be a non-empty string when provided.`);
    }
    let params: Record<string, string> | undefined;
    if (argumentsValue?.params !== undefined) {
      if (typeof argumentsValue.params !== 'object' || argumentsValue.params === null || Array.isArray(argumentsValue.params)) {
        throw invalid(`${toolName} requires params to be an object of name to string value.`);
      }
      params = {};
      for (const [k, v] of Object.entries(argumentsValue.params as Record<string, unknown>)) {
        if (typeof v !== 'string') {
          throw invalid(`${toolName} requires params values to be strings (got ${k}).`);
        }
        params[k] = v;
      }
    }
    return {
      ...(typeof variant === 'string' ? { variant: variant.trim().toUpperCase() } : {}),
      ...(params !== undefined ? { params } : {})
    };
  }

  private success(result: unknown): Record<string, any> {
    const structuredContent = { status: 'success', result };
    return {
      content: [{ type: 'text', text: serializeJsonText(structuredContent) }],
      structuredContent
    };
  }
}

/** 参数校验失败的 MCP 语义错误。 */
function invalid(message: string): McpError {
  return new McpError(ErrorCode.InvalidParams, message);
}
