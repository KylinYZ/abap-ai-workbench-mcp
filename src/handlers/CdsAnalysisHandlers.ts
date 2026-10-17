import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type {
  CdsAnalysisClient,
  CdsAnalysisObjectType,
  CdsAnalysisQuery
} from '../adt/CdsDependencyApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * ============================================================================
 * CDS 分析只读 MCP 工具处理器（对应能力矩阵 read.cds-analysis 行）
 * ============================================================================
 *
 * 暴露三个只读工具，语义对齐 VSP vibing-steampunk focused 工具
 * GetCDSDependencies / GetCDSImpactAnalysis / GetCDSElementInfo
 * （internal/mcp/tools_focused.go 第 32-34 行注册项；底层 ADT 协议见
 * src/adt/CdsDependencyApi.ts 中各函数注释）：
 *
 *   1. getCdsDependencies   —— CDS 依赖树：该 CDS 从哪些表/视图读取（上游）
 *   2. getCdsImpactAnalysis —— CDS 反向影响：哪些对象在消费该 CDS（下游）
 *   3. getCdsElementInfo    —— CDS 元素元数据：视图字段/注解清单
 *
 * 业务规则：
 *   - 三个工具全部只读（readOnlyHint=true、destructiveHint=false、
 *     approvalRequired=false），底层只发 GET 或 usageReferences 查询 POST，
 *     不涉及任何 SAP 写操作。
 *   - 输入只接受 objectType+objectName；ADT URI 一律由服务端从对象名推导，
 *     绝不接受调用方传入的任意 URL/XML（项目安全边界）。
 *   - 本文件只定义工具与分派，不接入 src/index.ts / ToolProfiles（由后续
 *     集成任务完成）；测试直接 import 本模块。
 */

/** 与 HighLevelReadHandlers 一致的只读工具定义强类型。 */
type CdsAnalysisToolDefinition = ToolDefinition & {
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

/** 本处理器认领的三个工具名；supports()/handle() 均以此集合为边界。 */
const CDS_ANALYSIS_TOOL_NAMES = new Set([
  'getCdsDependencies',
  'getCdsImpactAnalysis',
  'getCdsElementInfo'
]);

/** CDS DDL 源名称的长度上限（DDLS 对象名标准上限 30，留出命名空间余量）。 */
const CDS_OBJECT_NAME_MAX_LENGTH = 40;

export class CdsAnalysisHandlers {
  /**
   * @param cdsAnalysis 只读 CDS 分析客户端（窄接口注入，风格对齐
   *   HighLevelReadHandlers / AbapMemberSourceReader 的构造注入；集成时可用
   *   src/adt/CdsDependencyApi.ts 的 createCdsAnalysisClient(client.h) 构造）
   */
  constructor(private readonly cdsAnalysis: CdsAnalysisClient) {}

  /** 该工具名是否由本处理器负责。 */
  supports(toolName: string): boolean {
    return CDS_ANALYSIS_TOOL_NAMES.has(toolName);
  }

  /** 三个只读工具的 MCP 定义（schema 含 additionalProperties:false 与长度限制）。 */
  getTools(): CdsAnalysisToolDefinition[] {
    return [
      readOnlyTool(
        'getCdsDependencies',
        'Read the CDS forward dependency tree: base tables and views the given CDS DDL source reads FROM (upstream). Read-only; returns a trimmed JSON summary, never raw ADT XML.',
        cdsAnalysisInputSchema()
      ),
      readOnlyTool(
        'getCdsImpactAnalysis',
        'Read CDS reverse dependencies (where-used): objects that consume or reference the given CDS DDL source (downstream impact). Read-only; returns a trimmed JSON summary, never raw ADT XML.',
        cdsAnalysisInputSchema()
      ),
      readOnlyTool(
        'getCdsElementInfo',
        'Read element metadata of one CDS DDL source: field names, types, semantics and CDS annotations. Read-only; returns a trimmed JSON summary, never raw ADT XML.',
        cdsAnalysisInputSchema()
      )
    ];
  }

  /**
   * 按工具名分派到注入的只读客户端。
   * 错误处理对齐 HighLevelReadHandlers：MCP 语义错误（参数校验等）原样透传；
   * 其余底层异常统一脱敏为 InternalError（"failed."），绝不外泄远端响应体、
   * 头或目标系统细节。
   */
  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'getCdsDependencies') {
        return success(await this.cdsAnalysis.getCdsDependencies(this.query(toolName, argumentsValue)));
      }
      if (toolName === 'getCdsImpactAnalysis') {
        return success(await this.cdsAnalysis.getCdsImpactAnalysis(this.query(toolName, argumentsValue)));
      }
      if (toolName === 'getCdsElementInfo') {
        return success(await this.cdsAnalysis.getCdsElementInfo(this.query(toolName, argumentsValue)));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown CDS analysis tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      // 底层 ADT 响应可能包含目标系统细节；对外只报告工具级失败
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }

  /**
   * 参数校验与规范化（业务规则）：
   * - objectType 只允许 DDLS（CDS DDL 源）；缺省按 DDLS 处理；
   * - objectName 必填：非空、<=40 字符、无空白/控制字符，统一转大写；
   * 校验失败抛 McpError(InvalidParams)，在进入底层客户端之前拦截。
   */
  private query(toolName: string, argumentsValue: Record<string, unknown>): CdsAnalysisQuery {
    const objectType = argumentsValue?.objectType === undefined ? 'DDLS' : argumentsValue.objectType;
    if (objectType !== 'DDLS') {
      throw invalid(`${toolName} supports objectType DDLS (CDS DDL source) only.`);
    }
    const rawName = typeof argumentsValue?.objectName === 'string' ? argumentsValue.objectName.trim() : '';
    if (
      !rawName
      || rawName.length > CDS_OBJECT_NAME_MAX_LENGTH
      || /\s/.test(rawName)
      || /[\u0000-\u001f\u007f]/.test(rawName)
    ) {
      throw invalid(
        `${toolName} requires objectName: a non-empty CDS DDL source name of at most ${CDS_OBJECT_NAME_MAX_LENGTH} characters without whitespace or control characters.`
      );
    }
    // 统一输出规范查询：大写对象名 + 显式 DDLS 类型
    const normalized: { objectName: string; objectType: CdsAnalysisObjectType } = {
      objectName: rawName.toUpperCase(),
      objectType: 'DDLS'
    };
    return normalized;
  }
}

/** 三个工具共享的输入 schema（objectType 可选枚举 + objectName 长度限制）。 */
function cdsAnalysisInputSchema(): ToolDefinition['inputSchema'] {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      objectType: {
        type: 'string',
        description: 'CDS object type; only DDLS (DDL source) is supported.',
        enum: ['DDLS'],
        optional: true
      },
      objectName: {
        type: 'string',
        description: 'Exact CDS DDL source name, e.g. ZC_TRAVEL_U.',
        minLength: 1,
        maxLength: CDS_OBJECT_NAME_MAX_LENGTH
      }
    },
    required: ['objectName']
  };
}

/** 只读工具定义工厂（元数据固定：只读、非破坏、幂等、开放世界）。 */
function readOnlyTool(
  name: string,
  description: string,
  inputSchema: ToolDefinition['inputSchema']
): CdsAnalysisToolDefinition {
  return {
    name,
    description,
    inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    _meta: { operationClass: 'read-only tenant', approvalRequired: false }
  };
}

/** 成功响应包装：content 文本与 structuredContent 同构（对齐 HighLevelReadHandlers）。 */
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
