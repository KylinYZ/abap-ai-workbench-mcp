# 当前进度

更新时间：2026-10-08（受控导入工作流离线落地轮）

## 结论

- 代码版本：`0.10.0`（npm 包 `abap-ai-workbench-mcp@0.10.0`，见 CHANGELOG；0.10.0 = S/4 低版本适配：版本能力协商 + 72 字符兼容 + kind 收窄；0.9.0 的 v2 双栈细节见下）：协议栈迁移 MCP 官方 v2 双栈——原生 2026-07-28（`server/discover` 应答，根除 ZCode 0.16.9+ auto 协商超时）+ 2025 legacy 兼容；受控确认流 MRTR 化（legacy 经官方 shim 保持 elicitation/create，v1 宿主零感知）。证据：[v2 双栈迁移实证](docs/evidence/mcp-v2-dual-era-verified.md)、[步骤 0 API 定型](docs/evidence/mcp-v2-migration-api-probe.md)。生产依赖 `@modelcontextprotocol/server@2.2.0`（v1 SDK 移 devDeps 作 2025 回归资产）。是否发布 npm 及用户部署状态待定；ZCode 0.16.9 真机终验待做；真实 DEV 确认链与关键链路已于 2026-09-29 用 sap-demo 复跑全绿（message-text/recover/where-used/transport-crossref/rename-controlled 双确认链，证据见 mcp-v2-dual-era-verified.md）。
- 自动化门禁：2026-09-29 起 `npm test -- --runInBand` 通过，174 suites / 1860 tests（连续两轮全绿）；`npm run build` 通过。受控传输请求创建链（仅创建）已落地：`previewTransportCreation`/`applyTransportCreation`/`getTransportCreationStatus`，DEV + development/development-workbench 专属，原生确认 + create/readback 双步验证，释放/删除/改属主/直改 E071·E071K 维持禁止；2026-09-29 当天完成 sap-demo 真机 smoke（SMOKE OK）；同日所有者边界调整"空请求允许删除"，落地受控清理三件套（preview 三条红线：未释放 D+零对象+本人属主 → 原生确认 → 删除+缺席验证），4 个残留空请求已经受控链删除并缺席复核，smoke 扩展自清理后零残留（SMOKE OK + CLEANUP OK），证据见 docs/evidence/transport-creation-real-dev-verified.md。
- VSP 能力对齐 **64/71**（MCP_SUPERSET=13、EQUIVALENT=51、PARTIAL=3、INTENTIONAL_RESTRICTION=4）；本轮（受控导入轮）`install.deploy-zip` 与 `fileio.import-export` 双行 IR→PARTIAL 离线落地——受控导入三件套 `previewRepositoryObjectImport`/`applyRepositoryObjectImport`/`getRepositoryObjectImportStatus`（仅 DEV + development/development-workbench）：abapGit ZIP（zipPath/zipBase64）→ `$` 本地包批量 CLAS/INTF/PROG，immutable plan（逐对象存在性/漂移基线）+ 原生确认 + 逐对象"建/改→锁→写→语法检查→激活→readback"，首失败即停、写后异常 OUTCOME_UNKNOWN 终结；Jest 27 例新增全绿；**v2 双包模式落地并 sap-dev 真机 SMOKE 11/11 PASS**（`npm run test:import-real-dev`：transportable 模式 CLAS/PROG 全链 corrNr+typed-ref 激活+update 轮漂移基线+corrNr 锁清理；local 模式 PROG-only；证据 docs/evidence/repository-import-real-dev-verified.md）。**激活 body 根因发现并修复**：activate 字符串简写 body 缺 adtcore:type/parentUri 致激活器无法定位非活动版本（"同名已存在/骨架激活/无 PUBLIC SECTION"三症状同根，跨两台系统）——导入链与受控创建链 SourceObjectCreationAdapter 均改 typed objectReference。遗留（双系统同族 OO 生成器/激活队列损坏，skip 语义留档）：INTF 接口池生成、$ 本地包 OO 激活、CLAS testclasses 激活；2026-10-10 **analysis.lint 与 rfc.helper-bridge 双双晋级 EQUIVALENT**（analysis.lint：@abaplint/core npm scoped 包实为可用（先前定性修正），本地引擎+abap-mcp-server 集成配置借鉴；rfc.helper-bridge：所有者授权+allowlist 硬门受控收紧，ZCL_VSP_RFC_SERVICE call/getMetadata/search 三动作真机通；真机 SMOKE OK，证据见 [lint-helper-rfc 真机验证](docs/evidence/lint-helper-rfc-real-dev-verified.md)）；2026-10-07（五）**report 三行晋级 EQUIVALENT**（所有者放开报表执行方向；runReport=受控核包装作业链+spool 解码、submitReportJob=异步提交、getReportVariants=VARID/VARIT 只读；真机 SMOKE OK 11 PASS，证据见 [report 真机验证](docs/evidence/report-real-dev-verified.md)）；2026-10-07（四）**knowledge-queries 与 analysis.history 双双晋级 EQUIVALENT**（cluster_read=readClusterTable 任意 INDX 型集群表通用读取 + impact=getImpactAnalysis 多跳 WBCROSSGT 反向影响面，真机 SMOKE OK，证据见 [cluster-impact 真机验证](docs/evidence/cluster-impact-real-dev-verified.md)）；2026-10-07（三）**git.abapgit 晋级 EQUIVALENT**（部署补全 220 CLAS/INTF + zabapgit 表新建 + 真实 ZIP 导出核对 13 对象→23 文件 errors=0，证据见 [git-bridge 真机验证](docs/evidence/git-bridge-real-dev-verified.md)）；2026-10-07（二）git.abapgit 桥链路真机全通（sap-dev 授权轮）：客户端 data 字符串契约/skipped·errors 透出修复 + SAP 侧 ZCL_VSP_GIT_SERVICE 三改（INTF 容错/cx_root/错误诊断透出，经 ADT 锁改激活），剩余唯一阻塞精确定位为 abapGit 部署完整性（360/593，缺 233 对象清单已交付），补部署后预期晋级（证据见 [git-bridge 真机验证](docs/evidence/git-bridge-real-dev-verified.md)）；2026-10-07 knowledge-queries 的 fm_test_data payload 内容层收编（S/2 集群解码器 ClusterDataDecoder 全语义移植 + Go oracle 19/19 恒等 + 真机解码实数据，证据见 [fm-test-data-payload 真机验证](docs/evidence/fm-test-data-payload-real-dev-verified.md)；V5 嵌套表 0xAD 为与上游一致的已声明边界）；2026-10-06 `devtools.execute-abap` 由 PARTIAL 晋级 EQUIVALENT（受控 ABAP 执行链 `executeAbap` 真机 SMOKE OK，VSP ExecuteABAP 执行核移植，证据见 [execute-abap 真机验证](docs/evidence/execute-abap-real-dev-verified.md)）；`debug.amdp-adt` 已于 2026-10-03 由 PARTIAL 晋级 EQUIVALENT（A8 AMDP 原生调试受控工作流四操作真机全链 SMOKE OK，含 SAP 断点裁决 VALID 通路）；2026-10-04 第二波落地 AMDP_STEP/AMDP_READ_VARIABLE（自动化验证）；同日 sap-dev 跨系统复验：主工作流 14 步全绿（第二系统独立复现，HANA 会话证实），命中路径两系统同模式未递交（过程执行 rows=4 与判定 VALID 均真实但 ON_BREAK 不递交 + kind=STOP 生命周期事件，系统性前置缺失，证据见 [AMDP 工作流真机验证](docs/evidence/amdp-debugger-workflow-real-dev-verified.md)）。`analysis.history` 仍为 PARTIAL。loads、有界加载图和传输成员/结构边界组合链已由专用 DEV 真机证据覆盖核心路径；CR 分组、动态图边及图引擎完整性仍有缺口，详见[后续缺口与验收规划](docs/evidence/analysis-history-and-fm-test-data-roadmap.md)。
- **sap-dev 全功能真机战役（2026-10-04，所有者授权）**：focused 168 工具中直接实测 133 项（只读面 106 + 写入链 27）+ AMDP 专项；**7 项真缺陷/问题定性**（getObjectSource/classIncludes/unitTestEvaluation 同族崩溃、previewDdicPropertyChange metaData 路径崩溃、applyDescriptionChange sap-dev 未落地、文本池写读不对称、listJobs 错误不透明）+ 响应丢失族定性（克隆/重命名落地但响应超时丢失）+ 8 项环境/形态限制；部署发现 RFC_SYSNR=00/新验证传输 S4DK900109/validation 模式行为。明细见 [sap-dev 全功能战役](docs/evidence/sap-dev-full-campaign-2026-10-04.md)。
- **战役缺陷修复（同日）**：7 项中 6 项修复并真机复验 PASS（classIncludes 两步修复/unitTestEvaluation 契约/ValidateObjectUrl 防御/listJobs 空回退/DDIC OBJECT_NOT_FOUND/描述链诊断透传）；文本池持久性（解锁后回滚）留档开放问题，调用方需独立读回验证。基线升至 183 suites/2008 tests。
- **VSP 对齐收尾轮（2026-10-04，离线）**：矩阵 GAP 清零——`transport.merge-move` 定性 `INTENTIONAL_RESTRICTION`（勘察 VSP ui5 同源 transport_merge.go：ADT 无该资源面、SE09 背后 FM 非 remote-enabled、VSP 自身须走 CALL FUNCTION 桥且 merge=删非空请求/move=FM 直改 E071·E071K，撞传输红线；解除须 helper 桥+所有者显式放开）；`ui5.write` 受控写链离线落地（`previewUi5Operation`/`applyUi5Operation`/`getUi5OperationStatus`，四 kind create_app/upload_file/delete_file/delete_app，对齐 VSP filestore POST/PUT/DELETE 协议；preview 冻结+漂移复核+readback+UNKNOWN_OUTCOME+同值短路；filestore 写无 workbench 锁，事务边界由 preview/readback 补齐），晋级 `PARTIAL`，待真机 smoke（`ui5-write-real-dev-smoke`）。矩阵现为 55/71：MCP_SUPERSET=13、EQUIVALENT=42、PARTIAL=5、GAP=0、INTENTIONAL_RESTRICTION=11。基线 185 suites/2039 tests。证据：[ui5 写链离线落地](docs/evidence/ui5-write-controlled-offline.md)。同轮 health 子操作离线收编：`analyzeHealth` 工具（包级 tests/atc/boundaries/staleness 四信号 + 对象级三信号；VSP handlers_health.go 573 行逐行移植聚合与防缺陷语义——incomplete 阻断 GOOD、跑失败的测试记 ERROR 不冒充 PASS、零扫描边界不判 CLEAN；boundaries 包级复用已真机验证的 checkPackageBoundaries，对象级如实 UNKNOWN；执行级门控同 runUnitCoverage），12 单测全绿；四信号源各自已有真机证据、组合层真机端到端待验，`analysis.history` 维持 PARTIAL。证据：[health 离线收编](docs/evidence/health-summary-offline-alignment.md)。基线升至 186 suites/2051 tests。同日真机取证（sap-demo 10.30.254.48:8001/300，所有者授权）：ui5.write 经 curl 直连 ADT 打通 CSRF/会话与 GET 读面后，全部写方法被资源控制器 405 ExceptionMethodNotSupported 拒绝——该系统 ui5-bsp filestore 控制器为只读面（sap-adt feature 探测 ✗ui5 独立佐证），无残留对象，矩阵维持 PARTIAL、liftCondition 改为需具备写控制器的目标 DEV；analyzeHealth 组合层逐信号源取证：tests/boundaries/staleness 三信号全通且形态与 HealthCapability 契约一致（含 partial 上提防线），ATC 信号两次超客户端 30s 限制（errorSignal→verdict UNKNOWN 防线兜住，需 timeoutMs 提升重启后复验）；另发现 MCP runQuery 工具 datapreview 通道对 IN 列表 SQL 的独立缺陷（单值正常，analyzeHealth 走的 ADT 客户端通道不受影响）。**2026-10-06 收尾**：sap-dev 写面探测 405（ui5.write 双系统定性留档）；**ZADT_VSP helper 9 对象部署 sap-dev 完成**（$ZADT_VSP 本地包，_s4d_fix 修复版三服务类，幂等重激活零 E/A/X 零 inactive；本地包创建须 POST 集合端点+pack: 前缀+packageType=development 模板，锁链路必须复用本项目 ADT 协议栈——纯 python 复刻被拒），SAPC/SICF 两步交用户（服务面基线 501/404）。**用户完成配置后 WebSocket 端到端冒烟全通**（101 握手+accept 向量匹配、ping→pong:true、UNKNOWN_DOMAIN 结构化错误）；中途修复激活完整性问题（8 类 include 段 inactive 是 TY_MESSAGE 报错根因，分组循环激活至清零；inactive 复核正则大小写/斜杠敏感）与补依赖类 ZCL_ADT_00_AMDP_TEST；git 域按 abapGit 前置禁用（handler 注释注册行，启用需先装 abapGit）。git.abapgit nextMilestone=websocket-bridge-client-engineering。证据：[helper 部署](docs/evidence/zadt-vsp-helper-deploy-real-dev.md)。**同日深夜收官**：abapGit 迁移 v1.134.0 发布 tag（357 对象，三层根因修复：locals 引用闭包、版本混态、残留 main locals），SCC 拓扑激活清零，git 注册假阳性修复（正则匹配注释行），**WebSocket git 域端到端打通**（路由生效、export 真实执行），get_types 单点阻塞定位（INTF 序列化器动态 SQL 异常，非部署问题）。**桥客户端轮收官**：`gitTypes`/`gitExport` 两工具落地（ApcWebSocketBridge：node:net 最小 RFC6455 客户端，保留 Basic auth 头——Node 全局 WebSocket 不支持自定义头；GitBridgeApi 假服务端单测 9 例；DEV+workbench 门控，legacy-full 组合面含入）；真机连通验证通过，export/get_types 被同一 abapGit 运行时问题阻塞（is_type_supported(INTF) 单类型异常，已隔离留档）。基线 189 suites/2087 tests。客户端重启后继续直连端到端：analyzeHealth 对象级（262.7s，ATC 22 findings→WARN）与包级 Z001（211.9s，tests 真机发现并执行 2 个测试类、ATC 162 findings、staleness unsearched 精准抓到 7 个 ZCL_AMDP_DBG_* TADIR 孤儿并如实降级）双 scope 四信号全通；途中修复两个真机缺陷——isAdtNotFound 真机形态失配（AdtErrorException 状态码在 err 字段 + 本地化 message，此前致 previewUi5Operation 内部错误）与包级 tests 信号缺 NONE 分支（ran>0 且 classes=0 应报『没有测试』非 PASS）。基线 186 suites/2052 tests。
- `getFmTestDataSets` 已真机验证 EUFUNC 测试集目录与元数据读取；CLUSTD payload 未解码，不提供 inputs/outputs 内容。是否投入 S/2 集群解码器应先做独立可行性评估，不应扩大当前能力声明。
- datapreview CLUSTD wire 契约已离线锁定并经真机实证（2026-09-28，授权后只读探针）：CLUSTD=hex/type='X'/'<data>' 无属性、CLUSTR=INT2 片段字节数、LRAW 固定宽度+全零 padding，无损重组规则确立。oracle 解码轮：999 目录集群核心两对象 TE_DATADIR/FDESC_COPY 对象级可解码实锤；**多片段完整性真机实证**（RSZ_X_COMPONENT_GET 6 片 SRTF2 0..5 连续、组装器精确重组 19407 字节，VSP Join 语义离线组装器 +6 回归）。全量解码边界如实记录：V6 集群（原型白名单只收 V5，VSP 上游支持 V6）与 deep 嵌套 0xAD（上游同拒）。随附修复 createFmTestDataClient decode=false（DATS→Date 真机实锤的有损转换）。证据：[CLUSTD 真机取证](docs/evidence/fm-test-data-clustd-real-dev-verified.md)。decoder 接入维持 NO-GO：V6 路径与 %_I/%_V 输入输出对象解码为独立工程轮。
- 路线图与审计见 [`analysis.history / FM payload 路线图`](docs/evidence/analysis-history-and-fm-test-data-roadmap.md)、[analysis.history 缺口审计](docs/evidence/analysis-history-gap-audit.md)及[FM API 集成计划](docs/evidence/fm-test-data-api-integration-plan.md)。用户提供的 VSP checkout 已确认精确匹配矩阵固定 SHA，MIT 许可与内部 decoder/compressor 依赖已核实；隔离离线 v5 parser 原型及合成测试已完成，不连 SAP、不接 MCP。现有 EUFUNC fixtures 的再分发/脱敏状态和本项目 datapreview 的 CLUSTD wire 表示仍待核实；不得将原型描述为真实 payload 已验证。CR/LIMU 身份不得猜测，未知 ADT 协议先请求脱敏 Eclipse 抓包。发布与 MCP 客户端部署状态未在本轮核实。
- 仓库对象目录：31 类；`REAL_DEV_VERIFIED=28`、`CONTROLLED_IMPLEMENTED=1`、`AUTOMATION_VERIFIED=2`。
- 真实 DEV 验证使用专用配置及只读或受控流程；QAS/PRD 不写。组合链证据使用 `sap-demo`，只读 SQL，无写操作。
- 所有历史 `OUTCOME_UNKNOWN`、`COMPENSATED`、`COMPENSATION_FAILED` 计划均不可重放；新验证必须使用新身份和新 preview。

## 已达到 `REAL_DEV_VERIFIED`

`ABAP_CLASS`、`ABAP_INTERFACE`、`BEHAVIOR_DEFINITION`、`CDS_ACCESS_CONTROL`、`CDS_ASPECT`、`CDS_DATA_DEFINITION`、`CDS_METADATA_EXTENSION`、`CDS_TYPE`、`CHANGE_DOCUMENT_OBJECT`、`DATABASE_TABLE`、`DATA_ELEMENT`、`DDIC_DOMAIN`、`DDIC_STRUCTURE`、`DDIC_TABLE_TYPE`、`DDIC_TYPE_GROUP`、`FUNCTION_GROUP`、`FUNCTION_GROUP_INCLUDE`、`FUNCTION_MODULE`、`LOGICAL_EXTERNAL_SCHEMA`、`MESSAGE_CLASS`、`NUMBER_RANGE_OBJECT`、`NONT/NOT`、`PACKAGE`、`PROGRAM`、`PROGRAM_INCLUDE`、`RONT/ROT`、`SERVICE_BINDING`、`SERVICE_DEFINITION`。

逐类 evidence、对象身份、传输和 cleanup 证据以 [`docs/evidence/repository-creation-maturity-evidence.json`](docs/evidence/repository-creation-maturity-evidence.json) 为准；创建侧顺序和依赖见 [`docs/evidence/repository-validation-campaign-matrix.md`](docs/evidence/repository-validation-campaign-matrix.md)。

## 尚未晋级

| 对象 | 当前等级 | 原因 | 下一步 |
| --- | --- | --- | --- |
| `DDIC_LOCK_OBJECT` | `CONTROLLED_IMPLEMENTED` | 依赖表的真实创建与 cleanup 证据尚未形成 | 先取得专用 DEV 协议与完整生命周期证据 |
| `CDS_ANNOTATION_DEFINITION` | `AUTOMATION_VERIFIED` | 目标 SAP 明确拒绝创建授权 | 由 SAP 管理员补齐最小授权后，用新身份复测 |
| `CDS_ENTITY_BUFFER` | `AUTOMATION_VERIFIED` | 尚无满足目标约束的 active CDS 实体 | 准备可 buffer 的 active CDS 依赖后再验证 |

## 接手入口

1. 先读 `AGENTS.md` 和 [`docs/evidence/repository-creation-productionization-handoff.md`](docs/evidence/repository-creation-productionization-handoff.md)。
2. 再读当前 validation matrix 与 maturity manifest，不以本文件推断单个计划细节。
3. 需要历史根因时查 [`BLOCKED.md`](BLOCKED.md)、`CHANGELOG.md` 和对应 evidence 文档。
4. 修改源码或构建后硬重启 MCP；用新 healthcheck session 和旧 plan `PLAN_NOT_FOUND` 验收。

## 验证状态

| 事实面 | 状态 |
| --- | --- |
| 代码 | `verified-current`：当前分支源码、profile 计数和 maturity gate 有测试覆盖 |
| 运行态 | `pending`：本轮未重新连接真实 SAP 或发布环境 |
| 文档 | `changed-and-verified`：入口、指南、状态和证据索引已对齐 |
| 规则 | `changed-and-verified`：`AGENTS.md` 已压缩并指向唯一权威文档 |
| 记忆 | `generated-read-only`：未修改 Codex/Obsidian 记忆 |
| 工作区 | `verified-current`：未发现本轮生成的临时文档；未执行删除或清场 |

## 2026-09-16 闲时轮：devtools.activate 补跑——发现并修复 apply 自我死锁

- 矩阵行 `devtools.activate` 保持 UNVERIFIED（apply 真实激活执行仍未完成，三次尝试均中断，重试预算用尽即停）。
- 关键产出：定位 `applyObjectActivation` 未列入 `usesSapExecutionGate` 豁免名单，`maxConcurrentTools=1` 下确认后内部再次 `gate.run` 自我死锁（客户端 60s 超时、审计无 CONFIRMED、SAP 无副作用）——已修复并以 `serverGuardrails.test.ts` 回归测试覆盖（129 suites / 1178 tests 全绿）。
- 另明确：激活目标条目必须含 `adtcore:parentUri`（ZVIF2 等顶层 INTF/DTEL 不适用；ZVCL_CAMPAIGN 类可用）；smoke 脚本修复 TDZ 引用并放宽激活 apply 超时至 5 分钟。
- 真机结果：三次尝试分别中断于目标过滤、死锁（已修复）、SAP 端传输校验瞬时 500；自建残留 ZVACTSMOKE2 已受控清理并 absence 复查通过，无新增系统残留。
- 遗留：下轮直接重跑 `scripts/object-activation-real-dev-smoke.mjs`（目标 ZVCL_CAMPAIGN）预期一次通过；详见 `docs/evidence/object-activation-real-dev-partial-verified.md` 补跑记录。

## 2026-09-16 闲时轮（二）：devtools.activate 补跑通过——晋级 EQUIVALENT，矩阵 UNVERIFIED 清零

- 本地门禁全绿后一次通过真机 smoke：`scripts/object-activation-real-dev-smoke.mjs` 目标 ZVCL_CAMPAIGN，全部 18 项断言 PASS，输出 SMOKE OK。
- 审计完整链（plan `dd0f5874...`）：PREVIEW_CREATED（6 条目）→ OBJECT_ACTIVATION_CONFIRMED → OBJECT_ACTIVATION_COMPLETED（"activated 6 object(s), 0 still inactive"）；重复 apply 拒绝、目标离开未激活列表、自建对象清理 absence 复查均通过，并有独立新进程只读复查佐证。
- 上轮修复的 apply gate 自我死锁（serverGuardrails 豁免名单）即本次通过的关键前置，回归测试持续生效。
- 矩阵行 `devtools.activate` 晋级 EQUIVALENT（evidence + real-dev-verified）；矩阵现状：MCP_SUPERSET=6、EQUIVALENT=25、PARTIAL=17、GAP=17、INTENTIONAL_RESTRICTION=6、**UNVERIFIED=0**，对齐 31/71。
- 证据：`docs/evidence/object-activation-real-dev-verified.md`（新建）；partial 文档保留为历史过程。
- 遗留：剩余 GAP 集中在 RFC transport（需授权）、report/AMDP/UI5 写（RESTRICTION 方向）；前轮历史遗留 ZVACTSMOKE3 与旧 ENQ 锁未处理。

## 2026-09-16 闲时轮（三）：source.class-include 晋级 MCP_SUPERSET——类 include 受控写入链

- 本轮工作（循环推进目标第 1 项，唯一开放 P0）：previewAbapChange 扩展 classInclude 参数（definitions/implementations/macros/testclasses，仅 CLASS）。最小改动复用整条受控链——resolver 解析 include 可写源 URL 并冻结进 plan，锁/激活归属父类，确认消息显式标注 include 粒度；四层 mock 测试 +12。
- 本地门禁全绿：Jest 129 suites / 1190 tests、build、check:repository-creation-coverage、check:vsp-capability-parity、git diff --check。
- 真机闭环 smoke（scripts/class-include-real-dev-smoke.mjs，最终干净运行 17 项断言全 PASS、SMOKE OK）：自建类 ZVCLINCSMK → definitions include 真实写入+激活（plan APPLIED、SOURCE_VERIFIED、独立直读复查标记一致）→ 负例 VALIDATION_FAILED → 受控清理 absence 通过，零残留。审计含 3 轮完整 SOURCE_WRITTEN→OBJECT_ACTIVATED→SOURCE_VERIFIED→APPLY_COMPLETED（全部 elicitation 确认）。
- 过程要点：真实 include URI 形如 /includes/definitions；getObjectSource 带分页参数命中工具缓存（写后复查须直读）；该 DEV 新类也暴露 testclasses（四粒度全可解析）；一次 UNKNOWN_OUTCOME（慢时段 81s 超时）按边界只读探针确认实际已创建、未盲试。
- 矩阵：source.class-include PARTIAL → MCP_SUPERSET（evidence + real-dev-verified）。现状 MCP_SUPERSET=7、EQUIVALENT=25、PARTIAL=16、GAP=17、INTENTIONAL_RESTRICTION=6、UNVERIFIED=0，对齐 32/71。证据：docs/evidence/class-include-real-dev-verified.md；清理脚本已参数化支持 PROGRAM/ABAP_CLASS。
- 遗留：无系统残留。下一轮起点（预筛清单）：diagnostics.dumps（P1，dump 增值分析客户端聚合）。

## 2026-09-16 闲时轮（四）：diagnostics.dumps 晋级 EQUIVALENT——dump 增值分析客户端聚合

- 本轮工作（轮三预筛指定项）：新增 `groupRuntimeDumps`（ST22 dump 按"异常类型+终止程序"分组聚合，频次降序/最近优先，对齐 VSP GroupDumps 语义）与 `findSimilarDumps`（同类历史检索，回答"是新问题吗"，对齐 VSP similar 语义）；纯客户端聚合零新端点，数据源复用 RuntimeDumpReader。14 个 mock 用例 + 接线（runtimeTools 面 + workbench/operations 名单）。
- 本地门禁全绿：Jest 130 suites / 1204 tests、build、check:repository-creation-coverage、check:vsp-capability-parity、git diff --check。
- 真机验证（只读，7 天窗口）：groupRuntimeDumps 聚合 50 条真实 dump 为 22 组（Top：DBSQL_SQL_ERROR@CL_BATCH_SCHEDULER ×11）；findSimilarDumps 检索 DBSQL_SQL_ERROR 28 次历史（DDIC/SAPSYS/068157）。证据：docs/evidence/dump-analysis-real-dev-verified.md。
- 矩阵：diagnostics.dumps PARTIAL → EQUIVALENT（evidence + real-dev-verified）。现状：MCP_SUPERSET=7、EQUIVALENT=26、PARTIAL=15、GAP=17、INTENTIONAL_RESTRICTION=6、UNVERIFIED=0，对齐 33/71。
- 遗留（既有缺陷，非本轮引入）：readRuntimeDumps 服务端 runtimeError 过滤在该 DEV 系统报 InternalError（findSimilarDumps 已改为纯客户端匹配绕开）；ZVACTSMOKE3 残留对象与旧 ENQ 锁仍未处理。
- 下一轮起点建议：P1 PARTIAL 中 codeintel.context（dependency-context-spike）或 git.abapgit（abapgit-export-alignment，注意只读边界）；P2 的 ui5.read（ui5-readonly-spike）也可。

## 2026-09-17 闲时轮（五）：codeintel.context 晋级 EQUIVALENT——依赖上下文四只读工具

- 本轮工作（轮四预筛指定项）：dependency-context-spike 落地为四个只读工具——`getDependencyContext`（压缩依赖上下文 prologue：正则提取依赖→读者价值排序→只读 ADT 取源→公共契约提取与调用收窄，失败依赖显式列为 unresolved）、`analyzeDependencies`（regex 层依赖发现+疑似误报标注）、`parseAbapSource`（客户端词法/分句/分类）、`analyzeSourceEffects`（本地副作用与 LUW 归类）。VSP 参考实现 pkg/ctxcomp + handlers_effects.go 逐段移植并注明行号；取源串行（VSP 5 路并发→按串行红线收敛），预算按"到手契约"计、失败不占槽位。
- 本地门禁全绿：Jest 132 suites / 1257 tests、build、check:repository-creation-coverage、check:vsp-capability-parity、git diff --check；本能力新增 53 例单测（API 36 + Handlers 17）。
- 真机验证（scripts/context-analysis-real-dev-smoke.mjs，全程只读，零写操作）：focused catalog 四工具可见；grepPackage 枚举 Z001 候选，选中 ZCL_MCP_SM21_ADT_HTTP——3 依赖（CL_SYSLOG/CL_SYSLOG_FILTER/IF_HTTP_EXTENSION）3 契约全解析、prologue 130 行、stats 恒等式通过；契约名与依赖发现清单交叉一致；parse 176 条语句识别 CLASS_DEFINITION；LUW=safe 含边界声明；source 直传零 SAP 往返。最终 SMOKE OK。
- 真机发现并修复：ADT include 的 abapsource:sourceUri 为相对 URI（source/main），直接 getObjectSource 报 Invalid Object URL——已在 createSourceFetcher 增加 absolutizeSourceUrl（口径对齐 AbapMemberSourceReader.resolveSourceUrl，拒绝 ../:// 等），补 3 个单测。其余 smoke 前期失败均为脚本自身目标选择/断言问题，非被测能力缺陷。
- 矩阵：codeintel.context PARTIAL → EQUIVALENT（evidence + real-dev-verified）。现状 MCP_SUPERSET=7、EQUIVALENT=27、PARTIAL=14、GAP=17、INTENTIONAL_RESTRICTION=6、UNVERIFIED=0，对齐 34/71。证据：docs/evidence/context-analysis-real-dev-verified.md。
- 接线同步：index.ts + ToolProfiles（workbench 显式名单 +4）+ ToolOperationPolicy（read-only 类 +4）+ ToolCatalogIntegrity 计数（development=143、diagnostic-readonly=112、legacy-full=175、workbench=110）+ AGENTS.md 基线。
- 遗留：无系统残留（全程只读）。ZVACTSMOKE3 与旧 ENQ 锁仍为历史遗留。下一轮起点建议（预筛清单）：P2 的 ui5.read（ui5-readonly-spike）、revisions.source/compare（revision 源码读取与版本对比核实）、read.message-class-texts（message-class-read-spike）；P1 的 git.abapgit（abapgit-export-alignment，注意只读边界与 SAP 端 abapGit 前置）。

## 2026-09-17 闲时轮（六）：ui5.read 晋级 EQUIVALENT——UI5 filestore 只读三工具

- 本轮工作（预筛清单指定项）：ui5-readonly-spike 落地为三个只读工具——`ui5ListApps`（filestore 应用清单 Atom feed）、`ui5GetApp`（应用文件树）、`ui5GetFileContent`（文件原始内容）。VSP pkg/adt/ui5.go 只读方向移植（ui5.write 维持缺口）；应用名单级命名空间白名单 + 文件路径穿越拒绝（处理器参数层 InvalidParams 零网络往返 + API 层纵深防御），URL 由名称拼接整体转义。
- 行为增强：目标系统忽略 name 查询参数（专用 DEV 实测，VSP 同受影响），query 客户端 `*` 通配符过滤兜底。
- 本地门禁全绿：Jest 134 suites / 1277 tests、build、check:repository-creation-coverage、check:vsp-capability-parity、git diff --check；本能力新增 20 例单测（API 12 + Handlers 8）。
- 真机验证（scripts/ui5-readonly-real-dev-smoke.mjs，全程只读）：feed 3105 条返回 200 应用（含 /SAM4U/DASHBRD 命名空间形态）；Z* 客户端过滤正确（该 DEV 无自定义 UI5 应用）；ui5GetApp 文件树 17 条；ui5GetFileContent 真实读回 .Ui5RepositoryBinaryFiles（92 bytes）；穿越负例 InvalidParams 拒绝。最终 SMOKE OK（第一轮遇一次 ui5GetApp 瞬时失败，等待重试通过，未超预算）。
- 矩阵：ui5.read GAP → EQUIVALENT（evidence + real-dev-verified）。现状 MCP_SUPERSET=7、EQUIVALENT=28、PARTIAL=14、GAP=16、INTENTIONAL_RESTRICTION=6、UNVERIFIED=0，对齐 36/71。证据：docs/evidence/ui5-readonly-real-dev-verified.md。
- 接线同步：index.ts + ToolProfiles（workbench +3）+ ToolOperationPolicy（read-only +3）+ ToolCatalogIntegrity 计数（development=146、diagnostic-readonly=115、legacy-full=178、workbench=113）+ AGENTS.md 基线（134/1277）。
- 遗留：无系统残留（全程只读）。

## 2026-09-17 闲时轮（七）：diagnostics.spool-jobs 晋级 PARTIAL——spool/作业只读 SQL 子集

- 本轮工作（P1 优先级指定项）：job-spool-read-spike 落地为只读 SQL 子集二工具——`listSpoolRequests`（TSP01 清单 + TST01 头增补 storage/码页/行数/字节 + TBTCP 作业步骤反查，listident 补零 10 位）与 `listJobs`（TBTCO 清单含状态释义/起止时间/时长 + TBTCP 步骤增补）。VSP spool.go/jobs.go 自由 SQL 路径逐段移植；走 runQuery datapreview 通道（decode=true）。
- 边界（随结果 notes 返回，记 PARTIAL 而非 EQUIVALENT）：spool 内容读取（TST03/TemSe 解码）与作业日志（VSP 走 RFC/XBP，本项目暂无 RFC 传输）不在子集内；解除条件已写入矩阵行 liftCondition。
- 注入防线：名字类参数处理器层白名单（InvalidParams）、作业名放行通配、LIKE 转义+控制字符拒绝、日期校验、状态码白名单。
- 真机发现并适配端点缺陷：该 DEV datapreview 对 tbtco/tbtcp 的 WHERE+ORDER BY 组合确定性报解析错（"DES" is not allowed here——DESCENDING 段被丢弃；tsp01 正常）。已实测界定触发面，实现 `runWithOrderFallback`（VSP 原样优先 → 失败回退 WHERE-only + 客户端排序并在 notes 标注）。另把名字白名单预检上移到处理器参数层（InvalidParams 而非 InternalError）。
- 本地门禁全绿：Jest 136 suites / 1299 tests、build、coverage、parity、diff --check；本能力新增 21 例（API 13 + Handlers 8）。
- 真机验证（scripts/spool-jobs-real-dev-smoke.mjs，全程只读 SELECT）：近 7 天 50 作业（/IWXBE/EVENT_STATISTICS finished，步骤含程序）+ 50 spool（#23200 storage=D codepage=4103，作业引用 SAP_MM_PUR_PO_AND_IR_FROM_QTN）；交叉印证与注入负例通过。SMOKE OK。
- 矩阵：diagnostics.spool-jobs GAP → PARTIAL（evidence + real-dev-verified）。现状 MCP_SUPERSET=7、EQUIVALENT=28、PARTIAL=15、GAP=15、INTENTIONAL_RESTRICTION=6、UNVERIFIED=0，对齐 35/71。证据：docs/evidence/spool-jobs-real-dev-verified.md。
- 接线同步：index.ts + ToolProfiles（workbench +2）+ ToolOperationPolicy（read-only +2）+ ToolCatalogIntegrity 计数（development=148、diagnostic-readonly=117、legacy-full=180、workbench=115）+ AGENTS.md 基线（136/1299）。
- 遗留：无系统残留。本轮三能力（codeintel.context、ui5.read、diagnostics.spool-jobs）完成，输出汇总。下一轮预筛：read.message-class-texts（message-class-read-spike，P2）、revisions.source/compare（P2）、analysis.boundaries（package-boundary-spike，P2，纯客户端可仿 VSP graph/boundary.go）；P1 仅剩 git.abapgit（需 SAP 端 abapGit 前置）与 AMDP 调试（需 HANA AMDP 授权），均受环境前置约束。

## 2026-09-17 闲时轮（八）：read.message-class-texts 晋级 EQUIVALENT——消息类文本只读工具

- 本轮工作（预筛指定项）：message-class-read-spike 落地为只读工具 `getMessages`——GET /sap/bc/adt/messageclass/<名>（Accept vnd.sap.adt.mc.messageclass+xml），消息号+短文本按号升序，可选 sap-language 语言覆盖（VSP OverrideLanguage 同义）。VSP client.go GetMessageClass / i18n.go GetMessageClassTexts 只读方向移植；写入方向（i18n.write）维持缺口。
- 关键实现点：XML 属性按名后缀容错匹配（兼容 mc: 前缀与无前缀形态）；对该解析关闭 fast-xml-parser 属性数值化以保留 msgno 前导零（"001"）；名字白名单（≤20 位、可选单级命名空间）预检在处理器参数层（InvalidParams 零网络往返），API 层纵深防御。
- 本地门禁全绿：Jest 138 suites / 1315 tests、build、coverage、parity、diff --check；本能力新增 16 例单测（API 8 + Handlers 8）。
- 真机验证（scripts/message-class-read-real-dev-smoke.mjs，全程只读 GET）：标准消息类 00 读回 901 条（前导零保留、升序、计数一致）；sap-language=EN/DE 均成功（901 条 DE/EN 文本差异 0，仅记录）；注入负例 InvalidParams 拒绝。SMOKE OK。
- 矩阵：read.message-class-texts GAP → EQUIVALENT（evidence + real-dev-verified）。现状 MCP_SUPERSET=7、EQUIVALENT=29、PARTIAL=15、GAP=14、INTENTIONAL_RESTRICTION=6、UNVERIFIED=0，对齐 36/71。证据：docs/evidence/message-class-read-real-dev-verified.md。
- 接线同步：index.ts + ToolProfiles（workbench +1）+ ToolOperationPolicy（read-only +1）+ ToolCatalogIntegrity 计数（development=149、diagnostic-readonly=118、legacy-full=181、workbench=116）+ AGENTS.md 基线（138/1315）。
- 遗留：无系统残留。下一轮预筛：revisions.source（revision-source-read，核实版本源码读取）或 revisions.compare（revision-compare-spike）、analysis.boundaries（package-boundary-spike，可仿 VSP graph/boundary.go 纯客户端）、i18n.read（i18n-language-read-spike，可与既有 getTextElements/domain/数据元素标签拼接）；P1 仅剩 git.abapgit 与 AMDP（环境前置受限）。

## 2026-09-17 闲时轮（九）：revisions.source 晋级 EQUIVALENT——版本源码只读工具

- 本轮工作（预筛指定项）：revision-source-read 落地为只读工具 `getRevisionSource`——输入 objectType+objectName+版本选择器（版本标签精确匹配或清单 1-based 序号），不带选择器为发现模式返回版本清单。与 VSP 的安全差异：不接受调用方 version_uri（任意 URL），版本与源 URI 全部服务端解析（quick search 精确匹配 → revisions 清单 → 版本源码 GET，解析口径复用依赖上下文取源链）。
- 接线同步：index.ts + ToolProfiles（workbench 显式名单 +1；OPERATIONS_READONLY 显式追加 getRevisionSource，与 revisions 清单同级运维诊断，operations 计数 44→45）+ ToolOperationPolicy（read-only +1）+ ToolCatalogIntegrity 计数（development=150、diagnostic-readonly=119、legacy-full=182、workbench=117、operations=45）+ AGENTS.md 基线（140/1331）。
- 本地门禁全绿：Jest 140 suites / 1331 tests、build、coverage、parity、diff --check；本能力新增 16 例单测（API 8 + Handlers 8）。中途 VspCapabilityParity 测试拦获矩阵行声明 operations-readonly 但工具未入运维名单的一致性缺口，已按"补充运维名单"修正（正是防回退门禁的设计意图）。
- 真机验证（scripts/revision-source-real-dev-smoke.mjs，全程只读）：ZVCL_CAMPAIGN 发现模式返回版本清单（标签=传输号 S4HK900009）；index=1 读回 14 行源码；小写标签回填与序号路径读到同一版本（内容一致）；未知标签/非法名字/非法 objectType 参数层拒绝。SMOKE OK。
- 矩阵：revisions.source PARTIAL → EQUIVALENT（evidence + real-dev-verified）。现状 MCP_SUPERSET=7、EQUIVALENT=30、PARTIAL=14、GAP=14、INTENTIONAL_RESTRICTION=6、UNVERIFIED=0，对齐 37/71。证据：docs/evidence/revision-source-real-dev-verified.md。
- 遗留：无系统残留。剩余可做项：revisions.compare（版本间 diff spike）、analysis.boundaries（纯客户端边界检查）、i18n.read（语言覆盖读取拼接）、analysis.history（co-change 等）、install.diagnostics（helper 前置只读检查）等 P2；P1 的 git.abapgit/AMDP 受环境前置约束。

## 2026-09-17 闲时轮（十）：revisions.compare 晋级 EQUIVALENT——版本对比只读工具

- 本轮工作（预筛指定项）：revision-compare-spike 落地为只读工具 `compareRevisions`（挂在 RevisionSourceHandlers，revisions 域三工具齐全）——两侧选择器接受版本标签（大小写不敏感）/清单序号/`current`（version2 缺省 current，与 VSP 一致），输出 LCS unified diff（3 行上下文 hunks）+ identical 判定 + 增删行计数。VSP revisions.go CompareVersions L69-119 + workflows_source.go generateUnifiedDiff L1447-1560 移植；版本与源 URI 服务端解析，不接受 version_uri 直传。
- 本地门禁：Jest 141 suites / 1339 tests、build、coverage、parity、diff --check 全绿；本能力新增 8 例单测（unifiedDiff hunk 头/上下文窗口/远距双 hunk 等）。第一轮门禁拦获 compareRevisions 未入策略分类/名单的接线遗漏（assertToolCatalogClassified 抛错），补齐后全绿——防回退门禁按设计生效。
- 真机验证（scripts/revision-compare-real-dev-smoke.mjs，全程只读）：ZVCL_CAMPAIGN 版本 S4HK900009 vs current 检出真实差异（+1/-1，hunk @@ -10,5 +10,5 @@，对象激活后被修改）；相同版本 identical=true；标签大小写不敏感与序号双路径一致；负例参数层拒绝。SMOKE OK（首跑遇旧 dist 失败一次，重建后通过，非能力缺陷）。
- 矩阵：revisions.compare PARTIAL → EQUIVALENT（evidence + real-dev-verified）。现状 MCP_SUPERSET=7、EQUIVALENT=31、PARTIAL=13、GAP=14、INTENTIONAL_RESTRICTION=6、UNVERIFIED=0，对齐 38/71。证据：docs/evidence/revision-compare-real-dev-verified.md。
- 接线同步：ToolProfiles（workbench +1、operations +1）+ ToolOperationPolicy（read-only +1）+ ToolCatalogIntegrity 计数（development=151、diagnostic-readonly=120、legacy-full=183、workbench=118、operations=46）+ AGENTS.md 基线（141/1339）。
- 遗留：无系统残留。revisions 域（清单/源码/diff）全部闭环。剩余可做项：analysis.boundaries（纯客户端边界检查）、i18n.read、analysis.history、install.diagnostics、codeintel.navigation 邻域补充等 P2；P1 git.abapgit/AMDP 受环境前置约束。

## 2026-09-17 闲时轮（十一）：i18n.read 晋级 EQUIVALENT——按语言只读四工具

- 本轮工作（预筛指定项）：i18n-language-read-spike 落地为四个按语言只读工具（挂 I18nReadHandlers）——`getObjectContentInLanguage`（对象内容按语言，源 URL 由 objectType+objectName 服务端解析，复用 RevisionSourceApi.resolveObjectSourceUrl）、`getDataElementLabels`（数据元素四段标签，Accept 必须用 vnd.sap.adt.dataelements.v2+xml——通用类型 406，VSP 实测注释）、`getTextPoolInLanguage`（文本池 symbols/selections/headings 三子资源，key=value 解析、@ 指令跳过、空文本保留、单子资源 404 记 missing 不报错）、`compareObjectLanguages`（双语行级对比 line-N 键，只返回差异/缺失）。消息类文本按语言已由 getMessages 覆盖；i18n.write 维持缺口。
- 本地门禁全绿：Jest 143 suites / 1352 tests、build、coverage、parity、diff --check；本能力新增 13 例单测（API 6 + Handlers 7）。
- 真机验证（scripts/i18n-language-read-real-dev-smoke.mjs，全程只读 GET）：LANGU 元素四段标签按语言读回（EN/DE 均德语原文——主语言回退行为与 note 一致）；RFITEMAP 文本池 106 条（missing=[]）；对象内容 1412 行；双语对比 differing=0 与代码行无语言差异预期一致；负例参数层拒绝。SMOKE OK。
- 矩阵：i18n.read PARTIAL → EQUIVALENT（evidence + real-dev-verified）。现状 MCP_SUPERSET=7、EQUIVALENT=32、PARTIAL=12、GAP=14、INTENTIONAL_RESTRICTION=6、UNVERIFIED=0，对齐 39/71。证据：docs/evidence/i18n-language-read-real-dev-verified.md。
- 接线同步：index.ts + ToolProfiles（workbench +4）+ ToolOperationPolicy（read-only +4）+ ToolCatalogIntegrity 计数（development=155、diagnostic-readonly=124、legacy-full=187、workbench=122、operations=46）+ AGENTS.md 基线（143/1352）。
- 遗留：无系统残留。剩余可做项：analysis.boundaries（纯客户端边界检查）、analysis.history（co-change 等）、install.diagnostics（helper 前置只读检查）、codeintel.navigation/completion-format 邻域核实；P1 git.abapgit/AMDP 受环境前置约束。

## 2026-09-17 规划修订轮：RFC 基座定为 open-rfc（矩阵 rfc.* 行说明改写）

- 决策（用户确认）：rfc-transport-spike 阶段 1 传输基座不再自研，采用本地 open-rfc（`D:\MyDev\SAP\open-rfc`，npm `open-rfc@0.2.3`，SDK-free TS classic RFC 客户端）。依据：VSP Go 版即依赖同源 open-rfc-go（`vibing-steampunk/go.mod` `replace => ../open-rfc-go`，`pkg/saprfc` 为薄桥接）；open-rfc 零运行时依赖、无 NW RFC SDK/原生插件，与本项目技术栈一致。
- 不变：`src/rfc/` 阶段 0 保留为门控与模型层（FmAllowlist 只读白名单、FM 接口/编解码/超时/连接池），open-rfc 仅作传输执行器适配进 TransportAdapter；`rfc.helper-bridge` 维持 INTENTIONAL_RESTRICTION（非 remote-enabled FM 经 helper 与 open-rfc 无关）；真实 RFC 仅专用 DEV 授权 smoke、QAS/PRD 只读。
- 变化：连接参数由既有 ADT 系统配置推导（不引入第二套凭据）；describe 经 open-rfc RFC_METADATA_GET 映射 `src/rfc/interface` 出 JSON Schema。
- 矩阵落点（状态全部不变，仅改 restrictionReason/liftCondition）：rfc.remote-enabled.call/describe（P0 GAP，nextMilestone 仍 rfc-transport-spike）、rfc.remote-enabled.discovery 与 rfc.remote-enabled.read-table（P1 PARTIAL）解除条件指向 open-rfc 基座；diagnostics.spool-jobs 的 liftCondition 同步；校验通过后计数不变（对齐 39/71）。
- 前置条件（阶段 1 开工前必须关闭，已写入计划文档修订节）：①open-rfc 要求 Node ^22.14/^24 而本项目 engines>=18（当前开发机 v20.18.0），需先完成引擎兼容评估；②依赖形态评审（npm 依赖 vs vendored，参照 third-party/abap-adt-api 先例与许可证记录）；③classic RFC 明文传输边界（无加密/对端认证，仅可信内网 DEV）纳入系统角色门控设计。
- 同步修正过期表述：计划文档 RFC 段落 + 新增「2026-09-17 规划修订」节、SpoolJobApi.ts 头注释、spool-jobs 证据文档边界节、PROGRESS.md 历史轮次中「RFC 方向排除」的措辞（历史事实不变，改为「暂无 RFC 传输」并指向新基座）。

## 2026-09-17 闲时轮（十二）：analysis.boundaries 晋级 EQUIVALENT——包边界只读检查工具

- 本轮工作（预筛指定项）：package-boundary-spike 落地为只读工具 `checkPackageBoundaries`——TADIR 枚举包内 PROG/CLAS/INTF → 逐对象串行读源码提取依赖（复用 ContextCompressionApi.extractDependencies）→ TADIR 按 kind 分组批查目标包 → 逐边裁定 SAME_PACKAGE/ALLOWED（白名单 glob `*`/`?`）/STANDARD（非 Z/Y 包）/VIOLATION/UNKNOWN，聚合 crossedPackages 与 violatingObjects。判定口径对齐 VSP graph/boundary.go 六类裁定；架构差异（VSP 预构建内存图 vs 本实现按需即时分析）已记录。动态调用检测（DYNAMIC 裁定）未实现，dynamic 恒 0 并在 notes 标注。
- 注入防线：包名处理器层白名单（InvalidParams 零网络往返）；目标包 IN 字面量由内部拼装（数据来自 TADIR）。
- 本地门禁全绿：Jest 144 suites / 1357 tests、build、coverage、parity、diff --check；本能力新增 13 例单测（API 5 + Handlers 8，含六类裁定/白名单通配/STANDARD 不进清单/空包边界）。
- 真机验证（scripts/boundary-check-real-dev-smoke.mjs，全程只读 SELECT/GET）：Z001 包枚举 15 对象、3 条依赖全部裁定 STANDARD（干净自有验证包），六类计数自洽；白名单路径因无跨包依赖以负例覆盖（分支由单测断言）；注入负例参数层拒绝。SMOKE OK。
- 矩阵：analysis.boundaries GAP → EQUIVALENT（evidence + real-dev-verified）。现状 MCP_SUPERSET=7、EQUIVALENT=33、PARTIAL=12、GAP=13、INTENTIONAL_RESTRICTION=6、UNVERIFIED=0，对齐 40/71。证据：docs/evidence/boundary-check-real-dev-verified.md。
- 接线同步：index.ts + ToolProfiles（workbench +1）+ ToolOperationPolicy（read-only +1）+ ToolCatalogIntegrity 计数（development=156、diagnostic-readonly=125、legacy-full=188、workbench=123、operations=46）+ AGENTS.md 基线（144/1357）。
- 遗留：无系统残留。所有者要求本轮完成后暂停迭代。剩余可做项（下批候选）：analysis.history（co-change 等只读分析）、install.diagnostics（helper 前置只读检查）、analysis.lint（需 abaplint 引擎）、codeintel.navigation/completion-format 邻域核实；P1 git.abapgit/AMDP 受环境前置约束。

## 2026-09-17 闲时轮（十三）：crud.compare-source 晋级 EQUIVALENT——对象间源码对比只读工具

- 本轮工作（P2 最小可关闭项）：compare-source 落地为只读工具 `compareSourceObjects`（挂 RevisionSourceHandlers，版本域四工具齐全）——两对象（CLAS/INTF/FUNC/PROG）各自经 quick search 精确解析当前源码 → identical 判定 → LCS unified diff（3 行上下文）→ 增删行计数 + 两侧行数。VSP workflows_source.go CompareSource L1403-1444 移植；源 URL 服务端解析，不接受任意 URL。复用 compareRevisions 的 unifiedDiff 与解析链，净增代码量小。
- 本地门禁全绿：Jest 144 suites / 1369 tests、build、coverage、parity、diff --check；本能力新增 10 例单测。过程中 compareRevisions 轮的同款教训再现一次（compareSourceObjects 漏入策略分类/名单 → assertToolCatalogClassified 拦获），补齐后全绿。
- 真机验证（scripts/compare-source-real-dev-smoke.mjs，全程只读 GET）：ZVCL_CAMPAIGN 自比 identical（14 行）；ZVCL_CAMPAIGN vs RFITEMAP（1412 行）检出真实差异 +1408/-10（unified hunk、两侧标注正确）；负例参数层拒绝。SMOKE OK。
- 矩阵：crud.compare-source GAP → EQUIVALENT（evidence + real-dev-verified）。现状 MCP_SUPERSET=7、EQUIVALENT=34、PARTIAL=12、GAP=12、INTENTIONAL_RESTRICTION=6、UNVERIFIED=0，对齐 41/71。证据：docs/evidence/compare-source-real-dev-verified.md。
- 接线同步：index.ts + ToolProfiles（workbench +1）+ ToolOperationPolicy（read-only +1）+ ToolCatalogIntegrity 计数（development=157、diagnostic-readonly=126、legacy-full=189、workbench=124、operations=46）。
- 新增协作规则（所有者本轮指示）：每轮完成后 git commit + push；网络不通走本地代理 127.0.0.1:7890。本轮起执行首次提交推送。
- 遗留：无系统残留。剩余可做项：analysis.history（co-change 等只读分析）、install.diagnostics（helper 前置只读检查）、read.transaction（事务码元数据）、analysis.lint（需 abaplint 引擎）等 P2；P1 git.abapgit/AMDP 受环境前置约束。

## 2026-09-17 闲时轮（十四）：read.transaction 晋级 PARTIAL——事务码元数据只读工具（描述通道环境受限）

- 本轮工作（预筛指定项）：read.transaction 落地为只读工具 `getTransaction`（挂 TransactionReadHandlers）——TSTC（事务码→承载程序 PGMNA）+ TSTCT（按语言 SPRSL 取描述 TTEXT）两条自由 SQL。VSP client.go GetTransaction L1384-1412 的任务语义移植；通道差异经真机实测确认。
- 真机实测发现（探针逐层定位）：① VSP 的 ADT vit/wb TRAN 端点在该 DEV 无 TRAN 映射（"No URI-Mapping defined"，SE38/SM37 双探针）；② 替代通道 TSTCT 的 datapreview 数据读取一律 Internal server error（无 WHERE/各种 WHERE 全形态，表结构 describe 正常）——环境级数据预览限制。
- 适配：TSTCT 描述查询容错为"缺失 + note 标注"（不让它拖垮 program 主语义）；"事务码不存在"按 InvalidParams 透出。矩阵如实记 PARTIAL（描述要素在目标环境不可得），liftCondition 写明解除条件。
- 本地门禁全绿：Jest 145 suites / 1383 tests、build、coverage、parity、diff --check；本能力新增 14 例单测（API 7 + Handlers 7，含 TSTCT 失败容错降级）。
- 真机验证（scripts/transaction-read-real-dev-smoke.mjs，全程只读 SELECT）：SE38 → 程序 RSABAPPROGRAM 正确；描述缺失 + note 标注 TSTCT 受限；DE 同样受限；ZZZZ9 不存在 → InvalidParams 含 TSTC 提示；注入负例参数层拒绝。SMOKE OK。
- 矩阵：read.transaction GAP → PARTIAL（evidence + real-dev-verified）。现状 MCP_SUPERSET=7、EQUIVALENT=34、PARTIAL=13、GAP=11、INTENTIONAL_RESTRICTION=6、UNVERIFIED=0，对齐 41/71。证据：docs/evidence/transaction-read-real-dev-verified.md。
- 接线同步：index.ts + ToolProfiles（workbench +1）+ ToolOperationPolicy（read-only +1）+ ToolCatalogIntegrity 计数（development=158、diagnostic-readonly=127、legacy-full=190、workbench=125、operations=47）+ AGENTS.md 基线（145/1383）。
- 遗留：无系统残留。剩余可做项：analysis.history（co-change 等只读分析）、install.diagnostics（helper 前置只读检查）、analysis.lint（需 abaplint 引擎）等 P2；P1 git.abapgit/AMDP 受环境前置约束。

## 2026-09-17 闲时轮（十五）：install.diagnostics 晋级 EQUIVALENT——安装前置只读发现工具

- 本轮工作（预筛指定项）：helper 前置只读 discovery 落地为只读工具 `checkInstallPrerequisites`（挂 InstallDiagnosticsHandlers，无入参）——ZADT_VSP helper TADIR 探测（LIKE 'ZADT_VSP%'，失败重试 1 次）+ abapGit ADT 服务可达性分类（/sap/bc/adt/abapgit/repos，v2 Accept；available/not_installed/forbidden/error 四态，"does not exist" 语义归 not_installed）+ 本地 Node 运行时。notes 明确"本服务器不做任何安装动作"（安装属 INTENTIONAL_RESTRICTION 行）。VSP 的 ListDependencies 是本地嵌入 ZIP 清单（安装动作输入），对本项目不适用，矩阵 restrictionReason 已记录差异。
- 本地门禁全绿：Jest 146 suites / 1394 tests、build、coverage、parity、diff --check；本能力新增 11 例单测（API 5 + Handlers 6）。
- 真机验证（scripts/install-diagnostics-real-dev-smoke.mjs，全程只读 SELECT/GET）：ZADT_VSP helper installed=false（该系统从未安装 helper；首轮 TADIR 瞬时 500 由重试吸收）；abapGit 分类 not_installed（ADT 报资源不存在，语义识别正确）；Node v22.22.2 报告；notes 边界生效。SMOKE OK。
- 矩阵：install.diagnostics PARTIAL → EQUIVALENT（evidence + real-dev-verified）。现状 MCP_SUPERSET=7、EQUIVALENT=35、PARTIAL=12、GAP=11、INTENTIONAL_RESTRICTION=6、UNVERIFIED=0，对齐 42/71。证据：docs/evidence/install-diagnostics-real-dev-verified.md。
- 接线同步：index.ts + ToolProfiles（workbench +1）+ ToolOperationPolicy（read-only +1）+ ToolCatalogIntegrity 计数（development=159、diagnostic-readonly=128、legacy-full=191、workbench=126、operations=48）+ AGENTS.md 基线（146/1394）。
- 遗留：无系统残留。剩余可做项：analysis.history（co-change 等只读分析）、analysis.lint（需 abaplint 引擎）、codeintel.navigation 邻域核实、crud.recover-failed-create/set-description/refactor.rename（写方向工作流，需谨慎设计）等 P2；P1 git.abapgit/AMDP 受环境前置约束。

## 2026-09-17 闲时轮（十六）：analysis.lint 归位 INTENTIONAL_RESTRICTION——abaplint 引擎不可得

- 调研结论：矩阵行 analysis.lint（P2 GAP，离线 ABAP 静态分析）的依赖 abaplint 引擎不可得——npm 包 abaplint 已于 2022-07 unpublish（2026-09-17 npm view 返回 404 实测）；VSP 依赖其内部 Go 转译版（pkg/abaplint，非公开包），本项目无法复用。
- 处理：按矩阵词汇归位 INTENTIONAL_RESTRICTION（GAP 移出可做桶），restrictionReason 记录 404 实测证据与替代路径（ADT 在线语法检查 syntaxCheckCode/syntaxCheckCdsUrl 已在 catalog，覆盖"发现语法错误"核心需求；abaplint 离线规则集无等价物），liftCondition 写明重新评估条件。
- 期间一次 JSON 转义事故（node -e 内嵌引号破坏 JSON），已 git checkout 恢复并以 JSON.parse 验证后重做。
- 现状：MCP_SUPERSET=7、EQUIVALENT=35、PARTIAL=12、GAP=10、INTENTIONAL_RESTRICTION=7、UNVERIFIED=0，对齐 42/71（完成率不变，GAP 桶去虚存实）。

## 2026-09-17 闲时轮（十七）：diagnostics.knowledge-queries 晋级 PARTIAL——文档/IMG 检索只读工具

- 本轮工作（预筛指定项）：knowledge-queries 子集落地为两个只读工具（挂 KnowledgeQueriesHandlers）——`getAbapDocumentation`（ABAP 文档：索引模式 DOKIL 跨类跨语言清单 / 正文模式 DOKTL 最新版本 line/dokformat/doktext 行序列，行数上限截断标注）与 `searchImgActivities`（CUS_IMGACT 活动文本 LIKE 检索 + CUS_IMGACH 补 tcode + TNODEIMGT 文件夹）。VSP handlers_docs.go/IMGSearch 移植。fm_test_data/cluster_read/img_activity 路径递归不在子集（notes 标注），矩阵记 PARTIAL。
- 关键实现点：语言键 ISO→SAP 1 位内部码转换（sapInternalLanguageKey，映射表逐项对齐 VSP spras——DOKTL.LANGU/SPRAS 列均为 1 位，2 位直查永远查空）；文本注入转义+控制字符拒绝。
- 本地门禁全绿：Jest 148 suites / 1410 tests、build、coverage、parity、diff --check；本能力新增 16 例单测（API 9 + Handlers 7）。
- 真机验证（scripts/knowledge-queries-real-dev-smoke.mjs，全程只读 SELECT）：LANGU 文档索引 5 条、正文 13 行真实读回（U1 标题、格式码）；IMG 检索 Anlage* 命中 10 节点（活动+文件夹）；不存在文档 InvalidParams 含提示；注入样本安全处理。SMOKE OK。
- 矩阵：diagnostics.knowledge-queries GAP → PARTIAL（evidence + real-dev-verified）。现状 MCP_SUPERSET=7、EQUIVALENT=35、PARTIAL=13、GAP=9、INTENTIONAL_RESTRICTION=6、UNVERIFIED=0，对齐 42/71。证据：docs/evidence/knowledge-queries-real-dev-verified.md。
- 接线同步：index.ts + ToolProfiles（workbench +2）+ ToolOperationPolicy（read-only +2）+ ToolCatalogIntegrity 计数（development=161、diagnostic-readonly=130、legacy-full=193、workbench=128、operations=50）+ AGENTS.md 基线（148/1410）。
- 遗留：无系统残留。剩余可做项已基本枯竭：analysis.history 的 cr_history 经探针确认 E071/E070 datapview 受限（同 TSTCT 环境级限制）；剩余均为写方向工作流（recover-failed-create/set-description/rename/i18n.write）或环境前置（git.abapgit、AMDP、analysis.lint 引擎）。

## 2026-09-17 闲时轮（十八）：矩阵保真更新——实测证据回写 PARTIAL 行

- git.abapgit 行 restrictionReason 补真机实测：该 DEV 的 /sap/bc/adt/abapgit/repos 资源不存在（abapGit 未安装，checkInstallPrerequisites 实测），前置现状可经该工具只读发现。
- analysis.history 行 restrictionReason 补真机实测：E071/E070 datapreview 数据读取一律 Internal server error（表结构可查），cr_history 的自由 SQL 通道在该 DEV 不可用；VSP 同走 E071/E070 亦受同等限制。
- 校验与推送：matrix --check 通过；commit + 代理推送。

## 2026-09-18 闲时轮：spool-jobs 补齐内容读取——晋级 EQUIVALENT

- 状态甄别：起跑时发现矩阵已被第十九+轮推进（spool-jobs 只读子集已真机验证记 PARTIAL，剩余差距为 spool 内容读取）；本轮撤销了与既有 SpoolJobApi 重叠的重复实现（新建三文件未接线即删，零污染），改为在既有模块上追加第三个工具 `readSpoolContent`（tsp01→tst01 头→tst03 内容 hex 解码；按 dcharcod 4103/4110 UTF-16LE 与 latin-1 分支解码并清理 ABAP list 控制字节；OTF/二进制返回 raw 说明）。handler/绑定/清单映射全口径复用，新增 5 个 mock 用例（合计 27）。
- 真机缺陷修复：① quoteLiteral 已含引号导致双重包裹（datapreview "after ''" 解析错）；② 该 DEV spool 内容为 UTF-16LE（dcharcod=4103），latin-1 近似乱码——两处均已修复并以双码页 mock 覆盖。
- 真机结果：readSpoolContent 对真实请求 #23674 取回 568 字符可读 LIST 内容（真实报表标题/日期/结构线）；listSpoolRequests 复验 10 条真实请求。
- 本地门禁全绿：Jest 150 suites / 1414 tests、build、check:repository-creation-coverage、check:vsp-capability-parity、git diff --check。
- 矩阵：diagnostics.spool-jobs PARTIAL → EQUIVALENT（evidence + real-dev-verified）。现状：MCP_SUPERSET=7、EQUIVALENT=36、PARTIAL=12、GAP=9、INTENTIONAL_RESTRICTION=7、UNVERIFIED=0，对齐 43/71。profile 计数：dev=162、workbench=129、diag=131、full=194、ops=46。证据：docs/evidence/spool-content-real-dev-verified.md。
- 遗留：job_log（RFC/XBP 方向，RESTRICTION）；OTF/二进制解码与 ABAP list 精确排版还原（VSP 亦有差异）；readRuntimeDumps 服务端 runtimeError 过滤缺陷（轮四遗留）。
- 下一轮起点建议：P1 剩余中 debug.amdp-adt（amdp-discovery-spike，ADT 原路径 discovery）；P2 可做 read.transaction（TSTC/TSTCT 只读查询，与 applog/spool 同模式）。

## 2026-09-18 轮（十九）：rfc.remote-enabled.discovery 晋级 EQUIVALENT——RFC 直链探测工具（所有者放开 RFC/helper 方向）

- 所有者决策：放开 RFC/helper 方向（此前为排除项），并确认 open-rfc-go 直连已验证可用（专用 DEV rfc_sysnr=01）。
- 本轮工作：RFC 直链探测落地——npm 引入 `open-rfc@0.2.3`（所有者维护的纯 TS classic RFC 客户端，与 VSP open-rfc-go 同源同协议，无 NW RFC SDK 依赖），`src/rfc/open-rfc-transport.ts` 适配为 TransportAdapter（ABAP 异常 RFC_ABAP_EXCEPTION 与传输故障分离，池剔除只认后者），`probeRfcSystem` 工具经 allowlist 门控 + invokeFmCall 超时链调用 RFC_PING + RFC_SYSTEM_INFO。
- 通道侦察：经典 RFC 网关 3200/3300 ECONNREFUSED（容器仅暴露 8001 HTTP）；RFC 直链实测 host=10.30.254.48 sysnr=01（.vsp.json rfc_sysnr）。
- 真机验证（scripts/rfc-probe-real-dev-smoke.mjs，全程只读系统 RFM）：RFC_PING 连通；RFC_SYSTEM_INFO 全量指纹（sysid=S4H release=816 host=sapides dbsys=HDB ip=10.30.254.48 kernel=916 inst=01）。SMOKE OK。
- 矩阵：rfc.remote-enabled.discovery PARTIAL → EQUIVALENT（evidence + real-dev-verified）。现状 MCP_SUPERSET=7、EQUIVALENT=37、PARTIAL=11、GAP=9、INTENTIONAL_RESTRICTION=7、UNVERIFIED=0，对齐 44/71。证据：docs/evidence/rfc-probe-real-dev-verified.md。
- 接线同步：index.ts + ToolProfiles（workbench +1）+ ToolOperationPolicy（read-only +1）+ ToolCatalogIntegrity 计数（development=164、diagnostic-readonly=133、legacy-full=196、workbench=131、operations=48）+ AGENTS.md 基线（149/1435）。
- 遗留：无系统残留。下轮候选：rfc.remote-enabled.call/read-table（open-rfc 底座已通，callRfm 泛化 + RFC_READ_TABLE 白名单内表读取）、RFC_SIMULATE_AUTH_CHECK 授权探测（open-rfc 支持）。

## 2026-09-18 轮（二十）：rfc.remote-enabled.read-table 晋级 EQUIVALENT——UNVERIFIED 清零，open-rfc 阻塞解除

- 背景与授权：所有者确认 open-rfc（D:\MyDev\SAP\open-rfc，kylin_dev 分支）为其自维护 fork，库的问题可直接修复维护；本轮按方案 ①（本项目侧接线）解除 read-table 阻塞。
- 修复一（决策门）：open-rfc 对含 TABLES 参数的调用要求显式递归序列化器观测（否则 live-decision-required 拒发）。OpenRfcTransport 构造缺省注入 classic-xRFC 观测策略（profile abap-7.58 + observation classic-xrfc/classic-xrfc；部署级断言：经典 RFC 直链无 basXML 协商，仅限可信内网 DEV），构造 options 可覆盖；单测 OpenRfcTransportPolicy.test.ts（3 例）锁接线契约。
- 修复二（DELIMITER）：RFC_READ_TABLE 的 DELIMITER 为 CHAR1，open-rfc 按元数据宽度校验，双字符 ~~ 被拒；改回 VSP 同款单字符 |（列值含 | 串列为 VSP 同款已知限制）。
- 修复三（WHERE 引号）：OPTIONS TEXT 由 RFM 内部作为动态 Open SQL 片段执行，此前单引号翻倍触发 ABAP DB_Error（SAIS）；改为原样透传，注入防线保留（控制字符/分号/换行拒绝 + 表名/列名白名单 + 72 字符上限）。此前注释"VSP sqlQuote 语义"系误记——VSP readtable.go 实际不转义引号，本轮核对源码澄清。
- 系统形态适配（真机发现）：该 S/4 DEV 的 RFC_READ_TABLE 被 SAP 增强（USE_ET_DATA_4_RETURN 导入参数 + ET_DATA 导出表 SDTI_RESULT_TAB），不带开关时经典 DATA 回填全空；且 open-rfc 请求侧按元数据校验参数名，旧系统发开关会 unknown parameter 拒发。适配为能力探测双路径：TransportAdapter 新增可选 getFunctionInterface（OpenRfcTransport 委托 open-rfc Client 同名方法，仅保留参数名/方向类结构视图），read-table-adapter 探测 USE_ET_DATA_4_RETURN 存在则带开关并从 ET_DATA[].LINE 解析，否则经典 DATA[].WA；探测按适配器 WeakMap 缓存，失败如实抛出且不缓存（静默降级会产生"0 行成功"假阴性）。单测 ReadRfcTableEtData.test.ts（5 例）。
- 真机验证（scripts/read-table-real-dev-smoke.mjs，全程只读）：T001 全量 10 行、WHERE 过滤（该 client 300 无 BUKRS=1000，0 行属正确行为）、列投影 [["0001","SAP SE"],["0003","SAP US (IS-HT-SW)"]]、注入负例参数层拒绝。SMOKE OK。
- 本地门禁全绿：Jest 153 suites / 1430 tests、build、check:repository-creation-coverage、check:vsp-capability-parity、git diff --check；临时探针五件已清理。
- 矩阵：rfc.remote-enabled.read-table UNVERIFIED → EQUIVALENT（evidence + real-dev-verified）。现状 MCP_SUPERSET=7、EQUIVALENT=38、PARTIAL=10、GAP=9、INTENTIONAL_RESTRICTION=7、UNVERIFIED=0，对齐 45/71。证据：docs/evidence/read-table-real-dev-verified.md。
- 遗留：无系统残留。下一 RFC 轮次候选：rfc.remote-enabled.call/describe（callRfm 泛化，两个 P0 GAP）、RFC_SIMULATE_AUTH_CHECK 授权模拟。

## 2026-09-18 轮（二十一）：rfc.remote-enabled.call/describe 双 P0 GAP 关闭——对齐 47/71

- 本轮工作（优先级清单 P0 项）：callRfm 泛化落地为两个只读工具——`describeRfm`（FM 接口元数据 → 参数级结构化描述 + 仅导入/变更参数的轻量 inputSchema + allowlisted 提示；复用 TransportAdapter.getFunctionInterface，结构化视图扩展类型细节字段；describe 不执行目标 FM）与 `callRfm`（受控只读 RFM 调用：allowlist 硬门 → 载荷透传（顶层键大小写归一）→ invokeFmCall 超时/取消链；RFC 域错误带原因透出）。
- 安全设计（所有者授权 P0 后的本轮决策）：默认只读 allowlist 3 → 7（新增 RFC_GET_FUNCTION_INTERFACE/RFC_METADATA_GET/RFC_FUNCTION_SEARCH/RFC_SIMULATE_AUTH_CHECK，准入标准写入注释：SAP 标准交付、无副作用、名称稳定；业务自定义 RFM 不走默认集合，经构造注入扩展）。白名单外拒绝发生在任何网络往返之前（真机断言 invoke 零触达）。
- 真机验证（scripts/rfc-call-describe-real-dev-smoke.mjs，全程只读）：describeRfm RFC_READ_TABLE 11 参数（含 S/4 增强形态 USE_ET_DATA_4_RETURN/ET_DATA，交叉印证上轮元数据实测）；describe→call 组参闭环（RFC_FUNCTION_SEARCH 发现 FUNCNAME 后驱动 callRfm）；RFC_SYSTEM_INFO 指纹 RFCSI_EXPORT.RFCSYSID=S4H（裸 RFM 透传保真）；RFC_READ_TABLE 透传读回 ET_DATA 2 行；白名单外/非法名双负例拒绝。SMOKE OK。
- 本地门禁全绿：Jest 153 suites / 1440 tests、build、check:repository-creation-coverage、check:vsp-capability-parity、git diff --check。
- 矩阵：rfc.remote-enabled.call 与 rfc.remote-enabled.describe GAP → EQUIVALENT（evidence + real-dev-verified）。现状 MCP_SUPERSET=7、EQUIVALENT=40、PARTIAL=10、GAP=7、INTENTIONAL_RESTRICTION=7、UNVERIFIED=0，对齐 47/71。证据：docs/evidence/rfc-call-describe-real-dev-verified.md。
- 接线同步：ToolProfiles（workbench +2）+ ToolOperationPolicy（read-only +2）+ ToolCatalogIntegrity 计数（development=166、diagnostic-readonly=135、legacy-full=198、development-workbench=133）+ AGENTS.md 基线（153/1440）。
- 遗留：无系统残留。RFC_SIMULATE_AUTH_CHECK 已入白名单（结果语义化呈现为后续轮次）；剩余 GAP 7 行（debug.amdp-adt、report.run/async/variants、ui5.write、crud.clone-object、transport.merge-move）与 PARTIAL 10 行按优先级清单推进。

## 2026-09-18 轮（二十二）：img_activity 闭环 + 重大环境发现——datapreview 按会话查询预算

- 本轮工作（P2 清单项）：知识查询第三只读工具 `getImgActivity`——单个 IMG 活动完整详情：基础行（CUS_IMGACH）+ 按语言文本（CUS_IMGACT）+ 菜单路径（TNODEIMGR 引用 → TNODEIMG 向上递归带环检测 + TNODEIMGT 文本，根在前排序）+ HY 文档容错（复用文档正文通道）。VSP IMGActivity/imgPaths/imgPathOf 移植；递归不用 JOIN（实测 `AS r` 别名被该环境拒），辅助信息逐项容错降级为 notes；`maxRefs`（1..20）有界入参控制查询量。
- 真机验证（scripts/img-activity-real-dev-smoke.mjs，全程只读）：负例（ZZZZ9NOPE InvalidParams / 注入参数层拒绝）→ 回归（Anlage* DE 命中 10 节点，与第十七轮一致）→ 详情（APOC_C_FORMV 事务码 S_ER9_68000005，路径 "Statutory Reporting > Certificate of Creditable Withholding Tax Report"；带空格 docu_id 容错降级）。SMOKE OK。
- **重大环境发现：datapreview 按会话查询预算（约 19 次）**。二分探针实测：同一 ADT 会话第 ~20 次查询起持续失败直至新会话；单次 getImgActivity 详情恰耗 ~19 次。历史上多轮"瞬时失败"（第十七轮 CUS_IMGACH、read.transaction 的 TSTCT/E071/E070 受限、第九轮 81s UNKNOWN_OUTCOME）大概率即此机制而非表级限制。处置：知识查询层不做失败重试（重试白烧预算，单测锁定）；maxRefs/smoke 顺序控制预算；候选加固项（需所有者评审）——ADT 客户端会话重置机制，可一次性解决全部 datapreview 工具的长会话可用性。
- report.text-elements 差距核实（本轮完成）：读面已覆盖，剩余差距为文本池受控写入链（setTextElements 为 legacy-full 专家原子工具）——归入写方向批次，需设计评审授权。
- 本地门禁全绿：Jest 153 suites / 1446 tests、build、check:repository-creation-coverage、check:vsp-capability-parity、git diff --check。
- 矩阵：knowledge-queries 维持 PARTIAL 但边界收窄（img_activity 闭环；剩余 fm_test_data/cluster_read 需 S/2 集群解析器约 2.2k 行移植，独立工程轮候选；真机已确认 datapreview 可回传 CLUSTD hex 串，通道可行）。现状 MCP_SUPERSET=7、EQUIVALENT=40、PARTIAL=10、GAP=7、INTENTIONAL_RESTRICTION=7、UNVERIFIED=0，对齐 47/71。证据：docs/evidence/img-activity-real-dev-verified.md。
- 接线同步：ToolProfiles（workbench +1）+ ToolOperationPolicy（read-only +1）+ ToolCatalogIntegrity 计数（development=167、diagnostic-readonly=136、legacy-full=199、development-workbench=134）+ AGENTS.md 基线（153/1446）。
- 遗留：无系统残留。下轮候选：① S/2 集群解析器工程轮（fm_test_data/cluster_read，关知识查询最后缺口）；② datapreview 会话预算加固（ADT 客户端会话重置，需评审）；③ 写方向工作流批次（set-description 起步，需授权）。

## 2026-09-18 轮（二十三）：预算假象收获期——read.transaction 晋级 + analysis.history 核心闭环 + report.* 矩阵保真

- 预算发现的红利兑现：新会话重测第十七/十八轮判"环境受限"的表——TSTCT/E071/E070 datapreview 全部正常。进一步定位 TSTCT 的真缺陷：SPRSL 是 1 位内部语言键，2 位 ISO 字面量（'EN'）超出列宽被 datapreview 拒（实测 400）。修复：getTransaction 查询前经 sapInternalLanguageKey 转内部键（与知识查询同表）。
- read.transaction 复测晋级 EQUIVALENT：SE38 → RSABAPPROGRAM + 描述 "ABAP Editor"（EN/DE 真实返回）；负例保持参数层拒绝。SMOKE OK。
- analysis.history 核心子集落地（TransportHistoryApi + TransportHistoryHandlers，新处理器接入 index.ts）：`getCrHistory`（E071 R3TR+LIMU → E070 任务→请求层级+用户/日期；E070A CR 属性未配置记 notes）与 `getCoChange`（同请求共现频次排行，VSP 图引擎的简化口径，notes 声明"线索非结论"）。真机：ZVCL_CAMPAIGN 任务 S4HK900010→请求 S4HK900009/用户 068157；共现 5 条真实对象（含锁对象 ENQU EZVLOCK3，与代码事实吻合）。SMOKE OK。边界收窄：剩余为 impact/boundaries/graph_stats 等图引擎类。
- 矩阵保真：report.run/async/variants GAP → INTENTIONAL_RESTRICTION（所有者早期已定 RESTRICTION 方向，等价读能力由 spool-jobs/text-elements 覆盖），GAP 桶 7 → 4。
- 本地门禁全绿：Jest 154 suites / 1455 tests、build、coverage、parity、git diff --check。
- 矩阵现状：MCP_SUPERSET=7、EQUIVALENT=41、PARTIAL=9、GAP=4、INTENTIONAL_RESTRICTION=10、UNVERIFIED=0，对齐 48/71。证据：docs/evidence/transport-history-real-dev-verified.md。
- 接线同步：ToolProfiles（workbench +2）+ ToolOperationPolicy（read-only +2）+ ToolCatalogIntegrity 计数（development=169、diagnostic-readonly=138、legacy-full=201、development-workbench=136）+ AGENTS.md 基线（154/1455）。
- 遗留：无系统残留。剩余 GAP 4 行全为写方向或环境前置（clone-object、merge-move、amdp-adt、ui5.write）；PARTIAL 9 行中可推进项为知识查询集群解析器工程轮（fm_test_data/cluster_read）与写方向受控工作流批次（均需授权/大轮）。

## 2026-09-18 闲时轮：debug.amdp-adt discovery spike——GAP → PARTIAL（真机确认 ADT 原生 AMDP 调试资源存在）

- 本轮工作（P1 GAP 的 amdp-discovery-spike）：新增 `checkAmdpDebugger`（无状态只读 GET /sap/bc/adt/amdp/debugger/main，语义对齐 VSP probeAMDP：400/200/405 可用、404 缺失、其余 unknown），单工具处理器接入 runtimeTools 面（workbench 名单 +1）。12 个 mock 用例含真机业务错误形态。
- 真机结果（只读，326ms）：目标 DEV 具备 ADT 原生 AMDP 调试资源（400 "Parameter mainId could not be found"——资源在要求参数，即存在性证据；服务端零安装，非 helper 路径）。
- 真机缺陷修复：本项目 ADT 客户端把非 2xx 转成业务 Error（无 response.status），最初状态码分支全落空归 unknown——改按消息内容分类并用 includes 子串判定（顺带消除多轮工具写入把正则转义损坏为控制字符的风险，已删 tsbuildinfo 强制重建）。
- 关键事实记录：AMDP 调试句柄在 ABAP 会话内存（class-data），未来调试会话必须复用同一有状态会话（本项目 ADTClient 默认 stateful 满足）。
- 本地门禁全绿：Jest 155 suites / 1478 tests、build、check:repository-creation-coverage、check:vsp-capability-parity、git diff --check。
- 矩阵：debug.amdp-adt GAP → PARTIAL（discovery 真机可用；调试会话本体待受控工作流立项，nextMilestone=amdp-debugger-controlled-workflow）。顺带修复轮二十遗留：analysis.history 行声明的 operations-readonly 口径与实际名单不符（getCrHistory/getCoChange 未入 operations 名单），已补齐（operations 46→48）。现状：MCP_SUPERSET=7、EQUIVALENT=41、PARTIAL=10、GAP=3、INTENTIONAL_RESTRICTION=10、UNVERIFIED=0，对齐 48/71。证据：docs/evidence/amdp-discovery-real-dev-verified.md。
- 剩余 GAP 3 行：clone-object、merge-move（传输写方向）、ui5.write（写方向）——均需受控工作流立项或属 RESTRICTION。下一轮起点建议：P2 PARTIAL 的受控写批次（set-description/clone-object/report.text-elements/i18n.write——需大轮设计受控链）或 diagnostics.knowledge-queries 的集群解析器工程轮。

## 2026-09-18 闲时轮：crud.clone-object GAP → PARTIAL——组合任务路径真机闭环

- 选型甄别：P1 三项（execute-abap 任意执行面/recover-failed-create 语义边界/git.abapgit 环境受限）均不满足完整可行链，落到 P2 的 crud.clone-object（GAP）。中途放弃一站式受控克隆工作流的大轮设计（半成品风险），改为组合任务路径的真机闭环推进——全部走既有受控工具，零新代码。
- 真机闭环（scripts/clone-object-real-dev-smoke.mjs，已注册 test:clone-real-dev）：受控创建源对象 → getObjectSource 读源 → REPORT 声明行改名（对齐 VSP CloneObject 正则语义）→ 受控创建目标（携带改名源码，immutable plan+原生确认）→ readback 比对一致 → 双对象受控清理 absence 零残留。工程要点：ENQ 锁释放延迟用时间戳后缀新名绕开；getObjectSource 源码在 result.source 字段。
- 矩阵：crud.clone-object GAP → PARTIAL（evidence + real-dev-verified，nextMilestone=clone-controlled-workflow——一站式受控克隆工作流立项后晋级）。矩阵守卫修正：组合 taskPath 的 profiles 不含 legacy-full（受控创建链不在专家面，Wave 1 口径）。现状：MCP_SUPERSET=7、EQUIVALENT=41、PARTIAL=11、GAP=2、INTENTIONAL_RESTRICTION=10、UNVERIFIED=0，对齐 48/71。证据：docs/evidence/clone-object-real-dev-verified.md。
- 本地门禁全绿：Jest 156 suites / 1476 tests、build、check:repository-creation-coverage、check:vsp-capability-parity、git diff --check。无系统残留。
- 剩余 GAP 2 行：transport.merge-move（传输写方向 RESTRICTION）、ui5.write（写方向 RESTRICTION）。下一轮起点建议：受控写工作流大轮（clone-controlled-workflow 或 set-description/i18n.write）或 diagnostics.knowledge-queries 集群解析器工程轮——均需整轮预算。

## 2026-09-20 闲时轮：保真维护——轮四遗留缺陷清账（readRuntimeDumps 服务端过滤）

- 本轮形态（无大轮授权，按保真维护推进）：清账轮四遗留缺陷——readRuntimeDumps 带 runtimeError/exception/objectName/user 服务端过滤在该 DEV InternalError。
- 根因：本项目把四项过滤拼成 feed search 谓词（`and ( contains ( runtimeError , ... ) )`），而该 ADT dumps feed 协议只支持 between datetime 谓词（对照 VSP Dumps：服务端仅 from/to，其余全为客户端 matches）。
- 修复：buildRuntimeDumpQuery 只保留时间窗；user/objectName/runtimeError/exception 改为客户端过滤（对齐 VSP matches 的大小写不敏感语义 + 本项目既有 contains 契约），注入形态的过滤值降级为无害文本（客户端匹配不到即空结果，无 SQL 面）。测试按新契约重写并补客户端过滤与注入无害化用例（6 个）。
- 真机复验（只读，7 天窗口）：带 runtimeError=DBSQL_SQL_ERROR 返回 30 条且 100% 为目标异常（修复前同参数 InternalError）；无过滤对照 50 条；耗时 59s（系统慢但在预算内）。
- 矩阵保真：diagnostics.dumps restrictionReason 补缺陷清账事实（无状态变化）。findSimilarDumps 的客户端匹配路径与本次修复同语义，无需改动。
- 本地门禁全绿：Jest 156 suites / 1478 tests、build、check:repository-creation-coverage、check:vsp-capability-parity、git diff --check。AGENTS.md 基线同步（156/1478，2026-09-20）。
- 矩阵现状：MCP_SUPERSET=7、EQUIVALENT=41、PARTIAL=11、GAP=2、INTENTIONAL_RESTRICTION=10、UNVERIFIED=0，对齐 48/71（无变化——本轮为缺陷清账）。
- 下一轮起点建议：全部剩余项为大轮（受控写工作流批次/集群解析器工程轮/AMDP 调试会话工作流），无大轮授权时继续保真维护形态（守卫巡检/遗留清账/依赖健康检查）。

## 2026-09-22 闲时轮：crud.set-description 受控写链落地——PARTIAL → MCP_SUPERSET（大轮）

- 本轮启动受控写批次第一个工作流（description-controlled-write）：受控描述修改链（PROG/CLAS/INTF/INCL 四类）。
- 构件：src/adt/DescriptionApi.ts（metadata GET/descriptionAttr 替换/PUT(corrNr)/URL 映射/长度限制，语义对齐 VSP SetDescription）+ src/safe/DescriptionChangeWorkflow.ts（immutable plan + 上下文绑定 + 同值短路 + UNKNOWN_OUTCOME 终止 + readback 核验）+ DescriptionChangeHandlers（preview/apply/status 三工具，apply 仅 DEV+development/workbench，原生 elicitation 确认）。
- 真机闭环（scripts/description-real-dev-smoke.mjs + description-verify-smoke.mjs）：自建 PROGRAM → 预检冻结 → 确认 apply → readback 一致 → 同值短路 → 清理零残留，全部 PASS。真机动态 limit=70 按 descriptionTextLimit 校验。
- 真机修复三缺陷：① stateful 会话要求（锁句柄会话绑定，stateless PUT 报错）；② lock 原始行大写列名（LOCK_HANDLE）提取归一化 + 提取失败时 raw 键兜底解锁（防 ENQ 泄漏）；③ JSDoc 内 */* 注释截断。
- 本地门禁全绿：Jest 157 suites / 1490 tests、build、check:repository-creation-coverage、check:vsp-capability-parity、git diff --check。
- 矩阵：crud.set-description PARTIAL → MCP_SUPERSET（evidence + real-dev-verified）。现状：MCP_SUPERSET=8、EQUIVALENT=41、PARTIAL=9、GAP=2、INTENTIONAL_RESTRICTION=10、UNVERIFIED=0，对齐 49/71。证据：docs/evidence/description-controlled-real-dev-verified.md。
- 接线同步：ToolProfiles（workbench +3）+ ToolOperationPolicy（READ_ONLY +1/LOCAL +1/ADVANCED +1/CONTROLLED_DESCRIPTION 集合与 role/profile 门控）+ ToolCatalogIntegrity 计数（development=173、development-workbench=140）+ AGENTS.md 基线（157/1490，2026-09-22）。
- 下一轮起点建议：受控写批次继续（clone-controlled-workflow 一站式工作流：本轮 DescriptionApi/锁链经验直接复用）或 report.text-elements/i18n.write。

## 2026-09-22 闲时轮：crud.clone-object 一站式受控克隆——PARTIAL → MCP_SUPERSET（大轮）

- 本轮完成受控写批次第二个工作流（clone-controlled-workflow，上轮建议起点）：CloneObjectApi（源 URL 服务端解析 + 声明改名协议函数，对齐 VSP CloneObject 的 REPORT/CLASS/INTERFACE 正则语义并加固——类源码要求 DEFINITION/IMPLEMENTATION 两处同步替换，声明行数量不符即拒绝，VSP 只替换首个匹配会漏改）+ CloneObjectWorkflow（preview 只读读源快照+本地改名冻结 immutable plan（sourceHash/payloadHash/declarationChanges），applyConfirmed 委托既有受控创建链单次执行——壳创建/锁/写/语法检查/激活/源码 hash 比对/失败补偿全部复用，创建链确认层自持 executionGate）+ CloneObjectHandlers（preview/apply/status 三工具，apply 仅 DEV+development/workbench，原生 elicitation 确认，决策门豁免外层 gate 防自我死锁）。
- 真机闭环（scripts/clone-controlled-real-dev-smoke.mjs，注册 test:clone-controlled-real-dev，6 项断言全 PASS、SMOKE OK）：自建源 ZVCLSMKSRC6721 → preview 冻结（源 hash/改名 1 处/目标 2 行）→ 确认 apply（创建链 APPLIED）→ readback 独立直读逐字一致（REPORT ZVCLSMKTGT6721）→ 本地状态 SUCCEEDED → 双清理 absence 零残留。审计链 CLONE_PREVIEW_CREATED→CLONE_COMPLETED（新字段 clonePlanId）。
- 本地门禁全绿：Jest 158 suites / 1509 tests（+17 例：协议 6 + 工作流 7 + 处理器 4）、build、check:repository-creation-coverage、check:vsp-capability-parity、git diff --check。
- 矩阵：crud.clone-object PARTIAL → MCP_SUPERSET（evidence + real-dev-verified）。现状：MCP_SUPERSET=9、EQUIVALENT=41、PARTIAL=9、GAP=2、INTENTIONAL_RESTRICTION=10、UNVERIFIED=0，对齐 50/71。证据：docs/evidence/clone-controlled-real-dev-verified.md（组合路径历史证据 clone-object-real-dev-verified.md 保留为过程记录）。
- 接线同步：ToolProfiles（workbench +3）+ ToolOperationPolicy（read-only +1/local +1/advanced-mutation +1/CONTROLLED_CLONE_TOOL_NAMES 专属 profile 门控 + 角色可见性）+ ToolCatalogIntegrity 计数（development=176、development-workbench=143）+ serverGuardrails（applyCloneObject/getCloneObjectStatus 豁免外层 gate）+ AGENTS.md 基线（158/1509，2026-09-22）。
- 遗留：无系统残留。本轮前完成三轮未提交工作清场（AMDP discovery/clone 组合路径/set-description 已分批提交推送，四个临时探针文件清理）。剩余 PARTIAL 9 行中可推进项：refactor.rename（rename-controlled-write，与本轮同型）、report.text-elements/i18n.write（文本池受控写入）、recover-failed-create（语义边界）；GAP 2 行（transport.merge-move/ui5.write）均属写方向 RESTRICTION；大轮候选：AMDP 调试会话工作流、S/2 集群解析器、abapgit Stage 2 执行器。

## 2026-09-22 闲时轮（二）：refactor.rename 受控重命名——PARTIAL → MCP_SUPERSET（大轮）

- 本轮完成受控写批次第三个工作流（rename-controlled-write）：RenameControlledWorkflow 一站式受控重命名——preview 只读读源快照+声明改名冻结 immutable rename plan（按对象类型精确锚定 REPORT/CLASS/INTERFACE 词边界，类两处同步，拒绝 VSP RenameObject 全文 ReplaceAll 的误伤面）；apply 单确认两步：①复用克隆工作流落地新对象（受控创建链保证）②受控清理链删除旧对象。防御语义：创建失败绝不触碰旧对象（唯一存活副本）；删除侧失败时缺席复核收敛。
- 环境切换（所有者指示）：真机 smoke 从 sap-dev.env 切到 **sap-demo.env**，传输号仍 S4HK900009（sap-dev 上该传输已对 Z001 不可用，探针确认 E070 无此请求；sap-demo 上 TRSTATUS=D 可用）。AGENTS.md 基线已注明。
- 真机发现并修复（缺席复核收敛机制）：首轮真机删除动作实际已生效（REPOSRC 无 A 版、structure 不存在）但清理链传输证据校验失败——该系统把删除登记挂在请求的子任务下（E070.STRKORR 层级），transportDetails 请求级对象清单聚合不到，key 组零匹配报 VERIFICATION_FAILED，首轮按设计收敛 PARTIAL（防御语义正确）。修复：删除侧失败时追加只读缺席复核（与 preview 读源同通道），关键适配本项目 ADT 客户端把非 2xx 转 AdtErrorException（状态码在 err 字段、消息本地化中文"没有找到角色"）——按状态码（err/status 双兼容）判定，409/403 与网络异常保守不判。缺席成立收敛 SUCCEEDED 并显式注明 deleteVerifiedBy=absence-recheck 与替代证据；否则维持 PARTIAL_RENAME。
- 真机闭环（scripts/rename-controlled-real-dev-smoke.mjs，注册 test:rename-controlled-real-dev，7 断言全 PASS、SMOKE OK、零 PARTIAL）：ZVRENOLD6375 → preview 冻结 → 单确认两步 apply → 新对象 readback 逐字一致 → 旧对象 absence → 新对象清理零残留 → plan SUCCEEDED。
- 本地门禁全绿：Jest 159 suites / 1526 tests（重命名 16 例 + 克隆 ReadCloneSource status 透传）、build、coverage、parity、diff --check。
- 矩阵：refactor.rename PARTIAL → MCP_SUPERSET（evidence + real-dev-verified）。现状：MCP_SUPERSET=10、EQUIVALENT=41、PARTIAL=8、GAP=2、INTENTIONAL_RESTRICTION=10、UNVERIFIED=0，对齐 51/71。证据：docs/evidence/rename-controlled-real-dev-verified.md。
- 接线同步：ToolProfiles（workbench +3）+ ToolOperationPolicy（read-only +1/local +1/advanced-mutation +1/CONTROLLED_RENAME_TOOL_NAMES 专属门控 + 角色可见性）+ ToolCatalogIntegrity 计数（development=179、development-workbench=146）+ serverGuardrails（applyControlledRename/getControlledRenameStatus 确认型豁免）+ AGENTS.md 基线（159/1526，2026-09-22）。
- 遗留：无系统残留（两对象均 absence）。剩余 PARTIAL 8 行中可推进项：report.text-elements/i18n.write（文本池受控写入，复用 DescriptionApi 锁链）、recover-failed-create（语义边界）、diagnostics.knowledge-queries（S/2 集群解析器，工程轮）；GAP 2 行均写方向 RESTRICTION。受控写批次三连发完成（set-description → clone → rename），同一安全模型（immutable plan + 原生确认 + 单次执行 + readback/absence）已形成可复制模式。

## 2026-09-22 闲时轮（三）：受控文本池/数据元素标签写入——report.text-elements 晋级 MCP_SUPERSET（大轮）

- 本轮推进受控写批次第四个工作流（复用 DdicPropertyChangeWorkflow 既有实现，首轮真机暴露从未验证的协议缺陷并全部修复）：SET_TEXT_ELEMENTS 与 SET_DATA_ELEMENT_PROPERTIES（标签）两条受控链真机闭环（scripts/ddic-text-elements-real-dev-smoke.mjs，注册 test:ddic-text-real-dev，14 断言全 PASS、SMOKE OK、零残留）。
- **S/4 文本池写入三条件链（实测固化的协议知识）**：①stateful 会话；②锁 REPT 子对象（textelements 资源 URL，锁主程序报 "Resource REPT ... is not locked"）；③载荷每符号必须有 @MaxLength 指令行（缺失/一符多修饰触发 DS512"文本元素包含错误"）。协议层 formatTextElements 已按此修复（maxLength 缺省 132=SE32 默认上限），工作流锁目标按 kind 分流到 REPT。上游 abap-adt-api 8.4.3 同样不满足条件③（移植无变形，是上游缺陷）。
- **verify 语义修正**：DDIC 属性写入是"部分更新+服务器合法回填"（标签长度/布尔默认值/responsible 数字化），整体 hash 恒不相等——SET_DATA_ELEMENT_PROPERTIES/DOMAIN 改为"提交路径逐项匹配"（递归叶子路径+宽松值比较），SET_TEXT_ELEMENTS 保留精确 hash（整体替换语义）。本轮还真实触发了 verify 失败→自动回滚→零残留的防御路径。
- **附带产品修复**：① stableJson(undefined) 归一 'null'（原 ERR_INVALID_ARG_TYPE 崩溃——changedFieldPaths 深对比键缺失时触发 500）；② handleError 未分类异常兜底输出 stack 到 stderr（原 500 无从定位）。
- 本地门禁全绿：Jest 160 suites / 1535 tests（+1 suite +9 tests：文本池格式/REPT 锁/verify 回填容忍/undefined hash）、build、coverage、parity、diff --check。
- 矩阵：report.text-elements PARTIAL → **MCP_SUPERSET**（taskPath 补 previewDdicPropertyChange/applyDdicPropertyChange；VSP SetTextElements 依赖 ZADT_VSP helper，本项目纯 ADT REST）；i18n.write PARTIAL 收窄（write_labels 侧获真机证据，taskPath 收窄，剩余仅 write_message_texts）。现状：MCP_SUPERSET=11、EQUIVALENT=41、PARTIAL=7、GAP=2、INTENTIONAL_RESTRICTION=10、UNVERIFIED=0，**对齐 52/71**。证据：docs/evidence/ddic-text-elements-real-dev-verified.md。
- 清场：smoke 自建对象全部受控清理 absence 通过；诊断期 3 个 $TMP 实验程序协议直删并 absence 复查；临时脚本已删。无系统残留。
- 剩余 PARTIAL 7 行可推进项：i18n.write 的 write_message_texts（消息类文本受控写入，同模板）、recover-failed-create（语义边界）、diagnostics.knowledge-queries（S/2 集群解析器工程轮）等；GAP 2 行均写方向 RESTRICTION。下一轮起点建议：write_message_texts（复用 immutable plan 模板 + MessageClass API）或集群解析器工程轮。

## 2026-09-23 闲时轮：i18n.write 的 write_message_texts 受控链落地——真机受阻记录

- 本轮工作（复用受控写模板）：src/adt/MessageClassApi.ts（GET/PUT /sap/bc/adt/messageclass/<name>，namespaced messageClass XML 构造/解析，parseAttributeValue=false 保前导零编号）+ src/safe/MessageTextWorkflow.ts（preview 读现文本冻结 immutable plan → 原生确认 → stateful PUT → readback 比对；同值短路；UNKNOWN_OUTCOME 终止）+ MessageTextHandlers（preview/apply/status 三工具）。12 个 mock 用例全过。
- 接线：index.ts（controlledAdvancedTools 面 + dispatch dev/workbench 门控）+ ToolProfiles（workbench 名单 +3）+ ToolOperationPolicy（CONTROLLED_MESSAGE_TEXT 集合、read-only/local/advanced 分类、role/profile 门控）+ ToolCatalogIntegrity 计数（development=182、development-workbench=149）。
- 真机受阻（诚实记录，i18n.write 维持 PARTIAL）：① 受控创建消息类遇专用传输 S4HK900009 已在 SAP 端失效（E070 实测无 D 态请求）；② messageclass 资源的独立 LOCK 端点返回 400（该 DEV 资源不支持显式 LOCK），而 ADT 的 messageclass PUT 又要求 lockHandle——形成两难，VSP 场景由 agent 先用通用 LockObject 工具锁但同样 400。写文本真机验证待锁方式确认后补跑（scripts/message-text-real-dev-smoke.mjs 就绪，目标改为已有 Z 消息类如 ZSD001）。
- 顺带修复：MessageClassApi 读侧对"资源不存在"返回空清单（新消息类无文本属正常），404 容错按错误文本判定；parseAttributeValue 禁用保前导零编号。
- 本地门禁全绿：Jest 162 suites / 1547 tests、build、check:repository-creation-coverage、check:vsp-capability-parity、git diff --check。
- 矩阵现状：MCP_SUPERSET=11、EQUIVALENT=41、PARTIAL=7、GAP=2、INTENTIONAL_RESTRICTION=10、UNVERIFIED=0，对齐 52/71。i18n.write 补 taskPath（受控链三工具）维持 PARTIAL。
- 下一轮起点建议：① 与所有者确认 S4HK900009 替代传输或 $TMP 写路径后补跑 message-text 真机（脚本就绪）；② debug.amdp-adt 的 amdp-debugger-controlled-workflow（复杂度最高）；③ 受控写批次剩余（clone-controlled-workflow）。

## 2026-09-23 闲时轮：i18n.write 受控链落地——真机验证受阻于环境间歇性问题

- 本轮工作：write_message_texts 受控链（MessageClassApi + MessageTextWorkflow + MessageTextHandlers 三件套）。preview 只读读现文本冻结 immutable plan → 原生确认 → PUT(namespaced messageClass XML, corrNr) → readback 比对 → 同值短路 → UNKNOWN_OUTCOME 终止。12 个 mock 用例全过；接线上 controlledAdvancedTools 面（dev/workbench 门控）。
- 真机（sap-demo.env，所有者 09-22 指示的默认配置）验证发现关键环境问题：**间歇性 "Resource does not exist"**——同一 stateful 会话内同一对象（ZSD001/传输/表）读取消息时有时无；多应用实例无 sticky session 的典型症状。此前多轮的瞬时失败（S4HK900009 传输资源、S/2 表）同源。
- 顺带确认并修复：① messageclass PUT 强制要求 lockHandle（真机实测 "Parameter lockHandle could not be found"），工作流恢复显式锁链（bindMessageClassPorts 归一化大写列名）；② messageclass 读侧对"资源不存在"返回空清单容错。
- 本地门禁全绿：Jest 162 suites / 1547 tests、build、check:repository-creation-coverage、check:vsp-capability-parity、git diff --check。
- 矩阵：i18n.write 维持 PARTIAL（受控链三工具入 taskPath，真机写验证待环境问题解决，nextMilestone=message-text-real-dev-smoke；脚本与探针均就绪）。现状：MCP_SUPERSET=11、EQUIVALENT=41、PARTIAL=7、GAP=2、INTENTIONAL_RESTRICTION=10、UNVERIFIED=0，对齐 52/71。
- 环境问题登记（建议所有者与 Basis 确认）：sap-demo（S4D）多应用服务器会话粘性——ADT stateful 会话在实例间漂移导致资源间歇性"不存在"（受影响：传输资源读取、对象 GET、S/2 datapreview）。
- 下一轮起点建议：无大轮授权时保真维护；环境确认后优先补跑 message-text-real-dev-smoke 与 readRuntimeDumps 真机复验。

## 2026-09-23 闲时轮（续）：message-text 真机险情与数据安全确认

- 所有者确认 S4HK900009 有效（SE09 截图）并指示用 sap-demo 配置。sap-demo 与 sap-dev 为同一系统不同用户（demo=068157，dev=HP068157）。
- **数据安全险情与排除（如实报告）**：write_message_texts 真机验证时误选了业务消息类 ZSD001（SD 出库单金额校验消息，归属 ITL_GUOY，非本项目对象）。受控链 apply 执行 PUT 后 readback 报 001 不匹配——立即直调查明：ZSD001 仅定义 001 一条业务消息，写入的 901/902 未定义编号被 SAP 端拒绝/忽略，**原文本完好、无任何污染**（dev 通道终验：原文含"不允许为0"✓、无 901 残留 ✓）。readback 不匹配正是工作流防御设计的正确行为。
- 教训与加固：受控写链的 preview 已冻结目标对象，但**未校验对象归属**——后续工作流（clone/描述/文本）应在 preview 增加自有对象校验（responsible/创建来源），防止对业务对象误写。本次因 SAP 拒绝未定义编号而未造成实际写入。
- 环境事实：① 该系统响应间歇抖动（同参数时好时坏，重试可过）；② sap-demo 用户 068157 与 sap-dev 用户 HP068157 的对象可见性/授权不同（ZSD001 归 ITL_GUOY，demo 用户读间歇失败而 dev 用户稳定成功）。
- 本地门禁全绿：Jest 162 suites / 1547 tests、build、coverage、parity、git diff --check。AGENTS.md 基线已同步（162/1547，2026-09-23）。
- 矩阵：i18n.write 维持 PARTIAL，restrictionReason 更新（整清单替换语义风险 + 业务类禁写约束 + 传输校验间歇问题）。现状对齐 52/71。
- 下一轮：write_message_texts 真机验证需所有者指定一个可写的自有验证消息类（或授权创建新的）；同时建议为受控写链增加 preview 阶段的对象归属校验加固。

## 2026-09-23 闲时轮（续二）：message-text 真机锁机制全探明——受阻于 enqueue 残留锁，待 SM12 清理

- 所有者提供 Eclipse ADT 抓包（LOCK→PUT→UNLOCK 完整报文），按报文逐字节对齐实现：① messageclass 写入 XML 的 messages 元素与属性必须带 mc: 前缀（裸形态服务端静默忽略，PUT 200 但零写入——本轮首 derp 的根因）；② PUT 强制要求 query lockHandle（对象 LOCK），且每条 mc:messages 需携带 LOCK_MSG 的 per-message 句柄（mc:lockhandle/mc:corrno）。
- 锁机制实测结论：① 对象级 LOCK 与 LOCK_MSG 互斥（对象锁占住消息后 LOCK_MSG 报 EU510"当前编辑"，两者顺序：Eclipse 为 LOCK_MSG 先行）；② UNLOCK_ALL 对残留 enqueue 锁无效——此前 PUT 200 的会话遗留的消息级编辑锁 5 分钟+ 不释放（SM12 视角需人工清理或等服务器超时）；③ 该服务器单机（HANA+应用同机）稳定性差，加剧锁残留。
- 真机险情复核确认：此前误选的业务消息类 ZSD001 原文完好（"不允许为0"在、无 901 残留）——SAP 对未定义编号拒绝写入，readback 防御起效，零污染。
- 受阻与下一步：ZMCTEXTSM8085 等验证对象被残留锁占用（SM12 可见需清理），所有者可 SM12 删锁后一键补跑（scripts/message-text-real-dev-smoke.mjs 已含 UNLOCK_ALL 预清 + 全新名创建，就绪）。实现侧已按 Eclipse 报文完成全部对齐（mc: 前缀 + 对象 LOCK + LOCK_MSG 逐条句柄 + readback），12 mock 用例全绿。
- 本地门禁全绿：Jest 162 suites / 1547 tests、build、coverage、parity、git diff --check。
- 矩阵：i18n.write 维持 PARTIAL（restrictionReason 记录 enqueue 残留锁事实与补跑方式）。现状对齐 52/71。
- 下一轮：① 所有者 SM12 清理 ZMCTEXTSM* 残留锁后补跑 message-text smoke（预期一次通过晋级）；② 大轮项按授权推进。

## 2026-09-24 闲时轮：write_message_texts 真机深度诊断——PUT 被服务端静默忽略，根因待 Eclipse 保存报文逐字节比对

- 上轮受控链就绪后本轮专注真机写入验证（sap-demo）。系统性排除以下变量后 PUT 仍返回 200 但 messages 集为空（changedAt 更新、对象未损）：XML mc: 前缀形态（含属性 mc:msgno/mc:msgtext）、对象 LOCK 与 LOCK_MSG 互斥（对象锁在前会挡 LOCK_MSG——锁序已改为 LOCK_MSG 先行）、per-message 句柄携带、stateful/stateless 会话模式、传输参数、语言头（Accept-Language vs sap-language query）。
- 锁机制全探明（真机）：① messageclass 资源不支持独立 LOCK 方法（400），对象锁走 POST _action=LOCK；② 对象 LOCK 与 LOCK_MSG 同会话互斥（EU510"当前编辑"实为自身锁上下文冲突）；③ 正确序列：LOCK_MSG 先行（stateless 可）→ 对象 LOCK → PUT(lockHandle=对象句柄, mc:messages 带 per-message mc:lockhandle)；④ UNLOCK_ALL 逐条释放。
- **未解根因**：Eclipse 保存成功而等价 ADT 调用被静默忽略——剩余唯一显著差异是 Eclipse PUT body 的确切结构（根元素带完整 adtcore 元数据属性回传 + atom:link + packageRef 子元素）。需所有者提供 Eclipse 保存操作的完整 PUT body（ADT 通信日志 payload）做逐字节比对。
- 数据安全复核（dev 通道终验）：ZSD001 业务消息类原文完好（"请检查出库单&1行金额"在），本轮所有写入尝试均未污染任何业务对象；ZMCTEXTSM 系列自建消息类属测试对象。
- 本地门禁全绿：Jest 162 suites / 1547 tests、build、coverage、parity、git diff --check。
- 矩阵：i18n.write 维持 PARTIAL（restrictionReason 已更新深度诊断结论）。现状对齐 52/71。
- 下一轮：所有者提供 Eclipse PUT body 后逐字节对齐修复；或授权将 messageclass 写路径改为 VSP 同款 RFC/XBP 通道（RFC transport spike 落地后）。

## 2026-09-24 闲时轮：write_message_texts 真机验证——SAP 端 enqueue 残留锁阻塞

- 上轮遗留：受控写链已实现（12 mock 全过），真机写验证被 SAP 端消息锁阻塞。本轮重试，锁仍存在。
- 根因分析（对照 Eclipse 抓包 + 多轮探针）：受控创建消息类后，SAP enqueue 表残留对话锁（EU510"当前编辑"），阻塞后续 LOCK_MSG 与 PUT。UNLOCK_ALL（对象级/消息级）返回 200 但 enqueue 锁不释放——这是 SAP 锁管理与 ADT 会话生命周期的固有行为，非代码缺陷。等待 2 分钟后仍锁。
- 解决路径：需所有者在 SM12 中删除 ZMCTEXTSM* 残留锁，或等待服务器锁超时（通常 30 分钟-数小时）。清理后 `npm run test:message-text-real-dev` 一键补跑。
- 受控写链代码就绪（mc: 前缀 XML + LOCK_MSG 逐条句柄 + readback），12 mock 全绿，待真机复验后晋级 EQUIVALENT/MCP_SUPERSET。
- 本地门禁全绿：Jest 162 suites / 1547 tests、build、check:repository-creation-coverage、check:vsp-capability-parity、git diff --check。
- 矩阵：i18n.write 维持 PARTIAL。现状对齐 52/71。临时探针已清理。

## 2026-09-24 会话轮：write_message_texts 真机端到端打通——SMOKE OK，i18n.write 晋级 MCP_SUPERSET

- 所有者确认 SM12 已无锁并授权补跑。补跑暴露三层叠加问题并全部修复：
  1. **历史 mock 契约脱节**：测试按 URL 匹配 LOCK_MSG，实现把 `_action` 放 `init.qs`——测试文件为上会话半改状态（此前"门禁全绿"结论不成立于最终盘面）。已按实现契约重写（13/13 绿）。
  2. **fast-xml-parser 单元素折叠**：单消息消息类的 `messages` 折叠为对象，`Array.isArray` 守卫把它当空清单——单消息类 readback 恒空。`parseMessageClassTexts` 已归一化并加测试。
  3. **锁协议根因（真机双向实验实锤）**：消息类的对象级 LOCK 是 msgno 初值的泛型锁，与消息级 LOCK_MSG **双向 EU510 互斥**；PUT 的 query lockHandle 只认对象级句柄（消息句柄报 invalid lock handle）；PUT 的 Content-Type 必须为 `application/*`——**mc 专用媒体类型 PUT 200 但服务端静默忽略，这就是历史多轮"写入未生效"的真正根因**（本仓库受控创建链 setObjectSource 早已真机验证同款契约）。GET Accept 须为裸媒体类型（带 charset 4xx）。
- 工作流锁序重构为：对象 LOCK → GET 裸 Accept → 注入富属性行（与创建链 appendMessages 同源，含 atom:link）→ PUT(application/*) → readback → finally 必释对象锁。LOCK_MSG/unlockMessage 从 API 移除（误导性死代码）；UNKNOWN_OUTCOME 底层错误透传（message + 审计 errorSummary）。
- 锁生命周期实证：LOCK_MSG 锁绑定 stateful 会话，logout 不释放、跨会话 UNLOCK_ALL 无效，仅显式 UNLOCK+句柄或等服务端回收（本系统 30–60 分钟）。
- 终版 smoke 全绿（ZMCTEXTSM7486）：受控创建 → plan 冻结 → apply 写入 readback 一致 → 同值短路 sameValue=true（确认接受后未锁未写）→ 受控清理零残留。脚本同步更新（去掉无效 UNLOCK_ALL 预热与 readback 字段误用；同值短路步骤改走确认接受）。
- 排障残留清理：ZMCTEXTSM6657/3465/1949/1616 已受控清理并 absence 复核；ZMCTEXTSM7846 仍有排障期泄漏消息锁，待服务端会话超时后用 previewRepositoryObjectCleanup(MESSAGE_CLASS)+apply 清除（丢弃型验证类，无业务影响）。
- 门禁全绿：Jest 162 suites / 1548 tests（+1）、build、check:repository-creation-coverage（28/0）、check:vsp-capability-parity、git diff --check。
- 矩阵：**i18n.write → MCP_SUPERSET**（证据 docs/evidence/message-text-write-real-dev-verified.md）。现状对齐 **53/71**（MCP_SUPERSET=12、EQUIVALENT=41、PARTIAL=6、GAP=2、RESTRICTION=10）。AGENTS.md 基线已同步。
- 下一轮：剩余 PARTIAL 6 行（debug.amdp-adt、devtools.execute-abap、crud.recover-failed-create、git.abapgit、diagnostics.knowledge-queries、analysis.history）与 GAP 2 行（transport.merge-move、ui5.write）按大轮立项推进。

## 2026-09-24 会话轮二：recover-failed-create 受控恢复链真机打通——SMOKE OK，晋级 MCP_SUPERSET

- 矩阵行 crud.recover-failed-create（P1）落地。设计：previewRepositoryObjectCleanup 新增可选 creationPlanId 绑定，三重门控（计划存在 + 状态 ∈ FAILED/OUTCOME_UNKNOWN/COMPENSATION_FAILED + 目标身份一致）才允许对半成品做 inactive 容错解析；apply 复用同一受控删除链（重验证→锁→单次 DELETE→UNLOCK 兜底→absence）。"来源不明对象不自动恢复"边界保持：无绑定=active-only 语义不变，零登记证据依旧拒绝。
- 真机场景构造（sap-demo）：冻结创建计划 → 直连 ADT 预造同名 inactive 程序（等价崩溃残局）→ apply 收敛 FAILED → 绑定恢复清理删除半成品 → COMPLETED_LOCAL_ABSENCE + absence 零残留。负例：APPLIED 计划 POLICY_DENIED、未知计划 PLAN_NOT_FOUND、普通清理（无绑定）回归通过。
- 关键发现与修复：① 半成品（从未激活）删除后传输零登记——新增 NO_TRANSPORT_ENTRY_VERIFIED 处置，仅恢复绑定计划放行（absence 已独立证明删除生效），常规清理守卫不放宽；② legacy 创建适配器把包名填进 target.parentName，与清理语义父级不同义——绑定比较仅在显式提供且不符时拒绝；③ requestLimits 的 STRICT_TOOL_FIELDS 同步补 creationPlanId。
- 顺带修复：上会话遗留 7 个 scripts/probe-*-tmp.mjs 临时探针与根目录 probe-mt-final.tmp.mjs 已清理；package.json 注册 test:message-text-real-dev 与 test:recover-real-dev。
- 门禁全绿：Jest 162 suites / 1555 tests（+7）、build、check:repository-creation-coverage（28/0）、check:vsp-capability-parity、git diff --check。
- 矩阵：**crud.recover-failed-create → MCP_SUPERSET**（证据 docs/evidence/recover-failed-create-real-dev-verified.md）。现状对齐 **54/71**（MCP_SUPERSET=13、EQUIVALENT=41、PARTIAL=5、GAP=2、RESTRICTION=10）。AGENTS.md 基线已同步。
- 下一轮：剩余 PARTIAL 5 行（debug.amdp-adt、devtools.execute-abap、git.abapgit、diagnostics.knowledge-queries、analysis.history）——amdp-adt 与 execute-abap 需受控会话/执行链大轮设计；abapgit 受环境阻塞（abapGit 未安装）；knowledge-queries 与 analysis.history 需对照 VSP 补齐剩余子操作（fm_test_data/cluster_read、impact/tr_boundaries 等）。

## 2026-09-24 会话轮三：abapGit 结论修正 + getLoadGraph（D010INC 加载图）落地——analysis.history 缺口收窄

- **git.abapgit 结论修正（所有者）**：最新版 abapGit 已移除 ADT 服务（/sap/bc/adt/abapgit/repos）——即使系统装了 abapGit，ADT REST 面也不存在，该行维持现状（ADT 链路 RESTRICTION 方向正确），不再作为可推进项。
- **analysis.history 补齐 loads 子操作**（对照 VSP 源码 oisee/vibing-steampunk 逐函数移植 pkg/adt/loads.go + pkg/graph/builder_loads.go）：
  - 新增 src/adt/LoadGraphApi.ts + getLoadGraph 只读工具（focused/legacy-full/diagnostic/operations 四 profile；datapreview SQL 通道同款只读）。
  - 语义全套移植：填充池名归一化（=填充→CLAS/INTF 按 IP/IU 尾段、SAPL<组>/L<组><段>→FUGR、其余→PROG；LEGACY_REPORT 反例防误判）、归属过滤（前缀 LIKE 拖进的兄弟对象 ZCL_ORDER_ITEM 不属于 ZCL_ORDER）、内核机器行过滤（<SYSINI>/%_ 开头/~ 生成伴随池）、自包含行丢弃（类池加载自身方法占表绝对多数）、obsolete 行丢弃、2000 行上限防内核程序拖全表、up 方向锚定 INCLUDE 侧。
  - 真机（sap-demo）：ZCL_MCP_SM21_ADT_HTTP 读回 26 条对象间加载边（CL_ABAP_DATADESCR===CT 等跨类加载全部正确归一化），up 方向 13 行全为包含/机器行时 notes 如实标注；负例（非法 token/direction）参数层拒绝。直查 D010INC 对照：真机数据形态与 VSP 7.58 样本逐字一致。
  - 关键修复：handler 对 API 层参数语义错误按 InvalidParams 透传（原被脱敏成 InternalError）；smoke 负例正则对齐 -32602 形态。
- VSP 剩余缺口定性（源码核查）：knowledge-queries 的 fm_test_data/cluster_read 需 pkg/datacluster 二进制解析器（~18KB Go，EUFUNC/BALDAT/INDX/STXL EXPORT 集群解码，独立工程轮）；history 的 impact/tr_boundaries/cr_boundaries/health/graph_stats 需 pkg/graph 多跳遍历引擎（仅 loads 是纯表查询——本轮已收编）。
- 门禁全绿：Jest 163 suites / 1566 tests（+11）、build、coverage（28/0）、parity、git diff --check。profile 计数同步：development=183、workbench=150、diagnostic=140、legacy-full=203、operations=49。
- 矩阵：analysis.history 维持 PARTIAL 但 restrictionReason 更新（loads 已验证；剩余全为图引擎类）。AGENTS.md 基线已同步。
- 下一轮可选：knowledge-queries 的 fm_test_data 子集（EUFUNC 集群表——若只读目录层 TE_DATADIR/FDESC_COPY 可用 datapreview 结构读规避二进制解析，需探针定性）；或受控执行链大轮（execute-abap/amdp-adt）。

## 2026-09-25 闲时轮：getTransportScope 组合链真机验证 SMOKE OK——抓到并修复 NULL 列 undefined 缺陷

- 状态读取：拉取远程新提交 3225156（离线依赖图三工具：analyzeDependencyGraph/buildLoadDependencyGraph/getTransportScope，全部仅离线验证）。矩阵无 UNVERIFIED；按 nextMilestone=transport-structural-dependency-composition 选定本轮工作：为组合链补真机验证（离线三份证据共同声明的缺口）。
- 本地门禁先行全绿（168 suites / 1765 tests 基线；顺手补跑被远程提交遗漏的矩阵 MD 再生成）。
- 真机（sap-demo，只读）：`npm run test:transport-scope-real-dev`——S4HK900010 → 父请求 S4HK900009 归并、194 个 R3TR 成员、includeLoadBoundaries 组合分类（partial 三来源如实传播、summary 恒等关系成立、deploymentReadinessVerified/systemWideComplete 恒 false 断言）、负例（未知传输 partial+unresolved、非法 ID InvalidParams）。SMOKE OK。定向补证：buildLoadDependencyGraph 对真实类读回 26 条 LOADS 边（D010INC 真数据）。
- **真机抓到并修复实质缺陷**：SAP datapreview 对 NULL 列不输出 <data> 元素，parseQueryResponse 按 columns 补键后单元格值为 undefined（JSON 序列化省略成"缺键"假象）——TransportScope 的 cell() 只认字符串，顶层请求头（STRKORR 本应为空）被判异常数据，整条采集链空转；离线 fixtures（空串形态）无法暴露。修复：undefined/null/缺键统一归一化为空串语义，歧义列仍拒绝。新增回归用例 + 修正旧用例过时假设。教训再确认：fixtures 全绿≠真机可用，datapreview 行形态（undefined 值）需真机取证。
- 排障坑：tsbuildinfo 增量缓存跳过重写导致修复"未生效"假象（删缓存强制重建即解，二次踩坑确认）。
- 门禁全绿：168 suites / 1766 tests、build、coverage、parity、git diff --check。
- 矩阵：analysis.history 维持 PARTIAL，restrictionReason 增真机验证段，nextMilestone 更新为 transport-crossref-structural-edges（WBCROSSGT/CROSS 结构边采集）。证据：docs/evidence/transport-scope-real-dev-verified.md。
- 本轮未做 git commit/push（遵守闲时任务边界，工作区留给所有者复查）。

## 2026-09-25 闲时轮二：getTransportScope 补 WBCROSSGT/CROSS 结构边并真机验证——tr_boundaries 核心链路闭环

- 沿上轮 nextMilestone（transport-crossref-structural-edges）推进：getTransportScope 新增 includeCrossRefBoundaries 开关（与 includeLoadBoundaries 并列、至少一个为 true），对传输范围代码承载成员（CLAS/INTF/PROG/FUGR）采集 WBCROSSGT/CROSS 出向结构边（REFERENCES/CALLS 口径），与 LOADS 源互补后统一进入边界分类器。行语义逐条对齐 getCallees（真机验证过的同表读取口径）：DIRECT='X' 过滤类型引用噪声、PERFORM 行 NAME/PROG 交换、组件段合并为对象级边、兄弟池归属过滤、目标身份按成员名称集精确匹配（同名多类型记歧义不猜）、未命中落 UNKNOWN 类型节点交 Z/Y 启发式分类。
- 真机（sap-demo，只读）：决定性正例 S4HK900012——裸 SQL 取证 LZMCP_TOOLS 有 CROSS DIRECT 行（NAME=S_ADMI_FCD），组合链端到端产出 FUGR:ZMCP_TOOLS→UNKNOWN:S_ADMI_FCD（CALLS）并正确分类 standardCandidates，恒等关系成立、安全常量不放宽；getCallees 同源对照 21 条引用；双源组合真机可跑（partial 如实传播）；负例双 false → InvalidParams。SMOKE OK（npm run test:transport-crossref-real-dev）。
- 环境取证与新教训：① WBCROSSGT 的 INCLUDE 池名存在无填充截断形态（名长截断直接拼段后缀），归属过滤规则正确处理；② S4HK900010 自有验证类在 WBCROSSGT 无 DIRECT 行（极简代码+部分 inactive），结构边 0 是真实结果；③ datapreview 按会话查询预算耗尽后 E070/E071 读取静默失败成空成员——多段重查询 smoke 必须按段拆独立 MCP 会话并对空成员显式断言；④ bash heredoc 写含反斜杠 mock 数据会被转义吃掉伪造失败假象（heredoc 转义地狱第三次）——mock 数据必须用 Write 工具写文件。
- 实现修复：新入参 includeCrossRefBoundaries 同步 requestLimits.STRICT_TOOL_FIELDS（连续两轮在此翻车，已彻底记牢）；handler 补双 false 显式拒绝（防静默降级为纯成员模式）。
- 门禁全绿：168 suites / 1771 tests（+5）、build、coverage、parity、git diff --check。
- 矩阵：analysis.history 维持 PARTIAL，restrictionReason 增 crossref 真机段，nextMilestone 清空（tr_boundaries 核心链路真机闭环；剩余 E070A（服务器未配置）/动态调用/图引擎轮均超出纯 SQL 范围）。证据：docs/evidence/transport-crossref-real-dev-verified.md。
- 下一轮建议：analysis.history 纯 SQL 可落地子集已尽；剩余 PARTIAL（execute-abap/amdp-adt/knowledge-queries 解析器轮）均需大轮立项。可考虑对三轮组合链工具（getTransportScope/buildLoadDependencyGraph/analyzeDependencyGraph）做一次使用指南文档补写（docs/使用指南.md 尚未收录本轮 crossref 开关）。

## 2026-09-25 闲时轮三：getFmTestDataSets（EUFUNC 目录层）落地真机验证——fm_test_data 缺口收窄至集群解码器

- 选型：knowledge-queries（P2）的 fm_test_data 拆层策略——目录层（key 与元数据列）纯 SQL 可落地，payload 内容层（CLUSTD EXPORT 集群）仍需 S/2 集群解析器（独立工程轮）。
- 真机前置探针（datapreview 直查）：EUFUNC 表可读，列形态 RELID/GRUPPE/NAME/NUMMER/SEQID/SRTF2/LANGU/AUTOR/DATUM/ZEIT/VERSION/CLUSTR/CLUSTD 与 VSP fmtest.go key 取值完全对应；决定性正例 C162_SPEC_GET_BY_ID（标准 FM，999 目录行 + 数据行）。
- 新增 getFmTestDataSets 只读工具（挂 KnowledgeQueries 家族第四工具；focused/workbench/legacy-full/diagnostic profile）：relid='FL' 按 FM 名精确匹配，列出已保存测试集（编号/作者/日期/时间，SRTF2 续块去重、999 目录行分离为 directory 元数据），notes 恒带"payload 未解码"声明；通道失败降级空目录 + notes（不重试不伪装）。
- 真机 SMOKE OK：正例 C162_SPEC_GET_BY_ID 读回 999 目录（author=SAP）+ 1 个测试集；自有 FM 空目录为正常回答；非法名 InvalidParams。
- 接线修复：KnowledgeQueries mock 与 client 绑定同步（python 批量编辑两处错位，逐处修正）；STRICT_TOOL_FIELDS 白名单、ToolProfiles/OperationPolicy 名单、ToolCatalogIntegrity 计数（dev=187/workbench=154/diag=144/full=207）全部同步。
- 门禁全绿：169 suites / 1776 tests（+5 API 用例）、build、coverage、parity、git diff --check。
- 矩阵：diagnostics.knowledge-queries 维持 PARTIAL，taskPath 增 getFmTestDataSets，restrictionReason 更新（目录层子集真机验证；剩余 fm_test_data 内容层与 cluster_read 均为集群解析器工程轮）。证据：docs/evidence/fm-test-data-real-dev-verified.md。
- 下一轮建议：knowledge-queries 剩余缺口（fm_test_data 内容层 + cluster_read）与 analysis.history 剩余（impact/health/graph_stats）均需集群解析器/图引擎工程轮立项，纯 SQL 子集已尽；PARTIAL 剩余的 execute-abap/amdp-adt 为受控链大轮。若不做大轮，可做文档收尾轮（三组合链工具 + getFmTestDataSets 补写进 docs/使用指南.md）。

## 2026-09-25 闲时轮四：文档收尾轮——组合链三工具与 getFmTestDataSets 补写进使用指南

- 选型：PARTIAL 剩余全部是大轮/工程轮/定论不做（execute-abap、amdp-adt=受控链大轮；knowledge-queries、analysis.history=解析器/图引擎工程轮；abapgit=定论 RESTRICTION），无 UNVERIFIED。执行上上轮明确建议的文档收尾轮：近三轮落地的 5 个只读工具补写进 docs/使用指南.md（面向外部读者的权威指南此前缺失，工作区此前已含 27 个文件的未提交成果一并保留）。
- 使用指南更新：① 6.2/6.3 过时标注修正（"尚未真机验证"→ 6.2/6.4/6.5 真机验证完成，引用 transport-scope/transport-crossref 两份真机证据）；② 新增 6.4 传输结构边界组合链（getTransportScope 双开关语义、crossref 决定性正例、恒等关系与安全常量、预算与 partial 语义）；③ 新增 6.5 函数模块测试数据目录（getFmTestDataSets 目录层语义、payload 不解析声明、空目录为正常回答）；④ 基线行 169/1776（2026-09-25）。
- 版本适用性标注：6.4/6.5 注明"随下一 npm 版本发布（源码运行已可用）"，6.1 保留"尚未发布"（npm 0.8.4 确不含），避免误导 npm 安装用户。
- 门禁：169 suites / 1776 tests 全绿、parity、git diff --check（纯文档轮，无代码/矩阵变化）。
- 遗留与下一轮：PARTIAL 5 行全部进入"大轮/工程轮/定论"状态，纯 SQL 与轻量子集已尽。后续路径三选一：① 集群解析器工程轮（fm_test_data 内容层 + cluster_read，VSP pkg/datacluster 移植）；② 受控执行/调试链大轮（execute-abap、amdp-adt）；③ 发版轮（工作区已有大量未提交成果，可提请所有者审查后发布 0.8.5）。均需所有者输入，闲时轮不再自行开新工程。

## 2026-09-28 闲时轮：getWhereUsedConfig（TVARVC 配置引用分析）落地真机验证——analysis.history 再收一子操作

- 选型：CLUSTD 解码器接入维持 NO-GO（上轮 V6 边界），analysis.history 剩余子操作中 where_used_config 经 VSP 本地源码（D:\MyDev\SAP\vibing-steampunk handlers_graph.go）评估为纯 SQL+源码 grep 可落地——本轮落地。
- 实现：WhereUsedConfigApi + getWhereUsedConfig 只读工具（analysis 家族同型接线）。两段式：候选采集（WBCROSSGT OTYPE='TY' + CROSS TYPE='S' 按 NAME='TVARVC' 配对，单源失败可生存、双源失败硬错误非空答案）→ 源码 grep 确认（复用 grepObjects 通道，大小写不敏感；confirmed=true 仅当命中，失败/跳过/预算外一律 unsearched 不借义）。grep 预算默认 10 上限 30（与 VSP 无界的有意差异，notes 声明）；候选身份用 normalizeLoadName 归一化；不做包回填。
- 真机（sap-demo）：该系统 TVARVC 零候选（无激活引用代码）——采用直连 ADT 写链自造数据（授权范围：自有 Z* 验证对象的源码写与激活）：创建 ZWUXREF4790 → stateful 加锁写引用 TVARVC 源码 → 激活 → 组合链 readers=1 confirmed=1（决定性正例）→ 直连删除 + 缺席复核零残留。SMOKE OK。
- 环境取证：① 受控创建链的 REAL_DEV validation 模式（sap-demo.env 现 VALIDATION=true + PREFIX=ZV）会拒绝非 ZV 前缀创建且 REAL_DEV_VERIFIED 类型禁止 validation 计划写——smoke 进程 env 覆盖 false 无法绕过（validation 拒绝来自创建链内部语义，非 env 解析）；② 直连写链三坑：setObjectSource 必须用 /source/main 源端点、lock/activate 必须 stateful 会话；③ dist 是 ESM——插桩用 require 会崩（ESM 顶部 import）。
- 门禁全绿：172 suites / 1827 tests（+8）、build、coverage、parity、git diff --check。profile 计数（dev=188/workbench=155/diag=145/full=208）与 STRICT_TOOL_FIELDS 同步。
- 矩阵：analysis.history 维持 PARTIAL，taskPath 增 getWhereUsedConfig，restrictionReason 更新。证据：docs/evidence/where-used-config-real-dev-verified.md。
- 下一轮建议：analysis.history 剩余 usage_examples（callers 源码片段呈现层，可基于 getCallees+getObjectSource 收编）仍可纯 SQL 落地，可作下轮候选；其余同前（集群解析器/图引擎/受控执行链大轮）。

## 2026-09-29 轮：受控传输请求创建链落地——"仅创建"动作对 AI 放开

- 需求与边界（所有者指示）：放开"由 AI 创建传输请求"一个动作，触发条件=用户明确要求建请求（落点=原生确认）；释放、删除、改属主、加用户与直改 E071/E071K 维持禁止。
- 实现（与受控激活链同构的三工具受控链）：safe 层新增 TransportCreationTypes/PlanStore/Workflow/Confirmation；handlers 层新增 SafeTransportCreationHandlers（previewTransportCreation=只读 CTS 预检（transportInfo）+冻结 plan，锚点 URI 由 server 从包名推导 `/sap/bc/adt/packages/<devclass>`、applyTransportCreation=form elicitation 原生确认后经 executionGate 单次创建+transportDetails 读回验证、getTransportCreationStatus=本地查询）。拒绝本地 `$` 包与非法包名/超长描述（AS4TEXT≤60）；创建异常/空请求号/读回不一致→UNKNOWN_OUTCOME 终结不重试不删除。策略层：CONTROLLED_TRANSPORT_CREATION_TOOL_NAMES（preview=read-only、apply=advanced-mutation、status=local）+ DEV-only 角色门控 + development/development-workbench profile 门控（不进 legacy-full，专家继续用原子 createTransport）；serverGuardrails 豁免 apply/status 外层 gate（防 concurrency=1 自我死锁，同激活链教训）。profile 计数：development 188→191、development-workbench 155→158（focused 同步）。
- 门禁：`npm run build` 通过；`npm test -- --runInBand` 连续两轮全绿 174 suites / 1860 tests（首轮 4 个 suite 因瞬态编译问题失败，未定位到代码原因，复跑两轮稳定全绿）；新测试 26 例覆盖工作流/确认/profile 门控/仅创建边界（transportRelease 等四工具在受控 profile catalog 断言不存在）。真机 smoke 未运行——预检→确认→创建→读回全链待所有者授权后按 AGENTS.md 专用 DEV 配置补跑。
- 文档：AGENTS.md（安全边界改为"仅创建放开+其余禁止"、profile 计数、基线 174/1860）、docs/使用指南.md 4.1 增传输创建链段落、PROGRESS.md 本节。
- 真机 smoke（sap-demo，所有者当日授权）：`scripts/transport-creation-real-dev-smoke.mjs` 最终轮 29/29 全 PASS（S4HK900023）。全链验证：catalog 可见性与仅创建边界（4 个禁止工具不在目录）、$TMP 负向探针、包锚点预检（transportchecks 接受 packages URI，7.51 缺陷不复现）、确认拒绝/接受两分支、单次创建+读回、重复 apply 拒绝、直连 transportDetails 与 E070 双重独立佐证。
- 真机新事实四条：① 创建动作锁包于会话（enqueue 层，TLOCK/E071 无行），进程被杀后滞留数分钟再被服务端回收——期间新会话对同包 preview 报"已由本人编辑"；② 创建自动生成 1 个子任务但 E071 零行（包不进请求）；③ 数字型用户名前导零被剥（068157→68157），属主比较须剥零；④ MCP runQuery 响应为 {status, result:{columns, values}} 包装形态。
- 残留：4 个空请求 S4HK900017/019/021/023（TRSTATUS=D、属主 068157、E071 零对象，已逐一只读核实）——按"AI 不删除传输"边界不清理，属主可 SE09 手工删除。证据：docs/evidence/transport-creation-real-dev-verified.md。

## 2026-09-29 轮（二）：空请求受控清理链——边界调整为"仅删空请求"

- 所有者边界调整：空请求允许删除。落地受控清理三件套（与创建链同构，同一 handlers 类暴露）：`previewTransportCleanup`（只读 transportDetails 核验三条红线：未释放状态 D + 零对象（请求本体+全部子任务）+ 本人属主（数字型用户名剥前导零比较），任一不满足即 VALIDATION_FAILED 不建 plan）→ `applyTransportCleanup`（form elicitation 原生确认 decision=delete_transport → executionGate 单次 DELETE /cts/transportrequests/<number> → 只读读回验证缺席，仍可读即 UNKNOWN_OUTCOME 终结）→ `getTransportCleanupStatus`。非空/已释放/他人请求仍不可删；释放/改属主/加用户/直改 E071·E071K 维持禁止。策略层：CONTROLLED_TRANSPORT_CLEANUP_TOOL_NAMES + DEV-only + development/development-workbench 门控；serverGuardrails 豁免 apply/status 外层 gate。profile 计数：development 191→194、workbench 158→161。
- 真机（sap-demo）：4 个历史残留空请求（S4HK900017/019/021/023）经 `scripts/transport-cleanup-real-dev.mjs` 受控删除——逐个红线核验（status=D、objects=0、owner=68157）→ 原生确认 → 链内缺席验证 + 直连只读缺席复核双通过，SUMMARY 删除 4 跳过 0；smoke 脚本扩展自清理闭环（第 11–13 步），完整重跑 SMOKE OK（S4HK900025 创建→验证→清理→缺席），此后 smoke 零残留。
- 门禁：`npm run build` 通过；`npm test -- --runInBand` 176 suites / 1895 tests 全绿（新增 TransportCleanup.test.ts 25 用例：三条红线逐条拒绝/剥零属主/缺席验证/UNKNOWN_OUTCOME 不重试/六工具 profile 门控/原子 transportDelete 仍不进受控目录）。
- 文档：AGENTS.md 安全边界改写为"仅创建+仅删空请求"、docs/使用指南.md 清理句、证据文档追加清理章节、PROGRESS.md 本节。

## 2026-09-29 轮（二）：受控创建链传输门禁 7.51 兼容改造——软检查 + 双通道门禁 + 归属证明

- 背景：ED1（7.51）反馈两条受控创建链创建程序均卡 `TRANSPORT_INVALID: No URI-Mapping defined for URI`。修正前一轮误诊：预检从首版就传**自拼包 URI**（非不存在对象 URI），且 transportchecks 与 transportDetails 同在一个 try 无法按错误码归因；7.51/7.52 分界由用户断言 + sap-demo 行为探针侧证（SVERS=816 但文本池资源在=7.52+ 行为侧）。
- 实现（保持安全门控、不新增绕过受控链的写入口）：① transportchecks 降为软检查（失败只记诊断，候选不含请求降为提示，创建 POST corrNr 由 SAP 权威登记，VSP 同语义）；② 请求门禁双通道（ADT transportDetails → E070 只读 SQL 兜底，"已释放"任一通道即拒，两路皆败才拒）；③ 预检 URI 优先用 resolve 搜索返回的 parentUri（自拼 parentPath 回退）；④ 创建后归属证明（E071 只读 SQL 主 / ADT 请求对象清单备，严格条目匹配 + 函数模块/包含的父组放宽），UNPROVEN/UNKNOWN 按失败终止并禁止自动补偿删除（新码 TRANSPORT_REGISTRATION_UNPROVEN/UNKNOWN）；⑤ 预览与计划视图透出 transportValidation（通道/兼容性/notes/attempts 结构化诊断，消息经 sanitize 不透原始响应）。新增 `src/safe/TransportRegistration.ts` 纯函数层；CreationAdtClient 增可选 runQuery（datapreview）。
- 门禁：`npm run build` 通过；本轮文件域内 `AbapObjectCreationWorkflow.test.ts`（原 11 + 新 7）与新增 `TransportRegistration.test.ts`（7）25/25 全绿；全量套件此刻含并行 agent 的 transport cleanup 中间态（SafeTransportCreationHandlers.ts 瞬态语法错误/TransportCleanup.test.ts 编译错误），失败与本轮改动无关（归因：0 个测试失败、错误唯一指向对方文件域）。全量绿需等并行轮收尾后复跑确认。
- 待办：7.51 真机验证由对方用户执行（复测指引见证据文档第 5 节），通过前成熟度结论不变，但 PROGRAM 等创建验证系统基线标注为 7.52+ 行为侧。证据：docs/evidence/creation-transport-gate-751-compat.md。

## 2026-09-29 闲时轮：getUsageExamples（调用片段示例）落地真机验证——analysis.history 纯 SQL 子集全部收编

- 选型：analysis.history 剩余子操作中 usage_examples 经 VSP 本地源码评估（fetchUsageCallerSources + pkg/graph/queries_examples.go FindUsageExamples）为交叉表 SQL + 源码读取呈现层可落地——本轮落地，该行最后一个纯 SQL 子操作收编。
- 实现：UsageExamplesApi + getUsageExamples 只读工具（analysis 家族同型接线）。候选按目标类型选查询（FUNC→CROSS TYPE='F'；PROG→'R'（SUBMIT）/form 场景 'U'（PERFORM 行 NAME=form）；CLAS/INTF→WBCROSSGT+CROSS 双表 LIKE）；候选归一化、FUGR 不出片段（v1 边界 VSP 同）；逐候选读 source/main 全文做六形态匹配（CALL_FUNCTION/METHOD_CALL/CLASS_REFERENCE/SUBMIT/PERFORM/字面 GREP 兜底 MEDIUM 置信），注释行跳过，片段带前后 3 行行号上下文；排序非测试优先/高置信优先/具体形态优先；maxExamples 默认 10 上限 50。源码读取失败/空源码记 unsearched 不计入 totalCallers；交叉表失败 reason 脱敏固定文案。
- 真机（sap-demo）：直连 ADT 写链自造数据——创建自有验证类 ZWUEXA3478（引用真机自有类 ZCL_MCP_SM21_ADT_HTTP 的 =>/-> 调用）→ 激活 → 组合链 totalCallers=2、本对象示例命中 CLASS_REFERENCE HIGH → 直连删除 + 缺席复核零残留。SMOKE OK。WBCROSSGT 行形态真机取证：INCLUDE 30 位填充池（ZWUEXB35660===================CM001）、OTYPE=TY、NAME=目标名——与 LIKE 候选查询、normalizeLoadName 完全吻合；行激活即时生成且跨会话立即可见（immediate/5s/15s 三探一致）。
- 首跑 totalCallers=0 的根因为激活→查询竞态（5s 等待后稳定通过）；失败路径已改为保留对象取证。
- 门禁全绿：177 suites / 1905 tests（+10）、build、coverage、parity、git diff --check。profile 计数（dev=195/workbench=162/diag=146/full=209）与 STRICT_TOOL_FIELDS、ModernProtocol 运行时计数同步。
- 矩阵：analysis.history 维持 PARTIAL，taskPath 增 getUsageExamples，restrictionReason 更新（纯 SQL 子集全部收编；剩余 impact/health/graph_stats 为图引擎轮、E070A 服务器未配置）。证据：docs/evidence/usage-examples-real-dev-verified.md。
- 下一轮建议：analysis.history 与 knowledge-queries 的纯 SQL/呈现层子集已全部收编完毕；剩余（execute-abap/amdp-adt 受控链大轮、集群解析器工程轮、图引擎轮）均需所有者立项输入。工作区含 where_used_config 与本两轮未提交成果，可提请所有者审查后并入下版。

## 2026-09-30 轮：全工作流八阶段真机战役（sap-demo）——五缺陷真机修复 + 门禁语义首证

- 范围：0.9.0 三线功能全量回归（MCP v2 双栈 / 受控传输创建+清理链 / 受控创建链传输登记门禁）+ 三条 MRTR 确认链 + 恢复链。八阶段全部 SMOKE OK，证据 docs/evidence/full-workflow-smoke-verified.md。
- 门禁真机首证：preview 透出 review.transportValidation（ADT 通道 status=D、SAP_CONFIRMED）；不存在请求号正确拒（修 D3 后语义升级为"E070 未找到"）；apply 终态 APPLIED 含归属证明；getTransportScope + E071 SQL 双外部佐证；确认型 apply 串行门零死锁。
- 五缺陷真机修复（均有回归测试）：① getUsageExamples 漏 operations-readonly 名单（54，矩阵契约同步）；② description smoke 硬编码 sap-dev.env 误连 ED1（改 argv+sap-demo 默认+红线）；③ AbapObjectCreationWorkflow 两处 runQuery 裸引用丢 this（bind 修复，SQL 通道复活）；④ transportDetails 解析漏 tm:all_objects 包装（parseRequest 兼容，条目属性无 tm:obj_func）；⑤ 清理核验键 LIMU/REPS vs 登记条目 R3TR/PROG 失配（补别名）+ all_objects 合并视图同身份重复（三元组去重，"重复即腐坏"语义作废）。
- SAP 真机语义记录：对象删除后 E071 行不消失（含历史请求不可清，红线正确拒 S4HK900029）；清理链只接受归属校验传输的对象；ADT 删除留 TADIR 孤儿行。ED1 偶然佐证：7.51 双通道皆败时门禁正确拒（preview-only 零写入）。
- 门禁：178 suites / 1908 tests 全绿（+TransportsParser 2 例 +绑定回归 1 例 + 清理语义测试改写）、build、coverage 28 REAL_DEV_VERIFIED 零缺证据、git diff --check。
- 残留：S4HK900029（+任务 030）含 5 条中性历史行 + ZPRGWF* 源码已删的 TADIR 孤儿行，留属主 SE09；其余零残留。脚本新增 scripts/full-workflow-stage5-creation-gate.mjs、full-workflow-residue-cleanup.mjs、full-workflow-gate-probe.mjs。

## 2026-09-30 闲时轮：F1 程序文本池原子写纳入 focused profile——四层门逐层取证修复，真机 SMOKE OK

- 选型：所有者交接文档 9a591ae 新增 F 章任务清单，F1 [P1]（程序文本池写入受控化）为最高优先可落地项。本轮完成**最小方案**：原子 setTextElements 及配套 lock/unLock 纳入 focused/developer（development-workbench）入口。
- 四层门逐层取证与修复（每层独立实证）：① catalog 可见——DEVELOPMENT_WORKBENCH_TOOL_NAMES 加 setTextElements/lock/unLock（lock/unLock 为 "caller manages locking" 模式的必要配套：锁句柄须与写调用同 server 会话，OTHER_MUTATION 已 DEV 专属）；② 策略门——assertToolOperationAllowed 的 raw 族 legacy-full 专属为 setTextElements/lock/unLock 开 workbench 口（仍 DEV 专属+写槽）；③ legacy 只读分派门——isReadOnlyLegacyTool 拒绝逻辑同口径开口；④ 协议 415——文本池 /source/{category} 端点只认 text/plain（adt.textelements.v1 专用媒体类型 PUT/GET 均 415），GET/PUT 对称修复（@MaxLength 协议不变）。
- 真机（sap-demo）：focused 面运行时暴露 setTextElements → 直连创建+激活自有验证程序 ZWTXT#### → MCP lock（同会话锁）→ setTextElements 写 2 条中文文本符号 → getTextElements 读回逐条一致 → unLock → 删除+缺席零残留。SMOKE OK。
- 排障过程记录：四层门逐层定位（每层独立取证后修复，catalog/策略/分派/协议各一）；跨会话锁句柄不可用（直连拿锁+MCP 面写会被 SAP 拒——必须走 MCP lock 工具）；dist 插桩的 require/shebang/转义三坑（ESM import 须在 shebang 后）。
- 门禁全绿：180 suites / 1933 tests、build、coverage、parity、git diff --check。profile 计数（workbench=165）与 STRICT_TOOL_FIELDS（既有覆盖）同步。
- 矩阵：report.text-elements 维持 MCP_SUPERSET，restrictionReason 更新（F1 最小方案落地+协议 415 取证；完整方案受控工具对为后续）。证据：docs/evidence/f1-textpool-focused-real-dev-verified.md。
- 下一轮建议：F1 完整方案（previewTextPoolChange/applyTextPoolChange 受控工具对）或 F2（checkInstallPrerequisites 深化为 ZADT_VSP 可用性诊断）——均为所有者交接文档排定的可落地任务。

## 2026-09-30 闲时轮二：受控程序文本池写入链（F1 完整方案）真机验证——SMOKE OK

- 选型：F2（InstallDiagnosticsApi 深化）已被另一会话实现（工作树未提交 +306 行），F1 完整方案（受控工具对）未被占——按交接文档 F1 承接落地。
- 实现：TextPoolWorkflow（复刻 MessageTextWorkflow 安全模型：immutable plan + 原生确认 + stateful 锁链单次执行 + readback + UNKNOWN_OUTCOME 终止 + 同值短路）+ TextPoolHandlers 三件套（previewTextPoolChange/applyTextPoolChange/getTextPoolChangeStatus）。执行协议沿用 F1 固化的 text/plain 真机口径；对象锁由 server 会话持有（真机实证跨会话句柄被拒）。校验按 category 分规则（symbols 3 位+@MaxLength/selections 参数名≤30/headings 枚举），重复 id 拒绝。
- 分类注册全链：CONTROLLED_TEXT_POOL_TOOL_NAMES（READ_ONLY/ADVANCED_MUTATION/WRITE_CHAIN/DEV 门/workbench 门/CLASSIFIED 断言五处）；serverGuardrails 执行门豁免（apply/status 同受控消息文本链豁免语义）；requestLimits 白名单。
- 真机（sap-demo）：直连 ADT 写链自造数据——创建自有验证程序 ZWTPOL0714（引用 TEXT-001/002）+ 激活 → preview 冻结（old=0 new=2）→ apply 锁链执行 readback 核验 → status=SUCCEEDED → 同清单再跑 sameValue=true（不锁不写）→ 直连删除 + 缺席零残留。SMOKE OK。
- 边界记录：受控清理链对直连创建靶对象不适用（无锁条目登记，TRANSPORT_INVALID）——收尾用直连删除 + 缺席（与 usage-examples 轮同先例）。ZTABDATA_TOOL 17 条选择文本实战写入（D1 验收场景）留所有者确认后执行。
- 门禁全绿：180 suites / 1965 tests（+mock/门控用例）、build、coverage、parity、git diff --check。
- 矩阵：report.text-elements 维持 MCP_SUPERSET，restrictionReason 更新（受控三件套真机验证补全）。证据：docs/evidence/textpool-controlled-real-dev-verified.md。
- 下一轮建议：F2（InstallDiagnosticsApi 深化）已由另一会话完成实现（工作树未提交），待其提交后复核即可；analysis.history/knowledge-queries 剩余为图引擎/集群解析器工程轮。工作区含多轮未提交成果，建议所有者审查后统一提交。

## 2026-09-30 闲时轮二：文档收尾——where_used_config 与 usage_examples 补写进使用指南

- 拉取确认：远程已有所有者的 A8 AMDP 工作流晋级（debug.amdp-adt PARTIAL→EQUIVALENT，55/71，PARTIAL 降至 4）与 CLUSTD 多片段轮；无 UNVERIFIED；无本角色可单轮交付的矩阵项（剩余 4 行 PARTIAL 均为大轮/工程轮/定论，判定同前）。
- 执行上轮遗留的文档收尾：docs/使用指南.md 新增 6.6（getWhereUsedConfig：TVARVC 配置引用分析——两表配对候选+源码 grep 确认、单源生存/双源硬错误、grep 预算与 unsearched 不借义语义、激活时序提示）与 6.7（getUsageExamples：调用片段示例——CROSS 单字符码候选、六形态匹配+GREP 兜底 MEDIUM、排序与 unsearched 语义），均含 JSON 示例、smoke 命令与证据链接。
- 门禁：177 suites / 1905 tests 全绿（纯文档轮）、parity、git diff --check。
- 下一轮建议：矩阵剩余 4 行 PARTIAL（execute-abap/amdp-adt 已完成——amdp 已晋级；knowledge-queries/analysis.history 剩集群解析器与图引擎工程轮）均需所有者立项；0.9.0 已含组合链与目录层工具但 6.1 节"尚未发布"标注需在发版时复核。

## 2026-10-06 闲时轮：devtools.execute-abap 受控执行链真机验证——PARTIAL → EQUIVALENT（大轮）

- 选型：剩余 PARTIAL 中唯一可单轮落地的受控链大轮（VSP workflows_execute.go ExecuteABAP 执行核移植）。机制：用户 ABAP 片段包进一次性 ABAP Unit 测试程序（REPORT ZTEMP_EXEC_<ms尾段>，$TMP 本地包、无 transport、RISK LEVEL 由 riskLevel 声明），激活后 POST abapunit/testruns 单次运行，收尾 cl_abap_unit_assert=>fail( msg = |EXEC_RESULT:{ lv_result }| ) 把返回变量值带出测试沙箱（值离开测试方法的唯一通道），运行后临时程序即删。
- 实现：src/adt/ExecuteAbapApi.ts（执行核 + createExecuteAbapClient 绑定，七方法窄接口全部映射 AdtClient 既有公开 ADT 能力；锁/源码写入 ValidateStateful → 必须绑写域 stateful 主会话）+ src/handlers/ExecuteAbapHandlers.ts（单工具 executeAbap，schema additionalProperties:false + 枚举/长度边界）。三态失败语义同 VSP：syntaxError（激活步 200 内 E/A 消息——ADT 消息严重级在 type 字段——或激活 HTTP 异常，不进入运行步）、notRun（ABAP Unit 零测试类，"空"不是"通过"）、PayloadFailure（收尾断言之外的 exception 优先/critical 兜底）；清理失败记 cleanupWarnings 不重试（UNKNOWN_OUTCOME 不回放），cleanedUp 仅在 DELETE 成功后置位；锁句柄键名宽松兼容（LOCK_HANDLE/lockHandle，DescriptionApi 同教训）。
- 模板注入防线：returnVariable 直接拼进 wrapper 模板——isValidAbapVariableName（字母/下划线开头 ≤30 位）在 handler 层 InvalidParams 前置 + API 层二次校验，不合法零 SAP 调用。
- 分类注册：OTHER_MUTATION（同 runClass/unitTestRun/runUnitCoverage 执行类，QAS/PRD 入口拒绝 + 写槽串行）；workbench 显式名单 + legacy-full（coverageTools 分组）；STRICT_TOOL_FIELDS 白名单（code/riskLevel/returnVariable/keepProgram）；catalog 计数 development-workbench 172→173、legacy-full 210→211（ToolCatalogIntegrity + ModernProtocol 基线同步）。
- 门禁全绿：188 suites / 2078 tests（+26：API 10 + Handlers 16）、build、coverage（REAL_DEV_VERIFIED=28 零缺证据）、parity、git diff --check。测试坑两枚：TS 枚举是名义类型（字符串字面量不可赋 UnitTestAlertKind/UnitTestSeverity，须用枚举成员）；UnitTestClass/UnitTestMethod 的 ADT 元数据字段（adtcore:uri/type/name、uriType、unit）在 mock 中必须齐备。
- 真机（sap-demo）：npm run test:execute-abap-real-dev 全场景 SMOKE OK——happy path（输出捕获 `UNAME=hello from executeAbap SYSID=S4H`、ZTEMP_EXEC_28967590）、运行时异常（COMPUTE_INT_ZERODIVIDE）、编译失败（Field "UNDEFINED_VARIABLE_ZZ" is unknown）、keepProgram（保留确认 + 直连锁删清理）、negative（非法 returnVariable -32602 拒绝）；三个一次性程序缺席验证全过 + keepProgram 对象直连清理，零残留、无传输请求产生。smoke 脚本坑：ADT 不存在对象 GET 的异常文本是 "X does not exist"（非 404 状态码形态）。
- 矩阵：devtools.execute-abap PARTIAL → EQUIVALENT（taskPath=[executeAbap, runClass] 双入口覆盖 VSP execute_abap 片段/类任务面；evidence + real-dev-verified）。现状 MCP_SUPERSET=13、EQUIVALENT=43、PARTIAL=4、GAP=0、INTENTIONAL_RESTRICTION=11，对齐 56/71。证据：docs/evidence/execute-abap-real-dev-verified.md。
- 剩余 PARTIAL 4 行（ui5.write 需具备写控制器的目标 DEV；git.abapgit 定论 RESTRICTION；analysis.history/diagnostics.knowledge-queries 剩图引擎轮/集群解析器工程轮）与 RESTRICTION 11 行均需所有者立项输入，无可单轮交付项。

## 2026-10-07 闲时轮：S/2 集群解码器工程轮——fm_test_data payload 内容层真机收编（大轮）

- 选型：看板待办 3（V6 集群解码工程轮，离线可并行）；git.abapgit 桥客户端已由所有者 bc298fb 交付（真机在 sap-dev，超本轮 sap-demo 红线不做）。
- 实现：src/adt/ClusterDataDecoder.ts（约 900 行）——VSP pkg/datacluster + pkg/sapcompress 全语义移植：V5 legacy（15 字节头/4 字节描述符项/BB 行）+ V6 Unicode（32 字节头/UTF-16 名/7 字节描述符项/BC-CA-BE 帧）、码页 1100/4102/4103、LZH（raw DEFLATE+SAP 前缀，zlib inflateRaw）+ LZC（compress(1) LZW 自实现：块式读取/扩宽/clear/KwKwK）、全类型谱（含 DF16/DF34 密集打包十进制、packed 小数位、0xAD 嵌套表组件——V6 支持/V5 与上游同拒）、对象级容错（tolerant：失败点之前对象照常解出 + partialErrors 精确诊断，部分成功显式可见）。资源上限全套（1MB/对象 64/行 4096/深度 8/节点 4096/膨胀比 1024——绝对上限为主防线，比率 64 会误伤合法高压缩流已实测修正）。
- Go oracle 对照（开发时验证，临时程序不入库已清理）：本机 Go 经代理拉 toolchain 后直接编译 VSP 固定审计版 9886d272——集群 fixtures 7/7 + 压缩 fixtures 12/12 恒等；呈现口径差异两处（空表 null vs []、INT8 数字 vs 精度保全字符串）为有意取舍。入库测试全部合成向量（零 fixture 复制，守住 payload-spike 来源审计决定）。
- 接入：FmTestDataApi includePayload 开关（默认 false 目录视图 SQL 不变；true 追加 srtf2/clustr/clustd 列 + 按集分组续块 joinFragments → 解码 → %_I/%_V/TIME1/V_RC/VEXCEPTION 归类 + TE_DATADIR 标题/FDESC_COPY 接口快照）；handler schema/校验、STRICT_TOOL_FIELDS；无新工具（能力并入既有 getFmTestDataSets），catalog 计数不变。
- 测试坑五枚：TS 枚举名义类型（上轮已记）再犯两次的变体——BigInt 字面量需 ES2020 target（改 BigInt() 构造）；测试构造器三连错（SAP LZH 需真做 2 位前缀位移动、deflateSync 产出 zlib 容器须用 deflateRawSync、V6 close 描述符项也是 7/4 字节完整项）；python patch 漏 s= 赋值致替换静默丢失（第二次踩，grep 复核必做）；jest 收到旧断言结果时先清缓存再排查。
- 真机（sap-demo，全程只读 SELECT）：npm run test:fm-payload-real-dev SMOKE OK——C162_SPEC_GET_BY_ID 测试集 V6 集群全解（inputs I_IDENTNAM=EHSCATT*、outputs E_SUBID=000000002149、runtime 8539884 µs、rc=0）+ FDESC_COPY 接口快照 3 参数；999 目录集群定性为 V5+1100（2000 年写入）且 FDESC_COPY 行类型真实含 0xAD 嵌套表组件——上游"V5 无表组件"假设被真机样本推翻，格式无参照实现，维持 fail-closed（与上游一致），对象级容错保证失败点之前对象照常解出，0xAD 精确诊断入 notes 留证。
- 门禁全绿：191 suites / 2114 tests、build、coverage（REAL_DEV_VERIFIED=28）、parity（MD 已再生）、git diff --check。
- 矩阵：diagnostics.knowledge-queries 维持 PARTIAL 但边界大收窄——fm_test_data 内容层已收编（restrictionReason 更新），剩余仅 cluster_read（任意集群表读取入口）待立项。证据：docs/evidence/fm-test-data-payload-real-dev-verified.md。
- 下一轮建议：knowledge-queries 剩 cluster_read 一个子操作（与 fm_test_data 同解码器，缺的是 BALDAT/INDX 等表的通用读取入口语义，可评估同型收编）；analysis.history 维持图引擎轮定性；git.abapgit 真机推进需 sap-dev 授权窗口（INTF 序列化器兼容性待上游/所有者处理）。

## 2026-10-07 闲时轮（二）：git.abapgit 桥链路真机推进——SMOKE OK + 部署缺口精确定位（sap-dev 授权轮）

- 授权变化：本轮所有者明确 sap-dev 可用（10.30.255.42:8000/200）。选型回落 P1 git.abapgit（bc298fb 桥客户端已交付，缺口=真机验证与 INTF 阻塞）。
- 客户端修复（GitBridgeApi/Handlers）：① data 是 SAP build_json_response 的 **JSON 字符串**，首版当对象解析致"成功但全空"（mock 假服务端与真机契约脱节——同款教训第三次，离线全绿≠真机可用再确认）；② skipped/errors 字段透出；③ GitBridgeError VALIDATION_FAILED→InvalidParams 语义映射。测试 11/11（真机字符串契约用例入库）。
- SAP 侧三改（ZCL_VSP_GIT_SERVICE，经 ADTClient 直连 lock→PUT→unLock→activate 锁改激活，原源码备份 docs/evidence/sap-dev-backups/）：① handle_get_types 复刻 supported_list 循环加逐类型 TRY——上游 supported_list 不接 CX_ROOT，INTF 的 AFF 检查 CX_SY_DYNAMIC_OSQL_SEMANTICS 拖死全清单（bc298fb 遗留）；② serialize_objects CATCH 扩 cx_root；③ 逐对象错误（对象+异常文本）随响应 errors 透出（原静默 CONTINUE 不可诊断）。细节坑：ty_object_types 是 HASHED TABLE（APPEND 非法须 INSERT INTO TABLE）；裸 fetch 会话上下文致 PUT 423 invalid lock handle（锁属主绑会话，必须项目 ADTClient 直连模式）；CSRF 头必须带。
- 真机 SMOKE OK（scripts/git-bridge-real-dev-smoke.mjs，只读面）：gitTypes count=1/skipped=1（CLAS 在列、INTF 跳过如实，不再拖死）；gitExport TADIR 13 对象、errors 13 条逐对象（10 代码对象归因部署缺口动态 SQL + 3 非代码对象 SAPC/SUSH/SICF 按不支持忽略）；负例双防线拒绝。
- **剩余唯一阻塞精确定位：abapGit 部署完整性**。本地解析 abapGit v1.134 源码对象集（593：CLAS 466/INTF 114）对比 sap-dev TADIR（360）= 缺 233 对象（含 182 个 ZCL_ABAPGIT_OBJECT_* 序列化器——实装仅 14——与依赖表）；executeAbap 逐步逼近复现 `SAPSQL_PARSE_ERROR: 数据库表 'ZABAPGIT' 未知`（动态 SQL 引用缺失依赖）。补部署清单 docs/evidence/sap-dev-backups/abapgit-deploy-missing.json 已交付。该缺口同样限制 VSP 同系统 export（同库同协议），非本项目链路缺陷。
- 矩阵：git.abapgit 维持 PARTIAL（链路全通、导出面受部署限制），taskPath=[gitTypes,gitExport]、nextMilestone=abapgit-deploy-completion-then-export-verify，解除条件=补部署 233 对象后真机导出真实 ZIP 内容核对（预期晋级 EQUIVALENT）。绿行数不变 56/71。
- 门禁全绿：191 suites / 2116 tests、build、coverage（28）、parity（MD 已再生）、git diff --check。
- 下一轮建议：所有者补跑 abapGit 部署（233 清单可直接消费）后，下一闲时轮即可真机导出真实 ZIP 内容核对 → git.abapgit 晋级 EQUIVALENT（57/71）。

## 2026-10-07 闲时轮（三）：abapGit 部署补全 + git.abapgit 真实导出核对——PARTIAL → EQUIVALENT（sap-dev 授权轮，57/71）

- 上一轮定位部署缺 233 对象后本轮自行补齐（所有者"继续推进"授权延续 sap-dev）：部署源核对（extracted/=v1.134.0 与实装同源，233/233 全覆盖）→ 部署引擎（scripts/deploy-abapgit-missing.mjs：create→lock→PUT→unlock 批量 + 激活收敛循环）→ 三轮迭代。
- 部署坑四枚：INTF 的 ADT objtype 是 INTF/OI（INTF/OC 报 Unsupported object type）；仓库文件名小写 vs TADIR 大写（findSource 大小写不敏感）；ty_object_types HASHED TABLE（APPEND 非法）；stdout 管道全缓冲（后台日志看不到进度，等完成通知）。
- **zabapgit 表新建**（TADIR 孤儿条目但实体缺失——4219df7 轮遗留）：createObject(TABL/DT) 建 shell + DDLS 表源两处语法修正（关键字字段名 "type"/"value" 带引号；@AbapCatalog.sizeCategory 注释值为整数非 #枚举），runControlledTableCheck API 迭代至 0 错误后激活 OK。
- locals include 边界：13 个 AFF 序列化器依赖 locals include（LCL_AFF_METADATA_HANDLER 局部类），该 ADT 版本拒绝创建（locals_def/locals_imp POST 均 "wrong input data"）——维持 inactive 如实留档；AFF 类型对象导出受影响、常规包不受影响（$ZADT_VSP 已证）。
- **真机终验（SMOKE OK）**：gitTypes 158 类型支持（INTF 恢复，部署前被 AFF 异常跳过）、skipped=0；gitExport $ZADT_VSP → **13 对象、23 文件、38KB ZIP、errors=0**；ZIP 解包核对 24 条目（9 个 .clas.abap）含可读 ABAP 类定义、testzip 无损。smoke 判定三次迭代（部署前错误归因语义 → 部署后真实导出语义；ZIP 压缩流需解包读源、Windows python 行尾 CRLF trim）。
- 门禁全绿：191 suites / 2116 tests、build、coverage（28）、parity（71 行 57/71）、git diff --check。
- 矩阵：git.abapgit PARTIAL → **EQUIVALENT**（evidence + real-dev-verified）。现状 MCP_SUPERSET=13、EQUIVALENT=44、PARTIAL=3、GAP=0、INTENTIONAL_RESTRICTION=11，**对齐 57/71**。证据：docs/evidence/git-bridge-real-dev-verified.md（更新版）。
- 剩余 PARTIAL 3 行：ui5.write（需具备写控制器的目标 DEV）、analysis.history/knowledge-queries（图引擎轮与 cluster_read 工程轮）。下一轮建议：knowledge-queries 的 cluster_read（解码器已就绪，BALDAT/INDX 通用读取入口可同型收编）。

## 2026-10-07 闲时轮（四）：cluster_read + impact 双收编——knowledge-queries 与 analysis.history 晋级 EQUIVALENT（sap-demo 只读，59/71）

- 收编范围判定：PARTIAL 3 中 ui5.write 为环境限制不收（需具备写控制器的目标 DEV）；VSP handleImpact/fetchReverseDeps 源码确认 impact=逐层 WBCROSSGT+归一化 BFS（非全系统图常驻——可收编）；cluster_read 解码器已就绪（可收编）。双能力同轮落地。
- **cluster_read（readClusterTable，knowledge-queries 第五工具）**：ClusterReadApi——DD03L 动态结构发现（三续块列校验+KEYFLAG 键列+client 排除）→ 键列/续块列 SELECT（ORDER BY 键,SRTF2）→ 按键分组 joinFragments → S/2 解码（对象级容错）；截断丢弃最后集群（VSP 同款）如实上报；where 注入防线（控制字符/分号拒绝，引号原样透传——调用方 SQL 片段语法，VSP readtable 同款）。
- **impact（getImpactAnalysis，TransportHistoryHandlers 第三工具）**：ImpactAnalysisApi——VSP handleImpact/fetchReverseDeps 骨干移植：逐层 WBCROSSGT（NAME LIKE 目标%、每层 300 行）→ normalizeLoadName 归一化 + includeBelongsToName 归属过滤 → BFS frontier（maxDepth 3 默认/5 上限）→ 直接调用方/各深度影响集/逐边证据；查询预算 12 次控界（datapreview 会话预算）；动态调用不解析（VSP 同款）。
- 门禁迭代：schema 错误语义分层（cluster_read 的表名非法/非集群表/SQL 失败与 impact 的参数校验错误按 InvalidParams 透传，其余脱敏 InternalError）；handler mock 测试同步（TransportHistory 两→三工具、KnowledgeQueries 四→五）。
- 真机（sap-demo，只读 SMOKE OK）：EUFUNC C162 读回 2 续块→2 集群全解码（V5/1100，与 fm_test_data 基线交叉印证）；透明表结构校验拒绝；注入 where 拒绝；ZCL_ABAPGIT_AUTH 影响面（PROG:ZABAPGIT_FORMS→(d1) 引用边与部署轮实证吻合）；非法 objectType 拒绝。smoke 目标取舍：ZCL_MCP_SM21_ADT_HTTP 交叉表 0 行（引用 caller 已清理）→ 换部署轮实证的 ZCL_ABAPGIT_AUTH。
- 门禁全绿：191 suites / 2131 tests、build、coverage（28）、parity（71 行 **59/71**）、git diff --check。
- 矩阵：diagnostics.knowledge-queries 与 analysis.history 双双 PARTIAL → **EQUIVALENT**。现状 MCP_SUPERSET=13、EQUIVALENT=46、PARTIAL=1（ui5.write）、GAP=0、INTENTIONAL_RESTRICTION=11。证据：docs/evidence/cluster-impact-real-dev-verified.md。
- 全矩阵仅剩：ui5.write PARTIAL（需具备写控制器的目标 DEV）+ INTENTIONAL_RESTRICTION 11 行（均需所有者立项/环境）。下一轮建议：无可自行收编项，回归保真维护形态（守卫巡检/遗留清账/发版评估——多轮真机成果可提请所有者审查发布 0.9.1）。

## 2026-10-07 会话轮（五）：report 三行收编——runReport/submitReportJob/getReportVariants 晋级 EQUIVALENT（sap-dev 授权轮，62/71）

- 所有者放开报表执行方向（此前 RESTRICTION）。VSP 参照：handlers_report.go（RunReport 走 ZADT_VSP 桥，ABAP 服务 SUBMIT+cl_salv_bs_runtime_info 捕获 ALV）+ embedded/abap/zcl_vsp_report_service.clas.abap（sap-dev 部署版与内嵌版逐字同源核对）。
- **关键真机取证**：桥 report 域同步 SUBMIT 在 APC 会话内静默终止（无 ST22、无错误应答、连接即断 121ms）——VSP Go 客户端"作业化演进"注释为此问题的解法痕迹。本项目采用**纯 ADT 作业链语义**：受控执行核（devtools.execute-abap 同链）包装 JOB_OPEN → SUBMIT VIA JOB → JOB_CLOSE，零 helper 依赖；输出为列表文本（spool LIST 渲染）而非 ALV 结构化行（如实声明）。
- 三工具：`getReportVariants`（纯 ADT 只读 SQL：VARID+VARIT LANGU 列英文优先合并，全只读面可见含 QAS/PRD）、`runReport`（提交+轮询 TBTCO+TBTCP.LISTIDENT 定位 spool+readSpoolContent 解码 LIST 文本，waitSeconds 5..300）、`submitReportJob`（仅提交返回 jobname/count）。
- **真机取证坑五枚**：系统 ABAP Unit 风险上限=HARMLESS（dangerous/critical 拒跑且调用侧 flags 无法突破——包装器只做调度故声明 harmless，报表执行在后台进程）；RS_CREATE_VARIANT 参数契约陷阱（CURR_REPORT/CURR_VARIANT/VARI_DESC 三连探针，VARI_DESC 为结构类型——放弃 FM 路径改直插 VARID/VARIT）；VARIT 语言列=LANGU（非 SPRSL）；REPOSRC 在 datapreview 通道报 Unknown column（预检改 TRDIR）；executeAbap 单测上下文回滚 DB 写（造变体必须走后台作业独立 LUW——VARMAKER/VARDEL 双报表经 submitReportJob 闭环，RS_CREATE_VARIANT 探针在单测内创建成功但回滚不可见）。
- **真机 SMOKE OK（11 PASS）**：自建 SALV+WRITE 两测试报表 → runReport WRITE 报表 F+spool 含标记 / SALV 报表 F+258 字符列表输出 / TRDIR 预检拒绝；submitReportJob 作业提交+listJobs F+readSpoolContent 内容断言；getReportVariants 自造变体读回+空清单有效；四报表清理+缺席复核；作业残留（VSP 同款，SM37 可清）。
- 门禁全绿：191 suites / 2155 tests、build、coverage（28）、parity（71 行 **62/71**）、git diff --check。profile 计数：development=204、diagnostic-readonly=149、legacy-full=218、development-workbench=180、operations-readonly=57。
- 矩阵：report.run/report.async/report.variants 三行 PARTIAL/RESTRICTION → **EQUIVALENT**（runReport 的 ALV 差异如实声明）。证据：docs/evidence/report-real-dev-verified.md。
- 全矩阵仅剩：ui5.write PARTIAL（需具备写控制器的目标 DEV）+ INTENTIONAL_RESTRICTION 8 行（均需所有者立项/环境/Basis 升级 816 SP 补 filestore 写控制器）。下一轮建议：无可自行收编项；可评估 Basis 升级取证包整理（ui5.write）或发版（0.9.1 多轮成果）。

## 2026-10-10 会话轮：analysis.lint + rfc.helper-bridge 双收编——双双晋级 EQUIVALENT（sap-dev 授权轮，64/71）

- 所有者三项决策：① analysis.lint 源码仓库（KylinYZ/abap-mcp-server）可借鉴；② rfc.helper-bridge 可以进行；③ 受控导入工作流（deploy-zip+import-export）建议去做。
- **analysis.lint 收编**：定性修正——unpublish 的只是无 scoped CLI 包装包（abaplint），引擎本体 **@abaplint/core scoped 包持续发布**（2.120.70 实装）。AnalyzeLintApi：默认规则集（40+ 规则，对齐 abap-mcp-server snippet 配置）+ 文件类型自动探测（CLAS/INTF/FUGR/PROG/DDLS/BDEF/DCLS）+ 50KB 上限 + 10s 超时 + maxFindings 截断。纯客户端执行——无 SAP 交互，全角色/全环境可见。集成方式借鉴 abap-mcp-server（Apache-2.0，KylinYZ 所有者仓库），integration 仅 358 行。
- **rfc.helper-bridge 收编**：HelperRfcApi——桥 rfc 域三动作（call/getMetadata/search）端到端通（RFC_PING subrc=0、RFC_SYSTEM_INFO exports 指纹与 callRfm 直链对照一致、search 返回匹配列表）。**受控收紧**：allowlist 硬门（默认=callRfm 只读标准 FM 白名单 7 FM，构造注入扩展），白名单外零往返拒绝；FmAllowlist 复用 rfc/allowlist.ts。风险评审遗留如实声明：helper 面绕过 ADT 审计与网关限制的本质风险不变，allowlist 只收窄爆炸半径。helperCallRfm 工具接入 ReportHandlers（第四工具，DEV+workbench/legacy-full+写槽）。
- 门禁迭代坑三枚：助手类 zod 依赖未声明（手写 interface 替代）；getExecutionTools 过滤后 helperCallRfm 不在 coverageTools 导致 CLASSIFIED 断言拦截（探针核对后确认 schema 追加失败为根因，补齐后全过）； pollTimeout 测试 5s 真等待超 jest 默认 timeout（数字形式第三参 20_000）。
- **真机 SMOKE OK**：helper-rfc smoke 5 PASS（RFC_PING / RFC_SYSTEM_INFO exports / allowlist 外拒绝 / callRfm 对照 sysid 一致）；cluster-impact smoke 回归 PASS。
- 门禁全绿：191 suites / 2166 tests、build、coverage（28）、parity（71 行 **64/71**）、git diff --check。
- 矩阵：analysis.lint 与 rfc.helper-bridge 双双 INTENTIONAL_RESTRICTION → **EQUIVALENT**。现状 MCP_SUPERSET=13、EQUIVALENT=51、PARTIAL=1（ui5.write）、GAP=0、INTENTIONAL_RESTRICTION=6，**对齐 64/71**。证据：docs/evidence/lint-helper-rfc-real-dev-verified.md。
- 剩余 6 行 RESTRICTION：transport.merge-move（撞双红线，建议永久维持）、debug.amdp-helper（ADT 原生路径已 EQUIVALENT，helper 路径冗余）、install.zadt-vsp/install.abapgit（终态：不自动部署+SAP 端已完成）、install.deploy-zip/fileio.import-export（受控导入工作流——部署引擎已验证，**下一轮可立项实施**）。ui5.write PARTIAL（需 Basis 升级或可写系统）。
- 下一轮建议：**受控导入工作流**（deploy-zip + fileio.import-export 合并立项）——部署引擎（deploy-abapgit-missing.mjs 223 对象实证）+ 受控创建链 + 守卫框架全部就绪，剩余=通用化设计评审。
