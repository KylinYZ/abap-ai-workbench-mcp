# 低版本适配基线取证：ED1 = S/4HANA 1610 SP2（BASIS 7.51 SP2）

> 日期：2026-10-15。
> 性质：**M0 版本指纹基线证据**——S/4 低版本适配规划（`docs/S4低版本适配规划.md`）
> 的目标版本真机事实底座。
> 原始数据：`docs/prompts/低版本系统-信息收集报告-ED1-20261015.md`（S1-S9 全量，
> 经 abap-ai-workbench-mcp development-workbench profile 只读通道收集，零写入）。

## 1. 系统定性（已确认）

| 项 | 值 | 证据 |
|---|---|---|
| 系统角色 | 企业 DEV 真机（erpdev1.dfdchem.com / client 200 / SYSID=ED1） | S3 |
| 产品定性 | **S/4HANA 1610 on-premise SP2**：S4CORE=101 EXTRELEASE=0002，SAP_APPL 不存在 | S4 |
| ABAP 栈 | BASIS 751 SP2（SAP_ABA 75B，kernel 749） | S3/S4 |
| 后端 | HANA（hanadev02），Linux，UTF-8(4103)，UTC+8 | S3 |

**证据分量修正**：此前 ED1 按"developer edition 代理环境"定性（规划 §6.3）；本报告
确认 ED1 是企业 ERP DEV 真机（含经典 HR 栈 SAP_HR/EA-HR 608、ECC 功能包 801 系列），
其结论分量高于 developer edition，但仍为 DEV 环境非客户生产，发布表述按"1610 DEV
真机实证"处理。

## 2. 对规划 §2 事实表的真机核验结果

| 规划项 | 规划值 | 真机结果 | 结论 |
|---|---|---|---|
| ADT REST 后端 7.51 可用 | ✅ | adtDiscovery 62/256 CONFIRMED、feeds 4、objectTypes 161（S2/S9） | **已核验** |
| RAP 面在 7.51 缺席（登记 755） | BDEF/SRVD 不存在 | `BDEF=0 ; SRVD=0`（S5） | **已核验** |
| CDS 主面 7.51 可用 | ✅ | DDLS=17276、DCLS=1629、STOB=17272、DDLDEPENDENCY 存在（S5/S8） | **已核验** |
| RFC_READ_TABLE 可用 | ✅ | 存在，经典接口 OPTIONS 行宽 72（S6） | **已核验+新兼容点** |
| SADT_REST_RFC_ENDPOINT 存在（二期 RFC 承载前置） | 待探测 | **存在**（S6，接口 REQUEST/RESPONSE 深类型与社区文档一致） | **已核验** |
| RFC_SYSTEM_INFO 指纹可用 | ✅ | 可用；RFCSAPRL=751；`S4_HANA` 参数存在但值为空 | **已核验+警示**（指纹必须以 CVERS 为准，S4_HANA 不可依赖） |
| 受控传输链 E070/E071 基础面 | ✅ | 结构可读，E070 27503 行（S7） | **已核验** |
| transportchecks 包 URI 缺陷降级路径 | 规划 M2 | 本次未探测（M2 真机会话项） | 待验证 |
| AMDP 调试资源 7.51 不可用（登记 753） | 规划推断 | 本次未探测（M1/M4 真机会话项） | 待验证 |
| APC/WebSocket 7.51 可用（M3） | 规划推断 | 本次未探测（此前 ZADT_VSP 部署已实证 SICF/SAPC 可走） | 待验证 |

## 3. 新发现的兼容点（进入 M1/M2 backlog）

1. **readRfcTable whereClause ≤72 字符硬限制**（真机报错
   `whereClause exceeds 72 characters`）：ED1 的 RFC_READ_TABLE 为经典接口，
   OPTIONS 行(RFC_DB_OPT)宽 72。新 S/4 增强版 RFC_READ_TABLE 无此约束。
   → 服务端 `readRfcTable` 的 WHERE 拼装需按 72 字符预算设计（自动拆分 IN 条件/
   或清晰报错提示拆分），而不是透传长谓词后失败。
2. **describeClassicTable / runQuery 对 DDLSRC、CVERS_731 双通道失败**
   （describeClassicTable -32603；runQuery Internal server error；同通道对
   TADIR/E070/E071/CVERS 正常）：7.51 标配含 DDLSRC（DDLS 17276 间接佐证），
   疑为本 MCP 查询通道对特定表的处理缺陷而非表缺失。→ 排查
   describeClassicTable 的 zero-row data-preview 与 runQuery 通道对这两张表的
   兼容性；未修复前，指纹解析不得依赖 CVERS_731（当前设计已不依赖）。
3. **describeRfm 不受 allowlist 限制**（allowlisted=false 的 FM 同样可探测接口）：
   FM 存在性探测通道在 7.51 可用，对齐 SADT_REST_RFC_ENDPOINT 探测用途。
4. **RFC 通道在本环境完全可用**（probeRfcSystem + readRfcTable 均成功）：
   与此前"经典 RFC 网关端口不通"的环境记录不符，网络侧已变化；RFC 指纹探测
   可作为常规通道纳入。

## 4. 大结论

**本 MCP 的 development-workbench 只读面已在 S/4HANA 1610 SP2 真机上端到端工作**
（healthcheck/inspectSapSystem/probeRfcSystem/readRfcTable/runQuery/describeRfm/
describeClassicTable/sapDoctor 八通道全部完成预期动作）。M0 的"能力协商"方向
获得真机支撑；M1（目录裁剪接线）可直接以本环境为验证目标。

## 5. M1 落地记录（2026-10-15，本地工程完成）

基于本证据档的 M1 实现已全部落地并通过全量基线（199 suites / 2233 tests）：

1. **指纹探测链接线**（`src/index.ts`）：`resolveBasisRelease()` 懒探测一次并缓存——
   优先级 env `SAP_MCP_BASIS_RELEASE` 显式配置（部署者声明即负责，探测跳过）
   > `RFC_SYSTEM_INFO` 的 `RFCSAPRL`（8 秒专用短超时，兜防火墙 drop 挂死场景，
   低于常见客户端 30s 协议超时）；探测失败缓存为"不可得"= releaseGate 关闭、
   目录与 dispatch 行为零变化（fail-closed：不猜测裁剪）。
2. **双保留门控**：`tools/list` 出口过滤（低版本隐藏 RAP 面 11 工具）+
   `dispatchTool` 显式拒绝（含 `requires >= 755` 版本原因说明）。
3. **healthcheck capability report**：新增 `sapRelease` 段（basisRelease / source
   configured-env|rfc-probe|unresolved|unavailable / unavailableTools 清单）。
4. **readRfcTable 72 字符兼容**（§3.1 的修复）：`splitWhereToOptions` 引号感知、
   按空格边界切多行 OPTIONS TEXT（RFM 拼接即原语义）；引号内空格绝不切断；
   唯一剩余拒绝路径 = 引号外单 token 超宽。ED1 场景（6 组件 IN 查询）从必然
   失败变为正常工作。
5. **配置文档**：`.env.example` 增加 `SAP_MCP_BASIS_RELEASE` 说明。

**待 ED1 真机端到端确认（下次真机会话）**：重启 MCP 客户端后 healthcheck 应显示
`sapRelease.source=rfc-probe` 且 `basisRelease=751`；tools/list 应比高版本少
11 个 RAP 工具；readRfcTable 长 IN 查询应成功。AMDP 调试资源面探测（§2 末行）同为
下次真机项。

## 6. M2 落地记录（2026-10-15 同日，本地工程完成）

1. **受控创建 31 类能力目录按版本收窄**（M2-A）：
   - `REPOSITORY_CREATION_KIND_MIN_RELEASE`（`src/config/SapReleaseCapability.ts`）：
     SERVICE_DEFINITION/BEHAVIOR_DEFINITION/SERVICE_BINDING/CDS_TYPE/CDS_ASPECT=755
     （RAP/view-entity 时代，ED1 真机 BDEF=0/SRVD=0 实证）、CDS_ENTITY_BUFFER=757
     （2022+）、CDS_METADATA_EXTENSION=751（仅 7.50 缺，特性矩阵）。其余 24 类不登记
     （全版本可建）。
   - 接线三层：registry `list()` 清单收窄 + `describe()`（workflow preview 首行即经此）
     显式拒绝（`requires SAP_BASIS >= 755 ... reports BASIS 751`）；handlers 与
     workflow 注入 `releaseResolver`（`() => this.resolveBasisRelease()`），context
     副本携带 `basisRelease`；`RepositoryCreationContext.basisRelease?: number`。
   - apply 不重复校验：plan 在 preview 冻结时已过门禁，immutable plan 语义以创建
     当时判定为准。
   - healthcheck `sapRelease.unavailableCreationKinds` 同步输出收窄清单。
2. **受控创建传输预检降级（M2-B）核实为已有能力**：`AbapObjectCreationWorkflow.
   validateTransport` 注释与实现确认——包/父组 transportchecks 已于 2026-09-29
   ED1 排查轮降级为软检查（失败只记录诊断不拒绝，corrNr POST 由 SAP 权威登记），
   请求门禁已双通道（ADT transportDetails → E070 只读 SQL）。**M2-B 无新增工程**。
3. M2-C（`check:repository-creation-coverage` 的 release 维度）：暂缓——coverage
   脚本校验的是本地 31 类清单与证据 manifest 的一致性，release 收窄不改变本地清单
   本身；真机战役（M4）若需 release 维度基线再补。

基线：199 suites / 2244 tests（M2-A 新增 11 测：kind 表防漂移 + handlers 收窄行为
+ preview 门禁），tsc 干净。**本地工程（M0+M1+M2-A）全部就绪；剩余全部为真机会话项**
（M1/M2 端到端确认 → M3 WebSocket 桥验证 → M4 证据战役 → M5 发布）。

## 7. 2026-10-16 M3 路径作废与开局铁律（误判留档）

M3 曾被错误推进：本会话的 sap-dev MCP 服务器被凭记忆假定为 ED1，其
checkInstallPrerequisites 结果（ZADT_VSP helper + abapGit v1.134.0 developer
edition + inactive zcl_abapgit_* 类）被当作 ED1 就绪状态并据此准备激活写操作。
**所有者已纠正：当前环境没有低版本 ED1 连接**，该探测全部属于另一台高版本系统，
结论作废，ED1 真实部署状态未知。未产生写副作用（仅只读探测 + 一次报错的 preview）。

固化为 M3/真机会话开局铁律：
1. 任何真机动作前，先 `healthcheck` + `inspectSapSystem`（或 `probeRfcSystem`）
   确认连接目标身份（host / sysid / release），与预期目标显式核对；
2. 部署状态只信当前连接系统的 TADIR/registry 探测，绝不从其他系统的记忆外推；
3. ED1 1610 SP2 的**版本定性**仍可信（收集报告含机器级指纹 RFCSYSID=ED1、
   RFCHOST=ERPDEV1、RFCSAPRL=751、S4CORE=101），但**部署状态与连接可达性**
   以恢复连接后的重新探测为准。
