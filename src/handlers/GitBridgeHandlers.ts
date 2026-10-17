/**
 * git 域桥接工具处理器（矩阵 git.abapgit 行——经 ZADT_VSP APC WebSocket 的
 * 只读导出面）。两工具：
 *   1. gitTypes  —— abapGit 支持的对象类型清单
 *   2. gitExport —— 包/对象 → abapGit 序列化 ZIP（base64）+ 文件清单
 *
 * 门控：仅 DEV 角色（helper 只部署在 DEV）；操作类别 read-only（只读导出，
 * 跳过确认链、保留审计——与矩阵行 alternatePaths 口径一致）。
 */
import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type { GitBridgeTarget } from '../adt/GitBridgeApi.js';
import { gitGetTypes, gitExport, GitBridgeError } from '../adt/GitBridgeApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

const GIT_BRIDGE_TOOL_NAMES = new Set(['gitTypes', 'gitExport']);

/** 从进程环境推导桥接目标（与 ADT 同主机同凭据；路径为 APC 服务节点）。 */
export function gitBridgeTargetFromEnv(env: NodeJS.ProcessEnv, sapUrl: string, sapClient: string): GitBridgeTarget {
  const parsed = new URL(sapUrl);
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  return {
    host: parsed.hostname,
    port: Number(port),
    path: `/sap/bc/apc/sap/zadt_vsp?sap-client=${sapClient}`,
    authorization: 'Basic ' + Buffer.from(`${env.SAP_USER}:${env.SAP_PASSWORD ?? ''}`).toString('base64'),
    timeoutMs: 300000
  };
}

export class GitBridgeHandlers {
  constructor(private readonly target: GitBridgeTarget) { }

  supports(toolName: string): boolean {
    return GIT_BRIDGE_TOOL_NAMES.has(toolName);
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'gitTypes',
        description: 'List the ABAP object types supported by the installed abapGit (via ZADT_VSP WebSocket git domain). Read-only.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      },
      {
        name: 'gitExport',
        description: 'Export packages/objects to an abapGit-serialized ZIP (base64) with a file listing, via ZADT_VSP WebSocket git domain. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            packages: { type: 'array', description: 'Package names to export (e.g. ["Z001"]).', items: { type: 'string' }, minItems: 1 },
            includeSubpackages: { type: 'boolean', description: 'Include subpackages (default true).', optional: true }
          },
          required: ['packages']
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      }
    ];
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'gitTypes') {
        const result = await gitGetTypes(this.target);
        return this.success(result);
      }
      if (toolName === 'gitExport') {
        const result = await gitExport(this.target, {
          packages: argumentsValue.packages as string[],
          includeSubpackages: argumentsValue.includeSubpackages as boolean | undefined
        });
        return this.success(result);
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown git bridge tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      // 调用方输入校验失败（VALIDATION_FAILED）按 InvalidParams 透出；桥/服务端
      // 故障按 InternalError 脱敏——语义错误与基础设施故障分层
      if (error instanceof GitBridgeError && error.code === 'VALIDATION_FAILED') {
        throw new McpError(ErrorCode.InvalidParams, `${toolName}: ${error.message}`);
      }
      throw new McpError(ErrorCode.InternalError, `${toolName} failed: ${error instanceof Error ? error.message : String(error)}`);
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
