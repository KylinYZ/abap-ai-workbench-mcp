import { SafeAbapError } from '../safe/errors.js';
import type { ToolProfile } from '../safe/types.js';

export type ToolOperationClass =
  | 'local'
  | 'read-only'
  | 'source-mutation'
  | 'debug-control'
  | 'advanced-mutation'
  | 'quality-execution'
  | 'other-mutation';

export const RAW_ADVANCED_MUTATION_TOOL_NAMES = new Set([
  'setDomainProperties',
  'setDataElementProperties',
  'setTextElements',
  'changePackageExecute',
  'rapGenGenerate',
  'rapGenPublishService'
]);

export const CONTROLLED_ADVANCED_MUTATION_TOOL_NAMES = new Set([
  'previewDdicPropertyChange', 'applyDdicPropertyChange',
  'previewPackageChange', 'applyPackageChange',
  'previewRapOperation', 'applyRapOperation'
]);

export const CONTROLLED_REPOSITORY_CREATION_TOOL_NAMES = new Set([
  'listRepositoryObjectCreationCapabilities',
  'describeRepositoryObjectCreation',
  'previewRepositoryObjectCreation',
  'applyRepositoryObjectCreation',
  'getRepositoryObjectCreationStatus',
  'previewRepositoryObjectCleanup',
  'applyRepositoryObjectCleanup',
  'getRepositoryObjectCleanupStatus'
]);

// 受控对象克隆链（crud.clone-object 一站式工作流）：与受控创建/激活同面的
// DEV 受控 profiles 专属链，任何一环不在 QAS/PRD/未知角色下面世。
/**
 * 受控消息类文本写入工具集合（i18n.write 的 write_message_texts）：
 * preview（只读读现文本+冻结 plan）→ apply（原生确认后 stateful 锁链单次执行）
 * → status（本地查询）。仅 DEV 角色 + development/development-workbench。
 */
export const CONTROLLED_MESSAGE_TEXT_TOOL_NAMES = new Set([
  'previewMessageTextChange',
  'applyMessageTextChange',
  'getMessageTextChangeStatus',
  'getTextPoolChangeStatus'
]);

/**
 * 受控程序文本池写入链（F1 完整方案：report.text-elements 受控化收尾）。
 * → preview（写链只读前段，挂写槽同面）；apply（确认型写执行）；status（本地读取）。
 * 仅 DEV 角色 + development/development-workbench。
 */
export const CONTROLLED_TEXT_POOL_TOOL_NAMES = new Set([
  'previewTextPoolChange',
  'applyTextPoolChange',
  'getTextPoolChangeStatus'
]);

/**
 * 受控 UI5 filestore 写入链（F5：ui5.write 关缺口）。
 * → preview（只读预检：存在性/漂移基线/内容上限 + 冻结 plan）；apply（确认型
 *   写执行：漂移复核 → POST/PUT/DELETE → readback）；status（本地读取）。
 * 四 kind：create_app/upload_file/delete_file/delete_app。filestore 写不走
 * ABAP workbench 对象锁（BSP 容器操作，VSP 同款）；仅 DEV 角色 +
 * development/development-workbench。
 */
export const CONTROLLED_UI5_WRITE_TOOL_NAMES = new Set([
  'previewUi5Operation',
  'applyUi5Operation',
  'getUi5OperationStatus'
]);

/**
 * 受控对象导入链（deploy-zip/fileio.import-export 受控导入工作流）。
 * → preview（只读预检：离线解析 abapGit ZIP + 逐对象存在性/漂移基线 + 范围
 *   校验，冻结 immutable plan）；apply（原生确认后单次批量执行：逐对象漂移
 *   复核 → 建/改 → 锁链 → 激活 → readback，首失败即停）；status（本地读取）。
 * 目标强制 `$` 本地包（无传输号不进 CTS）；仅 CLAS/INTF/PROG。
 * 仅 DEV 角色 + development/development-workbench。
 */
export const CONTROLLED_REPOSITORY_IMPORT_TOOL_NAMES = new Set([
  'previewRepositoryObjectImport',
  'applyRepositoryObjectImport',
  'getRepositoryObjectImportStatus'
]);

export const CONTROLLED_CLONE_TOOL_NAMES = new Set([
  'previewCloneObject',
  'applyCloneObject',
  'getCloneObjectStatus'
]);

/**
 * 受控传输请求创建工具集合（cts.create-request 专属动作）：
 * preview（只读 CTS 预检+冻结 plan）→ apply（原生确认后单次创建工作台请求）
 * → status（本地查询）。仅创建：释放/删除/改属主/直改 E071·E071K 不在本链路
 * 任何工具中。仅 DEV 角色 + development/development-workbench。
 */
export const CONTROLLED_TRANSPORT_CREATION_TOOL_NAMES = new Set([
  'previewTransportCreation',
  'applyTransportCreation',
  'getTransportCreationStatus'
]);

/**
 * 受控传输请求清理工具集合（所有者 2026-09-29 边界调整：空请求允许删除）：
 * preview（只读核验"未释放 + 零对象 + 本人属主"三条红线 + 冻结 plan）→
 * apply（原生确认后单次删除 + 缺席验证）→ status（本地查询）。
 * 非空/已释放/他人属主请求仍一律不可删；释放/改属主/加用户仍禁止。
 * 仅 DEV 角色 + development/development-workbench。
 */
export const CONTROLLED_TRANSPORT_CLEANUP_TOOL_NAMES = new Set([
  'previewTransportCleanup',
  'applyTransportCleanup',
  'getTransportCleanupStatus'
]);

/**
 * 受控传输请求释放工具集合（所有者 2026-10-21 边界调整：受控释放 DEV 请求）：
 * preview 核验"状态 D + 本人属主"两条红线并冻结 plan；apply 单次标准释放
 * （newreleasejobs，无锁/ATC 绕行）+ 轮询读回验证 status=R；status 本地查询。
 */
export const CONTROLLED_TRANSPORT_RELEASE_TOOL_NAMES = new Set([
  'previewTransportRelease',
  'applyTransportRelease',
  'getTransportReleaseStatus'
]);

// 受控对象重命名链（refactor.rename 一站式工作流）：单确认两步（克隆新对象
// +受控删除旧对象），与受控创建/清理/克隆同面的 DEV 受控 profiles 专属链。
export const CONTROLLED_RENAME_TOOL_NAMES = new Set([
  'previewControlledRename',
  'applyControlledRename',
  'getControlledRenameStatus'
]);

/**
 * 受控对象激活工具集合（关闭矩阵缺口 devtools.activate）。
 * 三个工具构成完整受控链：preview（只读收集+冻结 plan）→
 * apply（原生确认后单次激活）→ status（本地查询）。
 * 仅 DEV 角色 + development/development-workbench profile 可用；
 * QAS/PRD/未知角色下隐藏且 dispatch 拒绝。
 */
export const CONTROLLED_ACTIVATION_TOOL_NAMES = new Set([
  'previewObjectActivation',
  'applyObjectActivation',
  'getObjectActivationStatus'
]);

const LOCAL_TOOL_NAMES = new Set([
  'analyzeDependencyGraph',
  'healthcheck', 'getAbapChangeStatus', 'getAbapObjectCreationStatus',
  'getDebugOperationStatus', 'revokeDebugSession', 'getQualityCheckStatus', 'getDescriptionChangeStatus',
  'getRepositoryObjectCreationStatus', 'getRepositoryObjectCleanupStatus',
  'getObjectActivationStatus', 'getCloneObjectStatus', 'getControlledRenameStatus',
  'getTransportCreationStatus', 'getTransportCleanupStatus', 'getTransportReleaseStatus',
  'getMessageTextChangeStatus',
  'getTextPoolChangeStatus',
  'getUi5OperationStatus',
  'getRepositoryObjectImportStatus'
]);

const READ_ONLY_TOOL_NAMES = new Set([
  'sap', 'sapDoctor',
  'transportInfo', 'hasTransportConfig', 'transportConfigurations', 'getTransportConfiguration',
  'userTransports', 'transportsByConfig', 'systemUsers', 'transportReference',
  'objectStructure', 'searchObject', 'findObjectPath', 'objectTypes', 'classIncludes', 'classComponents',
  'syntaxCheckCode', 'syntaxCheckCdsUrl', 'codeCompletion', 'findDefinition', 'usageReferences',
  'syntaxCheckTypes', 'codeCompletionFull', 'codeCompletionElement', 'usageReferenceSnippets',
  'fixProposals', 'fragmentMappings', 'abapDocumentation', 'inactiveObjects', 'objectRegistrationInfo',
  // 本地 abaplint 静态分析（analysis.lint 收编）：纯客户端只读，无 SAP 交互
  'analyzeLint',
  // 报表变体清单（report.variants 收编）：VARID/VARIT 只读 SQL
  'getReportVariants',
  'validateNewObject', 'getObjectSource', 'nodeContents', 'mainPrograms', 'featureDetails', 'collectionFeatureDetails',
  'findCollectionByUrl', 'loadTypes', 'adtDiscovery', 'adtCoreDiscovery', 'adtCompatibiliyGraph',
  'unitTestEvaluation', 'unitTestOccurrenceMarkers', 'prettyPrinterSetting', 'prettyPrinter',
  'gitRepos', 'gitExternalRepoInfo', 'checkRepo', 'remoteRepoInfo', 'ddicElement',
  'ddicRepositoryAccess', 'annotationDefinitions', 'packageSearchHelp', 'bindingDetails',
  'tableContents', 'runQuery', 'feeds', 'dumps', 'debuggerListeners', 'debuggerStackTrace',
  'debuggerVariables', 'debuggerChildVariables', 'atcCustomizing', 'atcCheckVariant', 'atcWorklists',
  'atcUsers', 'isProposalMessage', 'atcContactUri', 'tracesList', 'tracesListRequests',
  'tracesHitList', 'tracesDbAccess', 'tracesStatements', 'renameEvaluate', 'renamePreview',
  'extractMethodEvaluate', 'extractMethodPreview', 'revisions',
  'inspectAbapObject', 'previewAbapChange', 'previewAbapObjectCreation',
  'previewDebugOperation', 'previewDebugVariableChange', 'sm21Read', 'analyzeRuntimeErrors',
  'objectStructureElements', 'typeHierarchy', 'objectEnhancements', 'getDomainProperties',
  'getDataElementProperties', 'getTextElements', 'atcDocumentation', 'changePackagePreview',
  'rapGenValidateInitial', 'rapGenGetSchema', 'rapGenGetContent', 'rapGenGetUiConfig',
  'rapGenValidateContent', 'rapGenPreview', 'rapGenIsAvailable',
  'readRuntimeDumps', 'describeClassicTable', 'inspectSapSystem', 'getAbapMemberSource',
  'listRepositoryObjectCreationCapabilities', 'describeRepositoryObjectCreation', 'previewRepositoryObjectCreation',
  'previewRepositoryObjectCleanup',
  'previewObjectActivation',
  // 受控传输创建 preview（cts.create-request 专属动作）：只读 CTS 预检
  //（transportInfo 端点）+ 本地冻结 plan，不触碰创建写路径
  'previewTransportCreation',
  // 受控传输清理 preview（空请求边界）：只读 transportDetails 核验三条红线
  //（未释放+零对象+本人属主）+ 本地冻结 plan，不触碰删除写路径
  'previewTransportCleanup',
  // 受控传输释放 preview（受控释放边界）：只读 transportDetails 核验两条红线
  //（状态 D+本人属主）+ 本地冻结 plan，不触碰释放写路径
  'previewTransportRelease',
  // CDS 依赖分析三工具（能力矩阵 read.cds-analysis 行）：底层仅发只读 ADT GET/
  // usageReferences 查询，归入 read-only 类——QAS/PRD 角色自动可见可用
  'getCdsDependencies', 'getCdsImpactAnalysis', 'getCdsElementInfo',
  // Wave 3 只读分析（矩阵 search.content-grep / read.transaction 邻域 / analysis.callgraph
  // down 方向 / diagnostics.application-log 行）：源码 grep、交叉表 callees、BAL 应用日志
  'grepPackage', 'grepObjects', 'getCallees', 'readApplicationLog',
  // dump 增值分析：ST22 feed 读取后的纯客户端聚合，零额外端点
  'groupRuntimeDumps', 'findSimilarDumps',
  // 依赖上下文四工具（矩阵 codeintel.context 行）：客户端侧压缩/解析/依赖/副作用
  // 分析，SAP 交互仅有只读取源链（searchObject/objectStructure/getObjectSource）
  'getDependencyContext', 'analyzeDependencies', 'parseAbapSource', 'analyzeSourceEffects',
  // UI5/Fiori BSP 只读三工具（矩阵 ui5.read 行）：filestore 列表/文件树/文件内容，
  // 仅三个 GET 端点；ui5.write 方向维持缺口不开放
  'ui5ListApps', 'ui5GetApp', 'ui5GetFileContent',
  // SPOOL/后台作业只读工具（矩阵 diagnostics.spool-jobs）：自由 SQL
  // 查询 TSP01/TST01/TBTCP/TBTCO/TST03；作业日志（RFC/XBP）不在内
  'listSpoolRequests', 'listJobs', 'readSpoolContent',
  // AMDP 调试可用性探测：无状态 GET（400/200/405 可用、404 缺失）
  'checkAmdpDebugger',
  // 受控描述修改 preview（crud.set-description）：只读预检，不触碰写路径
  'previewDescriptionChange',
  // 受控消息文本 preview（i18n.write 的 write_message_texts）：只读读现文本+冻结 plan
  'previewMessageTextChange',
  // 受控程序文本池 preview（F1 完整方案）：只读读现文本池+冻结 plan
  'previewTextPoolChange',
  // 受控 UI5 filestore preview（F5：ui5.write）：只读预检（存在性/漂移基线/
  // 内容上限）+冻结 plan，不触碰写路径
  'previewUi5Operation',
  // 受控对象导入 preview（deploy-zip/fileio.import-export）：只读预检（ZIP
  // 离线解析 + 存在性/漂移基线 + 范围校验）+冻结 plan，不触碰写路径
  'previewRepositoryObjectImport',
  // 受控对象克隆 preview（crud.clone-object 一站式）：只读预检（源码快照+
  // 本地声明改名），不触碰写路径
  'previewCloneObject',
  // 受控对象重命名 preview（refactor.rename 一站式）：只读预检（源码快照+
  // 本地声明改名），不触碰写路径
  'previewControlledRename',
  // 消息类文本只读工具（矩阵 read.message-class-texts 行）：messageclass 资源
  // GET，可选 sap-language 语言覆盖；文本写入方向（i18n.write）不开放
  'getMessages',
  // 版本源码只读工具（矩阵 revisions.source 行）：版本标签/序号 → 版本源码 GET，
  // 版本与源 URI 全部服务端解析，不接受任意 URL
  'getRevisionSource',
  // 版本对比只读工具（矩阵 revisions.compare 行）：客户端 LCS unified diff +
  // 增删行计数；版本与源 URI 服务端解析
  'compareRevisions',
  // i18n 按语言只读四工具（矩阵 i18n.read 行语言覆盖部分）：sap-language 覆盖
  // 的只读 GET；文本写入方向（i18n.write）不开放
  'getObjectContentInLanguage', 'getDataElementLabels', 'getTextPoolInLanguage', 'compareObjectLanguages',
  // 包边界只读检查工具（矩阵 analysis.boundaries 行只读子集）：TADIR SELECT +
  // 源码依赖提取 + TADIR 目标包反查；动态调用检测（VSP DYNAMIC）不在子集内
  'checkPackageBoundaries',
  // 对象间源码对比（矩阵 crud.compare-source 行）：双对象当前源码 LCS unified
  // diff；源 URL 服务端解析，不接受任意 URL
  'compareSourceObjects',
  // git 域桥接只读二工具（矩阵 git.abapgit 行）：经 ZADT_VSP APC WebSocket 的
  // abapGit 类型清单与包导出（ZIP base64）；helper 只在 DEV，DEV-only 门见下
  'gitTypes', 'gitExport',
  // 事务码元数据只读（矩阵 read.transaction 行）：TSTC/TSTCT 自由 SQL
  //（vit/wb TRAN 端点在该 DEV 无映射）；事务码运行不在此列
  'getTransaction',
  // 安装前置只读发现（矩阵 install.diagnostics 行）：只读 discovery，
  // 不做任何安装动作（安装属 INTENTIONAL_RESTRICTION 行）
  'checkInstallPrerequisites',
  // 知识查询只读三工具（矩阵 diagnostics.knowledge-queries 行子集）：
  // DOKIL/DOKTL 文档读取 + IMG 活动检索 + IMG 活动详情（路径递归）；
  // fm_test_data/cluster_read 已收编（readClusterTable/getFmTestDataSets）
  'getAbapDocumentation', 'searchImgActivities', 'getImgActivity',
  'getFmTestDataSets',
  'readClusterTable',
  'getWhereUsedConfig',
  'getUsageExamples',
  // 传输历史只读二工具（矩阵 analysis.history 行子集）：E071/E070 自由 SQL
  //（真机复测可用）；VSP 图引擎类 impact/boundaries 不在子集
  'getCrHistory', 'getCoChange',
  'getImpactAnalysis',
  // D010INC 加载图只读（analysis.history 的 loads 子操作，纯 SQL 无图引擎）
  'getLoadGraph', 'buildLoadDependencyGraph', 'getTransportScope',
  // RFC 直链四工具（矩阵 rfc.remote-enabled.discovery/read-table/call/describe）：
  // 无副作用系统 RFM 探测、只读表读取、FM 接口元数据描述、受控只读 RFM 调用
  //（callRfm 的安全面由协议层只读 allowlist 硬门收窄，白名单外一律拒绝）
  'probeRfcSystem',
  'readRfcTable',
  'describeRfm',
  'callRfm'
]);

const SOURCE_MUTATION_TOOL_NAMES = new Set([
  'setObjectSource', 'deleteObject', 'activateObjects', 'activateByName', 'createObject',
  'createTestInclude', 'fixEdits', 'renameExecute', 'extractMethodExecute',
  'applyAbapChange', 'applyAbapObjectCreation'
]);

const DEBUG_CONTROL_TOOL_NAMES = new Set([
  'debuggerListen', 'debuggerDeleteListener', 'debuggerSetBreakpoints', 'debuggerDeleteBreakpoints',
  'debuggerAttach', 'debuggerSaveSettings', 'debuggerStep', 'debuggerGoToStack',
  'debuggerSetVariableValue', 'applyDebugOperation', 'authorizeDebugSession',
  'executeDebugCommand', 'applyDebugVariableChange'
]);

const OTHER_MUTATION_TOOL_NAMES = new Set([
  'login', 'logout', 'dropSession', 'createTransport', 'setTransportsConfig',
  'createTransportsConfig', 'transportDelete', 'transportRelease', 'transportSetOwner',
  'transportAddUser', 'lock', 'unLock', 'reentranceTicket', 'runClass', 'unitTestRun',
  // 受控 ABAP 执行（devtools.execute-abap）：临时程序包装 + ABAP Unit 单次运行，
  // 与 runClass/unitTestRun 同级执行行为（自建 $TMP 临时程序创建/激活/删除 +
  // 用户代码执行，非只读；QAS/PRD 拒绝，写槽串行）
  'executeAbap',
  // 报表执行（report.run/report.async 收编，2026-10-07 所有者放开）：运行/调度
  // 系统内已有报表 = 执行行为（非只读；DEV-only，写槽串行）
  'runReport',
  'submitReportJob',
  // helper 桥 rfc 域（rfc.helper-bridge 收编，2026-10-10 所有者授权）：桥内
  // CALL FUNCTION 执行行为（allowlist 硬门；DEV-only，写槽串行）
  'helperCallRfm',
  'setPrettyPrinterSetting', 'gitCreateRepo', 'gitPullRepo', 'gitUnlinkRepo', 'stageRepo',
  'pushRepo', 'switchRepoBranch', 'publishServiceBinding', 'unPublishServiceBinding',
  'createAtcRun', 'atcExemptProposal', 'atcRequestExemption', 'atcChangeContact',
  'tracesSetParameters', 'tracesCreateConfiguration', 'tracesDeleteConfiguration', 'tracesDelete'
]);

const ADVANCED_MUTATION_TOOL_NAMES = new Set([
  ...RAW_ADVANCED_MUTATION_TOOL_NAMES,
  ...CONTROLLED_ADVANCED_MUTATION_TOOL_NAMES,
  'applyRepositoryObjectCreation', 'applyRepositoryObjectCleanup',
  // 受控激活的 apply 属于对象生命周期变更（不动源码），归入 advanced-mutation 而非 source-mutation
  'applyObjectActivation',
  // runUnitCoverage 运行被测对象的用户代码，是执行行为（与 unitTestRun 同级，非只读）
  'runUnitCoverage',
  // analyzeHealth 的 tests 信号真正执行单测（健康检查里的执行行为，非只读；
  // 同 runUnitCoverage 级别，仅 workbench/legacy-full catalog 面）
  'analyzeHealth',
  // 受控描述修改 apply（crud.set-description）：repository 写入，受控链单次执行
  'applyDescriptionChange',
  // 受控消息文本 apply（i18n.write 的 write_message_texts）：repository 写入，
  // stateful 锁链单次执行
  'applyMessageTextChange',
  // 受控程序文本池 apply（F1 完整方案）：repository 写入（text/plain 源形态），
  // stateful 锁链单次执行
  'applyTextPoolChange',
  // 受控 UI5 filestore apply（F5：ui5.write）：filestore POST/PUT/DELETE（BSP
  // 容器操作，不走 workbench 对象锁），漂移复核 + readback 单次执行
  'applyUi5Operation',
  // 受控对象克隆 apply（crud.clone-object 一站式）：委托受控创建链的 repository
  // 写入，单确认单执行
  'applyCloneObject',
  // 受控对象重命名 apply（refactor.rename 一站式）：单确认两步（克隆新对象+
  // 受控删除旧对象），委托受控创建链与受控清理链
  'applyControlledRename',
  // 受控传输请求创建 apply（cts.create-request 专属动作）：仅创建工作台请求，
  // 单确认单执行；释放/删除/改属主/直改 E071·E071K 不在本链路面
  'applyTransportCreation',
  // 受控传输请求清理 apply（空请求边界）：仅删"未释放+零对象+本人属主"请求，
  // 单确认单执行 + 缺席验证；非空/已释放/他人请求仍不可删
  'applyTransportCleanup',
  // 受控传输请求释放 apply（受控释放边界）：仅标准释放"状态 D+本人属主"请求，
  // 单确认单执行 + 轮询读回验证；无锁/ATC 绕行，他人/已释放请求仍不可释放
  'applyTransportRelease',
  // 受控对象导入 apply（deploy-zip/fileio.import-export）：批量 repository 写入
  // （建/改 + 激活），逐对象漂移复核 + readback，单确认单执行
  'applyRepositoryObjectImport'
]);

const QUALITY_EXECUTION_TOOL_NAMES = new Set([
  'previewQualityCheck', 'runQualityCheck'
]);

const CLASS_SETS: ReadonlyArray<readonly [ToolOperationClass, Set<string>]> = [
  ['local', LOCAL_TOOL_NAMES],
  ['read-only', READ_ONLY_TOOL_NAMES],
  ['source-mutation', SOURCE_MUTATION_TOOL_NAMES],
  ['debug-control', DEBUG_CONTROL_TOOL_NAMES],
  ['advanced-mutation', ADVANCED_MUTATION_TOOL_NAMES],
  ['quality-execution', QUALITY_EXECUTION_TOOL_NAMES],
  ['other-mutation', OTHER_MUTATION_TOOL_NAMES]
];

export const CLASSIFIED_TOOL_NAMES = new Set(CLASS_SETS.flatMap(([, names]) => [...names]));

/**
 * 受控写链的只读前段工具（挂写槽特判集合）。
 *
 * 这些工具在操作分类上属 read-only（不直接触碰写路径），但它们的执行
 * 绑定写域主客户端（常驻 stateful 会话）：受控链是一体的写流程，preview
 * 是写链的前半段，与其 apply 同槽串行既避免读槽并发打在 stateful 会话上，
 * 也让同一受控链的 preview→apply 天然互斥。写槽（=1）下永无 stateful 并发。
 */
export const CONTROLLED_WRITE_CHAIN_READONLY_TOOLS = new Set<string>([
  // SafeAbap 源码/对象创建链的 preview
  'previewAbapChange', 'previewAbapObjectCreation',
  // 受控描述修改链的 preview（crud.set-description，确认层自持写槽同面）
  'previewDescriptionChange',
  // 调试受控链的 preview（执行体绑定写域调试会话）
  'previewDebugOperation', 'previewDebugVariableChange',
  // 质量检查链的 preview（runQualityCheck 同链，已在豁免清单）
  'previewQualityCheck',
  // 各受控链的 preview（apply/status 同集合，status 为本地读取挂哪侧都安全）
  ...CONTROLLED_ADVANCED_MUTATION_TOOL_NAMES,
  ...CONTROLLED_REPOSITORY_CREATION_TOOL_NAMES,
  ...CONTROLLED_MESSAGE_TEXT_TOOL_NAMES,
  ...CONTROLLED_TEXT_POOL_TOOL_NAMES,
  ...CONTROLLED_UI5_WRITE_TOOL_NAMES,
  ...CONTROLLED_CLONE_TOOL_NAMES,
  ...CONTROLLED_TRANSPORT_CREATION_TOOL_NAMES,
  ...CONTROLLED_TRANSPORT_CLEANUP_TOOL_NAMES,
  ...CONTROLLED_TRANSPORT_RELEASE_TOOL_NAMES,
  ...CONTROLLED_RENAME_TOOL_NAMES,
  ...CONTROLLED_ACTIVATION_TOOL_NAMES,
  ...CONTROLLED_REPOSITORY_IMPORT_TOOL_NAMES
]);

export function toolOperationClass(toolName: string): ToolOperationClass | undefined {
  return CLASS_SETS.find(([, names]) => names.has(toolName))?.[0];
}

export function isRawAdvancedMutationTool(toolName: string): boolean {
  return RAW_ADVANCED_MUTATION_TOOL_NAMES.has(toolName);
}

export function isToolAllowedForSystemRole(toolName: string, systemRole: string): boolean {
  const operationClass = toolOperationClass(toolName);
  // 受控创建链与受控激活链即使含只读语义的工具，也只对 DEV 角色可见：
  // 任务链的任何一环都不应在 QAS/PRD/未知角色下面世。
  if (CONTROLLED_REPOSITORY_CREATION_TOOL_NAMES.has(toolName)) return systemRole === 'DEV';
  if (CONTROLLED_ACTIVATION_TOOL_NAMES.has(toolName)) return systemRole === 'DEV';
  if (CONTROLLED_CLONE_TOOL_NAMES.has(toolName)) return systemRole === 'DEV';
  if (CONTROLLED_RENAME_TOOL_NAMES.has(toolName)) return systemRole === 'DEV';
  if (CONTROLLED_MESSAGE_TEXT_TOOL_NAMES.has(toolName)) return systemRole === 'DEV';
  if (CONTROLLED_TEXT_POOL_TOOL_NAMES.has(toolName)) return systemRole === 'DEV';
  // 受控 UI5 filestore 写链：任何一环都不应在 QAS/PRD/未知角色下面世
  if (CONTROLLED_UI5_WRITE_TOOL_NAMES.has(toolName)) return systemRole === 'DEV';
  // 受控对象导入链（批量 repository 写入）：任何一环都不应在 QAS/PRD 下面世
  if (CONTROLLED_REPOSITORY_IMPORT_TOOL_NAMES.has(toolName)) return systemRole === 'DEV';
  // git 域桥接（gitTypes/gitExport）：helper 只部署于 DEV，QAS/PRD 无服务面
  if (toolName === 'gitTypes' || toolName === 'gitExport') return systemRole === 'DEV';
  // 受控传输创建链：任何一环都不应在 QAS/PRD/未知角色下面世（仅创建、DEV 专属）
  if (CONTROLLED_TRANSPORT_CREATION_TOOL_NAMES.has(toolName)) return systemRole === 'DEV';
  // 受控传输清理链（空请求边界）：同上，删除动作整体 DEV 专属
  if (CONTROLLED_TRANSPORT_CLEANUP_TOOL_NAMES.has(toolName)) return systemRole === 'DEV';
  // 受控传输释放链（受控释放边界）：同上，释放动作整体 DEV 专属
  if (CONTROLLED_TRANSPORT_RELEASE_TOOL_NAMES.has(toolName)) return systemRole === 'DEV';
  return systemRole === 'DEV' || operationClass === 'local' || operationClass === 'read-only';
}

export function assertToolCatalogClassified(toolNames: string[]): void {
  const actual = new Set<string>();
  for (const name of toolNames) {
    if (actual.has(name)) throw new Error(`Duplicate MCP tool name '${name}'.`);
    actual.add(name);
    if (!toolOperationClass(name)) throw new Error(`MCP tool '${name}' has no operation policy classification.`);
  }
  const stale = [...CLASSIFIED_TOOL_NAMES].filter(name => !actual.has(name));
  if (stale.length > 0) throw new Error(`Operation policy contains tools absent from the catalog: ${stale.join(', ')}.`);
}

export function assertToolOperationAllowed(toolName: string, profile: ToolProfile, systemRole: string): void {
  const operationClass = toolOperationClass(toolName);
  if (!operationClass) {
    throw new SafeAbapError('POLICY_DENIED', 'policy', `Tool ${toolName} has no approved operation classification.`);
  }
  if (systemRole !== 'DEV' && operationClass !== 'local' && operationClass !== 'read-only') {
    throw new SafeAbapError(
      'POLICY_DENIED',
      'policy',
      'QAS, PRD, missing, and unknown system roles permit only local and read-only operations.'
    );
  }
  // F1（交接文档 2026-09-30）：程序文本池原子写 setTextElements 纳入
  // focused/developer 入口（development-workbench），仍 DEV 专属、走写槽；
  // 其余 raw 族维持 legacy-full 专属。
  const rawAllowedProfiles: ToolProfile[] = toolName === 'setTextElements'
    ? ['legacy-full', 'development-workbench']
    : ['legacy-full'];
  if (RAW_ADVANCED_MUTATION_TOOL_NAMES.has(toolName)
    && (!rawAllowedProfiles.includes(profile) || systemRole !== 'DEV')) {
    throw new SafeAbapError(
      'POLICY_DENIED',
      'policy',
      'Raw DDIC, package, RAP generation, and publication operations require DEV legacy-full.'
    );
  }
  if (CONTROLLED_ADVANCED_MUTATION_TOOL_NAMES.has(toolName)
    && ((profile !== 'development' && profile !== 'development-workbench') || systemRole !== 'DEV')) {
    throw new SafeAbapError(
      'POLICY_DENIED',
      'policy',
      'Controlled DDIC, package, and RAP operations require DEV development or development-workbench profile.'
    );
  }
  if (CONTROLLED_REPOSITORY_CREATION_TOOL_NAMES.has(toolName)
    && ((profile !== 'development' && profile !== 'development-workbench') || systemRole !== 'DEV')) {
    throw new SafeAbapError(
      'POLICY_DENIED',
      'policy',
      'Controlled repository creation capabilities require DEV development or development-workbench profile.'
    );
  }
  // 受控激活链（devtools.activate 缺口）：仅 DEV + development/development-workbench。
  // 其他 profile（含 legacy-full 专家面）一律 POLICY_DENIED——专家继续使用原子
  // activateObjects/activateByName，不受控激活链不进入 legacy catalog。
  if (CONTROLLED_ACTIVATION_TOOL_NAMES.has(toolName)
    && ((profile !== 'development' && profile !== 'development-workbench') || systemRole !== 'DEV')) {
    throw new SafeAbapError(
      'POLICY_DENIED',
      'policy',
      'Controlled object activation requires DEV development or development-workbench profile.'
    );
  }
  // 受控对象克隆链（crud.clone-object 一站式）：仅 DEV + development/
  // development-workbench。apply 委托受控创建链（其确认与执行门控已内建），
  // 不进入 legacy-full 专家面。
  if (CONTROLLED_CLONE_TOOL_NAMES.has(toolName)
    && ((profile !== 'development' && profile !== 'development-workbench') || systemRole !== 'DEV')) {
    throw new SafeAbapError(
      'POLICY_DENIED',
      'policy',
      'Controlled object clone requires DEV development or development-workbench profile.'
    );
  }
  // 受控对象重命名链（refactor.rename 一站式）：仅 DEV + development/
  // development-workbench。apply 单确认两步（克隆新对象+受控删除旧对象），
  // 确认与执行门控已内建，不进入 legacy-full 专家面。
  if (CONTROLLED_RENAME_TOOL_NAMES.has(toolName)
    && ((profile !== 'development' && profile !== 'development-workbench') || systemRole !== 'DEV')) {
    throw new SafeAbapError(
      'POLICY_DENIED',
      'policy',
      'Controlled object rename requires DEV development or development-workbench profile.'
    );
  }
  // 受控消息文本写入链（i18n.write 的 write_message_texts）：仅 DEV +
  // development/development-workbench；stateful 锁链单次执行。
  if (CONTROLLED_MESSAGE_TEXT_TOOL_NAMES.has(toolName)
    && ((profile !== 'development' && profile !== 'development-workbench') || systemRole !== 'DEV')) {
    throw new SafeAbapError(
      'POLICY_DENIED',
      'policy',
      'Controlled message text write requires DEV development or development-workbench profile.'
    );
  }
  // 受控程序文本池写入链（F1 完整方案）：仅 DEV + development/development-workbench。
  if (CONTROLLED_TEXT_POOL_TOOL_NAMES.has(toolName)
    && ((profile !== 'development' && profile !== 'development-workbench') || systemRole !== 'DEV')) {
    throw new SafeAbapError(
      'POLICY_DENIED',
      'policy',
      'Controlled text pool write requires DEV development or development-workbench profile.'
    );
  }
  // 受控 UI5 filestore 写入链（F5：ui5.write）：仅 DEV +
  // development/development-workbench；filestore 写不走 workbench 对象锁，
  // 事务边界由 preview 冻结 + apply readback 补齐。
  if (CONTROLLED_UI5_WRITE_TOOL_NAMES.has(toolName)
    && ((profile !== 'development' && profile !== 'development-workbench') || systemRole !== 'DEV')) {
    throw new SafeAbapError(
      'POLICY_DENIED',
      'policy',
      'Controlled UI5 filestore write requires DEV development or development-workbench profile.'
    );
  }
  // git 域桥接（gitTypes/gitExport）：仅 DEV + development-workbench（helper
  // 服务面与 abapGit 依赖只在 DEV 部署）。
  if ((toolName === 'gitTypes' || toolName === 'gitExport')
    && (profile !== 'development-workbench' || systemRole !== 'DEV')) {
    throw new SafeAbapError(
      'POLICY_DENIED',
      'policy',
      'Git bridge tools require DEV development-workbench profile (ZADT_VSP helper is DEV-only).'
    );
  }
  // 受控传输创建链（cts.create-request 专属动作）：仅 DEV +
  // development/development-workbench。仅创建一个动作：释放/删除/改属主与
  // E071·E071K 直改不在本链路面，也不进入 legacy-full 专家面（专家继续使用
  // 原子 createTransport，该工具不受本链路影响）。
  if (CONTROLLED_TRANSPORT_CREATION_TOOL_NAMES.has(toolName)
    && ((profile !== 'development' && profile !== 'development-workbench') || systemRole !== 'DEV')) {
    throw new SafeAbapError(
      'POLICY_DENIED',
      'policy',
      'Controlled transport creation requires DEV development or development-workbench profile.'
    );
  }
  // 受控传输清理链（空请求边界）：仅 DEV + development/development-workbench；
  // 红线（未释放+零对象+本人属主）在工作流 preview 内核验，此处只管 profile/role 面。
  if (CONTROLLED_TRANSPORT_CLEANUP_TOOL_NAMES.has(toolName)
    && ((profile !== 'development' && profile !== 'development-workbench') || systemRole !== 'DEV')) {
    throw new SafeAbapError(
      'POLICY_DENIED',
      'policy',
      'Controlled transport cleanup requires DEV development or development-workbench profile.'
    );
  }
  // 受控传输释放链（受控释放边界）：仅 DEV + development/development-workbench；
  // 红线（状态 D+本人属主）与"仅标准释放"在工作流内核验，此处只管 profile/role 面。
  if (CONTROLLED_TRANSPORT_RELEASE_TOOL_NAMES.has(toolName)
    && ((profile !== 'development' && profile !== 'development-workbench') || systemRole !== 'DEV')) {
    throw new SafeAbapError(
      'POLICY_DENIED',
      'policy',
      'Controlled transport release requires DEV development or development-workbench profile.'
    );
  }
  // 受控对象导入链（deploy-zip/fileio.import-export）：仅 DEV +
  // development/development-workbench；目标强制 $ 本地包，批量写入。
  if (CONTROLLED_REPOSITORY_IMPORT_TOOL_NAMES.has(toolName)
    && ((profile !== 'development' && profile !== 'development-workbench') || systemRole !== 'DEV')) {
    throw new SafeAbapError(
      'POLICY_DENIED',
      'policy',
      'Controlled repository import requires DEV development or development-workbench profile.'
    );
  }
  if (QUALITY_EXECUTION_TOOL_NAMES.has(toolName)
    && (profile !== 'development-workbench' || systemRole !== 'DEV')) {
    throw new SafeAbapError(
      'POLICY_DENIED',
      'policy',
      'Quality checks require DEV development-workbench profile.'
    );
  }
}
