/**
 * Health 聚合查询工具处理器（analysis.history 行 health 子操作——F 残项收编）。
 *
 * 单工具（执行级门控，同 runUnitCoverage——tests 信号运行被测对象的用户
 * 测试代码，属执行行为而非只读）：
 *   1. analyzeHealth —— 包级四信号（tests/atc/boundaries/staleness）或
 *      对象级三信号（boundaries 无单对象裁定器，如实 UNKNOWN），顶层
 *      verdict + notes；"未查到问题"≠"查过没问题"（incomplete 防线）。
 */
import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type { HealthCapability } from '../adt/HealthApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

const HEALTH_TOOL_NAMES = new Set(['analyzeHealth']);

export class HealthHandlers {
  constructor(private readonly health: HealthCapability) {}

  supports(toolName: string): boolean {
    return HEALTH_TOOL_NAMES.has(toolName);
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'analyzeHealth',
        description: 'Aggregate health snapshot for a package or object (tests/atc/boundaries/staleness + verdict + notes). The tests signal actually runs unit tests (execution, DEV workbench only); signals that could not be fully checked keep the verdict at UNKNOWN instead of GOOD.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            packageName: { type: 'string', description: 'Package to analyze (either this or objectType+objectName).', optional: true },
            objectType: { type: 'string', description: 'Object type (CLAS/PROG/INTF/FUGR, or FUNC with parent).', optional: true },
            objectName: { type: 'string', description: 'Object name.', optional: true },
            parent: { type: 'string', description: 'Function group name (required for objectType=FUNC).', optional: true }
          }
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        _meta: { operationClass: 'mutating tenant', approvalRequired: false }
      }
    ];
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    if (toolName !== 'analyzeHealth') {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown health tool: ${toolName}`);
    }
    const { analyzeHealth } = await import('../adt/HealthApi.js');
    try {
      const input = {
        packageName: argumentsValue.packageName,
        objectType: argumentsValue.objectType,
        objectName: argumentsValue.objectName,
        parent: argumentsValue.parent
      } as never;
      const result = await analyzeHealth(this.health, input);
      const structuredContent = { status: 'success', result };
      return {
        content: [{ type: 'text', text: serializeJsonText(structuredContent) }],
        structuredContent
      };
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, `analyzeHealth failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
