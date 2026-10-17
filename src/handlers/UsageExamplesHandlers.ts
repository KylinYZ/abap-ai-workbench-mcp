/**
 * usage-examples 只读工具处理器（analysis.history 的 usage_examples 子操作）。
 *
 * 单工具 getUsageExamples：
 *   - 给出目标对象被怎么使用的具体调用片段（callers 候选来自交叉表，
 *     逐候选读源码做形态匹配：CALL_FUNCTION/METHOD_CALL/CLASS_REFERENCE/
 *     SUBMIT/PERFORM，未命中字面 GREP 兜底 MEDIUM 置信）；
 *   - 注入两条既有只读通道：交叉表 SQL（datapreview）+ 源码读取（AbapObjectResolver）；
 *   - 对象名/组件名处理器层 token 预检，API 层引号包裹（纵深防御）。
 */
import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type { UsageExamplesClient } from '../adt/UsageExamplesApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

type UsageExamplesToolDefinition = ToolDefinition & {
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

const USAGE_EXAMPLES_TOOL_NAMES = new Set(['getUsageExamples']);

export class UsageExamplesHandlers {
  constructor(private readonly usageExamples: UsageExamplesClient) {}

  supports(toolName: string): boolean {
    return USAGE_EXAMPLES_TOOL_NAMES.has(toolName);
  }

  getTools(): UsageExamplesToolDefinition[] {
    return [
      {
        name: 'getUsageExamples',
        description:
          "Return concrete caller snippets for a target object: candidates come from the cross-reference tables (CROSS one-char TYPE codes for FUNC/PROG/SUBMIT, WBCROSSGT+CROSS for CLAS/INTF), each caller's source is read and matched by structural pattern (CALL FUNCTION / class=>method / NEW / TYPE REF TO / SUBMIT / PERFORM), with literal-name GREP as MEDIUM-confidence fallback. FUGR callers are excluded from snippets (v1 boundary). Read-only SQL plus source reads.",
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            objectType: {
              type: 'string',
              description: 'Target object type.',
              enum: ['CLAS', 'INTF', 'PROG', 'FUNC', 'SUBMIT']
            },
            objectName: {
              type: 'string',
              description: 'Target object name, e.g. Z_MY_FM / ZCL_API / ZREPORT.',
              minLength: 1,
              maxLength: 40
            },
            method: {
              type: 'string',
              description: 'Optional method name for CLAS/INTF METHOD_CALL matching.',
              minLength: 1,
              maxLength: 61,
              optional: true
            },
            form: {
              type: 'string',
              description: 'Optional subroutine name for PROG PERFORM matching.',
              minLength: 1,
              maxLength: 30,
              optional: true
            },
            maxExamples: {
              type: 'integer',
              description: 'Maximum examples to return; default 10, cap 50.',
              minimum: 1,
              maximum: 50,
              optional: true
            }
          },
          required: ['objectType', 'objectName']
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      }
    ];
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName !== 'getUsageExamples') {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown usage-examples tool: ${toolName}`);
      }
      const objectType = typeof argumentsValue?.objectType === 'string' ? argumentsValue.objectType.trim().toUpperCase() : '';
      if (!['CLAS', 'INTF', 'PROG', 'FUNC', 'SUBMIT'].includes(objectType)) {
        throw invalid('getUsageExamples requires objectType: one of CLAS, INTF, PROG, FUNC, SUBMIT.');
      }
      const objectName = typeof argumentsValue?.objectName === 'string' ? argumentsValue.objectName.trim().toUpperCase() : '';
      if (!objectName || objectName.length > 40 || !/^[A-Z0-9_/]+$/.test(objectName)) {
        throw invalid('getUsageExamples requires objectName: a non-empty object name of at most 40 characters matching [A-Z0-9_/].');
      }
      const method = typeof argumentsValue?.method === 'string' ? argumentsValue.method.trim().toUpperCase() : undefined;
      if (method !== undefined && (method.length > 61 || !/^[A-Z0-9_/]+$/.test(method))) {
        throw invalid('getUsageExamples method must match [A-Z0-9_/] with at most 61 characters.');
      }
      const form = typeof argumentsValue?.form === 'string' ? argumentsValue.form.trim().toUpperCase() : undefined;
      if (form !== undefined && (form.length > 30 || !/^[A-Z0-9_/]+$/.test(form))) {
        throw invalid('getUsageExamples form must match [A-Z0-9_/] with at most 30 characters.');
      }
      const maxExamples = typeof argumentsValue?.maxExamples === 'number' ? argumentsValue.maxExamples : undefined;
      const result = await this.usageExamples.getUsageExamples({
        objectType: objectType as 'CLAS' | 'INTF' | 'PROG' | 'FUNC' | 'SUBMIT',
        objectName,
        ...(method !== undefined ? { method } : {}),
        ...(form !== undefined ? { form } : {}),
        ...(maxExamples !== undefined ? { maxExamples } : {})
      });
      return {
        content: [{ type: 'text', text: serializeJsonText({ status: 'success', result }) }],
        structuredContent: { status: 'success', result }
      };
    } catch (error) {
      if (error instanceof McpError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/must be one of|is invalid \(A-Z 0-9/.test(message)) {
        throw invalid(message);
      }
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }
}

function invalid(message: string): McpError {
  return new McpError(ErrorCode.InvalidParams, message);
}
