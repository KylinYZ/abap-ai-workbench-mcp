# 当前进度

更新时间：2026-10-16（文档同步与维护仓库迁移轮）

本文件只保留当前结论与索引。逐轮过程记录一律不进本文件：历史细节在 [`CHANGELOG.md`](CHANGELOG.md)、[`docs/evidence/`](docs/evidence/) 与 git 提交历史中，VSP 对齐逐行状态在 [`docs/功能矩阵推进看板.md`](docs/功能矩阵推进看板.md)。

## 结论

- 代码版本：`0.10.1`（npm 包 `abap-ai-workbench-mcp@0.10.1`，2026-10-17 发布）。0.10.1 = 工具响应 JSON 格式化开关 `SAP_MCP_JSON_PRETTY`（默认压缩省 token，true=2 空格缩进）+ `tableContents`/`runQuery` rowNumber 客户端裁剪（datapreview 服务端 +1 口径）。0.10.0 = S/4HANA 低版本适配（BASIS 7.50/7.51）：`SAP_MCP_BASIS_RELEASE`/RFC 指纹懒探测的版本能力协商、RAP 面 11 工具与 AMDP kind 的 753/755 版本门控（双保留）、readRfcTable 72 字符 OPTIONS 引号感知切行、受控创建 31 类 kind 收窄。0.9.x 主线 = MCP v2 双栈、VSP 能力收编 64/71、受控导入三件套。逐版本细节见 CHANGELOG。
- 自动化门禁：202 个 Jest suites / 2259 tests 全绿（2026-10-17 基线；此后每轮以当次全量 `npm test -- --runInBand` 结果为准更新本行）；`npm run build` 通过。
- VSP 能力对齐：**64/71**（MCP_SUPERSET=13、EQUIVALENT=51、PARTIAL=3、INTENTIONAL_RESTRICTION=4）。剩余：`ui5.write` PARTIAL（需具备可写 filestore 控制器的目标 DEV，双系统 405 定性留档）；RESTRICTION 行中 `transport.merge-move` 与 `debug.amdp-helper` 建议永久维持，`install.zadt-vsp`/`install.abapgit` 为终态边界声明。逐行解除条件见看板。
- S/4 低版本适配：全链完成，外部用户 ED1（S/4HANA 1610 / BASIS 751）端到端验收通过（指纹 rfc-probe/751、11 个 RAP 工具隐藏、85 字符长 IN 切行返 5 行）。遗留尾项（AMDP 工作流实测、SICF apc 人工步骤）挂在 [`docs/S4低版本适配规划.md`](docs/S4低版本适配规划.md) M5。
- 维护仓库（2026-10-16）：`KylinYZ/abap-ai-workbench-mcp`，原仓库 `KylinYZ/mcp-abap-adt` 停更留档；上游 `mario-andreschak/mcp-abap-abap-adt-api` 以 upstream remote 保留备查，本项目为其二次开发维护版。GitHub 推送走本机代理 `127.0.0.1:7890`。
- 仓库对象目录：31 类；`REAL_DEV_VERIFIED=28`、`CONTROLLED_IMPLEMENTED=1`、`AUTOMATION_VERIFIED=2`。
- 真实 SAP 纪律：真机动作前必须 `healthcheck`/`inspectSapSystem` 验证目标身份；QAS/PRD 只读；所有历史 `OUTCOME_UNKNOWN`/`COMPENSATED`/`COMPENSATION_FAILED` 计划不可重放。

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
| 运行态 | `pending`：本轮为文档同步轮，未连接真实 SAP |
| 文档 | `changed-and-verified`：双 README、使用指南、迁移指南、PROGRESS、server.json 已对齐 0.10.1 基线 |
| 规则 | `changed-and-verified`：`AGENTS.md` 已同步维护仓库迁移与代理要点 |
| 记忆 | `changed-and-verified`：MEMORY.md 索引补齐 + 过期记忆修订 |
| 工作区 | `verified-current`：无临时文档残留 |

## 历史轮次索引

2026-09 至 2026-10 的逐轮记录（VSP 对齐 31→64/71 的各次晋级、真机战役、缺陷修复、发版 0.8.x/0.9.x/0.10.0）已按项目规则迁出本文件：每次能力行的晋级时间、证据文档与门禁基线以 [`CHANGELOG.md`](CHANGELOG.md) 各版本条目为准，过程证据在 [`docs/evidence/`](docs/evidence/) 对应文档，完整文本可从 git 历史（本文件 2026-10-16 之前的版本）恢复。本文件不再累积逐轮小节。
