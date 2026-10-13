/**
 * ============================================================================
 * 受控对象导入工作流（RepositoryObjectImportWorkflow）
 * —— 关闭矩阵行 install.deploy-zip / fileio.import-export 的受控导入面
 * ============================================================================
 *
 * 任务语义（对齐 VSP DeployZip/ImportFromFile 的导入方向，但走受控链）：
 *   把 abapGit 离线序列化包（ZIP）内的 CLAS/INTF/PROG 源码对象批量部署到
 *   一个 `$` 本地包：preview 只读预检并冻结 immutable plan → 原生确认 →
 *   applyConfirmed 按静态弱序（接口→类→程序）逐对象"建壳或更新 → 锁 → 写
 *   源 → 语法检查 → 解锁 → 激活 → readback 比对"。
 *
 * 安全模型（与受控创建链/受控 UI5 写链同面）：
 * 1. 仅 DEV 角色 + development/development-workbench profile；目标包强制
 *    `$` 本地包（无传输号、不进 CTS）；对象名必须过 SafetyPolicy 命名空间
 *    白名单（allowedNamespaces）。
 * 2. preview 冻结逐对象基线：存在性（create/update 判定）+ 既有对象逐包含
 *    active 源 hash；apply 前逐对象漂移复核，preview 与 apply 之间状态被
 *    改动（存在性翻转或任一包含内容变化）即 STATE_DRIFT 拒绝执行（写未发
 *    出，安全失败）。
 * 3. 单次执行：plan 恰好消费一次；readback 逐包含比对（CLAS 主源用类规范
 *    化比对，其余规范化行尾比对）。
 * 4. UNKNOWN 语义（与受控创建链一致）：建壳、源码写入、解锁、激活四类
 *    "请求已发出结果不可知"的调用失败 → 整个 plan 终结 OUTCOME_UNKNOWN，
 *    不重试、不自动删除、不补偿；后续对象 NOT_ATTEMPTED。
 * 5. 无自动补偿：已 APPLIED 的对象保留（导入天然可续跑——重新 preview 后
 *    已应用对象转为同内容 update）；确定性失败（语法检查/漂移/读回不符）
 *    使 plan 终结 FAILED 并停在第一个失败对象。
 *
 * 范围边界（v1，如实声明）：
 *   - 仅 CLAS/INTF/PROG；FUGR（函数组需函数模块级操作）与 DEVC（包不由
 *     导入创建，目标包必须预先存在）显式跳过并记原因；W3MI/TRAN 在解析层
 *     已跳过。
 *   - 每类型允许的源包含：INTF/PROG 仅 main；CLAS 允许 main + locals_def/
 *     locals_imp/testclasses（对应 ADT includes 的 definitions/implement
 *     ations/testclasses）。
 *   - 导入不删除目标对象上未被包覆盖的既有包含（abapGit 导入语义：只写
 *     包内提供的文件）。
 */
import { createHash } from 'node:crypto';
import type {
  AbapObjectStructure,
  ActivationResult,
  AdtLock,
  SearchResult,
  TransportInfo,
  TransportRequest
} from '../adt/index.js';
import type { AdtHTTP } from '../adt/AdtHTTP.js';
import { createImportObjectShell, type ImportShellInput } from '../adt/api/ImportShellCreation.js';
import { readZipTextEntries, ZipParseError } from '../abapgit/zip-reader.js';
import { parseAbapGitOfflineEntries } from '../abapgit/serialization.js';
import { buildDeploymentPlan } from '../abapgit/deployment-plan.js';
import { SafeAbapError, errorMessage } from './errors.js';
import type { SafetyPolicy } from './SafetyPolicy.js';
import type { AuditEvent } from './AuditLogger.js';
import { assertActivation, assertTransportAvailable, controlledResponsible } from './adapters/creationAdapterTools.js';
import { compareAbapClassSources, compareSources, sourceHash } from './sourceTools.js';

/** 受控导入执行面支持的仓库对象类型（v1：纯源码对象）。 */
export type ImportObjectType = 'CLAS' | 'INTF' | 'PROG';

/** 导入源包含段（abapGit 文件段口径）。 */
export type ImportSourcePart = 'main' | 'locals_def' | 'locals_imp' | 'testclasses';

/** 允许进入执行面的对象类型白名单。 */
const EXECUTABLE_TYPES: readonly ImportObjectType[] = ['CLAS', 'INTF', 'PROG'];

/** 每类型允许写入的源包含（之外的出现即 preview 拒绝——fail-closed）。 */
const ALLOWED_PARTS: Record<ImportObjectType, readonly ImportSourcePart[]> = {
  CLAS: ['main', 'locals_def', 'locals_imp', 'testclasses'],
  INTF: ['main'],
  PROG: ['main']
};

/** abapGit 源包含段 → ADT class:includeType（main 走 mainInclude 解析）。 */
const PART_TO_INCLUDE_TYPE: Record<Exclude<ImportSourcePart, 'main'>, 'definitions' | 'implementations' | 'macros' | 'testclasses'> = {
  locals_def: 'definitions',
  locals_imp: 'implementations',
  testclasses: 'testclasses'
};

/** 仓库对象类型 → quick search 的 ADT 类型键。 */
const SEARCH_TYPE: Record<ImportObjectType, string> = {
  CLAS: 'CLAS/OC',
  INTF: 'INTF/OI',
  PROG: 'PROG/P'
};

/** ZIP 输入上限（abapGit 离线包典型 ≤10MB；zipBase64 另受全局 5MiB 参数上限约束）。 */
const MAX_ZIP_BYTES = 8 * 1024 * 1024;

/** 单个 plan 的对象数上限（防失控批量；超限请用过滤器分批）。 */
const MAX_IMPORT_OBJECTS = 500;

const DEFAULT_TTL_MS = 15 * 60 * 1000;

/** 本地包名约定：$ 前缀 + 大写字母开头（与 buildDeploymentPlan 强制一致）。 */
const LOCAL_PACKAGE_PATTERN = /^\$[A-Z][A-Z0-9_]{0,29}$/;

/** "请求已发出、结果不可知"的错误包装（apply 层捕获后终结 OUTCOME_UNKNOWN）。 */
export class RepositoryImportOutcomeUnknownError extends Error {}

/** 受控导入链的窄客户端接口（接线层由 ADTClient 组装；测试用 mock 实现）。 */
export interface RepositoryImportAdtClient {
  searchObject(query: string, objType?: string, max?: number): Promise<SearchResult[]>;
  objectStructure(objectUrl: string, version?: 'active' | 'inactive' | 'workingArea'): Promise<AbapObjectStructure>;
  getObjectSource(objectSourceUrl: string, options?: { version?: 'active' | 'inactive' | 'workingArea' }): Promise<string>;
  setObjectSource(objectSourceUrl: string, source: string, lockHandle: string, transport?: string): Promise<void>;
  lock(objectUrl: string, accessMode?: string): Promise<AdtLock>;
  unLock(objectUrl: string, lockHandle: string): Promise<string>;
  /** 激活（typed objectReference：body 必须带 adtcore:type/parentUri——字符串
   *  简写 body 缺这两个字段时激活器无法定位非活动版本，真机表现为"同名已
   *  存在/骨架激活"等假象，sap-dev+sap-demo 双系统实证）。 */
  activate(
    object: { 'adtcore:uri': string; 'adtcore:type': string; 'adtcore:name': string; 'adtcore:parentUri': string },
    preauditRequested?: boolean
  ): Promise<ActivationResult>;
  /** 目标包元数据（建壳需要的 language/masterSystem/responsible 身份）。 */
  readControlledPackage(packageName: string): Promise<{
    language?: string;
    masterLanguage?: string;
    masterSystem?: string;
    responsible?: string;
  }>;
  /** 传输登记信息（transportable 模式校验传输可用性）。 */
  transportInfo(objectUrl: string, devClass?: string, operation?: string): Promise<TransportInfo>;
  /** 传输请求详情（未释放校验）。 */
  transportDetails(transportNumber: string): Promise<TransportRequest>;
  /** 无传输号建壳（CLAS/INTF 受控 XML、PROG/P 通用创建）。 */
  createImportShell(input: ImportShellInput): Promise<{ location: string }>;
}

export interface RepositoryImportAuditSink {
  append(event: AuditEvent): Promise<void>;
}

/** preview 入参（zipBase64 与 zipPath 二选一；transportable 模式必填 transportRequest）。 */
export interface RepositoryImportInput {
  /** 目标包名：transportable 模式为 transportable 包名；本地包模式为 `$` 包（仅 PROG）。 */
  packageName: string
  /** abapGit 离线包 ZIP 的 base64（小包内联场景；受全局参数字节上限约束）。 */
  zipBase64?: string
  /** abapGit 离线包 ZIP 的本地绝对路径（服务端进程读取；大包场景）。 */
  zipPath?: string
  /** transportable 模式的传输号（给定后目标包必须为 transportable 包；缺省为 `$` 本地包模式）。 */
  transportRequest?: string
  /** 可选对象名过滤（大小写不敏感子串）。 */
  nameFilter?: string
  /** 可选类型过滤（CLAS/INTF/PROG 子集）。 */
  typeFilter?: string[]
}

/** 单对象冻结条目（对外视图不含源码全文，只含 hash/字节数）。 */
export interface ImportObjectView {
  objectType: ImportObjectType
  objectName: string
  description: string
  /** create=目标不存在；update=目标已存在（逐包含漂移基线已冻结）。 */
  action: 'create' | 'update'
  objectUrl: string
  parts: ReadonlyArray<{ part: ImportSourcePart; sha256: string; bytes: number }>
}

/** 跳过条目（范围外对象 + 原因）。 */
export interface ImportSkipEntry {
  objectType: string
  objectName: string
  reason: string
}

/** apply 后的逐对象结果。 */
export interface ImportOutcomeEntry {
  objectType: string
  objectName: string
  action: 'create' | 'update'
  result: 'APPLIED' | 'FAILED' | 'UNKNOWN' | 'NOT_ATTEMPTED'
  error?: string
}

/** plan 状态机：PREVIEWED → APPLYING → APPLIED / FAILED / OUTCOME_UNKNOWN；PREVIEWED 超时 → EXPIRED。 */
export type RepositoryImportPlanStatus =
  | 'PREVIEWED' | 'APPLYING' | 'APPLIED' | 'FAILED' | 'OUTCOME_UNKNOWN' | 'EXPIRED'

/** plan 对外视图（无源码全文；apply 终结后附 outcomes）。 */
export interface RepositoryObjectImportPlanView {
  importPlanId: string
  createdAt: string
  expiresAt: string
  status: RepositoryImportPlanStatus
  systemHost: string
  client: string
  systemRole: string
  toolProfile: string
  packageName: string
  /** 包模式：transportable=CLAS/INTF/PROG 全型（需传输号）；local-package=仅 PROG。 */
  mode: 'transportable' | 'local-package'
  transportRequest?: string
  source: { kind: 'zipBase64' | 'zipPath'; zipPath?: string; zipSha256: string; zipBytes: number }
  filters: { nameFilter?: string; typeFilter?: string[] }
  identity?: { language: string; masterLanguage: string; masterSystem: string; responsible: string }
  objects: ImportObjectView[]
  skips: ImportSkipEntry[]
  counts: Record<string, number>
  notes: string[]
  payloadHash: string
  stages: Array<{ stage: string; success: boolean; timestamp: string; message?: string }>
  outcomes?: ImportOutcomeEntry[]
  resultSummary?: string
  primaryError?: { code: string; stage: string; message: string }
}

/** plan 内部形态（源码全文仅服务端内存，终结时剥离 text 释放内存）。 */
interface ImportObjectInternal extends ImportObjectView {
  parts: Array<{ part: ImportSourcePart; text?: string; sha256: string; bytes: number }>
  /** update 对象的逐包含 active 源 hash 基线（漂移复核依据；不含在对外视图）。 */
  baselineHashes: Record<string, string>
}

interface ImportPlanInternal extends RepositoryObjectImportPlanView {
  expiresAtMs: number
  objects: ImportObjectInternal[]
  context: { systemHost: string; client: string; sapUser: string; systemRole: string; toolProfile: string }
}

/** 上下文形态（plan 与当前会话绑定，跨系统/跨 profile 复用一律拒绝）。 */
interface ImportContext {
  systemHost: string
  client: string
  sapUser: string
  systemRole: string
  toolProfile: string
}

/** 稳定 hash（payloadHash / 逐包含基线 hash；Buffer 直接喂哈希避免序列化开销）。 */
function sha256Hex(payload: unknown): string {
  if (Buffer.isBuffer(payload)) return createHash('sha256').update(payload).digest('hex');
  return sourceHash(typeof payload === 'string' ? payload : JSON.stringify(payload));
}

/** 仓库对象类型 → 规范对象 URL（与受控创建链/healthCapability 同模板）。 */
function canonicalObjectUrl(objectType: ImportObjectType, name: string): string {
  const lower = encodeURIComponent(name.toLowerCase());
  switch (objectType) {
    case 'CLAS': return `/sap/bc/adt/oo/classes/${lower}`;
    case 'INTF': return `/sap/bc/adt/oo/interfaces/${lower}`;
    case 'PROG': return `/sap/bc/adt/programs/programs/${lower}`;
  }
}

/** quick search 结果精确匹配（名+型全等）。 */
function exactMatch(results: SearchResult[], name: string, adtType: string): SearchResult | undefined {
  return results.find(item => String(item['adtcore:name'] || '').toUpperCase() === name
    && String(item['adtcore:type'] || '').toUpperCase() === adtType);
}

/** 从搜索结果 URI 推导对象 URL（剥离可能附带的 /source/main 后缀）。 */
function objectUrlFromUri(uri: string): string {
  return uri.split('#')[0].replace(/\/source\/main\/?$/i, '');
}

/**
 * 源包含段 → 固定模板源 URL。
 *
 * 刻意不经过 objectStructure 解析：部分系统（sap-dev 真机实证）对刚建壳的
 * OO 对象 GET structure 直接报 "wrong input data for processing"（inactive/
 * active 版本参数同报），而 ADT 的源 URL 模板跨系统稳定——main 为
 * `{objectUrl}/source/main`，CLAS 类包含为 `{objectUrl}/includes/{includeType}`。
 * URL 全部由本工作流从规范化 objectUrl 推导，不接受服务端回传形态。
 */
function fixedPartSourceUrl(objectType: ImportObjectType, objectUrl: string, part: ImportSourcePart): string {
  const base = objectUrl.replace(/\/+$/, '');
  if (objectType === 'CLAS' && part !== 'main') {
    return `${base}/includes/${PART_TO_INCLUDE_TYPE[part]}`;
  }
  return `${base}/source/main`;
}

/**
 * 带有限重试的源读取：部分系统（sap-dev 真机实证）对新建壳的 source GET
 * **间歇性**报 "wrong input data for processing"（同一 URL 稍后重读即成功），
 * 2 次退避重试吸收该抖动；其他错误原样上抛不重试。
 */
async function readSourceWithRetry(
  client: RepositoryImportAdtClient,
  url: string,
  version: 'active' | 'inactive' | 'workingArea',
  attempts = 3
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await client.getObjectSource(url, { version });
    } catch (error) {
      lastError = error;
      if (!/wrong input data/i.test(errorMessage(error))) throw error;
      await new Promise(resolve => setTimeout(resolve, 750 * attempt));
    }
  }
  throw lastError;
}

/**
 * 受控对象导入工作流。
 * deps.client 必须绑定写域 stateful 主会话（锁链是 stateful 专属）；调用方
 * （接线层）负责 DEV 角色 + development/development-workbench 的目录门控。
 */
export class RepositoryObjectImportWorkflow {
  private readonly plans = new Map<string, ImportPlanInternal>();

  constructor(
    private readonly deps: {
      client: RepositoryImportAdtClient
      policy: SafetyPolicy
      audit: RepositoryImportAuditSink
      now?: () => number
    },
    private readonly ttlMs: number = DEFAULT_TTL_MS
  ) {}

  private context(): ImportContext {
    return {
      systemHost: this.deps.policy.systemHost,
      client: this.deps.policy.client,
      sapUser: this.deps.policy.sapUser,
      systemRole: this.deps.policy.systemRole,
      toolProfile: this.deps.policy.toolProfile
    };
  }

  /** preview：只读预检（解析 ZIP + 逐对象存在性/漂移基线）并冻结 immutable plan。 */
  async preview(input: RepositoryImportInput): Promise<Record<string, unknown>> {
    // 双保险角色/profile 门（dispatch 层 assertToolOperationAllowed 已先行把关）
    if (this.deps.policy.systemRole !== 'DEV'
      || !['development', 'development-workbench'].includes(this.deps.policy.toolProfile)) {
      throw new SafeAbapError('POLICY_DENIED', 'PREVIEW', 'Repository import requires an approved DEV development profile.');
    }
    // ── 包模式判定（2026-10-09 真机因素矩阵）：transportable=全型（CLAS/PROG，
    // INTF 系统修复前仍跳过）；local-package=仅 PROG（$ 本地包 OO 激活损坏）。
    const packageName = String(input?.packageName ?? '').trim().toUpperCase();
    const transportRequest = String(input?.transportRequest ?? '').trim().toUpperCase();
    const isLocalMode = transportRequest === '';
    if (isLocalMode) {
      if (!LOCAL_PACKAGE_PATTERN.test(packageName)) {
        throw new SafeAbapError('VALIDATION_FAILED', 'PREVIEW',
          `packageName "${packageName}" must be an existing local package ($ prefix) when transportRequest is omitted.`);
      }
    } else {
      if (!/^(?:\/[A-Z0-9_]+\/)?[A-Z][A-Z0-9_]{0,29}$/.test(packageName)) {
        throw new SafeAbapError('VALIDATION_FAILED', 'PREVIEW',
          `packageName "${packageName}" is not a valid ABAP repository name.`);
      }
      if (LOCAL_PACKAGE_PATTERN.test(packageName)) {
        throw new SafeAbapError('VALIDATION_FAILED', 'PREVIEW',
          'transportable mode (transportRequest given) does not accept $ local packages; omit transportRequest for PROG-only local imports.');
      }
      if (!/^[A-Z0-9]{3,10}$/.test(transportRequest)) {
        throw new SafeAbapError('VALIDATION_FAILED', 'PREVIEW', `transportRequest "${transportRequest}" is not a valid transport number.`);
      }
    }
    const importMode: 'transportable' | 'local-package' = isLocalMode ? 'local-package' : 'transportable';
    // 本地包模式不做命名空间断言——$ 前缀本身已是最强的"本地包"约束；transportable
    // 模式包名为普通仓库名，走对象名同款逐个断言（下方 assertMutationAllowed）。

    // ── ZIP 来源：zipBase64 / zipPath 二选一 ─────────────────────────────
    const hasInline = typeof input.zipBase64 === 'string' && input.zipBase64.trim() !== '';
    const hasPath = typeof input.zipPath === 'string' && input.zipPath.trim() !== '';
    if (hasInline === hasPath) {
      throw new SafeAbapError('VALIDATION_FAILED', 'PREVIEW', 'Provide exactly one of zipBase64 or zipPath.');
    }
    let zipBytes: Buffer;
    let sourceKind: 'zipBase64' | 'zipPath';
    if (hasInline) {
      sourceKind = 'zipBase64';
      const compact = String(input.zipBase64).replace(/\s+/g, '');
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
        throw new SafeAbapError('VALIDATION_FAILED', 'PREVIEW', 'zipBase64 is not valid base64.');
      }
      zipBytes = Buffer.from(compact, 'base64');
    } else {
      sourceKind = 'zipPath';
      const zipPath = String(input.zipPath).trim();
      if (zipPath.length > 1024 || /[\u0000-\u001f\u007f]/.test(zipPath)
        || !(zipPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(zipPath))) {
        throw new SafeAbapError('VALIDATION_FAILED', 'PREVIEW', 'zipPath must be an absolute local path without control characters.');
      }
      // 服务端进程本地读取（MCP server 与用户同机；VSP ImportFromFile 同语义）
      const { readFileSync } = await import('node:fs');
      zipBytes = readFileSync(zipPath);
    }
    if (zipBytes.length === 0 || zipBytes.length > MAX_ZIP_BYTES) {
      throw new SafeAbapError('VALIDATION_FAILED', 'PREVIEW',
        `ZIP size must be between 1 byte and ${MAX_ZIP_BYTES} bytes (got ${zipBytes.length}).`);
    }

    // ── 解析（离线三件套）+ 过滤 ─────────────────────────────────────────
    let entries;
    try {
      entries = readZipTextEntries(zipBytes);
    } catch (error) {
      if (error instanceof ZipParseError) {
        throw new SafeAbapError('VALIDATION_FAILED', 'PREVIEW', `ZIP is not a readable abapGit package: ${error.message}`);
      }
      throw error;
    }
    const parsed = parseAbapGitOfflineEntries(entries);
    const nameFilter = input.nameFilter === undefined || String(input.nameFilter).trim() === ''
      ? undefined : String(input.nameFilter).trim();
    if (nameFilter !== undefined && (nameFilter.length > 64 || /[\u0000-\u001f\u007f]/.test(nameFilter))) {
      throw new SafeAbapError('VALIDATION_FAILED', 'PREVIEW', 'nameFilter must be at most 64 characters without control characters.');
    }
    const typeFilter = input.typeFilter === undefined ? undefined
      : [...new Set((Array.isArray(input.typeFilter) ? input.typeFilter : []).map(item => String(item).trim().toUpperCase()))];
    if (typeFilter !== undefined && typeFilter.some(item => !EXECUTABLE_TYPES.includes(item as ImportObjectType))) {
      throw new SafeAbapError('VALIDATION_FAILED', 'PREVIEW', `typeFilter accepts only ${EXECUTABLE_TYPES.join(', ')}.`);
    }
    const filteredObjects = parsed.objects.filter(object =>
      (!typeFilter || typeFilter.includes(object.type))
      && (!nameFilter || object.name.toUpperCase().includes(nameFilter.toUpperCase())));
    // 部署计划构建（强制 $ 本地包 + 静态弱序：包→接口→类→程序→函数组）
    const deployment = buildDeploymentPlan(
      { ...parsed, objects: filteredObjects },
      packageName
    );

    // ── 逐动作分类：执行面 / 显式跳过 / 拒绝 ─────────────────────────────
    const skips: ImportSkipEntry[] = deployment.skips.map(skip => ({
      objectType: skip.objectType,
      objectName: skip.objectName,
      reason: skip.reason
    }));
    const candidates: ImportObjectInternal[] = [];
    const rejected: string[] = [];
    for (const action of deployment.actions) {
      if (action.objectType === 'DEVC') {
        skips.push({ objectType: 'DEVC', objectName: action.objectName, reason: 'package definitions are not created by import; the target package must already exist' });
        continue;
      }
      if (action.objectType === 'FUGR') {
        skips.push({ objectType: 'FUGR', objectName: action.objectName, reason: 'function group deployment requires function-module level operations (out of controlled import v1 scope)' });
        continue;
      }
      if (action.objectType === 'INTF') {
        // 接口池生成路径在当前验证系统上独立损坏（ADT 新建/修改激活全灭，
        // 2026-10-09 因素矩阵）；GUI 新建+激活仍可用。系统修复后移除此跳过。
        skips.push({ objectType: 'INTF', objectName: action.objectName, reason: 'INTF activation via ADT is currently broken on the target systems (interface-pool generator); create/update it via SAP GUI and retry after the system fix' });
        continue;
      }
      if (action.objectType === 'CLAS' && isLocalMode) {
        skips.push({ objectType: 'CLAS', objectName: action.objectName, reason: 'local-package OO activation is currently broken (A class already exists); CLAS requires transportable mode (pass transportRequest)' });
        continue;
      }
      if (action.sources.length === 0) {
        skips.push({ objectType: action.objectType, objectName: action.objectName, reason: 'no source files in the package (metadata only)' });
        continue;
      }
      const objectType = action.objectType as ImportObjectType;
      // testclasses include 的激活/生成在当前验证系统上损坏（写入后类池生成
      // 报"无 PUBLIC SECTION"，与写序无关——2026-10-09 双系统真机实证）：
      // 测试类部件拆出进 skips，main 先行部署；系统修复后移除此拆分。
      const testParts = action.sources.filter(source => source.part === 'testclasses');
      const execSources = action.sources.filter(source => source.part !== 'testclasses');
      for (const test of testParts) {
        skips.push({
          objectType: action.objectType,
          objectName: `${action.objectName}|testclasses`,
          reason: 'testclasses include activation is currently broken on the target systems (class-pool generator); the main source deploys without it'
        });
      }
      if (execSources.length === 0) {
        skips.push({ objectType: action.objectType, objectName: action.objectName, reason: 'only testclasses in the package and their activation is currently broken (see skip detail)' });
        continue;
      }
      const offending = execSources.map(source => source.part)
        .filter(part => !ALLOWED_PARTS[objectType].includes(part as ImportSourcePart));
      if (offending.length > 0) {
        rejected.push(`${objectType} ${action.objectName} (${offending.join(', ')})`);
        continue;
      }
      // 对象名必须过命名空间白名单（防 ZIP 内夹带白名单外对象名）
      this.deps.policy.assertMutationAllowed(action.objectName);
      candidates.push({
        objectType,
        objectName: action.objectName,
        description: action.description.slice(0, 120),
        action: 'create',
        objectUrl: canonicalObjectUrl(objectType, action.objectName),
        parts: execSources.map(source => ({
          part: source.part as ImportSourcePart,
          text: source.text,
          sha256: sourceHash(source.text),
          bytes: Buffer.byteLength(source.text, 'utf8')
        })),
        baselineHashes: {}
      });
    }
    if (rejected.length > 0) {
      throw new SafeAbapError('VALIDATION_FAILED', 'PREVIEW',
        `Object types carry source parts outside the import scope: ${rejected.join('; ')}.`);
    }
    if (candidates.length === 0) {
      const hint = isLocalMode
        ? ' Local-package mode is PROG-only; pass transportRequest for CLAS imports.'
        : '';
      throw new SafeAbapError('VALIDATION_FAILED', 'PREVIEW', `The package contains no importable objects for this mode.${hint}`);
    }
    if (candidates.length > MAX_IMPORT_OBJECTS) {
      throw new SafeAbapError('VALIDATION_FAILED', 'PREVIEW',
        `The package contains ${candidates.length} importable objects; the limit is ${MAX_IMPORT_OBJECTS}. Use filters to split the import.`);
    }

    // ── 目标包存在性 + 建壳身份（存在 create 候选时必须可得） ────────────
    const packageMatches = await this.deps.client.searchObject(packageName, 'DEVC/K', 10);
    if (!exactMatch(packageMatches, packageName, 'DEVC/K')) {
      throw new SafeAbapError('OBJECT_NOT_FOUND', 'PREVIEW', `Package ${packageName} does not exist; import does not create packages.`);
    }
    // transportable 模式：传输可用性校验（存在、未释放、可挂目标包）。
    if (!isLocalMode) {
      const packageUrl = String(exactMatch(packageMatches, packageName, 'DEVC/K')?.['adtcore:uri'] || '');
      let transportInfo: TransportInfo;
      let transportDetails: TransportRequest;
      try {
        [transportInfo, transportDetails] = await Promise.all([
          this.deps.client.transportInfo(packageUrl, packageName, 'I'),
          this.deps.client.transportDetails(transportRequest)
        ]);
      } catch (error) {
        // 底层查询失败（传输不存在/无权限等）转可读错误，不吞进 InternalError
        throw new SafeAbapError('TRANSPORT_INVALID', 'PREVIEW',
          `Transport ${transportRequest} could not be validated: ${errorMessage(error)}`);
      }
      assertTransportAvailable(transportInfo, transportDetails, transportRequest);
    }
    // 建壳身份（language/masterSystem/responsible）仅在有 create 候选时必需；
    // 全 update 场景不建壳，身份可缺省。
    let identityFrozen: { language: string; masterLanguage: string; masterSystem: string; responsible: string } | undefined;
    if (candidates.some(candidate => candidate.action === 'create')) {
      const metadata = await this.deps.client.readControlledPackage(packageName);
      const language = String(metadata.language || metadata.masterLanguage || '').trim();
      const masterLanguage = String(metadata.masterLanguage || metadata.language || '').trim();
      // 本地包不存储 adtcore:masterSystem（无跨系统语义，系统读回时丢弃该
      // 属性——真机实证）；系统对象自身的存储值即字面 "SAP"（与受控创建链
      // sameControlledMasterSystem 的 'SAP' 特判一致），故缺失时回退 "SAP"。
      const masterSystem = String(metadata.masterSystem || '').trim() || 'SAP';
      const responsible = controlledResponsible(metadata.responsible, this.deps.policy.sapUser);
      if (!language || !masterLanguage || !responsible) {
        throw new SafeAbapError('VALIDATION_FAILED', 'PREVIEW',
          `Package ${packageName} did not expose the identity metadata (language/responsible) required for shell creation.`);
      }
      identityFrozen = { language, masterLanguage, masterSystem, responsible };
    }

    // ── 逐对象存在性 + 既有对象逐包含 active 源 hash（漂移基线） ─────────
    for (const candidate of candidates) {
      const matches = await this.deps.client.searchObject(candidate.objectName, SEARCH_TYPE[candidate.objectType], 10);
      const existing = exactMatch(matches, candidate.objectName, SEARCH_TYPE[candidate.objectType]);
      if (!existing) continue;
      candidate.action = 'update';
      candidate.objectUrl = objectUrlFromUri(String(existing['adtcore:uri'] || '')) || candidate.objectUrl;
      for (const part of candidate.parts) {
        const sourceUrl = fixedPartSourceUrl(candidate.objectType, candidate.objectUrl, part.part);
        let current: string;
        try {
          current = await readSourceWithRetry(this.deps.client, sourceUrl, 'active');
        } catch (error) {
          throw new SafeAbapError('VALIDATION_FAILED', 'PREVIEW',
            `Existing ${candidate.objectType} ${candidate.objectName} part ${part.part} could not be read for baselining: ${errorMessage(error)}`);
        }
        candidate.baselineHashes[part.part] = sourceHash(current);
      }
    }

    // ── 冻结 plan ────────────────────────────────────────────────────────
    const now = this.deps.now?.() ?? Date.now();
    const fingerprint = {
      packageName, importMode, transportRequest, sourceKind, zipSha256: sha256Hex(zipBytes), filters: { nameFilter, typeFilter },
      objects: candidates.map(candidate => ({
        objectType: candidate.objectType, objectName: candidate.objectName, action: candidate.action,
        parts: candidate.parts.map(part => ({ part: part.part, sha256: part.sha256 }))
      }))
    };
    const plan: ImportPlanInternal = {
      importPlanId: globalThis.crypto.randomUUID(),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
      status: 'PREVIEWED',
      ...this.context(),
      packageName,
      mode: importMode,
      ...(isLocalMode ? {} : { transportRequest }),
      source: {
        kind: sourceKind,
        ...(sourceKind === 'zipPath' ? { zipPath: String(input.zipPath).trim() } : {}),
        zipSha256: sha256Hex(zipBytes),
        zipBytes: zipBytes.length
      },
      filters: { ...(nameFilter !== undefined ? { nameFilter } : {}), ...(typeFilter !== undefined ? { typeFilter } : {}) },
      ...(identityFrozen ? { identity: identityFrozen } : {}),
      objects: candidates,
      skips,
      counts: deployment.counts,
      notes: [...deployment.notes],
      payloadHash: sha256Hex(fingerprint),
      stages: [],
      expiresAtMs: now + this.ttlMs,
      context: this.context()
    };
    this.plans.set(plan.importPlanId, plan);
    await this.deps.audit.append(this.auditEvent(plan, 'REPO_IMPORT_PREVIEW_CREATED', true));
    return {
      status: 'preview',
      plan: this.publicView(plan),
      confirmationRequired: true,
      summary: `Import ${plan.objects.length} object(s) into ${packageName}: `
        + `${plan.objects.filter(item => item.action === 'create').length} create, `
        + `${plan.objects.filter(item => item.action === 'update').length} update, ${plan.skips.length} skip(s).`
    };
  }

  /** apply：原生确认后单次执行（逐对象漂移复核 → 建/改 → 锁链 → 激活 → readback）。 */
  async applyConfirmed(importPlanId: string): Promise<Record<string, unknown>> {
    const context = this.context();
    const plan = this.plans.get(importPlanId);
    if (!plan) throw new SafeAbapError('PLAN_NOT_FOUND', 'import-plan', 'Repository import plan does not exist.');
    if (plan.context.systemHost !== context.systemHost || plan.context.client !== context.client
      || plan.context.sapUser !== context.sapUser || plan.context.systemRole !== context.systemRole
      || plan.context.toolProfile !== context.toolProfile) {
      throw new SafeAbapError('POLICY_DENIED', 'import-plan', 'Plan belongs to a different SAP context.');
    }
    if (plan.status === 'PREVIEWED' && plan.expiresAtMs <= (this.deps.now?.() ?? Date.now())) {
      plan.status = 'EXPIRED';
    }
    if (plan.status === 'EXPIRED') {
      throw new SafeAbapError('PLAN_EXPIRED', 'import-plan', 'Repository import plan has expired.');
    }
    if (plan.status !== 'PREVIEWED') {
      throw new SafeAbapError('PLAN_ALREADY_CONSUMED', 'import-plan', `Repository import plan is already ${plan.status.toLowerCase()}.`);
    }
    plan.status = 'APPLYING';

    const outcomes: ImportOutcomeEntry[] = plan.objects.map(entry => ({
      objectType: entry.objectType, objectName: entry.objectName, action: entry.action, result: 'NOT_ATTEMPTED'
    }));
    const record = (stage: string, success: boolean, message?: string) => {
      plan.stages.push({ stage, success, timestamp: new Date(this.deps.now?.() ?? Date.now()).toISOString(), ...(message ? { message } : {}) });
    };
    record('APPLY_STARTED', true, `${plan.objects.length} object(s) into ${plan.packageName}`);

    for (let index = 0; index < plan.objects.length; index += 1) {
      const entry = plan.objects[index];
      try {
        // 漂移复核（写未发出前的安全失败点）：存在性必须与 preview 一致；
        // update 对象逐包含 active 源 hash 必须与基线一致。
        await this.revalidateBaseline(entry);
        record(`DRIFT_RECHECKED:${entry.objectType} ${entry.objectName}`, true);
        await this.deployObject(plan, entry);
        outcomes[index] = { ...outcomes[index], result: 'APPLIED' };
        record(`APPLIED:${entry.objectType} ${entry.objectName}`, true);
      } catch (error) {
        if (error instanceof RepositoryImportOutcomeUnknownError) {
          outcomes[index] = { ...outcomes[index], result: 'UNKNOWN', error: errorMessage(error) };
          record(`UNKNOWN:${entry.objectType} ${entry.objectName}`, false, errorMessage(error));
          const view = this.settle(plan, 'OUTCOME_UNKNOWN', {
            outcomes,
            primaryError: { code: 'UNKNOWN_OUTCOME', stage: 'apply', message: errorMessage(error) }
          });
          await this.auditSafe(plan, 'REPO_IMPORT_UNKNOWN', false, { unknownOutcome: true, errorSummary: errorMessage(error) });
          throw new SafeAbapError('UNKNOWN_OUTCOME', 'APPLY',
            'The import outcome is unknown for the current object; no retry or deletion was attempted. Inspect the target state with read-only tools.',
            { plan: view });
        }
        outcomes[index] = { ...outcomes[index], result: 'FAILED', error: errorMessage(error) };
        record(`FAILED:${entry.objectType} ${entry.objectName}`, false, errorMessage(error));
        const code = error instanceof SafeAbapError ? error.code : 'REMOTE_WRITE_FAILED';
        const view = this.settle(plan, 'FAILED', {
          outcomes,
          primaryError: { code, stage: 'apply', message: `${entry.objectType} ${entry.objectName}: ${errorMessage(error)}` }
        });
        await this.auditSafe(plan, 'REPO_IMPORT_FAILED', false, { errorSummary: `${entry.objectName}: ${errorMessage(error)}` });
        if (error instanceof SafeAbapError) throw new SafeAbapError(error.code, error.stage, error.message, { plan: view });
        throw new SafeAbapError('REMOTE_WRITE_FAILED', 'APPLY', `${entry.objectType} ${entry.objectName}: ${errorMessage(error)}`, { plan: view });
      }
    }

    const view = this.settle(plan, 'APPLIED', {
      outcomes,
      resultSummary: `Imported ${plan.objects.length} object(s) into ${plan.packageName}.`
    });
    await this.auditSafe(plan, 'REPO_IMPORT_COMPLETED', true);
    return { status: 'success', plan: view, applied: plan.objects.length };
  }

  /** 本地状态查询（不触 SAP）。 */
  status(importPlanId: string): RepositoryObjectImportPlanView {
    const plan = this.plans.get(importPlanId);
    if (!plan) throw new SafeAbapError('PLAN_NOT_FOUND', 'import-plan', 'Repository import plan does not exist.');
    return this.publicView(plan);
  }

  /** 单对象漂移复核：存在性翻转或任一包含内容变化 → STATE_DRIFT（写未发出）。 */
  private async revalidateBaseline(entry: ImportObjectInternal): Promise<void> {
    const matches = await this.deps.client.searchObject(entry.objectName, SEARCH_TYPE[entry.objectType], 10);
    const existing = exactMatch(matches, entry.objectName, SEARCH_TYPE[entry.objectType]);
    if (entry.action === 'create' && existing) {
      throw new SafeAbapError('STATE_DRIFT', 'APPLY',
        `${entry.objectType} ${entry.objectName} was absent at preview but exists now.`);
    }
    if (entry.action === 'update' && !existing) {
      throw new SafeAbapError('STATE_DRIFT', 'APPLY',
        `${entry.objectType} ${entry.objectName} existed at preview but is gone now.`);
    }
    if (entry.action !== 'update') return;
    const currentUrl = objectUrlFromUri(String(existing!['adtcore:uri'] || '')) || entry.objectUrl;
    for (const part of entry.parts) {
      if (entry.baselineHashes[part.part] === undefined) {
        throw new SafeAbapError('STATE_DRIFT', 'APPLY',
          `${entry.objectType} ${entry.objectName} no longer exposes source for part ${part.part} as baselined at preview.`);
      }
      const sourceUrl = fixedPartSourceUrl(entry.objectType, currentUrl, part.part);
      let current: string;
      try {
        current = await readSourceWithRetry(this.deps.client, sourceUrl, 'active');
      } catch (error) {
        throw new SafeAbapError('STATE_DRIFT', 'APPLY',
          `${entry.objectType} ${entry.objectName} no longer exposes source for part ${part.part} as baselined at preview.`);
      }
      if (sourceHash(current) !== entry.baselineHashes[part.part]) {
        throw new SafeAbapError('STATE_DRIFT', 'APPLY',
          `${entry.objectType} ${entry.objectName} part ${part.part} changed since preview.`);
      }
    }
  }

  /**
   * 单对象部署：create 先建壳（quick search 精确匹配证明存在），update 复用
   * 既有对象；随后 锁 → 逐包含写（固定模板 URL）→ 解锁 → 激活 → readback
   * 逐包含比对。建/写/解锁/激活四类调用失败按 UNKNOWN 包装；其余失败为
   * 确定性失败。
   */
  private async deployObject(plan: ImportPlanInternal, entry: ImportObjectInternal): Promise<void> {
    if (entry.action === 'create') {
      if (!plan.identity) {
        throw new SafeAbapError('VALIDATION_FAILED', 'APPLY', `Shell identity metadata is missing for ${entry.objectName}.`);
      }
      try {
        await this.deps.client.createImportShell({
          objectType: entry.objectType,
          name: entry.objectName,
          description: entry.description,
          packageName: plan.packageName,
          language: plan.identity.language,
          masterLanguage: plan.identity.masterLanguage,
          masterSystem: plan.identity.masterSystem,
          responsible: plan.identity.responsible,
          transport: plan.transportRequest ?? ''
        });
      } catch (error) {
        throw new RepositoryImportOutcomeUnknownError(`shell create outcome is unknown: ${errorMessage(error)}`);
      }
      // 壳存在性证明：quick search 精确匹配（不用 objectStructure——部分系统
      // 对新建壳的 structure GET 直接报 "wrong input data"，sap-dev 真机实证；
      // searchObject 对已存在对象恒可用）
      const shellMatches = await this.deps.client.searchObject(entry.objectName, SEARCH_TYPE[entry.objectType], 10);
      const shell = exactMatch(shellMatches, entry.objectName, SEARCH_TYPE[entry.objectType]);
      if (!shell) {
        throw new RepositoryImportOutcomeUnknownError(
          `shell existence proof outcome is unknown: search did not return ${entry.objectName} after creation`);
      }
      const shellUrl = objectUrlFromUri(String(shell['adtcore:uri'] || '')) || entry.objectUrl;
      if (shellUrl.replace(/\/+$/, '') !== entry.objectUrl.replace(/\/+$/, '')) {
        throw new SafeAbapError('OBJECT_CREATION_FAILED', 'APPLY',
          `Shell URL for ${entry.objectName} does not match the plan (${shellUrl}).`);
      }
    }

    // 源 URL 全部由固定模板从规范化 objectUrl 推导（见 fixedPartSourceUrl 注释）
    const partUrls: Array<{ part: ImportSourcePart; url: string; text: string }> = entry.parts.map(part => ({
      part: part.part,
      url: fixedPartSourceUrl(entry.objectType, entry.objectUrl, part.part),
      text: part.text ?? ''
    }));

    const lock = await this.deps.client.lock(entry.objectUrl, 'MODIFY');
    const lockHandle = String((lock as { LOCK_HANDLE?: string; lockHandle?: string }).LOCK_HANDLE
      ?? (lock as { lockHandle?: string }).lockHandle ?? '');
    if (!lockHandle) throw new SafeAbapError('LOCK_FAILED', 'APPLY', `Lock for ${entry.objectName} returned no handle.`);
    let operationError: unknown;
    try {
      for (const part of partUrls) {
        // 部分系统 POST 建壳后骨架生成异步完成，会覆盖紧随其后的 PUT（真机
        // 实证：PUT 成功返回但激活读到骨架，报"无 PUBLIC SECTION"）。带落地
        // 校验的重写循环吸收该时序竞争；PUT 本身幂等，重写安全。
        let landed = false;
        for (let attempt = 1; attempt <= 3 && !landed; attempt += 1) {
          try {
            // transportable 模式 PUT 带传输号（对象登记进传输；本地包为空串）
            await this.deps.client.setObjectSource(part.url, part.text, lockHandle, plan.transportRequest ?? undefined);
          } catch (error) {
            throw new RepositoryImportOutcomeUnknownError(`source write (${part.part}) outcome is unknown: ${errorMessage(error)}`);
          }
          try {
            const written = await readSourceWithRetry(this.deps.client, part.url, 'inactive');
            landed = compareSources(part.text, written).matches;
          } catch {
            landed = false;
          }
          if (!landed && attempt < 3) await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (!landed) {
          throw new RepositoryImportOutcomeUnknownError(
            `source write (${part.part}) did not land after retries — the system kept regenerating the shell source`);
        }
      }
      // 不做激活前 syntaxCheck：abapCheckRun 对"已建壳未激活"的本地对象会把
      // 对象自身注册误报为同名冲突（sap-demo 真机实证，active/inactive 版本
      // 参数同报）；编译正确性由激活步保证（激活即完整编译，E/A 消息经
      // assertActivation 暴露，语义同 executeAbap 的"激活失败不进入下一步"）。
    } catch (error) {
      operationError = error;
    }
    try {
      await this.deps.client.unLock(entry.objectUrl, lockHandle);
    } catch (unlockError) {
      // 保留更早的 unknown 为主要结果；否则未知解锁自身阻断激活与后续判断
      if (operationError instanceof RepositoryImportOutcomeUnknownError) throw operationError;
      throw new RepositoryImportOutcomeUnknownError(`unlock outcome is unknown: ${errorMessage(unlockError)}`);
    }
    if (operationError) throw operationError;

    try {
      // preauditRequested=true：受控创建链/VSP 同款激活形态。objectReference
      // 必须带 adtcore:type 与 adtcore:parentUri（父=目标包）——字符串简写
      // body 缺这两字段时激活器无法定位非活动版本（双系统真机实证）。
      const activation = await this.deps.client.activate({
        'adtcore:uri': entry.objectUrl,
        'adtcore:type': SEARCH_TYPE[entry.objectType],
        'adtcore:name': entry.objectName,
        'adtcore:parentUri': `/sap/bc/adt/packages/${plan.packageName.toLowerCase()}`
      }, true);
      assertActivation(activation, 'ACTIVATE_OBJECT');
    } catch (error) {
      if (error instanceof SafeAbapError && error.code === 'ACTIVATION_FAILED') throw error;
      throw new RepositoryImportOutcomeUnknownError(`activation outcome is unknown: ${errorMessage(error)}`);
    }

    // readback：激活后逐包含与包内源码比对（固定模板 URL；CLAS 主源用类规范化比对）
    for (const part of partUrls) {
      let actual: string;
      try {
        actual = await readSourceWithRetry(this.deps.client, part.url, 'workingArea');
      } catch (error) {
        throw new SafeAbapError('VERIFICATION_FAILED', 'readback',
          `${entry.objectType} ${entry.objectName} does not expose source for part ${part.part} after activation: ${errorMessage(error)}`);
      }
      const comparison = entry.objectType === 'CLAS' && part.part === 'main'
        ? compareAbapClassSources(part.text, actual)
        : compareSources(part.text, actual);
      if (!comparison.matches) {
        throw new SafeAbapError('SOURCE_VERIFY_FAILED', 'readback',
          `Activated source for ${entry.objectType} ${entry.objectName} part ${part.part} does not match the confirmed plan (${comparison.matchType}).`);
      }
    }
  }

  /** 终结 plan：剥离源码全文（保 hash/字节数），返回对外视图。 */
  private settle(
    plan: ImportPlanInternal,
    status: Exclude<RepositoryImportPlanStatus, 'PREVIEWED' | 'APPLYING' | 'EXPIRED'>,
    update: { outcomes?: ImportOutcomeEntry[]; resultSummary?: string; primaryError?: RepositoryObjectImportPlanView['primaryError'] }
  ): RepositoryObjectImportPlanView {
    plan.status = status;
    if (update.outcomes) plan.outcomes = update.outcomes;
    if (update.resultSummary) plan.resultSummary = update.resultSummary;
    if (update.primaryError) plan.primaryError = update.primaryError;
    // 终结后源码全文不再需要：剥离 text 释放内存（保留 hash 供追溯）
    for (const entry of plan.objects) {
      for (const part of entry.parts) part.text = undefined;
    }
    return this.publicView(plan);
  }

  private async auditSafe(plan: ImportPlanInternal, eventType: string, success: boolean, extra?: Partial<AuditEvent>): Promise<void> {
    try {
      await this.deps.audit.append(this.auditEvent(plan, eventType, success, extra));
    } catch { /* 审计失败不掩盖主错误 */ }
  }

  private auditEvent(plan: ImportPlanInternal, eventType: string, success: boolean, extra?: Partial<AuditEvent>): AuditEvent {
    return {
      correlationId: plan.importPlanId,
      eventType,
      systemHost: plan.context.systemHost,
      client: plan.context.client,
      systemRole: plan.context.systemRole,
      resultSummary: `import into ${plan.packageName}: ${plan.status} (${plan.objects.length} objects)`,
      success,
      ...extra
    } as AuditEvent;
  }

  private publicView(plan: ImportPlanInternal): RepositoryObjectImportPlanView {
    const { importPlanId, createdAt, expiresAt, status, systemHost, client, systemRole, toolProfile,
      packageName, mode, transportRequest, source, filters, identity, skips, counts, notes, payloadHash, stages, outcomes,
      resultSummary, primaryError } = plan;
    return {
      importPlanId, createdAt, expiresAt, status, systemHost, client, systemRole, toolProfile,
      packageName, mode, source, filters, skips, counts, notes, payloadHash, stages,
      ...(transportRequest ? { transportRequest } : {}),
      ...(identity ? { identity } : {}),
      objects: plan.objects.map(entry => ({
        objectType: entry.objectType,
        objectName: entry.objectName,
        description: entry.description,
        action: entry.action,
        objectUrl: entry.objectUrl,
        parts: entry.parts.map(part => ({ part: part.part, sha256: part.sha256, bytes: part.bytes }))
      })),
      ...(outcomes ? { outcomes } : {}),
      ...(resultSummary !== undefined ? { resultSummary } : {}),
      ...(primaryError !== undefined ? { primaryError } : {})
    };
  }
}

// 导出建壳工厂绑定（接线层用 httpClient 组装窄客户端时复用）
export { createImportObjectShell };
