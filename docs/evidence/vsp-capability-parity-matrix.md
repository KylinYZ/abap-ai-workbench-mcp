<!-- 本文件由 scripts/check-vsp-capability-parity.mjs 从同名 JSON 自动生成；禁止手工编辑。 -->

# VSP 能力对齐矩阵（Wave 1）

本矩阵回答一个问题：**VSP 用户可完成的 SAP 任务，本项目是否有等价任务路径**。
唯一真源是 `vsp-capability-parity-matrix.json`；本文件是生成视图，任何修改都会被 `--check` 门禁拒绝。

## 审计基线

| 项目 | commit | 工作树状态 |
| --- | --- | --- |
| VSP（只读对照） | `9886d2727f47506368b0a3c2f1c1766f1200f747` | dirty: 未提交 RFC/兼容层改动（pkg/adt/client.go、features.go、http.go 等已修改；abap/src/zvsp_compat/、docs/legacy-751-compat.md 等未跟踪） |
| 本项目 | `a8cdeda38dc4bbb8a98896e4f42e5925eed3d8ef` | dirty: 未提交多轮闲时成果（knowledge-queries 集群解码器工程轮 + git.abapgit 桥链路与部署补全轮：src/adt/GitBridgeApi.ts、scripts/deploy-abapgit-missing.mjs 等） |

生成日期：2026-10-06；矩阵行数：71。
profile 别名：focused 是 development-workbench 的默认入口别名；矩阵一律使用规范 profile 名，不使用 focused。

## 状态与证据词汇

- **MCP_SUPERSET** — 本项目完成同一任务，且多了可验证的安全或复读保证；计入完成率
- **EQUIVALENT** — 两边可完成同一任务，关键输入、输出和副作用相当；计入完成率
- **PARTIAL** — 只覆盖对象、参数、结果、系统角色或生命周期的一部分；不计入完成率
- **GAP** — VSP 已对外提供、本项目没有等价任务路径；不计入完成率
- **INTENTIONAL_RESTRICTION** — 因 QAS/PRD、无 SAP helper、无授权或不可安全验证而限制；必须写明替代路径和解除条件；不计入完成率
- **UNVERIFIED** — 代码存在但未完成当前版本的自动化或专用 DEV 验证；不计入完成率

证据等级：**source-audit**=仅完成双方源码对照审计，未经自动化或真实 SAP 验证；**automation**=已由本项目 Jest 自动化基线覆盖（运行时 catalog/profile/工作流测试）；**real-dev-verified**=已有专用 DEV 真机 create/readback/transport/cleanup/absence 证据（docs/evidence）；**released**=能力已随 npm 版本发布。

## 汇总

| 优先级 | MCP_SUPERSET | EQUIVALENT | PARTIAL | GAP | INTENTIONAL_RESTRICTION | UNVERIFIED | 合计 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P0 | 4 | 17 | 0 | 0 | 0 | 0 | 21 |
| P1 | 4 | 20 | 0 | 0 | 1 | 0 | 25 |
| P2 | 5 | 14 | 3 | 0 | 3 | 0 | 25 |
| 合计 | 13 | 51 | 3 | 0 | 4 | 0 | 71 |

计入完成率的行（MCP_SUPERSET + EQUIVALENT）：**64/71**；所有数字均为源码审计结论，未经真实 SAP 验证。

## P0 缺口（防回退关注点）

（无）

## 逐行矩阵

### source

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `source.read` | 读取 CLAS/PROG/INTF/FUNC/FUGR/INCL/DDLS/BDEF/SRVD/SRVB/MSAG/VIEW/ENHO 的源码 | SAP(action=read, target="<TYPE> <NAME>") 源码读取；focused GetSource | EQUIVALENT | P0 | `getObjectSource`、`inspectAbapObject`、`getAbapMemberSource` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `source.write` | 修改对象源码并完成锁/激活生命周期（含 CRUD UPDATE_SOURCE 与 method 粒度写入） | SAP(action=edit, params={source\|method,source}) 自动锁/激活；focused WriteSource/EditSource；CRUD UPDATE_SOURCE | MCP_SUPERSET | P0 | `previewAbapChange`、`applyAbapChange`、`getAbapChangeStatus` | development, development-workbench | DEV |
| `source.class-include` | 按 include 粒度编辑类成员（testclasses/definitions/implementations/macros） | SAP(action=edit, target="CLAS ...", params={include}) 类 include 写入 | MCP_SUPERSET | P0 | `previewAbapChange`、`applyAbapChange`、`getAbapChangeStatus` | development, development-workbench | DEV |

### read

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `read.object-metadata` | 读取对象结构化元数据（PROG/CLAS/INTF/FUNC/FUGR/INCL/TABL/DEVC/STRUCT/TYPE_INFO、包内容、函数组清单、类信息） | SAP(action=read) 元数据读取 + focused GetPackage/GetFunctionGroup/GetClassInfo/GetObjectStructure | EQUIVALENT | P0 | `objectStructure`、`objectStructureElements`、`inspectAbapObject` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `read.ddic-metadata` | 读取 DDIC 表/结构/类型信息与域、数据元素属性 | SAP(action=read, target="TABL\|STRUCT\|TYPE_INFO ...") + focused GetTable | EQUIVALENT | P0 | `describeClassicTable`、`ddicElement`、`ddicRepositoryAccess`、`getDomainProperties`、`getDataElementProperties` | development, development-workbench, business-readonly, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `read.table-contents` | 读取透明表数据内容与即席 OpenSQL 查询 | SAP(action=read, target="TABL_CONTENTS ...") + focused GetTable/GetTableContents/RunQuery | EQUIVALENT | P0 | `describeClassicTable`、`tableContents`、`runQuery` | development, development-workbench, business-readonly, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `read.cds-analysis` | 读取 CDS 依赖树、反向影响分析与元素元数据 | SAP(action=read, target="CDS_DEPS\|CDS_IMPACT\|CDS_ELEMENTS ...") + focused GetCDSDependencies/GetCDSImpactAnalysis/GetCDSElementInfo | EQUIVALENT | P1 | `getCdsDependencies`、`getCdsImpactAnalysis`、`getCdsElementInfo` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `read.coverage` | 运行单元测试并读取行级代码覆盖率 | SAP(action=read, target="COVERAGE ...") + focused GetCodeCoverage | EQUIVALENT | P1 | `runUnitCoverage` | development-workbench, legacy-full | DEV |
| `read.transaction` | 读取事务码元数据 | SAP(action=read, target="TRAN ...") | EQUIVALENT | P2 | `getTransaction` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `read.message-class-texts` | 读取消息类文本（SE91）与 MSAG 对象内容 | SAP(action=read, target="MSAG ...") + focused GetMessages | EQUIVALENT | P2 | `getMessages` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |

### search

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `search.objects` | 按名称模式搜索仓库对象与对象路径 | SAP(action=search, target="ZCL_*") + focused SearchObject | EQUIVALENT | P0 | `searchObject`、`findObjectPath`、`objectTypes` | development, development-workbench, business-readonly, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `search.content-grep` | 跨对象/包按源码内容正则搜索（grep） | SAP(action=grep, target=..., params={pattern}) + focused GrepObjects/GrepPackages | EQUIVALENT | P1 | `grepPackage`、`grepObjects` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |

### codeintel

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `codeintel.navigation` | 定义/引用跳转、类型层次、类组件、未激活对象与 ABAP 文档查询 | SAP(action=analyze, params={type:definition\|references\|type_hierarchy\|class_components\|inactive_objects\|abap_help}) + focused FindDefinition/FindReferences | EQUIVALENT | P0 | `findDefinition`、`usageReferences`、`usageReferenceSnippets`、`typeHierarchy`、`classComponents`、`inactiveObjects` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `codeintel.completion-format` | 代码补全、格式化与 pretty printer 设置读写 | SAP(action=analyze, params={type:completion\|pretty_print\|get_pretty_printer_settings\|set_pretty_printer_settings}) + focused PrettyPrint | EQUIVALENT | P1 | `codeCompletion`、`codeCompletionFull`、`codeCompletionElement`、`prettyPrinter`、`prettyPrinterSetting` | development, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `codeintel.context` | 压缩依赖上下文、ABAP 解析、依赖与变更影响分析 | SAP(action=analyze, params={type:context\|parse_abap\|analyze_deps\|effects}) + focused GetContext | EQUIVALENT | P1 | `getDependencyContext`、`analyzeDependencies`、`parseAbapSource`、`analyzeSourceEffects` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |

### devtools

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `devtools.syntax-check` | 对 ABAP/CDS 源执行语法检查 | SAP(action=analyze, params={type:syntax_check}) + focused SyntaxCheck | EQUIVALENT | P0 | `syntaxCheckCode`、`syntaxCheckCdsUrl` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `devtools.unit-tests` | 执行 ABAP Unit 测试并读取结果 | SAP(action=test, params={type:unit}) + focused RunUnitTests | EQUIVALENT | P0 | `previewQualityCheck`、`runQualityCheck`、`getQualityCheckStatus` | development-workbench | DEV |
| `devtools.atc-run` | 对对象发起 ATC 检查运行 | SAP(action=test, params={type:atc}) + focused RunATCCheck | EQUIVALENT | P0 | `previewQualityCheck`、`runQualityCheck`、`getQualityCheckStatus` | development-workbench | DEV |
| `devtools.atc-read` | 读取 ATC 结果工作清单、检查变体与定制 | SAP(action=test, params={type:atc\|atc_customizing}) 结果读取 + focused GetCheckRunResults | EQUIVALENT | P0 | `atcWorklists`、`atcCheckVariant`、`atcCustomizing`、`atcDocumentation` | development, development-workbench, diagnostic-readonly, operations-readonly, legacy-full | DEV, QAS, PRD |
| `devtools.activate` | 重新激活未激活对象（单对象/多对象/整包） | SAP(action=edit, target="ACTIVATE\|ACTIVATE_MULTI\|ACTIVATE_PACKAGE") + focused Activate/ActivatePackage | EQUIVALENT | P0 | `previewObjectActivation`、`applyObjectActivation`、`getObjectActivationStatus` | development, development-workbench | DEV |
| `devtools.execute-abap` | 直接执行 ABAP 片段并取回输出 | SAP(action=analyze, params={type:execute_abap}) | EQUIVALENT | P1 | `executeAbap` | development-workbench, legacy-full | DEV |

### crud

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `crud.create-object` | 创建仓库对象（包/表/程序/类/函数组/DDIC 域/数据元素/结构/CDS 等） | SAP(action=create, target="OBJECT\|DEVC\|TABL") + workflow create PROGRAM/CLASS_WITH_TESTS + focused CreatePackage/CreateTable | MCP_SUPERSET | P0 | `listRepositoryObjectCreationCapabilities`、`describeRepositoryObjectCreation`、`previewRepositoryObjectCreation`、`applyRepositoryObjectCreation`、`getRepositoryObjectCreationStatus` | development, development-workbench | DEV |
| `crud.delete-object` | 删除仓库对象 | SAP(action=delete, target="OBJECT ...") | MCP_SUPERSET | P0 | `previewRepositoryObjectCleanup`、`applyRepositoryObjectCleanup`、`getRepositoryObjectCleanupStatus` | development, development-workbench | DEV |
| `crud.clone-object` | 复制对象到新名称 | SAP(action=create, target="CLONE ...") + focused CloneObject | MCP_SUPERSET | P2 | `previewCloneObject`、`applyCloneObject`、`getCloneObjectStatus` | development, development-workbench | DEV |
| `crud.move-package` | 把对象移动到其他包 | SAP(action=edit, target="MOVE ...") + focused MoveObject | EQUIVALENT | P1 | `previewPackageChange`、`applyPackageChange` | development, development-workbench | DEV |
| `crud.recover-failed-create` | 恢复/清理一次失败的创建留下的半成品对象 | SAP(action=edit, target="RECOVER_FAILED_CREATE ...") | MCP_SUPERSET | P1 | `previewRepositoryObjectCleanup`、`applyRepositoryObjectCleanup`、`getRepositoryObjectCleanupStatus`、`getRepositoryObjectCreationStatus` | development, development-workbench | DEV |
| `crud.compare-source` | 对比两个对象的源码差异 | SAP(action=edit, target="COMPARE_SOURCE ...") + focused CompareSource | EQUIVALENT | P2 | `compareSourceObjects` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `crud.set-description` | 修改对象描述/短文本 | SAP(action=edit, params={editType:set_description}) | MCP_SUPERSET | P2 | `previewDescriptionChange`、`applyDescriptionChange`、`getDescriptionChangeStatus` | development, development-workbench | DEV |

### transport

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `transport.read` | 查询传输请求、配置与用户传输清单 | system type=list_transports\|get_transport\|get_user_transports\|get_transport_info + focused ListTransports/GetTransport | EQUIVALENT | P0 | `transportInfo`、`hasTransportConfig`、`transportConfigurations`、`getTransportConfiguration`、`userTransports`、`transportsByConfig`、`systemUsers`、`transportReference` | development, diagnostic-readonly, operations-readonly, legacy-full | DEV, QAS, PRD |
| `transport.create-release` | 创建、释放或删除传输请求 | system type=create_transport\|release_transport\|delete_transport | EQUIVALENT | P0 | `createTransport`、`transportRelease`、`transportDelete` | legacy-full | DEV |
| `transport.merge-move` | 合并传输请求或在请求间移动对象 | system type=merge_transports\|move_transport_object | INTENTIONAL_RESTRICTION | P2 | （无） | （无） | （无） |

### rfc

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `rfc.remote-enabled.call` | 通过 classic RFC 直连调用任意 remote-enabled 函数模块 | SAP(action=rfc, target="<FM>", params={op:call,args}) — open-rfc-go gateway 直连（非 ADT） | EQUIVALENT | P0 | `callRfm` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `rfc.remote-enabled.describe` | 描述 remote-enabled 函数模块接口（JSON Schema） | SAP(action=rfc, target="<FM>", params={op:describe}) | EQUIVALENT | P0 | `describeRfm` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `rfc.remote-enabled.discovery` | RFC 探测（RFC_SYSTEM_INFO/RFC_PING/probe 指纹）与 remote-enabled FM 搜索 | SAP(action=rfc, params={op:info\|ping\|probe\|search}) | EQUIVALENT | P1 | `inspectSapSystem`、`searchObject`、`packageSearchHelp`、`probeRfcSystem` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `rfc.helper-bridge` | 经 ZADT_VSP WebSocket helper 触发任意 FM 执行（含非 remote-enabled）与 Git 导出、报表执行等底座 | debug CALL_RFC + focused CallRFC；GitExport/RunReport 同底座 | EQUIVALENT | P1 | `helperCallRfm` | development-workbench, legacy-full | DEV |
| `rfc.remote-enabled.read-table` | 经 RFC 直读 DDIC 表（fields/where/top） | SAP(action=rfc, target="<TABLE>", params={op:read_table,fields,where,top}) | EQUIVALENT | P1 | `tableContents`、`runQuery`、`describeClassicTable`、`readRfcTable` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |

### debug

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `debug.session` | 调试会话生命周期：监听、附加、分离、单步、调用栈、变量查看 | SAP(action=debug, target="LISTEN\|ATTACH\|DETACH\|STEP\|GET_STACK\|GET_VARIABLES") + focused Debugger* | MCP_SUPERSET | P1 | `previewDebugOperation`、`applyDebugOperation`、`authorizeDebugSession`、`executeDebugCommand`、`getDebugOperationStatus`、`revokeDebugSession` | development, development-workbench | DEV |
| `debug.breakpoints` | 外部断点的设置、查询与删除 | SAP(action=debug, target="SET_BREAKPOINT\|GET_BREAKPOINTS\|DELETE_BREAKPOINT") + focused Set/Get/DeleteBreakpoint | MCP_SUPERSET | P1 | `previewDebugOperation`、`applyDebugOperation`、`debuggerListeners` | development, development-workbench | DEV |
| `debug.amdp-adt` | AMDP（HANA）存储过程调试（ADT 原路径） | SAP(action=debug, target="AMDP_ADT_START\|AMDP_ADT_BREAKPOINT\|AMDP_ADT_AWAIT\|AMDP_ADT_STOP") | EQUIVALENT | P1 | `checkAmdpDebugger`、`previewDebugOperation`、`applyDebugOperation`、`getDebugOperationStatus` | development, development-workbench | DEV |
| `debug.amdp-helper` | AMDP 调试（ZADT_VSP helper WebSocket 路径） | SAP(action=debug, target="AMDP_START\|AMDP_RESUME\|AMDP_STOP\|AMDP_STEP\|AMDP_GET_VARIABLES\|AMDP_SET_BREAKPOINT\|AMDP_GET_BREAKPOINTS") | INTENTIONAL_RESTRICTION | P1 | （无） | （无） | （无） |

### report

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `report.run` | 执行 ABAP 报表（带参数/变体）并捕获 ALV 输出 | SAP(action=debug, target="RUN_REPORT") + focused RunReport（ZADT_VSP WebSocket 底座） | EQUIVALENT | P1 | `runReport` | development-workbench, legacy-full | DEV |
| `report.async` | 后台执行报表并轮询取回异步结果 | SAP(action=debug, target="RUN_REPORT_ASYNC\|GET_ASYNC_RESULT") + focused RunReportAsync/GetAsyncResult | EQUIVALENT | P1 | `submitReportJob`、`listJobs`、`readSpoolContent` | development-workbench, legacy-full | DEV |
| `report.variants` | 列出报表变体 | SAP(action=debug, target="GET_VARIANTS") + focused GetVariants；analyze type=variants | EQUIVALENT | P1 | `getReportVariants` | development, diagnostic-readonly, development-workbench, operations-readonly, legacy-full | DEV, QAS, PRD |
| `report.text-elements` | 读写程序文本池/文本元素 | SAP(action=debug, target="GET_TEXT_ELEMENTS\|SET_TEXT_ELEMENTS") + focused Get/SetTextElements | MCP_SUPERSET | P2 | `getTextElements`、`previewDdicPropertyChange`、`applyDdicPropertyChange` | development, development-workbench | DEV |

### diagnostics

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `diagnostics.dumps` | 运行时错误（ST22 dump）列表、详情与聚合分析 | SAP(action=analyze, params={type:list_dumps\|get_dump\|group_dumps\|explain_dump\|similar_dumps\|dump_impact}) + focused ListDumps/GetDump | EQUIVALENT | P1 | `readRuntimeDumps`、`analyzeRuntimeErrors`、`groupRuntimeDumps`、`findSimilarDumps` | development, development-workbench, diagnostic-readonly, operations-readonly, legacy-full | DEV, QAS, PRD |
| `diagnostics.application-log` | 读取 BAL 应用日志（SLG1） | SAP(action=analyze, params={type:application_log}) | EQUIVALENT | P1 | `readApplicationLog` | development, development-workbench, diagnostic-readonly, operations-readonly, legacy-full | DEV, QAS, PRD |
| `diagnostics.spool-jobs` | 后台作业清单/日志与 spool 请求读取 | SAP(action=analyze, params={type:spool_list\|spool_read\|job_list\|job_log}) | EQUIVALENT | P1 | `listSpoolRequests`、`listJobs`、`readSpoolContent` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `diagnostics.knowledge-queries` | FM 测试数据、文档、IMG 活动检索等诊断辅助查询 | SAP(action=analyze, params={type:fm_test_data\|documentation\|img_search\|img_activity\|cluster_read}) | EQUIVALENT | P2 | `getAbapDocumentation`、`searchImgActivities`、`getImgActivity`、`getFmTestDataSets` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `diagnostics.traces` | ABAP profiler/性能跟踪文件列表与命中分析 | SAP(action=analyze, params={type:list_traces\|get_trace}) + focused ListTraces/GetTrace | EQUIVALENT | P1 | `tracesList`、`tracesListRequests`、`tracesHitList`、`tracesStatements`、`tracesDbAccess` | development, development-workbench, diagnostic-readonly, operations-readonly, legacy-full | DEV, QAS, PRD |
| `diagnostics.sql-trace` | SQL 跟踪（ST05）状态与记录读取 | SAP(action=analyze, params={type:sql_trace_state\|list_sql_traces}) + focused GetSQLTraceState/ListSQLTraces | EQUIVALENT | P1 | `tracesDbAccess`、`tracesStatements` | development, development-workbench, diagnostic-readonly, operations-readonly, legacy-full | DEV, QAS, PRD |

### analysis

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `analysis.callgraph` | 调用图/调用者/被调用者分析与静态-动态对比 | SAP(action=analyze, params={type:call_graph\|callers\|callees\|analyze_call_graph\|compare_call_graphs\|trace_execution}) + focused GetCallGraph/GetCallersOf/GetCalleesOf/AnalyzeCallGraphs/CompareCallGraphs/TraceExecution | EQUIVALENT | P0 | `usageReferences`、`usageReferenceSnippets`、`typeHierarchy`、`getCallees` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `analysis.boundaries` | 包边界违规检查（clean core） | SAP(action=analyze, params={type:check_boundaries,package}) + focused CheckBoundaries | EQUIVALENT | P2 | `checkPackageBoundaries` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `analysis.lint` | 离线 ABAP 静态分析（abaplint） | SAP(action=lint) 或 SAP(action=analyze, params={type:lint}) + focused AnalyzeABAPCode | EQUIVALENT | P2 | `analyzeLint` | development, diagnostic-readonly, development-workbench, operations-readonly, legacy-full | DEV, QAS, PRD |
| `analysis.history` | 共同变更、影响面、变更单历史与传输边界分析 | SAP(action=analyze, params={type:co_change\|impact\|cr_history\|tr_boundaries\|cr_boundaries\|health\|loads\|graph_stats\|where_used_config\|usage_examples}) | EQUIVALENT | P2 | `revisions`、`transportInfo`、`getCrHistory`、`getCoChange`、`getLoadGraph`、`analyzeDependencyGraph`、`buildLoadDependencyGraph`、`getTransportScope`、`getWhereUsedConfig`、`getUsageExamples`、`analyzeHealth`、`getImpactAnalysis` | development-workbench, legacy-full | DEV |

### git

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `git.abapgit` | abapGit 对象类型查询与包/对象导出 | system type=git_types\|git_export + focused GitTypes/GitExport（ZADT_VSP WebSocket 底座） | EQUIVALENT | P1 | `gitTypes`、`gitExport` | development-workbench, legacy-full | DEV |

### install

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `install.zadt-vsp` | 向 SAP 端部署 ZADT_VSP WebSocket helper | system type=install_zadt_vsp + focused InstallZADTVSP | INTENTIONAL_RESTRICTION | P2 | （无） | （无） | （无） |
| `install.abapgit` | 向 SAP 端部署 abapGit（standalone/dev edition） | system type=install_abapgit + focused InstallAbapGit | INTENTIONAL_RESTRICTION | P2 | （无） | （无） | （无） |
| `install.deploy-zip` | 从 abapGit 格式 ZIP 批量导入对象到包 | system type=deploy_zip + focused DeployZip | PARTIAL | P2 | `previewRepositoryObjectImport`、`applyRepositoryObjectImport`、`getRepositoryObjectImportStatus` | development, development-workbench | DEV |
| `install.diagnostics` | 安装依赖清单与安装自检 | system type=list_dependencies\|install_dummy_test + focused ListDependencies/InstallDummyTest；system FEATURES | EQUIVALENT | P2 | `healthcheck`、`featureDetails`、`checkInstallPrerequisites` | development, diagnostic-readonly, legacy-full | DEV, QAS, PRD |

### fileio

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `fileio.import-export` | 本地文件与 SAP 对象的批量导入/导出及文件侧重命名 | SAP(action=system\|edit, params={fileType:deploy_from_file\|save_to_file\|rename}) + focused ImportFromFile/ExportToFile | PARTIAL | P2 | `previewRepositoryObjectImport`、`applyRepositoryObjectImport`、`getRepositoryObjectImportStatus` | development, development-workbench | DEV |

### refactor

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `refactor.rename` | 对象/元素重命名（评估、预览、执行） | SAP(action=system\|edit, params={fileType:rename}) | MCP_SUPERSET | P2 | `previewControlledRename`、`applyControlledRename`、`getControlledRenameStatus` | development, development-workbench | DEV |

### ui5

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ui5.read` | UI5/Fiori BSP 应用发现与文件读取 | SAP(action=read, target="UI5_LIST\|UI5_APP\|UI5_FILE") + focused UI5ListApps/UI5GetApp/UI5GetFileContent | EQUIVALENT | P2 | `ui5ListApps`、`ui5GetApp`、`ui5GetFileContent` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `ui5.write` | UI5 应用与文件的创建/上传/删除 | SAP(action=create\|edit\|delete, target="UI5_APP\|UI5_FILE") | PARTIAL | P2 | `previewUi5Operation`、`applyUi5Operation`、`getUi5OperationStatus` | development, development-workbench | DEV |

### i18n

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `i18n.read` | 按语言读取对象文本、数据元素标签、消息文本与语言对比 | SAP(action=i18n, params={op:texts\|data_element_labels\|message_class_texts\|text_pool\|compare_languages}) + focused GetObjectTextsInLanguage/GetDataElementLabels/GetMessageClassTexts/GetTextPool/CompareLanguages | EQUIVALENT | P2 | `getTextElements`、`getDomainProperties`、`getDataElementProperties`、`getMessages`、`getObjectContentInLanguage`、`getDataElementLabels`、`getTextPoolInLanguage`、`compareObjectLanguages` | development, development-workbench, diagnostic-readonly, legacy-full | DEV, QAS, PRD |
| `i18n.write` | 写入数据元素标签与消息类文本 | SAP(action=i18n, params={op:write_labels\|write_message_texts}) | MCP_SUPERSET | P2 | `previewMessageTextChange`、`applyMessageTextChange`、`getMessageTextChangeStatus` | development, development-workbench | DEV |

### revisions

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `revisions.list` | 查询对象版本历史 | SAP(action=revisions, params={op:list}) + focused GetRevisions | EQUIVALENT | P2 | `revisions` | development, development-workbench, diagnostic-readonly, operations-readonly, legacy-full | DEV, QAS, PRD |
| `revisions.source` | 读取指定历史版本的源码 | SAP(action=revisions, params={op:source}) + focused GetRevisionSource | EQUIVALENT | P2 | `revisions`、`getRevisionSource` | development, development-workbench, diagnostic-readonly, operations-readonly, legacy-full | DEV, QAS, PRD |
| `revisions.compare` | 对比两个版本差异 | SAP(action=revisions, params={op:compare}) + focused CompareVersions | EQUIVALENT | P2 | `revisions`、`getRevisionSource`、`compareRevisions` | development, development-workbench, diagnostic-readonly, operations-readonly, legacy-full | DEV, QAS, PRD |

### service-binding

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `service-binding.publish` | 发布/取消发布服务绑定 | SAP(action=edit, target="PUBLISH_SERVICE\|UNPUBLISH_SERVICE") | MCP_SUPERSET | P1 | `previewRapOperation`、`applyRapOperation` | development, development-workbench | DEV |

### system

| id | 任务 | VSP surface | 状态 | 优先级 | 本项目任务路径 | profiles | roles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `system.info` | 系统信息、组件清单、连接与特性自检 | SAP() 空调用 info + SAP(action=system, target="INFO\|COMPONENTS\|CONNECTION\|FEATURES") + focused GetSystemInfo/GetInstalledComponents | EQUIVALENT | P0 | `inspectSapSystem`、`healthcheck`、`sapDoctor` | development-workbench, business-readonly, operations-readonly | DEV, QAS, PRD |
| `system.help` | 使用帮助与下一步指引 | SAP(action=help, target=tips) + SAP(action=info) | EQUIVALENT | P2 | `sap`、`sapDoctor` | development-workbench | DEV, QAS, PRD |

## 与 VSP 的有意差异（INTENTIONAL_RESTRICTION）

- **`transport.merge-move`**（P2）：ADT REST 层不存在传输合并/对象移动资源（VSP pkg/adt/transport_merge.go@9886d272 头注：SE09 Utilities→Reorganize 在 ADT 无对应面；organizer 资源只能加对象/改属主/释放，不能移除条目）。SE09 背后 FM TR_MERGE_REQUESTS、TR_APPEND_TO_COMM_OBJS_KEYS、TRINT_DELETE_COMM_OBJECT_KEYS 均非 remote-enabled，VSP 自身也必须经 ZADT_VSP 的 CALL FUNCTION WebSocket 桥关对话框执行。语义上 merge=把 from 的任务与对象并入 to 后删除 from（非空请求删除）、move=FM 直改 E071/E071K，与本项目传输安全红线（释放/改属主/加用户/删非空或他人请求与直改 E071·E071K 一律禁止）直接冲突；且当前 sap-demo client 300 未部署 ZCL_VSP_* helper 桥（2026-10-03 核实仅 SAPC/SICF 配置面）。维持不做。
  解除条件：仅当同时满足：1) 目标 DEV 部署 ZADT_VSP CALL FUNCTION 桥并通过 install.diagnostics 可用性诊断；2) 所有者显式放开传输红线并完成受控工作流设计评审（补偿/审计/回滚语义）。二者缺一即维持限制，无当前计划。
- **`debug.amdp-helper`**（P1）：AMDP helper 调试依赖 SAP 端 ZADT_VSP helper 对象；本项目不自动部署 SAP 端对象，也不在缺 helper 时退化成不受控调用。
  解除条件：专用 DEV + 明确授权 + helper 前置检查通过并完成独立风险评审后单独评估。
- **`install.zadt-vsp`**（P2）：本项目不自动在 SAP 端安装/部署对象；helper 部署属于有业务副作用的系统变更。
  解除条件：用户在 SAP 端自行完成安装后，本项目仅提供只读前置检查与诊断。
- **`install.abapgit`**（P2）：本项目不自动在 SAP 端安装/部署对象；abapGit 部署属于有业务副作用的系统变更。
  解除条件：用户在 SAP 端自行完成安装后，本项目仅提供只读前置检查与诊断。

