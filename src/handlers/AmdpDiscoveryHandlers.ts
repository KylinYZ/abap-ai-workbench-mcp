/**
 * AMDP 调试器可用性探测工具（矩阵行 debug.amdp-adt 的 discovery 前置）。
 *
 * 单个只读工具：checkAmdpDebugger——对 /sap/bc/adt/amdp/debugger/main 发起
 * 无状态 GET（零副作用），按状态码回答目标系统是否具备 ADT 原生 AMDP 调试
 * 资源（语义对齐 VSP probeAMDP：400/200/405 可用、404 缺失）。
 *
 * 定位（业务规则）：本工具是 amdp-discovery-spike 的产出——回答"前置条件是否
 * 满足"；AMDP 调试会话（start/breakpoint/await/stop）本身为后续受控工作流，
 * 不在本工具承诺范围（工具描述与矩阵 restrictionReason 均如实声明）。
 */
import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type { AmdpDiscoveryClient } from '../adt/AmdpDiscoveryApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

const AMDP_DISCOVERY_TOOL_NAMES = new Set(['checkAmdpDebugger']);

type AmdpDiscoveryToolDefinition = ToolDefinition & {
  annotations: { readOnlyHint: true; destructiveHint: false; idempotentHint: true; openWorldHint: true };
  _meta: { operationClass: 'read-only tenant'; approvalRequired: false };
};

function success(result: unknown): Record<string, any> {
  const structuredContent = { status: 'success', result };
  return {
    content: [{ type: 'text', text: serializeJsonText(structuredContent) }],
    structuredContent
  };
}

export class AmdpDiscoveryHandlers {
  constructor(private readonly amdpDiscovery: AmdpDiscoveryClient) {}

  supports(toolName: string): boolean {
    return AMDP_DISCOVERY_TOOL_NAMES.has(toolName);
  }

  getTools(): AmdpDiscoveryToolDefinition[] {
    return [
      {
        name: 'checkAmdpDebugger',
        description:
          'Check whether the target system exposes the ADT-native AMDP debugger resource (/sap/bc/adt/amdp/debugger/main). Stateless GET, zero side effects: 400/200/405 means available, 404 means absent. Answers the prerequisite only — starting debug sessions is a separate controlled workflow.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      }
    ];
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'checkAmdpDebugger') {
        return success(await this.amdpDiscovery.checkAmdpDebugger());
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown AMDP discovery tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      // 底层异常文本可能含目标系统细节；探测结果自身已归一化为 unknown，不透传
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }
}
