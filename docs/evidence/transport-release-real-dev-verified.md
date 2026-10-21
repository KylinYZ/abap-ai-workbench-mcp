# 受控传输释放链真机验证（sap-demo，2026-10-21）

## 结论

**SMOKE OK**——受控释放三件套（`previewTransportRelease` / `applyTransportRelease` /
`getTransportReleaseStatus`）在 sap-demo（10.30.254.48 / client 300，DEV 角色，
focused/development-workbench profile）端到端验证通过。执行脚本：
`node scripts/transport-release-real-dev-smoke.mjs`（默认 `sap-demo.env`，仅授权
sap-demo）。

## 场景覆盖（全 PASS）

| # | 场景 | 结果 |
|---|------|------|
| 1 | healthcheck 目标身份（DEV 角色 + confirmationMode 透出） | PASS |
| 2 | catalog：三工具可见、原子 `transportRelease` 不在受控目录 | PASS |
| 3 | 受控创建链建空请求 `S4HK900051`（释放目标） | PASS |
| 4 | 释放 preview：属主=本人（剥零比较）+ 状态 D 红线核验、plan 冻结 | PASS |
| 5 | 拒绝分支（native elicitation cancel） | SKIP（sap-demo 部署 `SAP_MCP_CONFIRMATION_MODE=auto`，无 elicitation 环节，语义由单测覆盖） |
| 6 | apply：单次标准释放 + 轮询读回 → `SUCCEEDED` + `releasedVerified=true` + `readbackStatus=R` | PASS |
| 7 | 阶段轨迹 PREVIEW / EXECUTE / READBACK | PASS |
| 8 | 重复 apply 拒绝（PLAN_ALREADY_CONSUMED） | PASS |
| 9 | 独立直连读回（不经 MCP 链）：`tm:status=R` | PASS |
| 10 | 已释放红线：同一请求再 preview 被拒（`only modifiable 'D' requests can be released`） | PASS |
| 11 | 属主红线：他人请求 preview 被拒 | 真机跳过（系统内无未释放的他人请求，单测覆盖） |

## 生产发现与修复：apply 自我死锁（重要）

首轮 SMOKE 三次在 `applyTransportRelease` 卡死直至客户端超时，SAP 侧请求保持 D
（POST 从未发出）。根因：`applyTransportRelease` / `getTransportReleaseStatus`
未加入 `usesSapExecutionGate` 豁免清单——外层 dispatch 先占唯一写槽
（`SAP_MCP_MAX_CONCURRENT_TOOLS=1`），确认层内部 `applyConfirmed` 再次申请写槽，
自我死锁。与受控激活/克隆/重命名/创建/清理链同一豁免语义，修复
（`src/lib/serverGuardrails.ts`）后 SMOKE 全绿。**受控链新增 apply 工具时，
executionGate 豁免清单是必改点**（本次离线单测不经过 gate 装配，未能提前发现）。

## 环境事实

- **`POST newreleasejobs` 同步等待释放检查完成，sap-demo 实测 ~34s**——远超普通
  ADT 请求，apply 链路（34s POST + 5×2s 轮询）要求客户端超时 ≥60s（脚本用 420s）。
- sap-demo 部署 `SAP_MCP_CONFIRMATION_MODE=auto`：apply 直接执行、无 elicitation
  拒绝分支，plan 阶段轨迹无 CONFIRM（审计事件仍记 `TRANSPORT_RELEASE_CONFIRMED`，
  confirmationMode=auto-config）。
- RFC 指纹探测在本网络环境不可达（`failed to connect NI socket ...:3300`），
  release gating 按设计自动禁用、目录零变化——与 0.10.0 的 fail-open 懒探测语义一致。
- 释放产物按 SAP 语义留在系统（已释放请求不可删）：本验证留下 `S4HK900043` /
  `S4HK900049` / `S4HK900051` 三个已释放 smoke 请求，属主可手工归档；死锁取证期间
  产生的两个空请求（`S4HK900045` / `S4HK900047`）已经受控清理链删除并验证缺席。

## 覆盖外（单测覆盖，真机不构造）

- 释放调用异常 / `abortrelapifail` 报告 / 轮询耗尽三路 `UNKNOWN_OUTCOME` 终结。
- 审计失败置 FAILED、属主剥零边界、请求号格式与未知字段拒绝。
