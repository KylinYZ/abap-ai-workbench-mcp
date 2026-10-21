/**
 * 受控传输请求释放的原生确认（TransportReleaseConfirmation）。
 *
 * 与 TransportCleanupConfirmation 完全同构：
 * - 仅支持 MCP form elicitation 原生确认；不支持调用方布尔确认，
 *   也不支持文本 fallback（避免确认语义被客户端转述弱化）。
 * - 确认对话框展示请求号、属主、状态、子任务/对象概况与"释放不可逆"
 *   语义（释放后对象锁定、无法继续修改），并重申两条红线（状态 D +
 *   本人属主）已由 preview 核验；只有 action=accept 且
 *   decision=release_transport 才会触发 apply。
 */
import {
  ErrorCode,
  McpError,
  type ElicitRequestFormParams,
  type ElicitResult
} from '../lib/McpErrorCompat.js';
import { ConfirmationRequiredError } from '../lib/MrtrElicitation.js';
import { SafeAbapError } from './errors.js';
import type { TransportReleasePlanView } from './transportReleaseTypes.js';

/** 确认前用于读取 plan 状态的最小端口。 */
export interface TransportReleaseStatusReader {
  status(transportReleasePlanId: string): TransportReleasePlanView;
}

export interface TransportReleaseConfirmationOptions {
  /** 客户端是否支持 form elicitation；不支持则直接拒绝而不是降级 */
  supportsFormElicitation: () => boolean;
  /** 发起原生确认对话框 */
  elicitInput: (params: ElicitRequestFormParams, timeoutMs: number) => Promise<ElicitResult>;
  /** 确认通过后的单次执行回调（由 executionGate 包裹的 workflow.apply）；confirmationMode 由确认层如实传入 */
  applyConfirmed: (
    transportReleasePlanId: string,
    confirmationMode?: 'elicitation' | 'auto-config'
  ) => Promise<Record<string, unknown>>;
  /**
   * 部署级自动确认开关（SAP_MCP_CONFIRMATION_MODE=auto 且 DEV 时由接线层注入）：
   * 返回 true 时跳过人工表单确认直接执行。工具调用方永远无法通过参数触发此路径。
   */
  autoApprove?: () => boolean;
  /** 可注入时钟，用于计算确认超时 */
  now?: () => number;
}

/** 确认对话框最长等待 15 分钟（与创建/清理链一致）。 */
const MAX_CONFIRMATION_TIMEOUT_MS = 15 * 60 * 1000;

export class TransportReleaseConfirmation {
  constructor(
    private readonly statusReader: TransportReleaseStatusReader,
    private readonly options: TransportReleaseConfirmationOptions
  ) {}

  /** 原生确认并单次执行释放 plan；拒绝时返回 confirmation_declined 而不执行。 */
  async confirmAndRun(transportReleasePlanId: string): Promise<Record<string, unknown>> {
    const plan = this.statusReader.status(transportReleasePlanId);
    assertConfirmable(plan);
    // 部署配置预授权：plan 状态校验通过后跳过人工表单确认（native 模式校验顺序不变）。
    // 必须先于 supportsFormElicitation 检查——auto 模式部署下客户端无需具备
    // elicitation 能力（与创建/清理确认链的短路顺序保持同构）。
    if (this.options.autoApprove?.()) {
      return this.options.applyConfirmed(transportReleasePlanId, 'auto-config');
    }
    if (!this.options.supportsFormElicitation()) {
      throw new SafeAbapError(
        'CONFIRMATION_UNSUPPORTED',
        'confirmation',
        'Transport release requires MCP form elicitation; text confirmation fallback is not supported.'
      );
    }
    const elicited = await this.elicit(
      confirmationForm(plan),
      confirmationTimeoutMs(plan, this.options.now?.() ?? Date.now())
    );
    if (elicited.action !== 'accept' || elicited.content?.decision !== 'release_transport') {
      return { status: 'confirmation_declined', transportReleasePlanId, confirmationMode: 'elicitation' };
    }
    return this.options.applyConfirmed(transportReleasePlanId, 'elicitation');
  }

  /** 封装 elicitation 调用：客户端超时视为取消，其他失败视为确认通道故障。 */
  private async elicit(params: ElicitRequestFormParams, timeoutMs: number): Promise<ElicitResult> {
    try {
      return await this.options.elicitInput(params, timeoutMs);
    } catch (error) {
      if (error instanceof ConfirmationRequiredError) throw error;
      if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) return { action: 'cancel' };
      throw new SafeAbapError('POLICY_DENIED', 'confirmation', 'The client confirmation dialog failed.');
    }
  }
}

/** 确认表单：展示请求号、概况与红线核验结果，说明释放不可逆。 */
function confirmationForm(plan: TransportReleasePlanView): ElicitRequestFormParams {
  return {
    mode: 'form',
    message: `Release transport request ${plan.target.transportNumber} · ${plan.systemHost}/${plan.client} `
      + `· owner ${plan.target.owner} · status ${plan.target.requestStatus} `
      + `· ${plan.target.taskCount} task(s) (${plan.target.unreleasedTaskCount} unreleased) `
      + `· ${plan.target.objectCount} object(s) `
      + '· Release is irreversible: objects become locked for changes and the request becomes visible to '
      + 'the transport domain. The server verified the request is modifiable and owned by you, runs the '
      + 'standard release once (no lock/ATC bypass) and never retries an unknown outcome.',
    requestedSchema: {
      type: 'object',
      properties: {
        decision: {
          type: 'string',
          title: '请选择操作',
          oneOf: [
            { const: 'release_transport', title: '释放一次此计划中的传输请求' },
            { const: 'cancel', title: '取消' }
          ]
        }
      },
      required: ['decision']
    }
  };
}

/** 确认超时不超过 plan 剩余 TTL；plan 已过期直接拒绝确认。 */
function confirmationTimeoutMs(plan: TransportReleasePlanView, now: number): number {
  const remaining = Date.parse(plan.expiresAt) - now;
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw new SafeAbapError('PLAN_EXPIRED', 'transport-release-plan', 'Transport release plan has expired.');
  }
  return Math.min(remaining, MAX_CONFIRMATION_TIMEOUT_MS);
}

/** 只有 PREVIEWED 状态的 plan 可以进入确认；其余状态给出确定性错误。 */
function assertConfirmable(plan: TransportReleasePlanView): void {
  if (plan.status === 'EXPIRED') {
    throw new SafeAbapError('PLAN_EXPIRED', 'transport-release-plan', 'Transport release plan has expired.');
  }
  if (plan.status !== 'PREVIEWED') {
    throw new SafeAbapError(
      'PLAN_ALREADY_CONSUMED',
      'transport-release-plan',
      `Transport release plan is already ${plan.status.toLowerCase()}.`
    );
  }
}
