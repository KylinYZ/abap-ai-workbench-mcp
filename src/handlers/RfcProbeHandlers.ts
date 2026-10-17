import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import { FmAllowlist, createDefaultFmAllowlist } from '../rfc/allowlist.js';
import { invokeFmCall } from '../rfc/call.js';
import { normalizeRfcConnectionParams, type RfcConnectionParams } from '../rfc/connection.js';
import { RfcError, RfcTransportError } from '../rfc/errors.js';
import { RfcConnectionPool } from '../rfc/pool.js';
import type { TransportAdapter } from '../rfc/transport.js';
import { readRfcTable } from '../rfc/read-table-adapter.js';
import { buildRfmDescription } from '../rfc/describe.js';
import { isValidFmName } from '../rfc/interface.js';
import { OpenRfcTransport, rfcParamsFromEnvironment } from '../rfc/open-rfc-transport.js';

/**
 * ============================================================================
 * RFC 直链只读工具处理器（rfc.remote-enabled.discovery/read-table/call/describe）
 * ============================================================================
 *
 * 四个只读工具，全部经 open-rfc（纯 TS classic RFC 客户端，与 VSP 的
 * open-rfc-go 同源同协议）直连 SAP 网关：
 *   - probeRfcSystem：RFC_PING + RFC_SYSTEM_INFO 连通与系统指纹；
 *   - readRfcTable：RFC_READ_TABLE 只读表读取（S/4 增强双路径，见 read-table-adapter）；
 *   - describeRfm：FM 接口元数据 → 参数清单 + 调用入参 JSON Schema
 *     （元数据通道 adapter.getFunctionInterface，不执行目标 FM）；
 *   - callRfm：调用只读 allowlist 内的任意 remote-enabled FM（载荷透传 +
 *     超时取消链；白名单外 RF_CALL_NOT_ALLOWED——「任意 FM 调用」的安全
 *     面收窄为「受控只读 RFM 调用」，业务自定义 RFM 经构造注入扩展）。
 *
 * 通道说明（真机实测 2026-09-18）：该 DEV 的 RFC 直链为 host 10.30.254.48 +
 * sysnr 01（网关 3301，.vsp.json rfc_sysnr 实测值）；HTTP 8001 端口的
 * SOAP-RFC 路线与直连无关。
 *
 * 安全链路（协议层全量生效）：
 *   allowlist 门控（白名单外 RF_CALL_NOT_ALLOWED）→ invokeFmCall 超时/取消
 *   → OpenRfcTransport（连接池复用，传输故障剔除，ABAP 异常不剔除）。
 *
 * 业务规则：
 *   - 只读工具（白名单均为无副作用系统 RFM；_meta.operationClass=
 *     'read-only tenant'）。
 *   - 探测失败不抛错（probeRfcSystem 的 discovery 语义）；callRfm/describeRfm
 *     的失败以含原因的 InternalError 透出（RfcError 消息为受控文本，无凭据）。
 *   - QAS/PRD 角色门控由既有策略层负责（read-only 类对三角色可见，但真实
 *     RFC 仅专用 DEV 授权 smoke）。
 */

/** 本处理器认领的工具名。 */
const RFC_PROBE_TOOL_NAMES = new Set(['probeRfcSystem', 'readRfcTable', 'describeRfm', 'callRfm']);

type RfcProbeToolDefinition = ToolDefinition & {
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

/** 只读白名单门控（RFC_PING/RFC_SYSTEM_INFO/RFC_READ_TABLE，协议层硬门）。 */
const allowlist = createDefaultFmAllowlist();

/** RFC 调用超时毫秒，30 秒与 VSP keep-alive 一致。 */
const RFC_CALL_TIMEOUT_MS = 30_000;

export class RfcProbeHandlers {
  /** 单连接退化适配器（未注入连接池时使用，懒建复用）。 */
  private standaloneAdapter?: TransportAdapter;

  /**
   * @param rfcConfig ADT 环境推导的 RFC 连接参数（host/client/user/password/
   *   language + 可选 sysnr 覆盖，缺省 '00'）
   * @param pool 可选的连接池（复用与 keep-alive）；未提供时退化为单连接适配器
   */
  constructor(
    private readonly rfcConfig: {
      readonly host: string
      readonly client: string
      readonly user: string
      readonly password?: string
      readonly language?: string
      readonly sysnr?: string
    },
    private readonly pool?: RfcConnectionPool
  ) {}

  /** 该工具名是否由本处理器负责。 */
  supports(toolName: string): boolean {
    return RFC_PROBE_TOOL_NAMES.has(toolName);
  }

  /** 取传输适配器：优先走连接池（acquire 按参数 key 复用），退化用单连接。 */
  private async adapter(): Promise<TransportAdapter> {
    if (this.standaloneAdapter) return this.standaloneAdapter;
    const params: RfcConnectionParams = normalizeRfcConnectionParams(
      rfcParamsFromEnvironment(this.rfcConfig)
    );
    if (this.pool) {
      const entry = await this.pool.acquire(params);
      return entry as unknown as TransportAdapter;
    }
    this.standaloneAdapter = new OpenRfcTransport(params);
    await this.standaloneAdapter.connect();
    return this.standaloneAdapter;
  }

  /** 单 FM 调用（allowlist 门控 + 超时取消，经白名单校验后才进传输层）。 */
  private async invokeWhitelisted(functionName: string): Promise<Record<string, unknown>> {
    if (!allowlist.isAllowed(functionName)) {
      throw new RfcError('RF_CALL_NOT_ALLOWED', `FM ${functionName} is not on the read-only allowlist.`);
    }
    const adapter = await this.adapter();
    const result = await invokeFmCall(adapter, { functionName, timeoutMs: RFC_CALL_TIMEOUT_MS });
    return {
      ...result.values,
      ...(Object.keys(result.tables).length > 0 ? { tables: result.tables } : {})
    } as Record<string, unknown>;
  }

  /**
   * 探测 RFC_SYSTEM_INFO 指纹（M1 版本能力协商链接线用）：返回值交由
   * detectBasisReleaseFromSystemInfo 提取 BASIS release。探测失败由调用方
   * 捕获处理（指纹不可得 = 不裁剪，绝不猜测——见 SapReleaseCapability 语义）。
   * 超时可调：指纹探测链路用 8 秒短超时（正常毫秒级；防火墙 drop 场景下
   * tools/list 首呼最坏多等 8 秒，低于常见客户端 30s 协议超时——历史坑位）。
   */
  async fetchSystemInfo(timeoutMs: number = RFC_CALL_TIMEOUT_MS): Promise<Record<string, unknown>> {
    if (!allowlist.isAllowed('RFC_SYSTEM_INFO')) {
      throw new RfcError('RF_CALL_NOT_ALLOWED', 'FM RFC_SYSTEM_INFO is not on the read-only allowlist.');
    }
    const adapter = await this.adapter();
    const result = await invokeFmCall(adapter, { functionName: 'RFC_SYSTEM_INFO', timeoutMs });
    return {
      ...result.values,
      ...(Object.keys(result.tables).length > 0 ? { tables: result.tables } : {})
    } as Record<string, unknown>;
  }

  /** 只读工具定义（探测/表读取/接口描述/受控调用四个入口）。 */
  getTools(): RfcProbeToolDefinition[] {
    const readOnly: Pick<RfcProbeToolDefinition, 'annotations' | '_meta'> = {
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      },
      _meta: { operationClass: 'read-only tenant', approvalRequired: false }
    };
    return [
      {
        name: 'probeRfcSystem',
        description:
          'Probe the classic-RFC face of the system over a direct RFC link (node:net to the gateway, no SDK): RFC_PING for reachability and RFC_SYSTEM_INFO for the system fingerprint (sysid/release/kernel/host/codepage). Gated to the read-only FM allowlist. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {}
        },
        ...readOnly
      },
      {
        name: 'readRfcTable',
        description:
          'Read rows from a DDIC table or view over the direct RFC link (RFC_READ_TABLE): WHERE clause kept verbatim (control characters and semicolons rejected), column projection, row-count limit. Adapts to the S/4-enhanced RFC_READ_TABLE (USE_ET_DATA_4_RETURN) automatically. Gated to the read-only FM allowlist. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            table: {
              type: 'string',
              description: 'Target DDIC table or view name, e.g. T001.',
              minLength: 1,
              maxLength: 30
            },
            whereClause: {
              type: 'string',
              description: "WHERE clause in Open SQL fragment form, e.g. \"BUKRS = '1000'\"; passed verbatim to the RFM.",
              optional: true
            },
            fields: {
              type: 'array',
              description: 'Column names to read; empty reads all columns.',
              items: { type: 'string' },
              optional: true
            },
            maxRows: {
              type: 'number',
              description: 'Maximum rows to return; default 100, cap 1000.',
              minimum: 1,
              maximum: 1000,
              optional: true
            }
          },
          required: ['table']
        },
        ...readOnly
      },
      {
        name: 'describeRfm',
        description:
          'Describe the interface of any remote-enabled function module over the direct RFC link: parameter list (direction/type/associated DDIC type/length/optionality) plus a lightweight input JSON Schema built from IMPORTING/CHANGING parameters for composing callRfm arguments. Metadata lookup only — the target FM is not executed. Table/structure row shapes are referenced by associatedType (resolve via DDIC metadata tools). Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            functionName: {
              type: 'string',
              description: 'Function module name, e.g. RFC_READ_TABLE; namespace form /NS/NAME supported.',
              minLength: 1,
              maxLength: 60
            }
          },
          required: ['functionName']
        },
        ...readOnly
      },
      {
        name: 'callRfm',
        description:
          'Call a function module over the direct RFC link. Gated to the read-only FM allowlist (probe/metadata/search/auth-simulation system RFMs; rejection carries the current allowlist). Arguments are passed through to the RFM as-is; use describeRfm first to compose them. Errors surface with reason (allowlist rejection, unknown parameter, ABAP exception, timeout). Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            functionName: {
              type: 'string',
              description: 'Function module name; must be on the read-only allowlist.',
              minLength: 1,
              maxLength: 60
            },
            args: {
              type: 'object',
              description: 'RFM arguments keyed by parameter name (top-level keys are case-normalized to uppercase); use describeRfm to discover names.',
              optional: true
            },
            timeoutSeconds: {
              type: 'number',
              description: 'Call timeout in seconds; default 30, cap 120.',
              minimum: 1,
              maximum: 120,
              optional: true
            }
          },
          required: ['functionName']
        },
        ...readOnly
      }
    ];
  }

  /**
   * 分派到注入的 RFC 客户端。探测失败不抛错（discovery 语义）；
   * 其余底层异常脱敏为 InternalError。
   */
  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'probeRfcSystem') {
        let ping: Record<string, unknown>;
        try {
          await this.invokeWhitelisted('RFC_PING');
          // RFC_PING 无输出参数：调用成功本身即连通证明
          ping = { pong: true, detail: 'RFC_PING succeeded over the direct RFC link' };
        } catch (error) {
          ping = { pong: false, detail: error instanceof Error ? error.message.slice(0, 200) : String(error) };
        }
        let systemInfo: Record<string, unknown>;
        try {
          systemInfo = await this.invokeWhitelisted('RFC_SYSTEM_INFO');
        } catch (error) {
          systemInfo = { status: 'error', detail: error instanceof Error ? error.message.slice(0, 200) : String(error) };
        }
        return success({ ping, systemInfo });
      }
      if (toolName === 'readRfcTable') {
        const table = typeof argumentsValue?.table === 'string' ? argumentsValue.table.trim().toUpperCase() : '';
        if (!table || table.length > 30 || !/^[A-Z0-9_/]+$/.test(table)) {
          throw invalid(
            `${toolName} requires table: a non-empty DDIC table name of at most 30 characters matching [A-Z0-9_/].`
          );
        }
        const whereClause = typeof argumentsValue?.whereClause === 'string' ? argumentsValue.whereClause.trim() : undefined;
        const fieldsRaw = Array.isArray(argumentsValue?.fields) ? argumentsValue.fields : undefined;
        const fields = fieldsRaw?.map(f => String(f ?? '').trim().toUpperCase()).filter(f => f !== '');
        const maxRows = typeof argumentsValue?.maxRows === 'number' && Number.isFinite(argumentsValue.maxRows)
          ? Math.min(Math.max(Math.floor(argumentsValue.maxRows), 1), 1000)
          : undefined;
        return success(await readRfcTable(
          await this.adapter(),
          {
            table,
            ...(whereClause ? { whereClause } : {}),
            ...(fields && fields.length > 0 ? { fields } : {}),
            ...(maxRows !== undefined ? { maxRows } : {})
          }
        ));
      }
      if (toolName === 'describeRfm') {
        const functionName = typeof argumentsValue?.functionName === 'string'
          ? argumentsValue.functionName.trim().toUpperCase()
          : '';
        if (!isValidFmName(functionName)) {
          throw invalid(
            `${toolName} requires functionName: a valid FM name (A-Z 0-9 _ /, namespace form /NS/NAME, at most 60 characters).`
          );
        }
        const adapter = await this.adapter();
        if (typeof adapter.getFunctionInterface !== 'function') {
          throw new McpError(
            ErrorCode.InternalError,
            `${toolName} failed: the active transport has no FM metadata channel.`
          );
        }
        const iface = await adapter.getFunctionInterface(functionName);
        return success(buildRfmDescription(functionName, iface, allowlist.isAllowed(functionName)));
      }
      if (toolName === 'callRfm') {
        const functionName = typeof argumentsValue?.functionName === 'string'
          ? argumentsValue.functionName.trim().toUpperCase()
          : '';
        if (!isValidFmName(functionName)) {
          throw invalid(
            `${toolName} requires functionName: a valid FM name (A-Z 0-9 _ /, namespace form /NS/NAME, at most 60 characters).`
          );
        }
        // 载荷透传 + 顶层参数键大小写归一（SAP 参数名约定大写；嵌套键为
        // 结构/表行字段，不属于 FM 参数名，不动）
        const rawArgs = argumentsValue?.args;
        if (rawArgs !== undefined && (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs))) {
          throw invalid(`${toolName}: args must be a plain object keyed by parameter names.`);
        }
        const payload = rawArgs === undefined
          ? undefined
          : Object.fromEntries(Object.entries(rawArgs).map(([key, value]) => [key.toUpperCase(), value]));
        const timeoutSeconds = typeof argumentsValue?.timeoutSeconds === 'number' && Number.isFinite(argumentsValue.timeoutSeconds)
          ? Math.min(Math.max(Math.floor(argumentsValue.timeoutSeconds), 1), 120)
          : undefined;
        // allowlist 硬门：白名单外 RF_CALL_NOT_ALLOWED（message 携带当前白名单）
        allowlist.assertAllowed(functionName);
        const adapter = await this.adapter();
        const result = await invokeFmCall(adapter, {
          functionName,
          ...(payload !== undefined ? { payload } : {}),
          ...(timeoutSeconds !== undefined ? { timeoutMs: timeoutSeconds * 1000 } : {})
        });
        return success({
          functionName: result.functionName,
          values: result.values,
          ...(Object.keys(result.tables).length > 0 ? { tables: result.tables } : {}),
          ...(result.exceptions.length > 0 ? { exceptions: result.exceptions } : {}),
          durationMs: result.durationMs
        });
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown RFC probe tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      // RfcError/RfcTransportError 的消息为受控文本（无凭据）：allowlist 拒绝
      // 需要透出当前白名单，unknown parameter / ABAP 异常 / 传输故障需要可诊断，
      // 因此 RFC 域的错误带原因透出；其余未知错误保持脱敏。
      if (error instanceof RfcError || error instanceof RfcTransportError) {
        throw new McpError(ErrorCode.InternalError, `${toolName} failed: ${error.message}`);
      }
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }
}

/** 成功响应包装：content 文本与 structuredContent 同构。 */
function success(result: unknown): Record<string, any> {
  const structuredContent = { status: 'success', result };
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent
  };
}

/** 参数校验失败的 MCP 语义错误。 */
function invalid(message: string): McpError {
  return new McpError(ErrorCode.InvalidParams, message);
}
