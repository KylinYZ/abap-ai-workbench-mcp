import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import {
  executeAbapViaUnitTest, isValidAbapVariableName,
  type ExecuteAbapClient, type ExecuteAbapOptions
} from '../adt/ExecuteAbapApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * ============================================================================
 * 受控 ABAP 执行 MCP 工具处理器（对应能力矩阵 devtools.execute-abap 行，执行型）
 * ============================================================================
 *
 * 暴露一个执行型工具，语义对齐 VSP devtools.execute_abap
 * （internal/mcp/handlers_devtools.go → pkg/adt/workflows_execute.go
 * ExecuteABAP 工作流；执行核移植见 src/adt/ExecuteAbapApi.ts）：
 *
 *   executeAbap —— 把用户 ABAP 片段包进一次性 ABAP Unit 测试程序（$TMP），
 *                  单次运行并经 EXEC_RESULT 断言消息取回输出值，运行后
 *                  临时程序即删除。
 *
 * 业务规则：
 *   - 执行型工具（readOnlyHint=false、destructiveHint=false、idempotentHint=
 *     false）：会在 SAP 系统上创建/激活/删除一个自建 $TMP 临时程序并执行
 *     用户代码，与 runClass/unitTestRun 同级（OTHER_MUTATION 门控，非只读；
 *     QAS/PRD 由入口策略拒绝，写槽串行）。
 *   - 风险边界由 riskLevel 声明并双通道生效：wrapper 的 RISK LEVEL 子句 +
 *     RunUnitTests 的 riskLevels flags（harmless 默认全含；dangerous 追加
 *     dangerous；critical 全开）。
 *   - 临时程序固定 $TMP 本地包、无 transport（不创建/占用传输请求）；名称
 *     前缀 ZTEMP_EXEC_ + 毫秒时间戳尾段，运行后删除（keepProgram 除外）。
 *   - 失败语义（VSP 移植）：编译失败（激活步 200 内消息或异常）、notRun
 *     （ABAP Unit 零测试类——"空"不等于"通过"）、PayloadFailure（用户代码
 *     中途死亡，行号回译）；清理失败记 cleanupWarnings 不重试。
 *   - 输入只接受 code/riskLevel/returnVariable/keepProgram 四个字段；临时
 *     程序名、URI、锁句柄一律由服务端自持，绝不接受调用方传入任意 URL。
 */

/** 与 UnitCoverageHandlers 一致的工具定义强类型（执行型元数据由本文件固定）。 */
type ExecuteAbapToolDefinition = ToolDefinition & {
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
const EXECUTE_ABAP_TOOL_NAMES = new Set(['executeAbap']);

/** 风险档位白名单（与 ExecuteAbapApi 的 riskLevelABAP 同源口径）。 */
const EXECUTE_ABAP_RISK_LEVELS = ['harmless', 'dangerous', 'critical'] as const;

/**
 * 用户代码长度上限：wrapper 是单方法体内联展开，ABAP 方法体与激活器对
 * 超大源码既慢又易超时；100k 字符对"片段执行"定位已远超所需。
 */
const EXECUTE_ABAP_CODE_MAX = 100_000;

/** returnVariable 的 schema 上限（与 API 层 30 位 ABAP 变量名规则一致）。 */
const EXECUTE_ABAP_VARIABLE_MAX = 30;

export class ExecuteAbapHandlers {
  /**
   * @param executeAbap 执行型客户端（窄接口注入，风格对齐 UnitCoverageHandlers；
   *   集成时用 src/adt/ExecuteAbapApi.ts 的 createExecuteAbapClient(
   *   adtClient.httpClient) 构造——必须绑写域 stateful 主会话）
   */
  constructor(private readonly executeAbap: ExecuteAbapClient) {}

  /** 该工具名是否由本处理器负责。 */
  supports(toolName: string): boolean {
    return EXECUTE_ABAP_TOOL_NAMES.has(toolName);
  }

  /** 执行型工具的 MCP 定义（schema 含 additionalProperties:false 与枚举/长度边界）。 */
  getTools(): ExecuteAbapToolDefinition[] {
    return [
      {
        name: 'executeAbap',
        description:
          'Execute an ABAP snippet once and return its output. The code is wrapped into a temporary ABAP Unit test program (local $TMP package, no transport), run a single time, and values written to the return variable are captured via an assertion message; the temp program is deleted afterwards. Executing operation: creates/activates/deletes a self-owned temp program and runs user code (same class as runClass/unitTestRun); riskLevel declares what the code does (harmless = no DB writes, default). Failure kinds: syntaxError (did not compile), notRun (ABAP Unit reported no test at all), payload exceptions with line mapping back to the submitted code.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: {
              type: 'string',
              description: 'ABAP statements to execute inside the wrapper method body. Use statements only (no REPORT/CLASS definition); assign results to the return variable to have them captured.',
              minLength: 1,
              maxLength: EXECUTE_ABAP_CODE_MAX
            },
            riskLevel: {
              type: 'string',
              description: 'Declares what the code does and which ABAP Unit risk levels are enabled: harmless (default, no DB writes), dangerous (includes dangerous), critical (all levels).',
              enum: [...EXECUTE_ABAP_RISK_LEVELS],
              optional: true
            },
            returnVariable: {
              type: 'string',
              description: `Wrapper string variable the code assigns results to (default lv_result, max ${EXECUTE_ABAP_VARIABLE_MAX} chars, ABAP identifier rules). Its final value is returned as output.`,
              minLength: 1,
              maxLength: EXECUTE_ABAP_VARIABLE_MAX,
              optional: true
            },
            keepProgram: {
              type: 'boolean',
              description: 'Keep the temporary program instead of deleting it (debugging aid; default false). The program name is returned either way.',
              optional: true
            }
          },
          required: ['code']
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        _meta: { operationClass: 'mutating tenant', approvalRequired: false }
      }
    ];
  }

  /**
   * 按工具名分派到注入的执行型客户端。
   * 错误处理对齐 UnitCoverageHandlers：MCP 语义错误（参数校验等）原样透传；
   * 其余底层异常统一脱敏为 InternalError（"failed."），绝不外泄远端响应体、
   * 头或目标系统细节。执行结果本身是软失败形态（success=false + failure
   * 字段），不会被吞成 failed.。
   */
  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'executeAbap') {
        const { code, opts } = this.query(toolName, argumentsValue);
        return success(await this.executeAbap.executeAbap(code, opts));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown execute-abap tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      // 底层 ADT 响应可能包含目标系统细节；对外只报告工具级失败
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }

  /**
   * 参数校验与规范化（业务规则，全部在进入底层客户端之前拦截）：
   * - code 必填：非空字符串、<=100k 字符；
   * - riskLevel 可选：传入时必须是小写枚举值（与 VSP execute_abap 同口径，
   *   不做大小写纠错），缺省由 API 层展开 harmless 默认档；
   * - returnVariable 可选：传入时必须满足 ABAP 变量名规则（字母/下划线开头，
   *   <=30 位）——它被直接拼进 wrapper 模板，注入防线前置到 handler 层；
   * - keepProgram 可选布尔。
   */
  private query(toolName: string, argumentsValue: Record<string, unknown>): {
    code: string;
    opts: ExecuteAbapOptions;
  } {
    const code = typeof argumentsValue?.code === 'string' ? argumentsValue.code : '';
    if (!code.trim()) {
      throw invalid(`${toolName} requires code: a non-empty ABAP statement sequence.`);
    }
    if (code.length > EXECUTE_ABAP_CODE_MAX) {
      throw invalid(`${toolName} supports code of at most ${EXECUTE_ABAP_CODE_MAX} characters.`);
    }

    const riskLevel = argumentsValue?.riskLevel;
    if (riskLevel !== undefined && !EXECUTE_ABAP_RISK_LEVELS.includes(riskLevel as never)) {
      throw invalid(`${toolName} supports riskLevel harmless, dangerous or critical only.`);
    }

    const returnVariable = argumentsValue?.returnVariable;
    if (returnVariable !== undefined) {
      if (
        typeof returnVariable !== 'string'
        || returnVariable.length > EXECUTE_ABAP_VARIABLE_MAX
        || !isValidAbapVariableName(returnVariable)
      ) {
        throw invalid(
          `${toolName} requires returnVariable to be a valid ABAP variable name (letter or underscore first, at most ${EXECUTE_ABAP_VARIABLE_MAX} characters).`
        );
      }
    }

    const keepProgram = argumentsValue?.keepProgram;
    if (keepProgram !== undefined && typeof keepProgram !== 'boolean') {
      throw invalid(`${toolName} supports keepProgram as a boolean only.`);
    }

    return {
      code,
      opts: {
        ...(riskLevel !== undefined ? { riskLevel: riskLevel as ExecuteAbapOptions['riskLevel'] } : {}),
        ...(typeof returnVariable === 'string' ? { returnVariable } : {}),
        ...(keepProgram === true ? { keepProgram: true } : {})
      }
    };
  }
}

/** 参数校验失败的 MCP 语义错误。 */
function invalid(message: string): McpError {
  return new McpError(ErrorCode.InvalidParams, message);
}

/** 成功响应包装：content 文本与 structuredContent 同构（对齐 UnitCoverageHandlers）。 */
function success(result: unknown): Record<string, any> {
  const structuredContent = { status: 'success', result };
  return {
    content: [{ type: 'text', text: serializeJsonText(structuredContent) }],
    structuredContent
  };
}
