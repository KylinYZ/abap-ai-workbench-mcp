/**
 * 受控传输请求释放 plan 存储（TransportReleasePlanStore）。
 *
 * 设计完全对齐 TransportCleanupPlanStore：
 * - plan 是 server 生成并冻结的不可变意图记录：preview 时一次性写入目标请求
 *   快照（属主/状态/子任务/对象数）与执行载荷，apply 只能按 planId 消费一次。
 * - TTL：PREVIEWED 状态的 plan 超时后自动置 EXPIRED；终态 plan 在容量压力下
 *   按时间先后驱逐。
 * - 上下文绑定：apply/status 必须携带与 preview 一致的 SAP 上下文
 *   （host/client/user/role/profile），跨上下文重放 plan 直接 POLICY_DENIED。
 * - 终态（含 UNKNOWN_OUTCOME）立即清除执行载荷，只保留有界摘要与错误。
 */
import { createHash, randomBytes } from 'crypto';
import { SafeAbapError } from './errors.js';
import type {
  CreateTransportReleasePlanInput,
  TransportReleaseContext,
  TransportReleaseError,
  TransportReleasePlan,
  TransportReleasePlanView,
  TransportReleaseResultSummary,
  TransportReleaseStage,
  TransportReleaseStatus
} from './transportReleaseTypes.js';

export class TransportReleasePlanStore {
  /** 全部释放 plan，按 planId 索引。 */
  private readonly plans = new Map<string, TransportReleasePlan>();

  constructor(
    /** plan 存活时长（毫秒），由 SafetyPolicy.planTtlMs 统一配置 */
    private readonly ttlMs: number,
    /** 可注入时钟，测试用固定时间获得确定性 */
    private readonly now: () => number = () => Date.now(),
    /** 可注入 planId 生成器，测试用固定 id 获得确定性 */
    private readonly createId: () => string = () => randomBytes(16).toString('hex'),
    /** plan 容量上限，超出时优先驱逐终态 plan，仍满则拒绝创建 */
    private readonly maxEntries: number = 100
  ) {}

  /**
   * 创建新的释放 plan（PREVIEWED 状态）。
   * payload 会被深拷贝冻结；payloadHash 是对载荷的 SHA-256 指纹，
   * 用于审计比对 plan 内容，不泄露载荷本身。
   */
  create(input: CreateTransportReleasePlanInput): TransportReleasePlan {
    this.cleanupExpired();
    this.evictTerminalPlans();
    if (this.plans.size >= this.maxEntries) {
      throw new SafeAbapError('PLAN_CAPACITY_FULL', 'transport-release-plan', 'Transport release plan capacity is full.');
    }
    const createdAt = this.now();
    // 冻结执行载荷：释放目标一经写入不可变更
    const payload = structuredClone(input.payload);
    const plan: TransportReleasePlan = {
      transportReleasePlanId: this.createId(),
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      status: 'PREVIEWED',
      context: normalizeContext(input.context),
      target: { ...input.target },
      payloadHash: fingerprint(payload),
      payload,
      stages: []
    };
    this.plans.set(plan.transportReleasePlanId, plan);
    return plan;
  }

  /** 按 id 取 plan；不存在则 PLAN_NOT_FOUND。查询前先做过期清理。 */
  get(transportReleasePlanId: string): TransportReleasePlan {
    this.cleanupExpired();
    const plan = this.plans.get(transportReleasePlanId);
    if (!plan) {
      throw new SafeAbapError('PLAN_NOT_FOUND', 'transport-release-plan', 'Transport release plan was not found.');
    }
    return plan;
  }

  /** 取 plan 并校验当前 SAP 上下文与 preview 一致，防止跨系统/跨客户端重放。 */
  getForContext(transportReleasePlanId: string, context: TransportReleaseContext): TransportReleasePlan {
    const plan = this.get(transportReleasePlanId);
    if (!sameContext(plan.context, normalizeContext(context))) {
      throw new SafeAbapError(
        'POLICY_DENIED',
        'transport-release-plan',
        'Transport release plan does not match the current SAP context.'
      );
    }
    return plan;
  }

  /**
   * 进入执行态（RUNNING）。仅 PREVIEWED 状态可进入：
   * - EXPIRED 明确报 PLAN_EXPIRED；
   * - 其他非 PREVIEWED 状态报 PLAN_ALREADY_CONSUMED（含重复 apply）。
   */
  beginRun(
    transportReleasePlanId: string,
    context: TransportReleaseContext,
    /** 确认方式由确认层如实传入：native 确认为 elicitation（默认），部署级 auto 确认为 auto-config */
    confirmationMode: 'elicitation' | 'auto-config' = 'elicitation'
  ): TransportReleasePlan {
    const plan = this.getForContext(transportReleasePlanId, context);
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
    plan.status = 'RUNNING';
    plan.confirmationMode = confirmationMode;
    return plan;
  }

  /** 更新 plan 状态；进入终态时记录 terminalAt 并立即清除执行载荷。 */
  setStatus(transportReleasePlanId: string, status: TransportReleaseStatus): TransportReleasePlan {
    const plan = this.get(transportReleasePlanId);
    plan.status = status;
    if (isTerminal(status)) {
      plan.terminalAt = this.now();
      plan.payload = undefined;
    }
    return plan;
  }

  /** 追加阶段轨迹（时间戳由 store 统一生成）。 */
  recordStage(transportReleasePlanId: string, stage: Omit<TransportReleaseStage, 'timestamp'>): void {
    const plan = this.get(transportReleasePlanId);
    plan.stages.push({ ...stage, timestamp: new Date(this.now()).toISOString() });
  }

  /** 写入结果摘要或错误（互相排斥；深拷贝避免外部引用篡改）。 */
  recordResult(
    transportReleasePlanId: string,
    result?: TransportReleaseResultSummary,
    error?: TransportReleaseError
  ): void {
    const plan = this.get(transportReleasePlanId);
    plan.result = result ? structuredClone(result) : undefined;
    plan.primaryError = error ? { ...error } : undefined;
  }

  /** 对外只读视图：时间转 ISO 字符串；绝不包含执行载荷。 */
  view(transportReleasePlanId: string, context?: TransportReleaseContext): TransportReleasePlanView {
    const plan = context ? this.getForContext(transportReleasePlanId, context) : this.get(transportReleasePlanId);
    return {
      transportReleasePlanId: plan.transportReleasePlanId,
      createdAt: new Date(plan.createdAt).toISOString(),
      expiresAt: new Date(plan.expiresAt).toISOString(),
      ...(plan.terminalAt !== undefined ? { terminalAt: new Date(plan.terminalAt).toISOString() } : {}),
      status: plan.status,
      systemHost: plan.context.systemHost,
      client: plan.context.client,
      sapUser: plan.context.sapUser,
      systemRole: plan.context.systemRole,
      toolProfile: plan.context.toolProfile,
      target: { ...plan.target },
      payloadHash: plan.payloadHash,
      stages: plan.stages.map(stage => ({ ...stage })),
      confirmationMode: plan.confirmationMode,
      result: plan.result ? structuredClone(plan.result) : undefined,
      primaryError: plan.primaryError ? { ...plan.primaryError } : undefined
    };
  }

  /** 把已到 TTL 的 PREVIEWED plan 置为 EXPIRED（惰性清理，查询时触发）。 */
  private cleanupExpired(): void {
    const timestamp = this.now();
    for (const plan of this.plans.values()) {
      if (plan.status === 'PREVIEWED' && timestamp >= plan.expiresAt) {
        plan.status = 'EXPIRED';
        plan.terminalAt = timestamp;
        plan.payload = undefined;
      }
    }
  }

  /** 容量压力下按终态时间从早到晚驱逐终态 plan；无终态 plan 可驱逐时保留现状。 */
  private evictTerminalPlans(): void {
    while (this.plans.size >= this.maxEntries) {
      const removable = [...this.plans.values()]
        .filter(plan => isTerminal(plan.status))
        .sort((left, right) => (left.terminalAt || left.createdAt) - (right.terminalAt || right.createdAt))[0];
      if (!removable) return;
      this.plans.delete(removable.transportReleasePlanId);
    }
  }
}

/** 上下文规范化：host 小写、user/role 大写，保证比对的一致性。 */
function normalizeContext(context: TransportReleaseContext): TransportReleaseContext {
  return {
    systemHost: String(context.systemHost || '').trim().toLowerCase(),
    client: String(context.client || '').trim(),
    sapUser: String(context.sapUser || '').trim().toUpperCase(),
    systemRole: String(context.systemRole || '').trim().toUpperCase(),
    toolProfile: context.toolProfile
  };
}

/** 逐字段比较两个上下文是否完全一致。 */
function sameContext(left: TransportReleaseContext, right: TransportReleaseContext): boolean {
  return left.systemHost === right.systemHost
    && left.client === right.client
    && left.sapUser === right.sapUser
    && left.systemRole === right.systemRole
    && left.toolProfile === right.toolProfile;
}

/** 对执行载荷计算 SHA-256 指纹。 */
function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

/** 终态判定：只有 PREVIEWED 与 RUNNING 是非终态。 */
function isTerminal(status: TransportReleaseStatus): boolean {
  return status !== 'PREVIEWED' && status !== 'RUNNING';
}
