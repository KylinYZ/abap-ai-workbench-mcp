import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type { InstallDiagnosticsClient } from '../adt/InstallDiagnosticsApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * ============================================================================
 * 安装前置只读发现 MCP 工具处理器（关闭能力矩阵缺口 install.diagnostics）
 * ============================================================================
 *
 * 暴露一个只读工具 checkInstallPrerequisites：报告 SAP 端 helper（ZADT_VSP）
 * 与 abapGit 的安装前置现状 + 本地运行时版本。纯只读 discovery，不做任何
 * 安装动作（安装属矩阵 INTENTIONAL_RESTRICTION 行）。协议细节见
 * src/adt/InstallDiagnosticsApi.ts 注释。
 *
 * 业务规则：
 *   - 只读工具（readOnlyHint=true、destructiveHint=false、approvalRequired=false；
 *     _meta.operationClass='read-only tenant'）；无入参。
 *   - 底层异常统一脱敏为 InternalError。
 */

/** 与 CrossReferenceHandlers 一致的只读工具定义强类型。 */
type InstallToolDefinition = ToolDefinition & {
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
const INSTALL_TOOL_NAMES = new Set(['checkInstallPrerequisites']);

export class InstallDiagnosticsHandlers {
  /**
   * @param installDiagnostics 安装前置只读客户端（集成时用
   *   src/adt/InstallDiagnosticsApi.ts 的 createInstallDiagnosticsClient(readClient)
   *   构造；readClient 需含 searchObject/runQuery/httpClient）
   */
  constructor(private readonly installDiagnostics: InstallDiagnosticsClient) {}

  /** 该工具名是否由本处理器负责。 */
  supports(toolName: string): boolean {
    return INSTALL_TOOL_NAMES.has(toolName);
  }

  /** 只读工具定义（无入参）。 */
  getTools(): InstallToolDefinition[] {
    return [
      {
        name: 'checkInstallPrerequisites',
        description:
          'Read-only discovery of install prerequisites: whether the ZADT_VSP helper objects exist (TADIR probe), whether the abapGit ADT service is reachable (GET /sap/bc/adt/git/repos classified as available / not_installed / forbidden), and the local Node runtime version. This server never installs anything. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {}
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true
        },
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      }
    ];
  }

  /**
   * 分派到注入的只读客户端。MCP 语义错误透传；底层异常脱敏为 InternalError。
   */
  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'checkInstallPrerequisites') {
        return success(await this.installDiagnostics.checkInstallPrerequisites());
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown install-diagnostics tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
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
