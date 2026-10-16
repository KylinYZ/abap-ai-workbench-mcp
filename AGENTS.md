# 项目协作规则

## 项目定位

本项目是带内置 ADT 客户端的 SAP ABAP MCP 服务。生产运行不依赖外部
`abap-adt-api` 包；上游来源和许可证见 `third-party/abap-adt-api/`。
默认 `focused` profile（别名 `developer`）面向开发人员，提供开发工作台能力；`business` 与 `operations` 分别是业务顾问和运维只读入口；`expert` 保留 DEV 专家兼容面。`safe`、`development` 等旧 profile 继续兼容。
新用户入口与能力分层见 `docs/产品定位.md`；不要把兼容 profile 名称重新写成产品入口。
## 当前发布与事实基线

- 当前版本：`0.10.0`（0.9.2 = analysis.lint 与 rfc.helper-bridge 晋级 64/71 + 受控导入三件套；0.10.0 = S/4HANA 低版本适配：BASIS 7.50/7.51 版本能力协商——`SAP_MCP_BASIS_RELEASE`/RFC 指纹懒探测 + RAP 面 11 工具与 AMDP kind 753 版本门控（双保留）+ readRfcTable 72 字符 OPTIONS 引号感知切行 + 受控创建 31 类 kind 收窄（RAP 时代 755/EntityBuffer 757/MetadataExtension 751），见 CHANGELOG 与 docs/S4低版本适配规划.md）；npm 包：`abap-ai-workbench-mcp@0.10.0`。
- 远程仓库（维护主仓库）：[`KylinYZ/abap-ai-workbench-mcp`](https://github.com/KylinYZ/abap-ai-workbench-mcp)，git remote 名 `origin`；原仓库 `KylinYZ/mcp-abap-adt` 已停更仅留档。上游：`mario-andreschak/mcp-abap-abap-adt-api`（git remote 名 `upstream`）——本项目基于其二次开发，本仓库为后续维护与完善版本；MIT 署名保留，upstream 仅用于对照上游，不作为推送目标。GitHub 访问需走本机代理（`git -c http.proxy=http://127.0.0.1:7890 ...`）。
- 当前源码 profile 目录：`safe=7`、`development=208`、`diagnostic-readonly=150`、`legacy-full=220`、`development-workbench=185`、`business-readonly=18`、`operations-readonly=58`（以 `src/__tests__/ToolCatalogIntegrity.test.ts` 基线为权威；受控导入三件套 2026-10-08 收录进 development/development-workbench）。
- 仓库对象创建目录固定 31 类：`REAL_DEV_VERIFIED=28`、`CONTROLLED_IMPLEMENTED=1`、`AUTOMATION_VERIFIED=2`；成熟度以 `docs/evidence/repository-creation-maturity-evidence.json` 为准。
- 自动化基线：199 个 Jest suites、2244 个 tests（2026-10-16，0.10.0 低版本适配轮 +56）。VSP 能力对齐：**64/71**（MCP_SUPERSET=13、EQUIVALENT=51、PARTIAL=3、INTENTIONAL_RESTRICTION=4）；2026-10-08（受控导入轮）`install.deploy-zip` 与 `fileio.import-export` 双行 IR→PARTIAL 离线落地：受控导入三件套 `previewRepositoryObjectImport`/`applyRepositoryObjectImport`/`getRepositoryObjectImportStatus`（仅 DEV + development/development-workbench；preview 挂写槽同面）——abapGit ZIP（zipPath/zipBase64，≤8MiB/≤500 对象）→ `$` 本地包批量 CLAS/INTF/PROG（FUGR/DEVC 显式跳过），immutable plan 冻结逐对象存在性/漂移基线 + 原生确认 + 逐对象"建/改→锁→写→语法检查→激活→readback"，首失败即停、写后异常 OUTCOME_UNKNOWN 终结；v2 双包模式（transportable：CLAS/PROG 建壳/PUT 带 corrNr；local-package：仅 PROG 无传输号——两台验证系统的 $ 本地包 OO 激活损坏）；**激活必须用 typed objectReference（带 adtcore:type/parentUri）**——字符串简写 body 缺字段致激活器无法定位非活动版本（双系统实证，受控创建链已同步修复）；INTF（接口池生成）与 CLAS testclasses（类池生成）激活损坏 skip 语义留档；真机 SMOKE **transportable 11/11 PASS**（sap-dev，`npm run test:import-real-dev`，证据 `docs/evidence/repository-import-real-dev-verified.md`）；2026-10-10 analysis.lint 与 rfc.helper-bridge 双双晋级 EQUIVALENT（analyzeLint=本地 @abaplint/core 引擎纯客户端分析；helperCallRfm=桥 rfc 域 allowlist 硬门受控 FM 调用；真机 SMOKE OK，证据 `docs/evidence/lint-helper-rfc-real-dev-verified.md`）；2026-10-07（五）report 三行晋级 EQUIVALENT（所有者放开报表执行方向；runReport/submitReportJob=受控核包装作业链+spool 解码、getReportVariants=VARID/VARIT 只读；真机 SMOKE OK，证据 `docs/evidence/report-real-dev-verified.md`；runReport 输出为列表文本而非 ALV 结构化行——如实声明）；2026-10-07（四）knowledge-queries 与 analysis.history 双双晋级 EQUIVALENT（cluster_read=readClusterTable 集群表通用读取 + impact=getImpactAnalysis 多跳反向影响面，证据 `docs/evidence/cluster-impact-real-dev-verified.md`）；2026-10-07（三）`git.abapgit` 晋级 EQUIVALENT（abapGit 部署补全 220 CLAS/INTF + zabapgit 表 + 真实 ZIP 导出核对，`npm run test:git-bridge-real-dev`，证据 `docs/evidence/git-bridge-real-dev-verified.md`；遗留 13 个 AFF 序列化器 inactive 留档）；`devtools.execute-abap` 已于 2026-10-06 晋级 EQUIVALENT（受控 ABAP 执行链 executeAbap：临时程序包装 + ABAP Unit 单次运行 + EXEC_RESULT 输出捕获 + 三态失败语义，真机 SMOKE OK，证据见 `docs/evidence/execute-abap-real-dev-verified.md`）；2026-10-07（二）git.abapgit 桥链路真机全通（gitTypes 容错收集 + gitExport 诊断透出，剩余唯一阻塞=abapGit 部署缺 233 对象清单已交付 docs/evidence/sap-dev-backups/abapgit-deploy-missing.json，证据见 `docs/evidence/git-bridge-real-dev-verified.md`）；2026-10-07 knowledge-queries 的 fm_test_data payload 内容层收编（S/2 集群解码器 ClusterDataDecoder：V5/V6/LZH/LZC 全语义移植 + Go oracle 19/19 恒等 + 真机实数据解码，证据见 `docs/evidence/fm-test-data-payload-real-dev-verified.md`；V5 嵌套表 0xAD 为与上游一致的已声明边界）；GAP 清零——`transport.merge-move` 定性 INTENTIONAL_RESTRICTION（ADT 无该资源面、背后 FM 非 remote-enabled、VSP 自身须走 CALL FUNCTION 桥且 merge=删非空请求/move=直改 E071·E071K，撞传输红线），`ui5.write` 受控写链离线落地（previewUi5Operation/applyUi5Operation/getUi5OperationStatus，四 kind create_app/upload_file/delete_file/delete_app，对齐 VSP filestore POST/PUT/DELETE 协议）晋级 PARTIAL，2026-10-05 sap-demo 真机取证：filestore 控制器只读面（写方法 405），维持 PARTIAL、需具备写控制器的目标 DEV；`analysis.history` 的 health 子操作离线收编（analyzeHealth，包级 tests/atc/boundaries/staleness 四信号 + 防缺陷 verdict 语义，执行级门控同 runUnitCoverage；2026-10-05 真机逐信号取证 tests/boundaries/staleness 全通、ATC 受客户端 30s 超时留档）。A8 AMDP 原生调试受控工作流四操作已真机验证，`debug.amdp-adt` EQUIVALENT；F1 程序文本池受控写已真机验证。当前进度见 `docs/evidence/ui5-write-controlled-offline.md`、`docs/evidence/health-summary-offline-alignment.md` 与 `docs/evidence/amdp-debugger-workflow-real-dev-verified.md`。
- 真实 SAP smoke 默认使用 `sap-demo.env`（所有者 2026-09-22 指示；sap-dev 上 S4HK900009 已不可用）。
- 运行时要求：Node.js >=22.14.0（`.nvmrc` 为 22；Node 18/20 已 EOL，自 0.7.0 起不再支持——为 RFC 基座 open-rfc 的支持合同对齐）。

## 开发与验证

```powershell
npm install
npm test -- --runInBand
npm run build
npm run check:repository-creation-coverage
git diff --check
```

真实 SAP smoke 仅在明确授权且使用专用 DEV 配置时运行：

```powershell
npm run test:repository-productionization-runtime -- "C:\Users\068157\.codex\sap-abap-adt\env\sap-dev.env"
npm run test:repository-verified-domain-preview -- "C:\Users\068157\.codex\sap-abap-adt\env\sap-dev.env" ZVPV001
```

修改源码、`.env` 或 `dist` 后必须硬重启 MCP 客户端，并确认新 healthcheck session 与旧 plan `PLAN_NOT_FOUND`。

## 目录约定

- `src/adt/`：内置 ADT 客户端；`src/adt/index.ts` 是稳定内部入口。
- `src/safe/`：安全策略、计划、确认、成熟度证据和受控工作流。
- `src/config/`、`src/lib/`：配置、profile、执行门控、限流、缓存和日志。
- `src/handlers/`：MCP 工具处理器；低层写入不得绕过 profile 边界。
- `docs/使用指南.md`：中文安装、接入、工具和运维权威指南；`docs/agent-setup-prompt.md` 是发给 agent 的自动安装配置提示词。
- `docs/evidence/`：真实 DEV 证据、成熟度 manifest 和当前创建矩阵。
- `PROGRESS.md`、`BLOCKED.md`：精简状态与阻塞索引；历史细节留在证据/CHANGELOG。
- `.env.example`：配置字段示例；不得提交真实 `.env` 或凭据。

## 安全边界

- 先用 CodeGraph 定位，再用 `rg` 做完整性确认。
- 真实 SAP 调用走分级执行门（2026-09-30 起）：写入/锁链/受控 apply 走写槽串行（`SAP_MCP_MAX_CONCURRENT_TOOLS=1`）；read-only 工具走读槽并发（`SAP_MCP_MAX_READ_CONCURRENT_TOOLS=2`）并绑定读域 stateless 会话（`SAP_MCP_STATELESS_READS=true`，读槽安全性的前提）；受控链只读 preview 挂写槽（绑定写域 stateful 主会话，保证 stateful 永无并发）。
- QAS、PRD、缺失或未知系统角色只允许本地/只读工具；隐藏和 dispatch 拒绝必须同时保留。
- 所有受控写入必须经过 server 生成的 preview plan、一次原生确认和 apply；不得接受调用方确认布尔值、任意 URL、XML、JSON、媒体类型或 lock handle。唯一例外：`SAP_MCP_CONFIRMATION_MODE=auto`（默认 native）时部署者显式授权跳过人工确认，apply 一次调用直接执行；该模式仅 DEV 角色可配置（非 DEV 启动即报错），仅由部署环境变量控制、调用方无任何参数可触发，审计如实记 `confirmationMode=auto-config`，plan 状态机与漂移校验保持不变。
- `REAL_DEV_VERIFIED` 只能由完整 create/readback/transport/cleanup/absence 证据启用；未知结果不得重放或自动删除。
- 传输请求：**仅创建**与**仅删空请求**两个动作对 AI 放开——创建走受控创建链（`previewTransportCreation` → 原生确认 → `applyTransportCreation`，创建后必须读回验证）；删除走受控清理链（`previewTransportCleanup` → 原生确认 → `applyTransportCleanup`），preview 强制核验三条红线：未释放（状态 D）+ 零对象 + 本人属主，任一不满足即拒。两链均仅 DEV + development/development-workbench。释放、改属主、加用户、删非空/他人请求与直改 E071/E071K 一律禁止；sap-demo 真机已验证（创建 SMOKE OK、4 个残留空请求受控删除+缺席复核，证据见 `docs/evidence/transport-creation-real-dev-verified.md`）。不连接生产，不执行数据库写操作。
- 报告时明确区分自动化、真实 SAP 已验证、部署状态和仍待环境确认的内容。

## 证据与历史

当前创建状态以 `docs/evidence/repository-validation-campaign-matrix.md` 为准；交接入口为 `docs/evidence/repository-creation-productionization-handoff.md`。`PROGRESS.md` 与 `BLOCKED.md` 只保留当前结论和历史 issue 索引，不再复制逐次会话流水账。
