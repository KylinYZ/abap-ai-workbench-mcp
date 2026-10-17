import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import { analyzeLint, type LintInput, type LintResult } from '../adt/AnalyzeLintApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * analyzeLint MCP 处理器（analysis.lint 行收编）。
 * 只读工具：本地 abaplint 引擎（@abaplint/core），无 SAP 交互——
 * 全角色/全环境可见（QAS/PRD 亦可用，纯客户端分析）。
 */
const LINT_TOOL_NAMES = new Set(['analyzeLint']);

export class AnalyzeLintHandlers {
  supports(toolName: string): boolean {
    return LINT_TOOL_NAMES.has(toolName);
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'analyzeLint',
        description:
          'Offline static analysis of ABAP source code using the abaplint engine (built-in @abaplint/core npm dependency, Apache-2.0). Provide ABAP source directly; returns findings with severity, rule key, line numbers, and messages. Read-only; no SAP interaction — analysis runs entirely client-side.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: {
              type: 'string',
              description: 'ABAP source code to analyze (max 50KB).',
              optional: true
            },
            version: {
              type: 'string',
              enum: ['Standard', 'Cloud'],
              description: 'ABAP syntax version for the analysis (default Standard; Cloud enables Cloud-only rules).',
              optional: true
            },
            maxFindings: {
              type: 'number',
              description: 'Cap on returned findings (default 200, max 500); truncated when exceeded.',
              minimum: 1,
              maximum: 500,
              optional: true
            }
          }
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      }
    ];
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    if (toolName !== 'analyzeLint') {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown lint tool: ${toolName}`);
    }
    try {
      const input: Partial<LintInput> = {};
      const code = typeof argumentsValue?.code === 'string' ? argumentsValue.code : undefined;
      const version = argumentsValue?.version;
      const maxFindings = argumentsValue?.maxFindings;

      if (code !== undefined) input.code = code;
      if (version === 'Standard' || version === 'Cloud') input.version = version;
      if (typeof maxFindings === 'number' && Number.isSafeInteger(maxFindings)) input.maxFindings = maxFindings;

      return this.success(await analyzeLint(input as LintInput));
    } catch (error) {
      if (error instanceof McpError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/non-empty|50KB limit|is invalid/i.test(message)) {
        throw new McpError(ErrorCode.InvalidParams, message);
      }
      throw new McpError(ErrorCode.InternalError, `${toolName} failed: ${message.slice(0, 160)}`);
    }
  }

  private success(result: unknown): Record<string, any> {
    const structuredContent = { status: 'success', result };
    return {
      content: [{ type: 'text', text: serializeJsonText(structuredContent) }],
      structuredContent
    };
  }
}
