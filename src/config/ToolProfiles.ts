import type { ToolDefinition } from '../types/tools.js';
import type { ToolProfile } from '../safe/types.js';
import { isRawAdvancedMutationTool, isToolAllowedForSystemRole } from './ToolOperationPolicy.js';
import { filterToolsForBasisRelease } from './SapReleaseCapability.js';

export const READ_ONLY_LEGACY_TOOL_NAMES = new Set([
  'transportInfo', 'hasTransportConfig', 'transportConfigurations', 'getTransportConfiguration',
  'userTransports', 'transportsByConfig', 'systemUsers', 'transportReference',
  'objectStructure', 'searchObject', 'findObjectPath', 'objectTypes', 'classIncludes', 'classComponents',
  'syntaxCheckCode', 'syntaxCheckCdsUrl', 'codeCompletion', 'findDefinition', 'usageReferences',
  'syntaxCheckTypes', 'codeCompletionFull', 'codeCompletionElement', 'usageReferenceSnippets',
  'fixProposals', 'fragmentMappings', 'abapDocumentation',
  'getObjectSource', 'inactiveObjects', 'objectRegistrationInfo', 'validateNewObject', 'nodeContents', 'mainPrograms',
  'featureDetails', 'collectionFeatureDetails', 'findCollectionByUrl', 'loadTypes', 'adtDiscovery',
  'adtCoreDiscovery', 'adtCompatibiliyGraph', 'unitTestEvaluation', 'unitTestOccurrenceMarkers',
  'prettyPrinterSetting', 'prettyPrinter', 'gitRepos', 'gitExternalRepoInfo', 'checkRepo', 'remoteRepoInfo',
  'ddicElement', 'ddicRepositoryAccess', 'annotationDefinitions', 'packageSearchHelp', 'bindingDetails',
  'tableContents', 'runQuery', 'feeds', 'dumps', 'debuggerListeners', 'debuggerStackTrace',
  'debuggerVariables', 'debuggerChildVariables', 'atcCustomizing', 'atcCheckVariant',
  'atcWorklists', 'atcUsers', 'isProposalMessage', 'atcContactUri', 'tracesList', 'tracesListRequests',
  'tracesHitList', 'tracesDbAccess', 'tracesStatements', 'renameEvaluate', 'renamePreview',
  'extractMethodEvaluate', 'extractMethodPreview', 'revisions', 'healthcheck',
  'objectStructureElements', 'typeHierarchy', 'objectEnhancements',
  'getDomainProperties', 'getDataElementProperties', 'getTextElements', 'atcDocumentation',
  'changePackagePreview', 'rapGenValidateInitial', 'rapGenGetSchema', 'rapGenGetContent',
  'rapGenGetUiConfig', 'rapGenValidateContent', 'rapGenPreview', 'rapGenIsAvailable',
]);

export const READ_ONLY_LEGACY_TOOL_COUNT = READ_ONLY_LEGACY_TOOL_NAMES.size;

export const DEVELOPMENT_WORKBENCH_TOOL_NAMES = new Set([
  'sap', 'sapDoctor',
  'inspectAbapObject', 'previewAbapChange', 'applyAbapChange', 'getAbapChangeStatus',
  'previewAbapObjectCreation', 'applyAbapObjectCreation', 'getAbapObjectCreationStatus',
  'previewRepositoryObjectCleanup', 'applyRepositoryObjectCleanup', 'getRepositoryObjectCleanupStatus',
  'previewDebugOperation', 'applyDebugOperation', 'authorizeDebugSession', 'executeDebugCommand',
  'getDebugOperationStatus', 'revokeDebugSession', 'previewDebugVariableChange', 'applyDebugVariableChange',
  'previewDdicPropertyChange', 'applyDdicPropertyChange', 'previewPackageChange', 'applyPackageChange',
  'previewRapOperation', 'applyRapOperation',
  'readRuntimeDumps', 'describeClassicTable', 'inspectSapSystem', 'getAbapMemberSource',
  'sm21Read', 'analyzeRuntimeErrors', 'healthcheck',
  'transportInfo', 'objectStructure', 'objectStructureElements', 'searchObject', 'findObjectPath',
  'objectTypes', 'classIncludes', 'classComponents', 'syntaxCheckCode', 'syntaxCheckCdsUrl',
  'findDefinition', 'usageReferences', 'usageReferenceSnippets', 'fragmentMappings', 'typeHierarchy',
  'unitTestEvaluation',
  'objectEnhancements', 'getObjectSource', 'inactiveObjects', 'mainPrograms', 'annotationDefinitions', 'ddicElement',
  'ddicRepositoryAccess', 'packageSearchHelp', 'getDomainProperties', 'getDataElementProperties',
  'getTextElements', 'bindingDetails', 'tableContents', 'runQuery', 'debuggerListeners',
  'debuggerStackTrace', 'debuggerVariables', 'debuggerChildVariables', 'atcCustomizing',
  'atcCheckVariant', 'atcWorklists', 'atcDocumentation', 'tracesList', 'tracesListRequests',
  'tracesHitList', 'tracesDbAccess', 'tracesStatements', 'changePackagePreview', 'revisions',
  'rapGenValidateInitial', 'rapGenGetSchema', 'rapGenGetContent', 'rapGenGetUiConfig',
  'rapGenValidateContent', 'rapGenPreview', 'rapGenIsAvailable',
  'previewQualityCheck', 'runQualityCheck', 'getQualityCheckStatus',
  'listRepositoryObjectCreationCapabilities', 'describeRepositoryObjectCreation',
  'previewRepositoryObjectCreation', 'applyRepositoryObjectCreation', 'getRepositoryObjectCreationStatus',
  // 受控对象激活链（devtools.activate 缺口）：workbench 面显式收录三工具
  'previewObjectActivation', 'applyObjectActivation', 'getObjectActivationStatus',
  // 受控传输请求创建链（cts.create-request 专属动作，仅创建）：workbench 面
  // 显式收录三工具；改属主不收录（仍停留在 legacy-full 原子面），释放走
  // 下方受控释放链（2026-10-21 起受控放开）
  'previewTransportCreation', 'applyTransportCreation', 'getTransportCreationStatus',
  // 受控传输请求清理链（空请求边界：未释放+零对象+本人属主才可删）：
  // workbench 面显式收录三工具；非空/已释放/他人请求仍不可删
  'previewTransportCleanup', 'applyTransportCleanup', 'getTransportCleanupStatus',
  // 受控传输请求释放链（受控释放边界：状态 D+本人属主，2026-10-21 所有者
  // 放开受控释放）：workbench 面显式收录三工具；仅标准释放（无锁/ATC 绕行），
  // 改属主/加用户/STMS 导入仍不收录
  'previewTransportRelease', 'applyTransportRelease', 'getTransportReleaseStatus',
  // CDS 依赖分析三工具（read.cds-analysis）：只读诊断能力，workbench 面显式收录
  'getCdsDependencies', 'getCdsImpactAnalysis', 'getCdsElementInfo',
  // Wave 3 分析五工具：源码 grep/交叉引用/应用日志（只读）+ 覆盖率执行（other-mutation）
  'grepPackage', 'grepObjects', 'getCallees', 'readApplicationLog', 'runUnitCoverage',
  // 受控 ABAP 执行（devtools.execute-abap）：执行级门控与 runUnitCoverage 同面
  // （workbench 显式收录 + legacy-full）——临时程序包装 + ABAP Unit 单次运行
  'executeAbap',
  // 报表执行面（report.run/async/variants 收编，2026-10-07 所有者放开）：
  // variants 只读（全只读面同收）；runReport/submitReportJob 执行类
  // （OTHER_MUTATION，DEV-only + 写槽）
  'getReportVariants',
  'runReport',
  'submitReportJob',
  // helper 桥 rfc 域（rfc.helper-bridge 收编）：allowlist 门控的受控 FM 调用
  'helperCallRfm',
  // 本地 abaplint 静态分析（analysis.lint 收编）：纯客户端只读，无 SAP 交互
  'analyzeLint',
  // Health 聚合查询（analysis.history 行 health 子操作）：tests 信号真正执行
  // 单测——执行级门控与 runUnitCoverage 同面（workbench 显式收录 + legacy-full）
  'analyzeHealth',
  // git 域桥接只读二工具（git.abapgit）：abapGit 类型清单 + 包导出 ZIP
  'gitTypes', 'gitExport',
  // dump 增值分析（diagnostics.dumps）：窗口内分组聚合与同类检索，只读
  'groupRuntimeDumps', 'findSimilarDumps',
  // 依赖上下文四工具（codeintel.context）：客户端侧压缩/解析/依赖/副作用分析，只读
  'getDependencyContext', 'analyzeDependencies', 'parseAbapSource', 'analyzeSourceEffects',
  // UI5/Fiori BSP 只读三工具（ui5.read）：filestore 列表/文件树/文件内容
  'ui5ListApps', 'ui5GetApp', 'ui5GetFileContent',
  // SPOOL/后台作业只读二工具（diagnostics.spool-jobs 只读子集）：自由 SQL 查询
  'listSpoolRequests', 'listJobs', 'readSpoolContent',
  // AMDP 调试可用性探测（debug.amdp-adt discovery 前置）：只读
  'checkAmdpDebugger',
  // 受控描述修改链（crud.set-description）：受控写，workbench 面显式收录
  'previewDescriptionChange', 'applyDescriptionChange', 'getDescriptionChangeStatus',
  // 受控消息文本写入链（i18n.write 的 write_message_texts）：受控写
  'previewMessageTextChange', 'applyMessageTextChange', 'getMessageTextChangeStatus',
  // 受控对象克隆链（crud.clone-object 一站式）：受控写（apply 委托受控创建链），
  // workbench 面显式收录
  'previewCloneObject', 'applyCloneObject', 'getCloneObjectStatus',
  // 受控对象重命名链（refactor.rename 一站式）：受控写（单确认两步：
  // 克隆新对象+受控删除旧对象），workbench 面显式收录
  'previewControlledRename', 'applyControlledRename', 'getControlledRenameStatus',
  // 消息类文本只读工具（read.message-class-texts）：messageclass 资源 GET
  'getMessages',
  // 版本源码只读工具（revisions.source）：按版本标签/序号读取历史版本源码
  'getRevisionSource',
  // 版本对比只读工具（revisions.compare）：LCS unified diff + 增删行计数
  'compareRevisions',
  // i18n 按语言只读四工具（i18n.read）：对象内容/数据元素标签/文本池/双语对比
  'getObjectContentInLanguage', 'getDataElementLabels', 'getTextPoolInLanguage', 'compareObjectLanguages',
  // 包边界只读检查工具（analysis.boundaries 只读子集）：TADIR 枚举 + 依赖提取
  'checkPackageBoundaries',
  // 对象间源码对比（crud.compare-source）：双对象当前源码 LCS unified diff
  'compareSourceObjects',
  // 事务码元数据只读（read.transaction）：TSTC/TSTCT 自由 SQL
  'getTransaction',
  // 安装前置只读发现（install.diagnostics）：helper TADIR 探测 + abapGit 可达性
  'checkInstallPrerequisites',
  // 知识查询只读三工具（diagnostics.knowledge-queries 子集）：DOKIL/DOKTL
  // 文档 + IMG 检索 + IMG 活动详情（路径递归）
  'getAbapDocumentation', 'searchImgActivities', 'getImgActivity',
  'getFmTestDataSets',
  'readClusterTable',
  'getWhereUsedConfig',
  'getUsageExamples',
  'getReportVariants',
  // 传输历史只读二工具（analysis.history 子集）：CR 历史 + 共同变更频次
  'getCrHistory', 'getCoChange',
  'getImpactAnalysis',
  // D010INC 加载图只读（analysis.history 的 loads 子操作）：编译期加载关系
  'getLoadGraph', 'buildLoadDependencyGraph', 'getTransportScope',
  // 离线依赖图快照：反向影响面和图统计，无 SAP 调用。
  'analyzeDependencyGraph',
  // RFC 直链四工具（rfc.remote-enabled.discovery/read-table/call/describe）：
  // 探测指纹、只读表读取、FM 接口描述、受控只读 RFM 调用
  'probeRfcSystem',
  'readRfcTable',
  'describeRfm',
  'callRfm',
  // 程序文本池原子写（F1 最小方案，交接文档 2026-09-30）：DEV 专属
  // RAW_ADVANCED_MUTATION（调用方自管锁/传输/激活），focused/developer 直达；
  // 配套 lock/unLock（OTHER_MUTATION，DEV 专属）——"caller manages locking"
  // 模式的锁句柄必须与写调用同 server 会话，缺锁工具则原子写不可用。
  'setTextElements',
  'lock',
  'unLock',
  // 受控程序文本池写入链（F1 完整方案）：preview/apply/status 三件套
  'previewTextPoolChange',
  'applyTextPoolChange',
  'getTextPoolChangeStatus',
  // 受控 UI5 filestore 写入链（F5：ui5.write 关缺口）：preview/apply/status
  // 三件套，四 kind（create_app/upload_file/delete_file/delete_app）
  'previewUi5Operation',
  'applyUi5Operation',
  'getUi5OperationStatus',
  // 受控对象导入链（deploy-zip/fileio.import-export）：abapGit ZIP → $ 本地包
  // 批量受控导入三件套
  'previewRepositoryObjectImport',
  'applyRepositoryObjectImport',
  'getRepositoryObjectImportStatus'
]);

export const BUSINESS_READONLY_TOOL_NAMES = new Set([
  'sapDoctor',
  'healthcheck', 'inspectSapSystem', 'describeClassicTable',
  'searchObject', 'findObjectPath', 'objectTypes', 'objectStructure', 'objectStructureElements',
  'annotationDefinitions', 'ddicElement', 'ddicRepositoryAccess', 'getDomainProperties',
  'getDataElementProperties', 'getTextElements', 'bindingDetails', 'tableContents', 'runQuery'
]);

export const OPERATIONS_READONLY_TOOL_NAMES = new Set([
  'sapDoctor',
  'healthcheck', 'inspectSapSystem', 'readRuntimeDumps', 'sm21Read', 'analyzeRuntimeErrors',
  'transportInfo', 'hasTransportConfig', 'transportConfigurations', 'getTransportConfiguration',
  'userTransports', 'transportsByConfig', 'systemUsers', 'transportReference',
  'searchObject', 'objectTypes', 'objectStructure', 'objectStructureElements', 'inactiveObjects',
  'atcCustomizing', 'atcCheckVariant', 'atcWorklists', 'atcDocumentation',
  'tracesList', 'tracesListRequests', 'tracesHitList', 'tracesDbAccess', 'tracesStatements',
  'debuggerListeners', 'debuggerStackTrace', 'debuggerVariables', 'debuggerChildVariables',
  'objectEnhancements', 'revisions', 'rapGenValidateInitial', 'rapGenGetSchema', 'rapGenGetContent',
  'rapGenGetUiConfig', 'rapGenValidateContent', 'rapGenPreview', 'rapGenIsAvailable',
  // 运维只读面追加应用日志读取（与 sm21Read 同级诊断）与 dump 增值分析
  'readApplicationLog', 'groupRuntimeDumps', 'findSimilarDumps',
  // 版本源码只读（与 revisions 清单同级的运维诊断：核对运行版本与历史差异）
  'getRevisionSource',
  // 版本对比只读（版本间 diff，运维核对运行版本变化）
  'compareRevisions',
  // 传输历史与共同变更只读（analysis.history 行：E071/E070 运维诊断）
  'getCrHistory', 'getCoChange',
  'getImpactAnalysis',
  // TVARVC 变量读者定位只读（analysis.history 行：where_used_config，与矩阵声明同步）
  'getWhereUsedConfig',
  // 调用方示例只读（analysis.history 行：usage_examples，与矩阵声明同步；
  // 交叉表候选 + 源码形态匹配，纯只读）
  'getUsageExamples',
  // D010INC 加载图只读（analysis.history 的 loads 子操作）
  'getLoadGraph', 'buildLoadDependencyGraph', 'analyzeDependencyGraph', 'getTransportScope',
  // 集群表通用读取（knowledge-queries 行：cluster_read 收编，运维诊断可用）
  'readClusterTable',
  // 报表变体清单（report.variants 收编，运维诊断可用）
  'getReportVariants',
  // 本地 abaplint 静态分析（analysis.lint 收编，运维诊断可用）
  'analyzeLint'
]);

export function selectProfileTools(
  profile: ToolProfile,
  safeTools: ToolDefinition[],
  legacyTools: ToolDefinition[],
  runtimeTools: ToolDefinition[] = [],
  safeDebugTools: ToolDefinition[] = [],
  systemRole = 'DEV',
  controlledAdvancedTools: ToolDefinition[] = [],
  qualityTools: ToolDefinition[] = [],
  focusedTools: ToolDefinition[] = [],
  activationTools: ToolDefinition[] = [],
  transportCreationTools: ToolDefinition[] = [],
  cdsTools: ToolDefinition[] = [],
  coverageTools: ToolDefinition[] = [],
  /**
   * BASIS release 维度裁剪（S/4 低版本适配，M0）：目标系统的 SAP_BASIS release
   * 数值形态（750 = 7.50）。undefined（指纹未接入）时跳过裁剪，目录与现有版本
   * 完全一致——releaseGate 与 systemRole 门控并列，语义见 SapReleaseCapability.ts。
   */
  basisRelease?: number
): ToolDefinition[] {
  let selected: ToolDefinition[];
  if (profile === 'safe') selected = safeTools;
  else if (profile === 'development') selected = [
    ...safeTools,
    ...safeDebugTools,
    ...runtimeTools,
    ...controlledAdvancedTools,
    ...activationTools,
    ...transportCreationTools,
    ...cdsTools,
    ...readOnlyLegacyTools(legacyTools)
  ];
  else if (profile === 'diagnostic-readonly') {
    // CDS 依赖分析属只读诊断能力，诊断入口同样收录（QAS/PRD 也可见）
    selected = [
      ...safeTools.filter(tool => tool.name === 'inspectAbapObject'),
      ...runtimeTools,
      ...cdsTools,
      ...readOnlyLegacyTools(legacyTools)
    ];
  } else if (profile === 'legacy-full') {
    // 专家完整面同样包含 CDS 只读分析三工具
    const completeTools = [...safeTools, ...runtimeTools, ...legacyTools, ...cdsTools, ...coverageTools];
    selected = systemRole === 'DEV'
      ? completeTools
      : completeTools.filter(tool => !isRawAdvancedMutationTool(tool.name));
  } else {
    const completeTools = [
      ...safeTools,
      ...safeDebugTools,
      ...controlledAdvancedTools,
      ...qualityTools,
      ...focusedTools,
      ...activationTools,
      ...transportCreationTools,
      ...cdsTools,
      ...coverageTools,
      ...runtimeTools,
      ...legacyTools
    ];
    const names = profile === 'development-workbench'
      ? DEVELOPMENT_WORKBENCH_TOOL_NAMES
      : profile === 'business-readonly'
        ? BUSINESS_READONLY_TOOL_NAMES
        : OPERATIONS_READONLY_TOOL_NAMES;
    selected = explicitlyNamedTools(profile, completeTools, names);
  }
  // systemRole 门控（QAS/PRD 只读裁剪）之后并列 releaseGate：低于工具登记的
  // minBasisRelease 即隐藏；undefined 表示指纹未接入，目录零变化（M0 语义）。
  const roleFiltered = systemRole === 'DEV'
    ? selected
    : selected.filter(tool => isToolAllowedForSystemRole(tool.name, systemRole));
  return filterToolsForBasisRelease(roleFiltered.map(tool => tool.name), basisRelease)
    .map(name => roleFiltered.find(tool => tool.name === name) as ToolDefinition);
}

function explicitlyNamedTools(profile: ToolProfile, tools: ToolDefinition[], names: Set<string>): ToolDefinition[] {
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  const missing = [...names].filter(name => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(`Tool profile '${profile}' references missing tools: ${missing.join(', ')}.`);
  }
  return [...names].map(name => byName.get(name) as ToolDefinition);
}

export function readOnlyLegacyTools(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.filter(tool => READ_ONLY_LEGACY_TOOL_NAMES.has(tool.name));
}

export function isReadOnlyLegacyTool(toolName: string): boolean {
  return READ_ONLY_LEGACY_TOOL_NAMES.has(toolName);
}
