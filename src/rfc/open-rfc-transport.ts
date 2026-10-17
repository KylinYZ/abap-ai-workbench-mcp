import { Client, languageIsoToSap, type RfcClientOptions } from '@kylinyz/open-rfc';

import { FmCallResult } from './call';
import { RfcError, RfcTransportError } from './errors';
import { normalizeRfcConnectionParams, RfcConnectionParams } from './connection';
import { AdapterFunctionInterface, TransportAdapter, RfcTransportInvokeRequest } from './transport';

/**
 * open-rfc 真实传输适配器（rfc-transport-spike 阶段 1）。
 *
 * 用途：把 npm `open-rfc`（SDK-free TypeScript classic RFC 客户端，与 VSP 的
 * open-rfc-go 同源同协议）适配为 `TransportAdapter`，替换阶段 0 的
 * LoopbackTransport，使 `src/rfc` 的接口校验/白名单/连接池上层全部生效于
 * 真实网络。
 *
 * 连接参数来源：由既有 ADT 系统配置推导（SAP_URL 主机 + SAP_CLIENT +
 * SAP_USER/SAP_PASSWORD + RFC_SYSNR 实例号，缺省 '00'——多数 SAP 系统
 * 主实例号为 00，个别环境经 RFC_SYSNR 显式覆盖；经典 RFC 网关端口 = 3300+sysnr）。
 *
 * 错误映射规则：
 * - open-rfc 的网络/登录/系统故障 → `RFC_TRANSPORT_FAILURE`（连接池据此剔除）；
 * - FM 侧 RAISE 的 ABAP 异常（ABAPError）→ `RFC_ABAP_EXCEPTION`（非传输故障，
 *   连接不剔除——FM 报错不代表连接坏了）。
 */

/** 错误码扩展：ABAP 异常与传输故障分离（连接池剔除只认传输故障）。 */
type OpenRfcTransportErrorCode = 'RFC_TRANSPORT_FAILURE' | 'RFC_TRANSPORT_CLOSED' | 'RFC_ABAP_EXCEPTION';

/**
 * open-rfc 递归序列化器发送策略类型（RfcClientOptions.recursiveSerializerPolicy）。
 * 该命名类型未从 open-rfc 包根导出，从 options 属性反取以保证与库版本同步。
 */
type LiveRecursiveSerializerPolicy = NonNullable<RfcClientOptions['recursiveSerializerPolicy']>;

/**
 * 经典 xRFC 序列化器观测（部署级断言，专用 DEV RFC 直链适用）。
 *
 * open-rfc 对含 TABLES/深层参数的调用（如 RFC_READ_TABLE）在发送前要求显式
 * 声明"对端序列化器观测"，否则报 live-decision-required 拒发。本观测是部署级
 * 断言而非动态探测，依据：经典 RFC 直链（CPIC）未经 basXML 使能配置时，
 * RFC 层按经典 xRFC 行式扁平序列化；RFC_READ_TABLE 参数均为扁平 TABLES，
 * 目标 DEV 直链无 basXML 协商。defaultSerializer 与 basxmlDisabledSerializer
 * 均为 classic-xrfc（后者不可为 unsupported——open-rfc 视为自相矛盾观测）。
 * 边界：仅限可信内网专用 DEV（与 classic RFC 明文传输边界一致）；若未来接入
 * 使能 basXML 的目标，须经 options.recursiveSerializerPolicy 覆盖并重新评审。
 */
const CLASSIC_XRFC_SERIALIZER_OBSERVATION = {
  defaultSerializer: 'classic-xrfc',
  basxmlDisabledSerializer: 'classic-xrfc'
} as const;

/**
 * 缺省递归序列化器发送策略：abap-7.58 兼容档 + classic-xRFC 观测。
 * open-rfc 决策门（assertRecursiveSerializerSendDecision）要求
 * status=live / selectedSerializer=classic-xrfc / sendAllowed=true /
 * basxmlNegotiation=disabled；该观测组合经 classifyRecursiveSerializer
 * 恰好产出此判定。profile 仅作声明（S/4HANA 平台 7.5x），不参与线上行为。
 */
const CLASSIC_XRFC_SERIALIZER_POLICY: LiveRecursiveSerializerPolicy = {
  profile: 'abap-7.58',
  observation: CLASSIC_XRFC_SERIALIZER_OBSERVATION
} as const;

/** 判定 open-rfc 抛出的错误是否为其 ABAP 异常形态（FM 侧 RAISE）。 */
function isAbapFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'abapMsgClass' in (error as Record<string, unknown>)
  );
}

/** 从 open-rfc 错误中摘取可展示消息（不携带凭据）。 */
function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length > 300 ? `${raw.slice(0, 300)}...` : raw;
}

export class OpenRfcTransport implements TransportAdapter {
  private readonly client: Client;
  private readonly timeoutSeconds: number;
  private lastActivityAt: number | null = null;
  private opened = false;

  constructor(
    params: RfcConnectionParams,
    options: {
      readonly timeoutSeconds?: number
      /** 覆盖缺省 classic-xRFC 序列化器策略（仅接入使能 basXML 的目标时使用）。 */
      readonly recursiveSerializerPolicy?: LiveRecursiveSerializerPolicy
    } = {}
  ) {
    // 连接参数由 normalizeRfcConnectionParams 严格校验/归一化后再喂给 open-rfc
    const normalized = normalizeRfcConnectionParams(params);
    this.timeoutSeconds = options.timeoutSeconds ?? 30;
    // recursiveSerializerPolicy 缺省注入 classic-xRFC 观测：open-rfc 对含
    // TABLES 参数的调用（RFC_READ_TABLE）无策略直接拒发（live-decision-required）
    const clientOptions: RfcClientOptions = {
      ...(options.timeoutSeconds !== undefined ? { timeout: options.timeoutSeconds } : {}),
      recursiveSerializerPolicy:
        options.recursiveSerializerPolicy ?? CLASSIC_XRFC_SERIALIZER_POLICY
    };
    this.client = new Client(
      {
        ashost: normalized.ashost,
        sysnr: normalized.sysnr,
        client: normalized.client,
        user: normalized.user,
        passwd: normalized.password,
        // RFC 会话语言固定 E：仅影响 RFM 返回的消息文本语言。中文简体内部码
        // 为数字 1，会被 open-rfc 的单字母校验拒绝（库限制），且语言会话与
        // 工作语言解耦是 RFC 生态通用做法
        lang: 'E'
      },
      clientOptions
    );
  }

  /** 建立经典 RFC 连接（open-rfc Client.open）。 */
  async connect(): Promise<void> {
    if (this.opened) return;
    await this.client.open();
    this.opened = true;
    this.lastActivityAt = Date.now();
  }

  /**
   * 执行一次 FM 调用。
   * 输出归类：open-rfc 返回对象中数组值归入 tables，其余归入 values
   * （与 FmCallResult 的 values/tables 语义一致）。
   */
  async invoke(request: RfcTransportInvokeRequest): Promise<FmCallResult> {
    if (!this.opened) {
      throw new RfcTransportError('invoke before connect (open-rfc transport)', undefined, 'RFC_TRANSPORT_CLOSED');
    }
    const started = Date.now();
    let result: Record<string, unknown>;
    try {
      result = (await this.client.call(
        request.functionName,
        (request.payload ?? {}) as Record<string, unknown>,
        { timeout: this.timeoutSeconds }
      )) as Record<string, unknown>;
      this.lastActivityAt = Date.now();
    } catch (error) {
      this.lastActivityAt = Date.now();
      if (isAbapFailure(error)) {
        // FM 侧 RAISE：不是传输故障——连接保留，异常名进 exceptions 通道
        const abap = error as { abapMsgClass?: unknown };
        throw new RfcError(
          'RFC_ABAP_EXCEPTION',
          `FM ${request.functionName} raised an ABAP exception: ${errorMessage(error)}`,
          { abapMsgClass: String(abap.abapMsgClass ?? '') }
        );
      }
      throw new RfcTransportError(
        `FM ${request.functionName} transport failure: ${errorMessage(error)}`
      );
    }

    const values: Record<string, unknown> = {};
    const tables: Record<string, readonly unknown[]> = {};
    for (const [key, value] of Object.entries(result ?? {})) {
      if (Array.isArray(value)) {
        tables[key] = value as readonly unknown[];
      } else {
        values[key] = value;
      }
    }
    return {
      functionName: request.functionName,
      values,
      tables,
      exceptions: [],
      durationMs: Date.now() - started
    };
  }

  /**
   * 查询 FM 接口元数据（open-rfc Client.getFunctionInterface → 结构化最小
   * 视图，只保留参数名/方向类）。用途：上层按系统能力适配载荷（如 S/4 的
   * RFC_READ_TABLE 增强 USE_ET_DATA_4_RETURN 在旧系统不存在，发前必须探测）。
   * 元数据查询走同一连接的网络往返，故障按传输级错误抛出（连接池据此剔除）。
   */
  async getFunctionInterface(functionName: string): Promise<AdapterFunctionInterface> {
    if (!this.opened) {
      throw new RfcTransportError('getFunctionInterface before connect (open-rfc transport)', undefined, 'RFC_TRANSPORT_CLOSED');
    }
    let iface: {
      parameters?: ReadonlyArray<{
        parameterName?: unknown
        parameterClass?: unknown
        exid?: unknown
        tableName?: unknown
        internalLength?: unknown
        optional?: unknown
      }>
    };
    try {
      iface = (await this.client.getFunctionInterface(functionName)) as typeof iface;
    } catch (error) {
      throw new RfcTransportError(
        `FM ${functionName} interface lookup failure: ${errorMessage(error)}`
      );
    }
    return {
      parameters: (iface.parameters ?? []).map(parameter => ({
        parameterName: String(parameter.parameterName ?? ''),
        parameterClass: String(parameter.parameterClass ?? ''),
        // 类型细节字段可选透传（describeRfm 的输出素材；探测路径只用名字/方向）
        parameterExid: parameter.exid === undefined || parameter.exid === null ? undefined : String(parameter.exid),
        associatedType: parameter.tableName === undefined || parameter.tableName === null ? undefined : String(parameter.tableName),
        internalLength: typeof parameter.internalLength === 'number' ? parameter.internalLength : undefined,
        optional: typeof parameter.optional === 'boolean' ? parameter.optional : undefined
      }))
    };
  }

  /** 关闭经典 RFC 连接。 */
  async close(): Promise<void> {
    if (!this.opened) return;
    await this.client.close();
    this.opened = false;
  }

  /** 最近一次成功活动（open 或 call）的 epoch 毫秒。 */
  lastActivity(): number | null {
    return this.lastActivityAt;
  }
}

/** 连接参数推导：由既有 ADT 环境变量组装 RFC 目标（不引入第二套凭据）。 */
export interface AdtDerivedRfcConfig {
  readonly host: string
  readonly client: string
  readonly user: string
  readonly password?: string
  readonly language?: string
  /** RFC 实例号；缺省 '00'（多数系统主实例号为 00，例外环境显式覆盖）。 */
  readonly sysnr?: string
}

/** 从 ADT 环境推导 RFC 连接参数（SAP_URL 主机 + 既有凭据 + RFC_SYSNR 覆盖）。 */
export function rfcParamsFromEnvironment(config: AdtDerivedRfcConfig): RfcConnectionParams {
  return normalizeRfcConnectionParams({
    ashost: config.host,
    client: config.client,
    user: config.user,
    password: config.password,
    language: config.language ?? 'EN',
    sysnr: config.sysnr ?? '00'
  });
}
