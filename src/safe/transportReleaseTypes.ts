/**
 * 受控传输请求释放工作流（TransportRelease）的类型定义。
 *
 * 业务背景（所有者 2026-10-21 边界调整）：
 * - 释放允许受控执行：开发变更经人工审批后，AI 可以经受控链释放 DEV 请求，
 *   打通"改代码 → 挂请求 → 受控释放"链路的最后一环。释放后的搬运（STMS
 *   导入到 QAS/PRD）仍不在本链路面。
 * - 明确不做的事：
 *   - 释放他人属主的请求绝不允许（与清理链同一红线）；
 *   - 已释放/锁定请求绝不重复释放（状态必须为 D）；
 *   - 强制变体（ignoreLocks 忽略对象锁 / IgnoreATC 忽略 ATC 检查）不进入
 *     受控面——受控链只走标准释放动作 `newreleasejobs`，锁与 ATC 发现由
 *     释放作业按系统标准检查，检查不过就是释放不生效，绝不绕行；
 *   - STMS 导入、改属主、加用户与直改 E071/E071K 仍一律禁止。
 * - 安全规则（与受控清理链同构）：
 *   - preview 只读核验两条红线（状态 D + 本人属主）并冻结 plan；任何红线
 *     不满足时确定性拒绝且不建 plan；子任务未释放数只透出不拦截（释放
 *     作业按 SAP 标准级联处理，结果以释放报告与读回为准）；
 *   - apply 仅接受 server 生成 planId；form elicitation 原生确认后单次释放；
 *   - 释放是后台作业：apply 成功后轮询只读读回（有限次数），status 变为
 *     R（已释放）才算 SUCCEEDED；释放调用异常、报告 abortrelapifail 或
 *     轮询耗尽仍非 R 时置 UNKNOWN_OUTCOME 终结，绝不自动重试写操作
 *     （释放是否真的生效只能人工只读复核，与清理链"仍可读"同哲学）。
 */
import type { TransportRequest } from '../adt/index.js';
import type { ToolProfile } from './types.js';

/**
 * 释放 plan 的生命周期状态（与创建/清理链一致）：
 * - PREVIEWED：preview 已冻结目标请求快照，等待原生确认与 apply。
 * - RUNNING：已确认，释放正在执行（同一 plan 不允许重复 apply）。
 * - SUCCEEDED：释放完成且只读读回验证 status=R（已释放）。
 * - UNKNOWN_OUTCOME：释放调用异常、远端检查拒绝（abortrelapifail）或读回
 *   轮询耗尽仍非 R——结果未知/未达成，plan 终结且禁止重试。
 * - FAILED：本地前置步骤（审计写入等）失败，远端从未被调用。
 * - EXPIRED：plan 超过 TTL 未被 apply，自动终结。
 */
export type TransportReleaseStatus =
  | 'PREVIEWED' | 'RUNNING' | 'SUCCEEDED' | 'UNKNOWN_OUTCOME' | 'FAILED' | 'EXPIRED';

/**
 * plan 绑定的 SAP 上下文。apply/status 时会重新校验当前会话上下文与
 * preview 时的上下文完全一致，防止跨系统/跨客户端重放 plan。
 */
export interface TransportReleaseContext {
  systemHost: string;        // SAP 主机（小写规范化）
  client: string;            // SAP 集团号
  sapUser: string;           // SAP 用户（大写规范化）——必须与请求属主一致
  systemRole: string;        // 系统角色：受控释放仅允许 DEV
  toolProfile: ToolProfile;  // 工具 profile：仅 development / development-workbench
}

/**
 * preview 阶段冻结的目标请求快照（展示与审计用）。
 * 全部字段来自 preview 时的只读 transportDetails 读回，不接受调用方断言。
 */
export interface TransportReleaseTarget {
  transportNumber: string;     // 目标请求号（10 位，已规范化为大写）
  owner: string;               // 读回的请求属主（已剥前导零）
  requestStatus: string;       // 读回的请求状态（必须为 D=可修改/未释放）
  taskCount: number;           // 读回的子任务数
  objectCount: number;         // 读回的对象总数（请求本体 + 全部子任务，仅透出）
  unreleasedTaskCount: number; // 子任务中状态非 R 的数量（透出项，非红线）
}

/** apply 阶段实际发送给 ADT transportRelease 的精确载荷。 */
export interface TransportReleasePayload {
  transportNumber: string;  // 仅此一个字段：释放目标由 plan 冻结
}

/** 单个执行阶段记录（时间戳由 store 写入）。 */
export interface TransportReleaseStage {
  stage: string;      // 阶段名：PREVIEW / CONFIRM / EXECUTE / READBACK
  success: boolean;   // 该阶段是否成功
  timestamp: string;  // ISO 时间戳
  message?: string;   // 可选补充说明
}

/** 结构化错误信息（写入 plan，避免堆栈等敏感细节外泄）。 */
export interface TransportReleaseError {
  code: string;    // SafeErrorCode
  stage: string;   // 失败阶段
  message: string; // 已脱敏的错误描述
}

/**
 * ADT 释放报告的有界摘要（ExecutedReport 摘取）：
 * chkrun:status 常见取值 released（作业受理）/ abortrelapifail（检查拒绝），
 * messages 为释放检查消息的有界列表（长文本截断）。
 */
export interface TransportReleaseReportSummary {
  status: string;                  // chkrun:status（released / abortrelapifail / ...）
  statusText?: string;             // chkrun:statusText（截断）
  messages: Array<{                // 释放检查消息（type + 文本截断，至多 10 条）
    type: string;                  // chkrun:type（SAPRC 消息类型）
    shortText: string;             // chkrun:shortText（截断）
  }>;
}

/** 释放结果摘要（SUCCEEDED 后写入 plan 的有界结果）。 */
export interface TransportReleaseResultSummary {
  kind: 'TRANSPORT_RELEASE';
  transportNumber: string;                  // 已释放并验证的请求号
  releasedVerified: true;                   // 读回验证：status 已变为 R
  readbackStatus: string;                   // 读回到的请求状态（应为 R）
  releaseReport?: TransportReleaseReportSummary; // ADT 返回的释放检查报告摘要
}

/** 释放 plan（服务端内部完整形态，含执行载荷；绝不整份回显给调用方）。 */
export interface TransportReleasePlan {
  transportReleasePlanId: string;   // server 生成的 plan 唯一 id（apply 的唯一凭据）
  createdAt: number;                // 创建时间（epoch ms）
  expiresAt: number;                // 过期时间（epoch ms，createdAt + TTL）
  terminalAt?: number;              // 进入终态的时间
  status: TransportReleaseStatus;
  context: TransportReleaseContext; // preview 时的 SAP 上下文快照
  target: TransportReleaseTarget;   // 目标请求快照（展示/审计用）
  payloadHash: string;              // payload 的 SHA-256 指纹（审计比对用）
  payload?: TransportReleasePayload; // 执行载荷；进入终态后立即清除
  stages: TransportReleaseStage[];  // 阶段轨迹
  confirmationMode?: 'elicitation' | 'auto-config'; // 确认方式：仅支持 MCP form elicitation
  result?: TransportReleaseResultSummary; // 有界结果摘要
  primaryError?: TransportReleaseError;   // 首个错误
}

/** store.create 的输入。 */
export interface CreateTransportReleasePlanInput {
  context: TransportReleaseContext;
  target: TransportReleaseTarget;
  payload: TransportReleasePayload;
}

/** preview 工具的输入（仅请求号一个字段）。 */
export interface PreviewTransportReleaseInput {
  transportNumber?: unknown; // 目标请求号，10 位
}

/** preview 成功结果（携带 plan 视图）。 */
export interface TransportReleasePreviewResult {
  status: 'preview';
  plan: TransportReleasePlanView;
  confirmationRequired: true;
}

/**
 * plan 对外只读视图。与内部 plan 的差异：时间为 ISO 字符串、
 * 绝不包含执行载荷（payload 仅以 payloadHash 指纹出现）。
 */
export interface TransportReleasePlanView {
  transportReleasePlanId: string;
  createdAt: string;
  expiresAt: string;
  terminalAt?: string;
  status: TransportReleaseStatus;
  systemHost: string;
  client: string;
  sapUser: string;
  systemRole: string;
  toolProfile: ToolProfile;
  target: TransportReleaseTarget;
  payloadHash: string;
  stages: TransportReleaseStage[];
  confirmationMode?: 'elicitation' | 'auto-config';
  result?: TransportReleaseResultSummary;
  primaryError?: TransportReleaseError;
}

/** transportDetails 读回的最小字段集合（结构子集，便于测试 mock）。 */
export type TransportDetailsForRelease = TransportRequest;
