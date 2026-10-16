[English](README.md) | [完整中文使用指南](docs/使用指南.md) | [Agent 自动安装提示词](docs/agent-setup-prompt.md)

# ABAP AI Workbench MCP 服务

`abap-ai-workbench-mcp` 是面向 SAP 团队的 AI 原生 ABAP 工作台：开发人员优先，业务顾问其次，运维人员兜底。默认 `focused` 入口借鉴 `vibing-steampunk` 的 Focused/Expert 思路，先展示能完成日常工作的开发能力；需要完整低层 ADT 面时再显式使用 `expert`。完整 ADT 客户端内置在 `src/adt/`，运行时不依赖外部 `abap-adt-api` 包。

> **项目来源**：本项目是基于 [`mario-andreschak/mcp-abap-abap-adt-api`](https://github.com/mario-andreschak/mcp-abap-abap-adt-api) 的二次开发版本，本仓库为后续维护与完善的唯一主仓库；遵循 MIT 许可证并保留对原作者的署名（见 [`LICENSE`](LICENSE)），上游仓库以 upstream remote 保留备查。

## 当前版本

- 版本 `0.9.2`，npm 包为 `abap-ai-workbench-mcp@0.9.2`（0.9.0 = MCP v2 双栈：原生 2026-07-28 + 2025 兼容；0.9.1 = 能力收编批次 62/71；0.9.2 = analysis.lint 与 rfc.helper-bridge 晋级 64/71 + 受控导入三件套，详见 CHANGELOG）。
- 代码仓库：[`KylinYZ/abap-ai-workbench-mcp`](https://github.com/KylinYZ/abap-ai-workbench-mcp)（维护主仓库；原仓库 `KylinYZ/mcp-abap-adt` 不再更新）。
- 始终使用带作用域的包名；不带作用域的包属于上游独立项目。
- 角色入口：`focused` / `developer`（150 个开发工具）、`business`（18 个只读工具）、`operations`（49 个只读工具）、`expert`（203 个兼容工具）。旧 profile 名称继续支持，完整目录见[产品定位](docs/产品定位.md)。
- 仓库对象创建目录固定 31 类：`REAL_DEV_VERIFIED=28`、`CONTROLLED_IMPLEMENTED=1`、`AUTOMATION_VERIFIED=2`。权威成熟度文件为 [`docs/evidence/repository-creation-maturity-evidence.json`](docs/evidence/repository-creation-maturity-evidence.json)。
- 自动化基线（2026-10-13）：198 个 Jest suites、2189 个 tests。

## 安装

### npm（推荐）

```bash
npx -y abap-ai-workbench-mcp@0.9.2
```

MCP 配置示例：

```json
{
  "mcpServers": {
    "abap-ai-workbench-mcp": {
      "command": "npx",
      "args": ["-y", "abap-ai-workbench-mcp@0.8.4"],
      "env": { "SAP_MCP_ENV_FILE": "D:\\path\\to\\sap-dev.env" }
    }
  }
}
```

### 源码

需要 Node.js 22.14+（Node 18/20 已 EOL，自 0.7.0 起不再支持；Windows 可用
nvm-windows 按仓库 `.nvmrc` 切换）。

```bash
npm install
npm run build
node dist/index.js
```

测试未发布修改时，应让 MCP 客户端使用绝对路径下的 `dist/index.js`。凭据放在仓库之外；配置字段见 `.env.example`。

## Profile 与安全边界

`focused` 和 `developer` 是开发者默认入口，等价于 `development-workbench`；`business`、`operations`、`expert` 分别是业务、运维和专家入口。`safe`、`development` 等旧 profile 仍兼容，但不再作为新用户的主要认知入口。

QAS、PRD、缺失和未知系统角色无论 Profile 都只能执行本地/只读工具；原始写入不能绕过角色门控。

所有远端写入都必须经过 server 生成的 preview plan、一次原生确认和一次 apply。调用方确认布尔值、任意 URL、XML/JSON、媒体类型和 lock handle 均不接受。远端结果不明确时计划终止：先核对 SAP 状态，使用新计划，禁止重放旧计划。

## 常用流程

### 五分钟上手

默认 `focused` 入口先调用 `sapDoctor`，再调用 `sap(action=help)`。读取源码使用 `sap(action=read, params={objectType, objectName})`；搜索使用 `sap(action=search, params={query})`；排查使用 `sap(action=diagnose)`（传入 `from/to` 自动查 Dump，传入 `objectName` 自动读对象，传入 `tableName` 自动查表）。需要修改或创建时分别用 `sap(action=edit)`、`sap(action=create)` 生成预览，应用仍沿用服务端计划和原生确认。

源码变更：

1. `inspectAbapObject` 读取完整源码。
2. 使用已有未释放传输调用 `previewAbapChange`。
3. 审阅服务返回的完整 diff。
4. 只把返回的 `changePlanId` 传给 `applyAbapChange`。
5. 用 `getAbapChangeStatus` 检查语法、激活、哈希和解锁结果。

仓库对象使用 `list/describe/preview/apply/status` 五个受控工具。清理是独立的破坏性流程，在 DEV workbench 中开放，并由 `SAP_MCP_ALLOWED_NAMESPACES` 和传输归属校验共同约束。逐类证据和阻塞身份见 [`docs/evidence/`](docs/evidence/)。

## 文档地图

- [`docs/使用指南.md`](docs/使用指南.md)：中文安装、配置、工具清单、安全操作、故障处理和验证边界。
- [`docs/agent-setup-prompt.md`](docs/agent-setup-prompt.md)：整段复制给任意 AI agent 即可自动完成本 MCP 服务的安装与配置。
- [`docs/evidence/repository-validation-campaign-matrix.md`](docs/evidence/repository-validation-campaign-matrix.md)：31 类对象当前状态。
- [`docs/evidence/repository-creation-productionization-handoff.md`](docs/evidence/repository-creation-productionization-handoff.md)：精简交接和下一步。
- [`PROGRESS.md`](PROGRESS.md)：当前进度摘要。
- [`BLOCKED.md`](BLOCKED.md)：现行阻塞与历史 issue 索引。
- [`CHANGELOG.md`](CHANGELOG.md)：版本历史。

## 配置与开发验证

私有环境文件至少设置 `SAP_URL`、`SAP_USER`、`SAP_PASSWORD`、`SAP_CLIENT`、`SAP_MCP_TOOL_PROFILE` 和 `SAP_MCP_SYSTEM_ROLE`。除非已有独立验证，不要提高 `SAP_MCP_MAX_CONCURRENT_TOOLS=1`。

```bash
npm test -- --runInBand
npm run build
npm run check:repository-creation-coverage
git diff --check
```

真实 SAP smoke 需要明确授权和专用 DEV 环境文件；自动化测试与本地构建不能证明部署或线上 SAP 行为。

## 许可证

MIT。内置上游客户端的许可和归属保留在 [`third-party/abap-adt-api/LICENSE`](third-party/abap-adt-api/LICENSE)。
