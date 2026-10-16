[English](README.md) | [完整中文使用指南](docs/使用指南.md) | [Agent 自动安装提示词](docs/agent-setup-prompt.md)

# ABAP AI Workbench MCP 服务

`abap-ai-workbench-mcp` 是面向 SAP 团队的 AI 原生 ABAP 工作台：开发人员优先，业务顾问其次，运维人员兜底。默认 `focused` 入口先展示能完成日常工作的开发能力，需要完整低层 ADT 面时再显式使用 `expert`。完整 ADT 客户端内置在 `src/adt/`，运行时不依赖外部 `abap-adt-api` 包。

> **项目来源**：本项目是基于 [`mario-andreschak/mcp-abap-abap-adt-api`](https://github.com/mario-andreschak/mcp-abap-abap-adt-api) 的二次开发版本，本仓库为后续维护与完善的唯一主仓库。遵循 MIT 许可证并保留对原作者的署名（见 [`LICENSE`](LICENSE)），上游仓库以 upstream remote 保留备查。

## 当前版本

- 版本 `0.10.0`，npm 包为 `abap-ai-workbench-mcp@0.10.0` —— S/4HANA 低版本适配（BASIS 7.50/7.51）：版本能力协商与逐工具门控、RFC 读表 72 字符兼容、受控创建 kind 收窄。完整历史见 [`CHANGELOG.md`](CHANGELOG.md)。
- 代码仓库：[`KylinYZ/abap-ai-workbench-mcp`](https://github.com/KylinYZ/abap-ai-workbench-mcp)（维护主仓库；原仓库 `KylinYZ/mcp-abap-adt` 不再更新）。
- 角色入口：`focused` / `developer`（185 个工具）、`business`（18）、`operations`（58）、`expert`（220）。旧 profile（`safe`、`development`、`diagnostic-readonly`、`legacy-full`）继续兼容，完整目录见[产品定位](docs/产品定位.md)。
- 仓库对象创建目录固定 31 类：`REAL_DEV_VERIFIED=28`、`CONTROLLED_IMPLEMENTED=1`、`AUTOMATION_VERIFIED=2`。权威成熟度文件为 [`docs/evidence/repository-creation-maturity-evidence.json`](docs/evidence/repository-creation-maturity-evidence.json)。
- 自动化基线（2026-10-16）：199 个 Jest suites、2244 个 tests。

## 安装

### npm（推荐）

```bash
npx -y abap-ai-workbench-mcp@0.10.0
```

MCP 配置示例：

```json
{
  "mcpServers": {
    "abap-ai-workbench-mcp": {
      "command": "npx",
      "args": ["-y", "abap-ai-workbench-mcp@0.10.0"],
      "env": { "SAP_MCP_ENV_FILE": "D:\\path\\to\\sap-dev.env" }
    }
  }
}
```

### 源码

需要 Node.js 22.14+（Node 18/20 已 EOL，自 0.7.0 起不再支持；Windows 可用 nvm-windows 按仓库 `.nvmrc` 切换）。

```bash
npm install
npm run build
node dist/index.js
```

测试未发布修改时，应让 MCP 客户端使用绝对路径下的 `dist/index.js`。凭据放在仓库之外；配置字段见 `.env.example`。

## 角色与安全边界

`focused`/`developer` 是开发者默认入口；`business`、`operations`、`expert` 分别是业务只读、运维只读和完整兼容面。QAS、PRD、缺失和未知系统角色无论 Profile 都只能执行本地/只读工具。

所有远端写入都必须经过 server 生成的 preview plan、一次原生确认和一次 apply。调用方确认布尔值、任意 URL、XML/JSON、媒体类型和 lock handle 均不接受。远端结果不明确时计划终止：先核对 SAP 状态，使用新计划，禁止重放旧计划。

## 五分钟上手

先调用 `sapDoctor`，再调用 `sap(action=help)`。读取源码用 `action=read`，搜索用 `action=search`，排查用 `action=diagnose`，受控预览用 `action=edit` / `action=create`。

源码变更链路：`inspectAbapObject` 读取完整源码 → `previewAbapChange`（使用已有未释放传输）→ 审阅返回的 diff → 只把返回的 `changePlanId` 传给 `applyAbapChange` → `getAbapChangeStatus` 检查语法、激活、哈希和解锁结果。仓库对象使用 `list/describe/preview/apply/status` 五个受控工具；清理是独立的破坏性流程，仅在显式圈定的 DEV 验证中开放（逐类证据见 [`docs/evidence/`](docs/evidence/)）。

## 配置

将 `.env.example` 复制到仓库外私有路径，至少设置 `SAP_URL`、`SAP_USER`、`SAP_PASSWORD`、`SAP_CLIENT`、`SAP_MCP_TOOL_PROFILE` 和 `SAP_MCP_SYSTEM_ROLE`。较旧的 S/4HANA（BASIS 7.50/7.51）会自动做版本能力协商，仅在探测失败时设 `SAP_MCP_BASIS_RELEASE`。除非已有独立验证，保持 `SAP_MCP_MAX_CONCURRENT_TOOLS=1`。

## 文档地图

- [`docs/使用指南.md`](docs/使用指南.md)：中文安装、配置、工具清单、安全操作、故障处理和验证边界。
- [`docs/agent-setup-prompt.md`](docs/agent-setup-prompt.md)：整段复制给任意 AI agent 即可自动完成本 MCP 服务的安装与配置。
- [`docs/evidence/repository-validation-campaign-matrix.md`](docs/evidence/repository-validation-campaign-matrix.md)：31 类对象当前状态。
- [`docs/evidence/repository-creation-productionization-handoff.md`](docs/evidence/repository-creation-productionization-handoff.md)：精简交接和下一步。
- [`PROGRESS.md`](PROGRESS.md)：当前进度摘要。
- [`BLOCKED.md`](BLOCKED.md)：现行阻塞与历史 issue 索引。
- [`CHANGELOG.md`](CHANGELOG.md)：版本历史。

## 开发与验证

```bash
npm test -- --runInBand
npm run build
npm run check:repository-creation-coverage
git diff --check
```

真实 SAP smoke 需要明确授权和专用 DEV 环境文件；自动化测试与本地构建不能证明部署或线上 SAP 行为。

## 许可证

MIT。内置上游客户端的许可和归属保留在 [`third-party/abap-adt-api/LICENSE`](third-party/abap-adt-api/LICENSE)。
