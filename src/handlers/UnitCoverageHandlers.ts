import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type {
  UnitCoverageClient,
  UnitCoverageObjectType,
  UnitCoverageQuery
} from '../adt/UnitCoverageApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * ============================================================================
 * 单元测试覆盖率 MCP 工具处理器（对应能力矩阵 read.coverage 行，执行型）
 * ============================================================================
 *
 * 暴露一个执行型工具，语义对齐 VSP vibing-steampunk focused 工具
 * GetCodeCoverage（internal/mcp/tools_focused.go 第 133 行注册白名单；
 * internal/mcp/handlers_testing.go handleGetCodeCoverage；底层 ADT 协议见
 * src/adt/UnitCoverageApi.ts 中各函数注释）：
 *
 *   runUnitCoverage —— 运行指定对象的单元测试（覆盖率采集开启），返回每测试类
 *                      执行状态 + statement/branch/procedure 覆盖率度量。
 *
 * 业务规则：
 *   - 执行型工具（readOnlyHint=false、destructiveHint=false、idempotentHint=false）：
 *     对象零修改，但会在 SAP 系统上执行被测对象的用户代码并消耗系统资源，
 *     与 unitTestRun 同级（建议接线为 other-mutation 门控，非只读）。
 *   - 输入只接受 objectType+objectName（FUNCTION_MODULE 为 GROUP/FUNC 复合格式）；
 *     ADT URI 一律由服务端从对象名推导，绝不接受调用方传入的任意 URL/XML
 *     （项目安全边界，与 VSP 直接收 object_url 不同）。
 *   - 本文件只定义工具与分派，不接入 src/index.ts / ToolProfiles（由后续
 *     集成任务完成）；测试直接 import 本模块。
 */

/** 与 CdsAnalysisHandlers 一致的工具定义强类型（执行型元数据由本文件固定）。 */
type UnitCoverageToolDefinition = ToolDefinition & {
  annotations: {
    readOnlyHint: false;
    destructiveHint: false;
    idempotentHint: false;
    openWorldHint: true;
  };
  _meta: {
    operationClass: 'mutating tenant';
    approvalRequired: false;
  };
};

/** 本处理器认领的工具名；supports()/handle() 均以此集合为边界。 */
const UNIT_COVERAGE_TOOL_NAMES = new Set(['runUnitCoverage']);

/** 支持的对象类型白名单（校验与 schema 枚举同源口径）。 */
const UNIT_COVERAGE_OBJECT_TYPES: UnitCoverageObjectType[] = ['PROGRAM', 'CLASS', 'FUNCTION_MODULE'];

/** 风险档位白名单（与 UnitCoverageApi 的枚举同源口径）。 */
const UNIT_COVERAGE_RISK_LEVELS = ['HARMLESS', 'DANGEROUS', 'CRITICAL'] as const;

/** 时长档位白名单（与 UnitCoverageApi 的枚举同源口径）。 */
const UNIT_COVERAGE_DURATIONS = ['SHORT', 'MEDIUM', 'LONG'] as const;

/**
 * objectName 的 schema 长度上限：取各类型上限的超集——FUNCTION_MODULE 复合名
 * GROUP/FUNC 最长 57（组 26 + 分隔符 1 + 模块 30）；PROGRAM/CLASS 的 30 上限
 * 由 API 层按类型细化校验（schema 只能声明一个统一上限）。
 */
const UNIT_COVERAGE_NAME_SCHEMA_MAX = 57;

export class UnitCoverageHandlers {
  /**
   * @param unitCoverage 执行型覆盖率客户端（窄接口注入，风格对齐
   *   CdsAnalysisHandlers 的构造注入；集成时可用 src/adt/UnitCoverageApi.ts 的
   *   createUnitCoverageClient(client.h) 构造）
   */
  constructor(private readonly unitCoverage: UnitCoverageClient) {}

  /** 该工具名是否由本处理器负责。 */
  supports(toolName: string): boolean {
    return UNIT_COVERAGE_TOOL_NAMES.has(toolName);
  }

  /** 执行型工具的 MCP 定义（schema 含 additionalProperties:false 与枚举/长度边界）。 */
  getTools(): UnitCoverageToolDefinition[] {
    return [
      {
        name: 'runUnitCoverage',
        description:
          'Run ABAP unit tests for one object with code coverage capture active and read line-level coverage. Returns per-test-class execution status plus statement/branch/procedure coverage numbers (trimmed JSON, never raw ADT XML). Executing operation: runs user code on the SAP system (same class as unitTestRun); modifies nothing. objectType+objectName only - the ADT URI is derived server-side. For FUNCTION_MODULE use objectName FUNCTION_GROUP/FUNCTION_MODULE.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            objectType: {
              type: 'string',
              description: 'Test object type. FUNCTION_MODULE requires objectName as FUNCTION_GROUP/FUNCTION_MODULE.',
              enum: [...UNIT_COVERAGE_OBJECT_TYPES]
            },
            objectName: {
              type: 'string',
              description: 'Exact SAP object name (uppercase-normalized server-side), e.g. ZCL_COVERAGE_DEMO; for FUNCTION_MODULE use ZFG_COV/ZFM_COV.',
              minLength: 1,
              maxLength: UNIT_COVERAGE_NAME_SCHEMA_MAX
            },
            riskLevel: {
              type: 'string',
              description: 'Cumulative risk level to include (level and below). Default HARMLESS.',
              enum: [...UNIT_COVERAGE_RISK_LEVELS],
              optional: true
            },
            duration: {
              type: 'string',
              description: 'Cumulative duration band to include (band and below). Default MEDIUM (short+medium, aligned with upstream defaults).',
              enum: [...UNIT_COVERAGE_DURATIONS],
              optional: true
            }
          },
          required: ['objectType', 'objectName']
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        _meta: { operationClass: 'mutating tenant', approvalRequired: false }
      }
    ];
  }

  /**
   * 按工具名分派到注入的执行型客户端。
   * 错误处理对齐 CdsAnalysisHandlers：MCP 语义错误（参数校验等）原样透传；
   * 其余底层异常统一脱敏为 InternalError（"failed."），绝不外泄远端响应体、
   * 头或目标系统细节。
   */
  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'runUnitCoverage') {
        return success(await this.unitCoverage.runUnitCoverage(this.query(toolName, argumentsValue)));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown unit coverage tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      // 底层 ADT 响应可能包含目标系统细节；对外只报告工具级失败
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }

  /**
   * 参数校验与规范化（业务规则，全部在进入底层客户端之前拦截）：
   * - objectType 必填且只允许 PROGRAM/CLASS/FUNCTION_MODULE（严格大写枚举匹配）；
   * - objectName 必填：非空字符串、<=57 字符、仅字母数字下划线（复合名含一个
   *   '/'），统一转大写；逐段细则由 API 层 normalizeUnitCoverageObjectName 复核；
   * - riskLevel/duration 可选：传入时必须是严格大写枚举值，缺省交由 API 层按
   *   上游默认档位展开（harmless + short/medium）。
   */
  private query(toolName: string, argumentsValue: Record<string, unknown>): UnitCoverageQuery {
    const objectType = argumentsValue?.objectType;
    if (
      typeof objectType !== 'string'
      || !UNIT_COVERAGE_OBJECT_TYPES.includes(objectType as UnitCoverageObjectType)
    ) {
      throw invalid(`${toolName} supports objectType PROGRAM, CLASS or FUNCTION_MODULE only.`);
    }

    const rawName = typeof argumentsValue?.objectName === 'string' ? argumentsValue.objectName.trim() : '';
    if (
      !rawName
      || rawName.length > UNIT_COVERAGE_NAME_SCHEMA_MAX
      || !/^[A-Za-z0-9_/]+$/.test(rawName)
    ) {
      throw invalid(
        `${toolName} requires objectName: a non-empty SAP object name of at most ${UNIT_COVERAGE_NAME_SCHEMA_MAX} characters using letters, digits, underscore (and one '/' for FUNCTION_MODULE FUNCTION_GROUP/FUNCTION_MODULE form).`
      );
    }

    // 复合格式校验（大写化前按原值分段，段细则由 API 层复核）：
    // FUNCTION_MODULE 必须恰好一个 '/'（GROUP/FUNC，缺组无法推导 ADT URI）；
    // PROGRAM/CLASS 不允许 '/'（避免命名空间前缀形式的 URI 歧义）
    const segments = rawName.split('/');
    if (objectType === 'FUNCTION_MODULE' && segments.length !== 2) {
      throw invalid(
        `${toolName} requires objectName FUNCTION_GROUP/FUNCTION_MODULE (exactly one '/') for objectType FUNCTION_MODULE.`
      );
    }
    if (objectType !== 'FUNCTION_MODULE' && segments.length !== 1) {
      throw invalid(
        `${toolName} requires objectName without '/' for objectType ${objectType}; the '/' separator is reserved for FUNCTION_MODULE.`
      );
    }

    // 枚举参数严格匹配（与 CdsAnalysisHandlers 的 objectType 同口径，不做大小写纠错），
    // 缺省保持 undefined，由 API 层展开为上游默认标志集
    const riskLevel = argumentsValue?.riskLevel;
    if (riskLevel !== undefined && !UNIT_COVERAGE_RISK_LEVELS.includes(riskLevel as never)) {
      throw invalid(`${toolName} supports riskLevel HARMLESS, DANGEROUS or CRITICAL only.`);
    }
    const duration = argumentsValue?.duration;
    if (duration !== undefined && !UNIT_COVERAGE_DURATIONS.includes(duration as never)) {
      throw invalid(`${toolName} supports duration SHORT, MEDIUM or LONG only.`);
    }

    // 规范化输出查询：大写对象名 + 显式对象类型 + 仅透传已提供的档位
    const query: UnitCoverageQuery = {
      objectType: objectType as UnitCoverageObjectType,
      objectName: rawName.toUpperCase(),
      ...(riskLevel !== undefined ? { riskLevel: riskLevel as UnitCoverageQuery['riskLevel'] } : {}),
      ...(duration !== undefined ? { duration: duration as UnitCoverageQuery['duration'] } : {})
    };
    return query;
  }
}

/** 参数校验失败的 MCP 语义错误。 */
function invalid(message: string): McpError {
  return new McpError(ErrorCode.InvalidParams, message);
}

/** 成功响应包装：content 文本与 structuredContent 同构（对齐 CdsAnalysisHandlers）。 */
function success(result: unknown): Record<string, any> {
  const structuredContent = { status: 'success', result };
  return {
    content: [{ type: 'text', text: serializeJsonText(structuredContent) }],
    structuredContent
  };
}
