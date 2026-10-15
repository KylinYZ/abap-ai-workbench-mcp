/**
 * SAP 版本能力协商（M0 数据层）——S/4HANA 低版本适配（BASIS 7.50/7.51）基础。
 *
 * 设计要点：
 * 1. 版本指纹（SapReleaseFingerprint）由 RFC/ADT 探测数据解析而来；解析层是纯函数，
 *    探测层（RFC_SYSTEM_INFO + CVERS 读表）接入点在 M0 收集清单落地后接线。
 * 2. 每工具最低 BASIS 版本登记表（TOOL_MIN_BASIS_RELEASE）：默认不限版本（700 = 全支持），
 *    仅对版本敏感工具显式登记，降低维护面、防止手工登记漂移。
 * 3. 门控语义与 systemRole 门控并列：basisRelease 为 undefined（未接入指纹）时
 *    全部工具放行，行为与现有版本完全一致——这是"能力协商、非能力重建"的基线前提。
 * 4. splitWhereToOptions 属 RFC 读表通道的低版本兼容（M1）：经典 RFC_READ_TABLE
 *    的 OPTIONS 行宽 72，长 WHERE 按引号感知的空格边界切多行。
 *
 * 版本事实依据（abap-docs 特性矩阵，software-heroes；详见 docs/S4低版本适配规划.md §2）：
 * - RAP（BDEF/SRVD 对象类型、RAP 生成器）7.55 起 GA → 全部 RAP 面登记 755；
 *   7.50/7.51/7.52 上这些对象类型不存在（收集清单 SECTION4 真机互证）。
 * - ADT AMDP 调试资源 7.53 起 → 仅登记 kind 级（AMDP_*），工具级不动（调试链同时
 *   承载普通 ABAP 调试，不能整体隐藏）。
 * - CDS 主面（Define View）7.40 SP05+ → 7.50/7.51 可用，不登记。
 * - CDS Metadata Extensions 仅 7.50 缺（7.51 起 available）→ 走受控创建 kind 级收窄（M2），不在工具级登记。
 */

import { RfcError } from '../rfc/errors.js';

/** 不登记版本要求的工具的默认最低 BASIS release：即全部支持（7.00 起）。 */
export const DEFAULT_MIN_BASIS_RELEASE = 700;

/** 低版本适配的目标下限：S/4HANA 1511（BASIS 7.50）。 */
export const LOW_RELEASE_TARGET_BASIS = 750;

/**
 * 每工具最低 BASIS release 登记表（数值形态：750 = 7.50）。
 * 只登记"低于该版本必须隐藏"的工具；未登记 = 不限版本。
 * 防漂移约束：键名必须出现在 ToolProfiles.ts 的工具名集合中（由单测断言）。
 */
export const TOOL_MIN_BASIS_RELEASE: Readonly<Record<string, number>> = {
  // RAP 生成器只读面（rap.generate 域）：RAP 7.55 GA
  rapGenValidateInitial: 755,
  rapGenGetSchema: 755,
  rapGenGetContent: 755,
  rapGenGetUiConfig: 755,
  rapGenValidateContent: 755,
  rapGenPreview: 755,
  rapGenIsAvailable: 755,
  // RAP 生成器写入面（raw advanced mutation）
  rapGenGenerate: 755,
  rapGenPublishService: 755,
  // 受控 RAP 操作链（preview/apply 一对）
  previewRapOperation: 755,
  applyRapOperation: 755
};

/**
 * kind 级版本登记表（预留，M1 接线到参数级 dispatch 门控）：
 * 工具整体不限版本、但特定操作 kind 受版本约束时在此登记。
 * 典型：ADT AMDP 调试资源（/sap/bc/adt/amdp/debugger）7.53 起，
 * 而 previewDebugOperation 同时承载普通 ABAP 调试（不限版本），只能按 kind 收窄。
 */
export const TOOL_KIND_MIN_BASIS_RELEASE: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  // previewDebugOperation 的 kind → minRelease；未列出的 kind（普通 ABAP 调试）不限版本
  previewDebugOperation: {
    AMDP_START: 753,
    AMDP_SYNC_BREAKPOINTS: 753,
    AMDP_AWAIT_STOP: 753,
    AMDP_TERMINATE: 753,
    AMDP_STEP: 753,
    AMDP_READ_VARIABLE: 753
  }
};

/** CVERS 表单行投影（收集报表 SECTION2 的输出形态）。 */
export interface CversRow {
  /** 软件组件 ID，如 SAP_BASIS、S4CORE、SAP_ABA。 */
  component: string;
  /** release 字符串，形态 '750' 或 '7.50'（源系统差异，解析层归一）。 */
  release: string;
  /** Support Package 层级（字符数字，如 '0004'）。 */
  spLevel?: string;
  /** 补丁级别。 */
  patchLevel?: string;
}

/** 版本指纹：能力矩阵裁剪的判定输入。 */
export interface SapReleaseFingerprint {
  /** SAP_BASIS release 数值形态（750 = 7.50）。裁剪矩阵的主键。 */
  basisRelease: number;
  /** SAP_BASIS 的 SP 层级（数值），同代次不同 SP 行为有差异时用于细分定性。 */
  basisSpLevel?: number;
  /**
   * S/4CORE 主版本代号（'100' = S/4HANA 1511，'101' = 1610）。
   * 仅展示信息；精简系统可能缺失，裁剪不依赖此字段。
   */
  s4coreRelease?: string;
  /** 指纹采集时间（ISO 8601）。 */
  detectedAt: string;
  /** 数据来源：cvers+system-info = 探测链；manual = 部署者显式配置。 */
  source: 'cvers+system-info' | 'manual';
}

/**
 * release 字符串归一化为数值：'750' → 750，'7.50' → 750，'751' → 751。
 * 非法输入返回 undefined（调用方 fail-closed 按未知版本处理）。
 */
export function normalizeReleaseNumber(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim();
  // '7.50' 形态：主次版本合并为三位数字
  const dotted = /^(\d)\.(\d{2})$/.exec(cleaned);
  if (dotted) return Number(`${dotted[1]}${dotted[2]}`);
  // '750' / '751' 纯三位数字形态（CVERS.REL 常见形态）
  if (/^\d{3}$/.test(cleaned)) return Number(cleaned);
  return undefined;
}

/**
 * 从 CVERS 行集合解析版本指纹。
 * - SAP_BASIS 缺失或不可解析 → 返回 undefined（调用方必须按"未知版本"处理，
 *   不得猜测裁剪——fail-closed 原则）。
 * - S4CORE 缺失不阻断（s4coreRelease 仅展示用）。
 */
export function parseSapReleaseFingerprint(
  cversRows: readonly CversRow[],
  now: Date = new Date()
): SapReleaseFingerprint | undefined {
  const basisRow = cversRows.find(row => row.component === 'SAP_BASIS');
  const basisRelease = normalizeReleaseNumber(basisRow?.release);
  if (basisRelease === undefined) return undefined;
  const s4coreRow = cversRows.find(row => row.component === 'S4CORE');
  const spLevel = basisRow?.spLevel !== undefined ? Number(basisRow.spLevel) : undefined;
  return {
    basisRelease,
    basisSpLevel: Number.isFinite(spLevel) ? spLevel : undefined,
    s4coreRelease: s4coreRow?.release,
    detectedAt: now.toISOString(),
    source: 'cvers+system-info'
  };
}

/**
 * 单工具版本判定：该工具在给定 BASIS release 上是否可用。
 * - basisRelease 为 undefined（指纹未接入）→ 恒 true：行为与现有版本零差异。
 * - 未登记版本要求的工具 → 全版本支持。
 */
export function isToolAvailableForBasisRelease(
  toolName: string,
  basisRelease: number | undefined
): boolean {
  if (basisRelease === undefined) return true;
  const min = TOOL_MIN_BASIS_RELEASE[toolName] ?? DEFAULT_MIN_BASIS_RELEASE;
  return basisRelease >= min;
}

/**
 * 批量过滤：返回在给定 release 上可用的工具名集合（保持输入顺序）。
 * 供 selectProfileTools 目录裁剪与 healthcheck capability report 共用。
 */
export function filterToolsForBasisRelease(
  toolNames: readonly string[],
  basisRelease: number | undefined
): string[] {
  if (basisRelease === undefined) return [...toolNames];
  return toolNames.filter(name => isToolAvailableForBasisRelease(name, basisRelease));
}

/**
 * kind 级版本判定（M1 接线）：给定工具的给定 kind 是否在 release 上可用。
 * 工具未登记 kind 级要求 → 不限版本。
 */
export function isToolKindAvailableForBasisRelease(
  toolName: string,
  kind: string,
  basisRelease: number | undefined
): boolean {
  if (basisRelease === undefined) return true;
  const kinds = TOOL_KIND_MIN_BASIS_RELEASE[toolName];
  if (!kinds) return true;
  const min = kinds[kind];
  if (min === undefined) return true;
  return basisRelease >= min;
}

/**
 * 受控创建对象 kind 的最低 BASIS release（M2-A：31 类能力目录的版本收窄）。
 * 未登记 = 全版本可建。真机依据：ED1/1610（7.51）TADIR 计数 BDEF=0/SRVD=0
 * （docs/evidence/low-release-ed1-751-baseline.md）；其余按 abap-docs 特性矩阵：
 * - RAP 时代（BDEF/SRVD/SRVB，7.55 GA）→ 755；
 * - CDS_TYPE / CDS_ASPECT（view entity 时代，7.55）→ 755；
 * - CDS_ENTITY_BUFFER（7.57/2022）→ 757；
 * - CDS_METADATA_EXTENSION（7.50 无、7.51 起 available）→ 751。
 */
export const REPOSITORY_CREATION_KIND_MIN_RELEASE: Readonly<Record<string, number>> = {
  SERVICE_DEFINITION: 755,
  BEHAVIOR_DEFINITION: 755,
  SERVICE_BINDING: 755,
  CDS_TYPE: 755,
  CDS_ASPECT: 755,
  CDS_ENTITY_BUFFER: 757,
  CDS_METADATA_EXTENSION: 751
};

/**
 * 受控创建 kind 版本判定：给定 kind 是否可在 release 上创建。
 * basisRelease undefined（指纹未接入/不可得）→ 恒 true，目录零变化。
 */
export function isRepositoryCreationKindAvailableForBasisRelease(
  objectKind: string,
  basisRelease: number | undefined
): boolean {
  if (basisRelease === undefined) return true;
  const min = REPOSITORY_CREATION_KIND_MIN_RELEASE[String(objectKind ?? '').trim().toUpperCase()];
  if (min === undefined) return true;
  return basisRelease >= min;
}

/** 汇总被收窄的受控创建 kind（healthcheck report 用），按 kind 名排序。 */
export function unavailableCreationKindsForBasisRelease(
  objectKinds: readonly string[],
  basisRelease: number | undefined
): Array<{ objectKind: string; minBasisRelease: number }> {
  if (basisRelease === undefined) return [];
  return objectKinds
    .filter(kind => !isRepositoryCreationKindAvailableForBasisRelease(kind, basisRelease))
    .map(kind => ({ objectKind: kind, minBasisRelease: REPOSITORY_CREATION_KIND_MIN_RELEASE[kind] }))
    .sort((a, b) => a.objectKind.localeCompare(b.objectKind));
}

/**
 * 受控创建 preview 的逐对象 kind 门禁（workflow 调用的纯函数）：任一对象命中
 * 版本收窄即抛 SafeAbapError 形态的信息（由调用方包装），plan 状态机不进入。
 * 未带 objectKind 的对象跳过（非受控创建域的调用方复用本函数时不误伤）。
 */
export function assertCreationKindsAvailableForBasisRelease(
  objects: readonly { objectKind?: unknown }[] | undefined,
  basisRelease: number | undefined
): void {
  if (basisRelease === undefined || !Array.isArray(objects)) return;
  for (const object of objects) {
    const kind = String((object as { objectKind?: unknown })?.objectKind ?? '').trim().toUpperCase();
    if (kind === '') continue;
    if (!isRepositoryCreationKindAvailableForBasisRelease(kind, basisRelease)) {
      throw new Error(
        `Repository object kind '${kind}' requires SAP_BASIS >= ${REPOSITORY_CREATION_KIND_MIN_RELEASE[kind]} but the target system reports BASIS ${basisRelease}.`
      );
    }
  }
}

/**
 * 汇总被裁剪的工具清单（healthcheck capability report 用）：
 * 返回 [工具名, 要求的最低 release] 对，按工具名排序，保证输出稳定可 diff。
 */
export function unavailableToolsForBasisRelease(
  toolNames: readonly string[],
  basisRelease: number | undefined
): Array<{ tool: string; minBasisRelease: number }> {
  if (basisRelease === undefined) return [];
  return toolNames
    .filter(name => !isToolAvailableForBasisRelease(name, basisRelease))
    .map(name => ({ tool: name, minBasisRelease: TOOL_MIN_BASIS_RELEASE[name] ?? DEFAULT_MIN_BASIS_RELEASE }))
    .sort((a, b) => a.tool.localeCompare(b.tool));
}

/**
 * 从 RFC_SYSTEM_INFO 的调用结果提取 BASIS release（指纹探测链的数据源）。
 * 真机形态（ED1/7.51 实测）：结果形如 { RFCSI_EXPORT: { RFCSAPRL: '751', ... } }，
 * 顶层也可能直接扁平携带 RFCSAPRL——两种形态都兼容。
 * RFCSAPRL 即 sy-saprl = BASIS release；缺环或不可解析返回 undefined
 * （调用方按"未知版本 = 不裁剪"处理，绝不猜测——fail-closed）。
 * 注意：RFCSI_EXPORT 中的 S4_HANA 导出参数在 ED1 实测返回空值，S/4 代次
 * 判定只能走 CVERS（parseSapReleaseFingerprint），本函数刻意不读 S4_HANA。
 */
export function detectBasisReleaseFromSystemInfo(systemInfo: unknown): number | undefined {
  if (typeof systemInfo !== 'object' || systemInfo === null) return undefined;
  const info = systemInfo as Record<string, unknown>;
  const nested = info.RFCSI_EXPORT;
  if (typeof nested === 'object' && nested !== null && 'RFCSAPRL' in nested) {
    return normalizeReleaseNumber(String((nested as Record<string, unknown>).RFCSAPRL ?? ''));
  }
  if ('RFCSAPRL' in info) {
    return normalizeReleaseNumber(String(info.RFCSAPRL ?? ''));
  }
  return undefined;
}

/**
 * 部署者显式配置的 BASIS release（env SAP_MCP_BASIS_RELEASE）。
 * 优先级高于 RFC 探测：显式声明意味着部署者对目标系统负责，探测失败不回退。
 * 非法值返回 undefined（静默视为未配置；错误拼写不应改变目录行为）。
 */
export function resolveConfiguredBasisRelease(raw: string | undefined | null): number | undefined {
  return normalizeReleaseNumber(raw);
}

/**
 * RFC_READ_TABLE OPTIONS 行切分（低版本 7.51 真机兼容点）：
 * 经典 RFC_READ_TABLE 的 OPTIONS 行(RFC_DB_OPT)宽 72，超长 WHERE 必须切成
 * 多行 TEXT——RFM 内部把行序列拼接为单个 WHERE（ABAP SQL 空白不敏感），
 * 行序即原语义。
 *
 * 切分规则：
 * - 仅在**引号外**的空格边界断行（引号内空格是字面量的一部分，切断会破坏
 *   字面量，如 `MSGTX = 'AB CD'`）；单引号成对翻转 in-quote 状态，'' 转义
 *   （连续两个单引号）天然正确（翻转两次回到原状态）。
 * - 贪心打包：每行尽量装满到 maxWidth；行首尾空格 trim（拼接后语义不变）。
 * - 引号外连续 token 自身超过 maxWidth 时无法安全断行 → 抛 RfcError
 *   （与原"超限即拒"语义一致的唯一剩余拒绝路径）。
 */
export function splitWhereToOptions(clause: string, maxWidth = 72): string[] {
  if (clause === '') return [];
  // 标记每个字符是否处于单引号字面量内（'' 转义即连续两次翻转，状态自洽）
  const inQuote: boolean[] = new Array(clause.length).fill(false);
  let quoting = false;
  for (let i = 0; i < clause.length; i++) {
    inQuote[i] = quoting;
    if (clause[i] === "'") quoting = !quoting;
  }
  // 可断点 = 引号外空格；引号外连续 token（word）超宽则拒绝
  const lines: string[] = [];
  let start = 0;
  while (start < clause.length) {
    // 跳过行首空格（引号外）
    while (start < clause.length && clause[start] === ' ' && !inQuote[start]) start++;
    if (start >= clause.length) break;
    // 找本行能容纳的最远断点；end 探测到 maxWidth 之外的第一个断点为止
    let end = start;
    let lastBreak = -1;
    while (end < clause.length && end - start < maxWidth) {
      if (clause[end] === ' ' && !inQuote[end]) lastBreak = end;
      end++;
    }
    if (end >= clause.length) {
      // 尾段整体放得下
      const tail = clause.slice(start).trim();
      if (tail === '') break;
      lines.push(tail);
      break;
    }
    if (lastBreak > start) {
      lines.push(clause.slice(start, lastBreak).trim());
      start = lastBreak;
    } else {
      // 本行内没有任何可断点：当前 token 超宽（或 token 正好从 start 连到
      // maxWidth 边界）——继续吞到下一个引号外空格，吞完仍超宽则拒绝
      let tokenEnd = end;
      while (tokenEnd < clause.length && !(clause[tokenEnd] === ' ' && !inQuote[tokenEnd])) tokenEnd++;
      if (tokenEnd - start > maxWidth) {
        throw new RfcError(
          'RFC_INVALID_PAYLOAD',
          `splitWhereToOptions: token exceeds ${maxWidth} characters and cannot be split safely.`
        );
      }
      lines.push(clause.slice(start, tokenEnd).trim());
      start = tokenEnd;
    }
  }
  if (lines.length === 0) throw new RfcError('RFC_INVALID_PAYLOAD', 'splitWhereToOptions: empty clause.');
  return lines;
}
