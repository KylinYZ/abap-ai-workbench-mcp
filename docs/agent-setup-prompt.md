# Agent 自动安装提示词（abap-ai-workbench-mcp）

把下面的提示词整段发给任何具备文件读写与命令执行能力的 AI agent（Claude
Code、Codex、Cursor 等），agent 即可自动完成本 MCP 服务的安装、配置与验证。

---

## 提示词（整段复制）

```text
请为我在本机安装并配置 SAP ABAP 的 MCP 服务 "abap-ai-workbench-mcp"（npm 包，
AI 原生 ABAP 工作台）。请严格按以下步骤执行，全程不要把任何真实凭据写入
Git 仓库或对话输出：

1. 前置检查
   - 确认 Node.js >= 22.14（node --version）；不满足则先安装/切换（Windows
     可用 nvm-windows）。
   - 确认 npm 可用（npm --version）。

2. 收集连接信息（缺什么向我要什么，一次问全）
   - SAP_URL（如 https://host:44300 或 http://host:8000）
   - SAP_USER、SAP_PASSWORD（或已有凭据 helper 命令）
   - SAP_CLIENT、SAP_LANGUAGE（可选，默认 100/EN）
   - 该 SAP 系统角色：DEV / QAS / PRD（决定工具面；QAS/PRD 强制只读）
   - 期望入口 profile：focused（开发人员默认）/ business（业务只读）/
     operations（运维只读）/ expert（完整面），默认 focused
   - 可选：RFC_SYSNR（经典 RFC 直连实例号，仅只读 RFM 工具用）
   - 可选：若目标系统是较旧的 S/4HANA（BASIS 7.50/7.51），保留默认即可——
     0.10.0 起会自动做版本能力协商；如自动探测失败可设
     SAP_MCP_BASIS_RELEASE 显式指定。

3. 生成配置
   - 从 npm 包的 .env.example 模板生成私有环境文件（仓库外路径，例如
     C:\Users\<me>\.abap-ai-workbench\sap-prod.env）：
     npm view abap-ai-workbench-mcp dist.tarball 拉包解出 .env.example，
     或直接按官方文档字段手写。
   - 必填字段：SAP_URL、SAP_USER、SAP_PASSWORD、SAP_CLIENT、
     SAP_MCP_TOOL_PROFILE、SAP_MCP_SYSTEM_ROLE、SAP_MCP_ALLOWED_HOSTS
     （取 SAP_URL 的主机名）、SAP_MCP_ALLOWED_CLIENTS（同 SAP_CLIENT）、
     SAP_MCP_ALLOWED_NAMESPACES（默认 Z,Y）、SAP_MCP_AUDIT_PATH（本地审计
     目录）、SAP_MCP_LOG_LEVEL=warn。
   - 保持 SAP_MCP_MAX_CONCURRENT_TOOLS=1（真实 SAP 调用串行红线）。
   - 私有环境文件权限收紧（Windows 下确保不在任何 Git 工作区内）。

4. 写入 MCP 客户端配置（按我使用的客户端选择其一；先问我是哪个客户端）
   - ZCode / Claude Desktop / Codex 等 JSON 型配置：
     {
       "mcpServers": {
         "abap-ai-workbench-mcp": {
           "command": "npx",
           "args": ["-y", "abap-ai-workbench-mcp@0.10.1"],
           "env": { "SAP_MCP_ENV_FILE": "<第3步的私有环境文件绝对路径>" }
         }
       }
     }
   - 注意 args 里用固定版本号（不要用 @latest），凭据只放环境文件，不放
     JSON 配置。

5. 验证（不通过不得报告完成）
   - 手动拉起一次服务进程确认能启动（SAP_URL 可达性不阻塞启动）：
     npx -y abap-ai-workbench-mcp@0.10.1，观察无启动报错后退出。
   - 重启我的 MCP 客户端后，列出工具清单：focused 入口应有 185 个工具；
     抽查 healthcheck 返回 healthy 且 configuredTarget.toolProfile 正确。
   - 用 healthcheck 与一次最小只读调用（如 searchObject 一个已知对象）做
     连通验证；写类工具一律不得在验证阶段调用。

6. 汇报
   - 给出：安装结果、环境文件路径（脱敏）、客户端配置位置、工具数、
     healthcheck 输出、以及"哪些项是已验证 / 哪些项待真实 SAP 环境确认"。
```

---

## 使用说明

- **给 agent 的最小变体**：如果只想让 agent 改已有配置（例如从旧包名迁移），
  只发第 4-6 步，并附上一句"把现有的 @kylinyz/mcp-abap-abap-adt-api 配置
  迁移到 abap-ai-workbench-mcp@0.10.1，环境文件路径不变"。
- **旧包名迁移**：`@kylinyz/mcp-abap-abap-adt-api` 已 deprecate，npm 安装时
  会提示改用 `abap-ai-workbench-mcp`；配置迁移只需替换 npx 参数中的包名。
- **安全边界**：提示词刻意让 agent 把凭据限制在仓库外的私有环境文件中、
  用固定版本号、验证阶段只做只读调用。不要放松这三点。
- 工具数基线（0.10.1，与 ToolCatalogIntegrity.test.ts 对齐）：入口 profile
  focused/developer = development-workbench = 185，business = business-readonly
  = 18，operations = operations-readonly = 58，expert = legacy-full = 220；
  遗留 profile：safe = 7，development = 208，diagnostic-readonly = 150。
