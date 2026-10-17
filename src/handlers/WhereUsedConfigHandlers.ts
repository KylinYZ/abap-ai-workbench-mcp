/**
 * where-used-config 只读工具处理器（analysis.history 的 where_used_config 子操作）。
 *
 * 单工具 getWhereUsedConfig：
 *   - 找出"代码里触碰 TVARVC 表"的编译单元（WBCROSSGT OTYPE=TY + CROSS TYPE=S
 *     两表配对），并对每个候选源码 grep 变量名确认真实读取；
 *   - 注入两条既有只读通道：交叉表 SQL（datapreview）+ 源码 grep（grepObjects）；
 *   - 对象名/变量名处理器层 token 预检，API 层引号包裹（纵深防御）。
 */
import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type { WhereUsedConfigClient } from '../adt/WhereUsedConfigApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

type WhereUsedConfigToolDefinition = ToolDefinition & {
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

const WHERE_USED_CONFIG_TOOL_NAMES = new Set(['getWhereUsedConfig']);

export class WhereUsedConfigHandlers {
  constructor(private readonly whereUsedConfig: WhereUsedConfigClient) {}

  supports(toolName: string): boolean {
    return WHERE_USED_CONFIG_TOOL_NAMES.has(toolName);
  }

  getTools(): WhereUsedConfigToolDefinition[] {
    return [
      {
        name: 'getWhereUsedConfig',
        description:
          "Find the objects whose code touches the TVARVC table (WBCROSSGT OTYPE=TY paired with CROSS TYPE=S), then grep each candidate's source for the variable name to confirm real readers. Grep budget defaults to 10 candidates (cap 30); unreached candidates and failed reads are reported as unsearched. Single-source failure survives with gaps; both tables failing is an error, not a 'no readers' answer. Read-only SQL plus source grep.",
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            variable: {
              type: 'string',
              description: 'TVARVC variable name, e.g. ZKEKEKE.',
              minLength: 1,
              maxLength: 40
            },
            grep: {
              type: 'boolean',
              description: 'Grep each candidate source for the variable name (default true). false lists table-touching candidates only.',
              optional: true
            },
            maxGrep: {
              type: 'integer',
              description: 'Maximum candidates to source-grep; default 10, cap 30. Unreached candidates are reported as unsearched.',
              minimum: 1,
              maximum: 30,
              optional: true
            }
          },
          required: ['variable']
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      }
    ];
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName !== 'getWhereUsedConfig') {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown where-used-config tool: ${toolName}`);
      }
      const variable = typeof argumentsValue?.variable === 'string' ? argumentsValue.variable.trim().toUpperCase() : '';
      if (!variable || variable.length > 40 || !/^[A-Z0-9_]+$/.test(variable)) {
        throw invalid('getWhereUsedConfig requires variable: a TVARVC variable name of at most 40 characters matching [A-Z0-9_].');
      }
      const grep = argumentsValue?.grep === undefined ? undefined : argumentsValue.grep === true;
      const maxGrep = typeof argumentsValue?.maxGrep === 'number' ? argumentsValue.maxGrep : undefined;
      const result = await this.whereUsedConfig.getWhereUsedConfig({
        variable,
        ...(grep !== undefined ? { grep } : {}),
        ...(maxGrep !== undefined ? { maxGrep } : {})
      });
      return {
        content: [{ type: 'text', text: serializeJsonText({ status: 'success', result }) }],
        structuredContent: { status: 'success', result }
      };
    } catch (error) {
      if (error instanceof McpError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      // 参数语义错误按 InvalidParams 透出；采集硬错误保留"不是无读者答案"语义
      if (/is invalid \(A-Z 0-9/.test(message) || /neither cross-reference table could be read/.test(message)) {
        throw new McpError(/is invalid/.test(message) ? ErrorCode.InvalidParams : ErrorCode.InternalError, message);
      }
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }
}

function invalid(message: string): McpError {
  return new McpError(ErrorCode.InvalidParams, message);
}
