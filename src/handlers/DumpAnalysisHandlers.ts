/**
 * Dump 增值分析工具处理器（矩阵行 diagnostics.dumps 的增值半边）。
 *
 * 两个只读工具（数据源复用 RuntimeDumpReader 的 ST22 feed 读取与时间窗校验，
 * 聚合运算在 src/read/DumpAnalytics.ts，语义对齐 VSP 的 group_dumps /
 * similar_dumps——均为纯客户端聚合，零额外端点）：
 *   1. groupRuntimeDumps —— 窗口内 ST22 dump 按 (异常类型, 终止程序) 分组聚合，
 *      频次降序、并列时最近优先；回答"哪些问题最频繁/还在发生吗/涉及谁"。
 *   2. findSimilarDumps  —— 给定异常类型（可叠加程序过滤），回答窗口内同类
 *      dump 出现次数、最近一次时间与涉及用户；空结果即"是新问题"。
 *
 * 业务规则：
 *   - 全部只读（readOnlyHint=true），operationClass 为 read-only tenant；
 *   - 时间窗/limit/过滤值校验复用 RuntimeDumpReader 的既有实现（ISO 时间、
 *     窗口 ≤7 天、SAFE_FILTER_VALUE 白名单），本文件不重复实现；
 *   - 错误脱敏对齐 HighLevelReadHandlers：底层异常一律 InternalError，
 *     绝不外泄 ADT 响应内容。
 */
import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import { RuntimeDumpReader, type RuntimeDumpInput } from '../read/RuntimeDumpReader.js';
import { findSimilarDumps, groupRuntimeDumps } from '../read/DumpAnalytics.js';
import { serializeJsonText } from '../lib/jsonResponse';

const DUMP_ANALYSIS_TOOL_NAMES = new Set(['groupRuntimeDumps', 'findSimilarDumps']);

/** 与 HighLevelReadHandlers 一致的只读工具定义强类型与元数据。 */
type DumpAnalysisToolDefinition = ToolDefinition & {
  annotations: { readOnlyHint: true; destructiveHint: false; idempotentHint: true; openWorldHint: true };
  _meta: { operationClass: 'read-only tenant'; approvalRequired: false };
};

function readOnlyTool(
  name: string,
  description: string,
  inputSchema: ToolDefinition['inputSchema']
): DumpAnalysisToolDefinition {
  return {
    name,
    description,
    inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    _meta: { operationClass: 'read-only tenant', approvalRequired: false }
  };
}

/** 与 HighLevelReadHandlers 的 success 同型：结构化返回 + 文本双通道。 */
function success(result: unknown): Record<string, any> {
  const structuredContent = { status: 'success', result };
  return {
    content: [{ type: 'text', text: serializeJsonText(structuredContent) }],
    structuredContent
  };
}

export class DumpAnalysisHandlers {
  constructor(private readonly runtimeDumps: RuntimeDumpReader) {}

  supports(toolName: string): boolean {
    return DUMP_ANALYSIS_TOOL_NAMES.has(toolName);
  }

  getTools(): DumpAnalysisToolDefinition[] {
    return [
      readOnlyTool(
        'groupRuntimeDumps',
        'Group runtime dumps (ST22) in a time window by runtime error and terminated program with occurrence counts, users, and first/last timestamps; most frequent first. Read-only client-side aggregation over the same feed as readRuntimeDumps.',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            from: { type: 'string', description: 'ISO-8601 start timestamp with an explicit target-system offset.', maxLength: 40 },
            to: { type: 'string', description: 'ISO-8601 end timestamp with the same explicit target-system offset.', maxLength: 40 },
            limit: { type: 'number', description: 'Maximum dumps to read before aggregation; defaults to 20.', minimum: 1, maximum: 50, optional: true },
            user: { type: 'string', description: 'Optional exact SAP user filter.', maxLength: 40, optional: true },
            objectName: { type: 'string', description: 'Optional contained ABAP object-name filter.', maxLength: 128, optional: true },
            runtimeError: { type: 'string', description: 'Optional contained runtime-error filter.', maxLength: 128, optional: true },
            exception: { type: 'string', description: 'Optional contained exception-class filter.', maxLength: 128, optional: true }
          },
          required: ['from', 'to']
        }
      ),
      readOnlyTool(
        'findSimilarDumps',
        'Find dumps similar to a given runtime error in a time window: occurrence count, first/last timestamps, users, and ordered occurrences. Empty answer means the error is new in that window. Read-only.',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            runtimeError: { type: 'string', description: 'Runtime error (exception) name to match, e.g. CX_SY_ZERODIVIDE.', minLength: 1, maxLength: 128 },
            program: { type: 'string', description: 'Optional terminated-program name to narrow the match.', minLength: 1, maxLength: 40, optional: true },
            from: { type: 'string', description: 'ISO-8601 start timestamp with an explicit target-system offset.', maxLength: 40 },
            to: { type: 'string', description: 'ISO-8601 end timestamp with the same explicit target-system offset.', maxLength: 40 },
            limit: { type: 'number', description: 'Maximum dumps to read before matching; defaults to 20.', minimum: 1, maximum: 50, optional: true },
            user: { type: 'string', description: 'Optional exact SAP user filter.', maxLength: 40, optional: true }
          },
          required: ['runtimeError', 'from', 'to']
        }
      )
    ];
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'groupRuntimeDumps') {
        // 读取（含既有时间窗/过滤校验）→ 纯客户端聚合
        const { dumps } = await this.runtimeDumps.read(argumentsValue as unknown as RuntimeDumpInput);
        const grouped = groupRuntimeDumps(dumps);
        return success({
          ...grouped,
          window: { from: argumentsValue.from, to: argumentsValue.to }
        });
      }
      if (toolName === 'findSimilarDumps') {
        // runtimeError 是匹配主键，必填校验在进入底层读取之前完成
        const runtimeError = typeof argumentsValue.runtimeError === 'string' ? argumentsValue.runtimeError.trim() : '';
        if (!runtimeError) {
          throw new McpError(ErrorCode.InvalidParams, 'findSimilarDumps requires a non-empty runtimeError to match.');
        }
        const program = typeof argumentsValue.program === 'string' ? argumentsValue.program.trim() : undefined;
        // runtimeError 只做客户端匹配，不透传给服务端 feed 过滤：
        // 对齐 VSP similar 的"拉全量后客户端匹配"语义，且不受服务端
        // runtimeError 过滤在此 DEV 系统的既有问题影响（真机 2026-09-16：
        // readRuntimeDumps 带该过滤即 InternalError，见 PROGRESS 遗留）。
        const { runtimeError: _ignoredError, exception: _ignoredException, ...readerInput } =
          argumentsValue as unknown as RuntimeDumpInput & Record<string, unknown>;
        const { dumps } = await this.runtimeDumps.read(readerInput);
        const similar = findSimilarDumps(dumps, runtimeError, program);
        return success({ ...similar, window: { from: argumentsValue.from, to: argumentsValue.to } });
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown dump analysis tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      // Raw ADT responses may contain target details, headers, or values; expose none of them.
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }
}
