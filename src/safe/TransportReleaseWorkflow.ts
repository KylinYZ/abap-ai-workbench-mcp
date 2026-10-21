/**
 * 受控传输请求释放工作流（TransportReleaseWorkflow）。
 *
 * 任务背景（所有者 2026-10-21 边界调整）：释放允许受控执行——变更经人工
 * 审批后，AI 可经受控链释放本人属主的未释放 DEV 请求。红线与语义：
 *   1. 状态 D：请求必须处于可修改（未释放）状态，已释放/锁定请求拒绝；
 *   2. 本人属主：请求属主必须等于当前 SAP 用户（数字型用户名剥前导零比较）；
 *   3. 仅标准释放：只走 ADT `newreleasejobs` 标准动作，ignoreLocks /
 *      IgnoreATC 强制变体不进入受控面——锁与 ATC 发现由释放作业按系统
 *      标准检查，检查不过就是释放不生效，绝不绕行；
 *   4. 子任务状态仅透出：未释放子任务数（unreleasedTaskCount）写进 plan
 *      供确认人查看，不做 preview 拒绝——释放作业按 SAP 标准级联处理，
 *      结果以释放报告与读回为准。
 *
 * 安全模型（与受控清理链一致）：
 * 1. preview：只读 transportDetails 核验红线 → server 冻结 immutable plan
 *    （请求号、属主、状态、任务/对象数、payloadHash、TTL）。不接受除请求号
 *    外的任何输入。
 * 2. apply：仅接受 server 生成的 planId；form elicitation 原生确认后单次
 *    执行 transportRelease（POST /cts/transportrequests/<number>/newreleasejobs）。
 * 3. 生效验证：释放是后台作业——apply 成功后轮询只读 transportDetails
 *    （有限次数 × 间隔），status 变为 R（已释放）才 SUCCEEDED。
 * 4. 结果未知即停止：释放调用异常（超时/中断，作业是否已启动未知）、
 *    释放报告 abortrelapifail（检查拒绝未达成）或轮询耗尽仍非 R，一律置
 *    UNKNOWN_OUTCOME 终结——绝不自动重试写操作，人工只读复核后再决定。
 */
import type { TransportReleaseReport, TransportRequest } from '../adt/index.js';
import type { AuditEvent } from './AuditLogger.js';
import { SafeAbapError } from './errors.js';
import { TransportReleasePlanStore } from './TransportReleasePlanStore.js';
import { SafetyPolicy } from './SafetyPolicy.js';
import type {
  PreviewTransportReleaseInput,
  TransportReleasePlan,
  TransportReleasePlanView,
  TransportReleasePreviewResult,
  TransportReleaseReportSummary,
  TransportReleaseResultSummary,
  TransportReleaseTarget
} from './transportReleaseTypes.js';

/** 读回轮询参数：释放作业受理后状态传播通常在数秒内完成，超限即保守终结。 */
const READBACK_POLL_ATTEMPTS = 5;   // 轮询次数上限（含首查）
const READBACK_POLL_INTERVAL_MS = 2_000; // 每次轮询间隔
const REPORT_TEXT_LIMIT = 200;      // 释放报告文本字段截断长度
const REPORT_MESSAGE_LIMIT = 10;    // 释放报告消息条数上限

/** 工作流依赖的 ADT 客户端端口（结构子集，便于测试 mock）。 */
interface TransportReleaseClient {
  /** 只读：按请求号读回请求详情（属主/状态/子任务/对象） */
  transportDetails(transportNumber: string): Promise<TransportRequest>;
  /** 写入：标准释放（ADT POST /cts/transportrequests/<number>/newreleasejobs） */
  transportRelease(transportNumber: string): Promise<TransportReleaseReport[]>;
}

/** 审计日志端口（与既有 workflow 的 auditLogger.append 用法一致）。 */
interface TransportReleaseAuditSink {
  append(event: AuditEvent): Promise<void>;
}

export class TransportReleaseWorkflow {
  constructor(
    private readonly client: TransportReleaseClient,
    private readonly policy: SafetyPolicy,
    private readonly plans: TransportReleasePlanStore,
    private readonly audit: TransportReleaseAuditSink,
    /** 可注入等待函数，测试用立即 resolve 获得确定性；生产为真实 sleep */
    private readonly sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))
  ) {}

  /**
   * preview：只读核验两条红线并生成释放 plan。
   * - input 仅允许 transportNumber 一个字段；
   * - 请求不存在/非本人属主/非 D 状态：分别给出确定性拒绝，不建 plan；
   * - 全程零写副作用。
   */
  async preview(
    input: PreviewTransportReleaseInput
  ): Promise<TransportReleasePreviewResult> {
    assertAllowedKeys(input, ['transportNumber'], 'transport release preview');
    const transportNumber = parseTransportNumber(input?.transportNumber);

    // 红线核验：全部依据只读 transportDetails 读回值，不接受调用方断言
    let details: TransportRequest;
    try {
      details = await this.client.transportDetails(transportNumber);
    } catch {
      throw new SafeAbapError(
        'VALIDATION_FAILED',
        'PREVIEW',
        `Transport ${transportNumber} was not found (read-back failed); nothing to release.`
      );
    }
    const owner = String(details?.['tm:owner'] || '').trim();
    const requestStatus = String(details?.['tm:status'] || '').trim().toUpperCase();
    const tasks = Array.isArray(details?.tasks) ? details.tasks : [];
    // 对象总数 = 请求本体 + 各子任务的对象（仅透出，不设零对象红线）
    const objectCount
      = (Array.isArray(details?.objects) ? details.objects.length : 0)
      + tasks.reduce((sum, task) => sum + (Array.isArray(task?.objects) ? task.objects.length : 0), 0);
    if (stripZeros(owner) !== stripZeros(this.policy.sapUser)) {
      throw new SafeAbapError(
        'VALIDATION_FAILED',
        'PREVIEW',
        `Transport ${transportNumber} is owned by '${owner}', not the current user; releasing other users' requests is not permitted.`
      );
    }
    if (requestStatus !== 'D') {
      throw new SafeAbapError(
        'VALIDATION_FAILED',
        'PREVIEW',
        `Transport ${transportNumber} has status '${requestStatus}' (only modifiable 'D' requests can be released); already released or locked requests are out of scope.`
      );
    }

    const target: TransportReleaseTarget = {
      transportNumber,
      owner,
      requestStatus,
      taskCount: tasks.length,
      objectCount,
      // 子任务未释放数仅透出：确认人可据此预判释放作业的结果，拦截交给释放检查
      unreleasedTaskCount: tasks.filter(task => String(task?.['tm:status'] || '').trim().toUpperCase() !== 'R').length
    };
    const plan = this.plans.create({
      context: releaseContext(this.policy),
      target,
      payload: { transportNumber }
    });
    try {
      this.plans.recordStage(plan.transportReleasePlanId, { stage: 'PREVIEW', success: true });
      await this.audit.append(releaseAuditEvent(plan, this.policy, 'TRANSPORT_RELEASE_PREVIEW_CREATED', true));
    } catch (error) {
      // 审计失败视为 preview 失败：plan 置 FAILED，绝不让无审计的释放意图存活
      this.plans.recordResult(plan.transportReleasePlanId, undefined, {
        code: 'AUDIT_FAILED', stage: 'PREVIEW', message: 'Transport release preview audit failed.'
      });
      this.plans.setStatus(plan.transportReleasePlanId, 'FAILED');
      throw error;
    }
    return { status: 'preview', plan: this.status(plan.transportReleasePlanId), confirmationRequired: true };
  }

  /** 本地查询 plan 状态（带上下文校验，跨上下文访问报 POLICY_DENIED）。 */
  status(transportReleasePlanId: string): TransportReleasePlanView {
    return this.plans.view(transportReleasePlanId, releaseContext(this.policy));
  }

  /**
   * apply：按已确认的 plan 执行一次标准释放。
   * 只接受 server 生成 plan 的 id；重复 apply、未知 plan、过期 plan、
   * 跨上下文 plan 一律拒绝。释放异常、报告拒绝或读回耗尽置 UNKNOWN_OUTCOME。
   */
  async apply(
    transportReleasePlanId: string,
    /** 确认层如实传入的确认方式：native elicitation / 部署级 auto-config；缺省 elicitation 保持旧行为 */
    confirmationMode: 'elicitation' | 'auto-config' = 'elicitation'
  ): Promise<Record<string, unknown>> {
    const context = releaseContext(this.policy);
    const previewed = this.plans.getForContext(transportReleasePlanId, context);
    // 过期 plan 单独报 PLAN_EXPIRED：与"已被消费"区分，提示调用方必须重新 preview
    if (previewed.status === 'EXPIRED') {
      throw new SafeAbapError('PLAN_EXPIRED', 'transport-release-plan', 'Transport release plan has expired.');
    }
    if (previewed.status !== 'PREVIEWED') {
      throw new SafeAbapError(
        'PLAN_ALREADY_CONSUMED',
        'transport-release-plan',
        `Transport release plan is already ${previewed.status.toLowerCase()}.`
      );
    }
    const payload = previewed.payload;
    if (!payload) {
      throw new SafeAbapError('PLAN_NOT_EXECUTABLE', 'transport-release-plan', 'Transport release plan payload is unavailable.');
    }

    // 进入 RUNNING：同一 plan 从此不可再次 apply；确认方式由确认层如实传入
    const plan = this.plans.beginRun(transportReleasePlanId, context, confirmationMode);
    try {
      await this.audit.append(releaseAuditEvent(plan, this.policy, 'TRANSPORT_RELEASE_CONFIRMED', true));
    } catch (error) {
      // 远端尚未被调用，本地审计失败可以安全地置 FAILED
      this.plans.recordResult(transportReleasePlanId, undefined, {
        code: 'AUDIT_FAILED', stage: 'CONFIRM', message: 'Transport release confirmation audit failed.'
      });
      this.plans.setStatus(transportReleasePlanId, 'FAILED');
      throw error;
    }

    // 单次标准释放调用：目标请求号由 plan 冻结；强制变体不在受控面
    let reports: TransportReleaseReport[];
    try {
      reports = await this.client.transportRelease(payload.transportNumber);
    } catch (error) {
      // 释放调用异常：远端结果未知（超时/中断都可能导致释放作业已启动），
      // 按 UNKNOWN_OUTCOME 保守处理并停止，绝不自动重试。
      return this.failWithUnknownOutcome(transportReleasePlanId, plan, new SafeAbapError(
        'UNKNOWN_OUTCOME',
        'EXECUTE',
        `The transport release outcome is unknown (${sanitizeMessage(error)}). `
        + 'Verify the request status read-only before any further action.'
      ));
    }
    this.plans.recordStage(transportReleasePlanId, { stage: 'EXECUTE', success: true });

    const reportSummary = summarizeReports(reports);
    // 远端检查明确拒绝（abortrelapifail）：释放未达成——与"读回未变"同置
    // UNKNOWN_OUTCOME 终结（只有读回确认生效才算成功，语义与清理链一致）。
    if (reportSummary.status === 'abortrelapifail') {
      return this.failWithUnknownOutcome(transportReleasePlanId, plan, new SafeAbapError(
        'UNKNOWN_OUTCOME',
        'READBACK',
        `The release check rejected the request (${reportSummary.statusText || 'abortrelapifail'}); `
        + 'the release did not take effect. Review the release messages read-only before any further action.'
      ));
    }

    // 生效验证：轮询只读读回，status 变 R 才算释放生效
    let readbackStatus = '';
    for (let attempt = 0; attempt < READBACK_POLL_ATTEMPTS; attempt++) {
      await this.sleep(READBACK_POLL_INTERVAL_MS);
      try {
        readbackStatus = String(
          (await this.client.transportDetails(payload.transportNumber))?.['tm:status'] || ''
        ).trim().toUpperCase();
      } catch {
        // 读回瞬时不稳定不立即判死：释放作业期间偶发读失败，继续下一轮
        continue;
      }
      if (readbackStatus === 'R') {
        const summary: TransportReleaseResultSummary = {
          kind: 'TRANSPORT_RELEASE',
          transportNumber: payload.transportNumber,
          releasedVerified: true,
          readbackStatus,
          releaseReport: reportSummary.status ? reportSummary : undefined
        };
        this.plans.recordStage(transportReleasePlanId, {
          stage: 'READBACK', success: true, message: `release verified (status ${readbackStatus})`
        });
        this.plans.recordResult(transportReleasePlanId, summary);
        this.plans.setStatus(transportReleasePlanId, 'SUCCEEDED');
        await this.audit.append(releaseAuditEvent(plan, this.policy, 'TRANSPORT_RELEASE_COMPLETED', true, summary));
        return { status: 'success', plan: this.status(transportReleasePlanId) };
      }
    }
    // 轮询耗尽仍非 R：释放作业可能仍在传播或已被拒绝——结果未知，保守终结
    return this.failWithUnknownOutcome(transportReleasePlanId, plan, new SafeAbapError(
      'UNKNOWN_OUTCOME',
      'READBACK',
      `The release call was accepted but the read-back still reports status '${readbackStatus || 'unknown'}' `
      + `after ${READBACK_POLL_ATTEMPTS} attempt(s); whether the release took effect is unknown. `
      + 'Verify the request status read-only (SE09) before any further action.'
    ));
  }

  /**
   * UNKNOWN_OUTCOME 终止路径：记录阶段失败、写错误、置 UNKNOWN_OUTCOME、
   * 尽力补一条审计（审计失败不掩盖主错误），最后抛出带 plan 视图的错误。
   */
  private async failWithUnknownOutcome(
    transportReleasePlanId: string,
    plan: TransportReleasePlan,
    error: SafeAbapError
  ): Promise<never> {
    this.plans.recordStage(transportReleasePlanId, {
      stage: error.stage, success: false, message: 'Remote outcome unknown.'
    });
    this.plans.recordResult(transportReleasePlanId, undefined, {
      code: error.code, stage: error.stage, message: error.message
    });
    this.plans.setStatus(transportReleasePlanId, 'UNKNOWN_OUTCOME');
    try {
      await this.audit.append(releaseAuditEvent(
        plan, this.policy, 'TRANSPORT_RELEASE_UNKNOWN', false, undefined, true
      ));
    } catch {
      // 审计失败不掩盖主错误；plan 上保留的 UNKNOWN_OUTCOME 状态是首要重放安全信号。
    }
    throw new SafeAbapError(error.code, error.stage, error.message, { plan: this.status(transportReleasePlanId) });
  }
}

/**
 * 把 ADT 释放报告数组折叠为有界摘要：取首条报告的 status/statusText，
 * messages 截断至 REPORT_MESSAGE_LIMIT 条、文本截断至 REPORT_TEXT_LIMIT。
 * 空报告返回无 status 的空摘要（释放作业受理态以读回为准）。
 */
function summarizeReports(reports: TransportReleaseReport[]): TransportReleaseReportSummary {
  const first = Array.isArray(reports) ? reports[0] : undefined;
  if (!first) {
    return { status: '', messages: [] };
  }
  const messages = (Array.isArray(first.messages) ? first.messages : [])
    .slice(0, REPORT_MESSAGE_LIMIT)
    .map(message => ({
      type: String(message?.['chkrun:type'] || '').slice(0, REPORT_TEXT_LIMIT),
      shortText: String(message?.['chkrun:shortText'] || '').slice(0, REPORT_TEXT_LIMIT)
    }));
  return {
    status: String(first['chkrun:status'] || ''),
    statusText: first['chkrun:statusText'] ? String(first['chkrun:statusText']).slice(0, REPORT_TEXT_LIMIT) : undefined,
    messages
  };
}

/**
 * 解析并校验目标请求号：10 位、SAP TRKORR 工作台/定制请求形态
 * （第 4 位为 K，与 legacy transportRelease 的 validateTransport 语义一致）。
 */
function parseTransportNumber(value: unknown): string {
  const transportNumber = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{2}K[0-9]{6}$/.test(transportNumber)) {
    throw new SafeAbapError(
      'VALIDATION_FAILED',
      'PREVIEW',
      'transportNumber must be a 10-character SAP transport request number (e.g. S4HK900123).'
    );
  }
  return transportNumber;
}

/** 从 SafetyPolicy 提取当前 SAP 上下文（与创建/清理链相同的字段集合）。 */
function releaseContext(policy: SafetyPolicy) {
  return {
    systemHost: policy.systemHost,
    client: policy.client,
    sapUser: policy.sapUser,
    systemRole: policy.systemRole,
    toolProfile: policy.toolProfile
  };
}

/** 属主比较辅助：数字型用户名剥前导零（068157 → 68157，真机实锤形态差异）。 */
function stripZeros(value: string): string {
  return value.replace(/^0+/, '');
}

/** 构造释放专用审计事件；载荷只出现 hash，不出现请求内容。 */
function releaseAuditEvent(
  plan: TransportReleasePlan,
  policy: SafetyPolicy,
  eventType: string,
  success: boolean,
  result?: TransportReleaseResultSummary,
  unknownOutcome = false
): AuditEvent {
  return {
    correlationId: plan.transportReleasePlanId,
    transportReleasePlanId: plan.transportReleasePlanId,
    eventType,
    systemHost: policy.systemHost,
    client: policy.client,
    systemRole: policy.systemRole,
    transportRequest: plan.target.transportNumber,
    resultSummary: result
      ? `released transport ${result.transportNumber} (readback status ${result.readbackStatus})`
      : undefined,
    unknownOutcome,
    success
  };
}

/** 拒绝输入对象上的未知字段，防止调用方夹带任意引用。 */
function assertAllowedKeys(value: unknown, keys: string[], label: string): void {
  const record = asRecord(value);
  const unexpected = Object.keys(record).filter(key => !keys.includes(key));
  if (unexpected.length > 0) {
    throw new SafeAbapError('VALIDATION_FAILED', 'PREVIEW', `${label} does not accept fields: ${unexpected.join(', ')}.`);
  }
}

function asRecord(value: unknown): Record<string, any> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SafeAbapError('VALIDATION_FAILED', 'PREVIEW', 'Transport release input must be an object.');
  }
  return value as Record<string, any>;
}

/** 错误消息脱敏：截断到 500 字符，避免把完整 ADT 响应外泄到错误通道。 */
function sanitizeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, ' ').trim().slice(0, 500);
}
