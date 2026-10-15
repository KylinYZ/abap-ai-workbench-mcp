# 提示词 1：在 S/4HANA 低版本系统上安装/升级本 MCP 并验证连通

> 使用方式：把本文件全部内容直接交给在低版本系统现场的同事（或他的 AI agent），
> 按步骤执行即可。全部动作仅涉及安装 npm 包与只读连通性验证，不修改 SAP 系统。

---

你负责把一个 SAP ABAP MCP 服务器（`abap-ai-workbench-mcp`）接入一台
**S/4HANA 低版本系统（BASIS 7.50/7.51，即 S/4HANA 1511/1610）**，供后续的
AI 辅助开发与版本适配评估使用。请严格按以下步骤执行。

## 1. 这是什么

`abap-ai-workbench-mcp` 是一个 Model Context Protocol (MCP) 服务器，内置 ADT 客户端，
让 Claude/ZCode 等 AI agent 通过 MCP 直连 SAP ABAP 系统，进行源码读取、对象检索、
只读诊断等操作。本次接入的目的是**评估并适配低版本系统**，全程只读，不修改任何
SAP 对象。

## 2. 前置条件（缺一不可，先核对）

| 项 | 要求 | 不满足时的处理 |
|---|---|---|
| Node.js | >= 22.14.0（`node -v` 确认） | 安装 Node 22 LTS |
| SAP 系统 | S/4HANA 1511/1610（更低版本也适用，如实记录即可） | — |
| 目标环境 | DEV 或沙箱 client（不要用生产/QAS） | 联系系统管理员 |
| SAP 用户 | 与 Eclipse ADT 相同授权的对话用户。判据：**Eclipse ADT 能连这台系统 = 用户够用**；如果没有 Eclipse，至少要求 S_RFC + ADT 服务访问权限 | 联系 BASIS |
| 网络 | 能从你本机访问 ICM 的 HTTP(S) 端口（常见 44300/8000） | 防火墙开通 |

## 3. 安装（新装或升级到当前版本 0.9.2）

```bash
# 全局安装/升级（二选一即可，npx 方式无需安装）
npm install -g abap-ai-workbench-mcp@0.9.2
```

如果你机器上已装旧版本，升级命令相同（npm 会覆盖到 0.9.2）。验证：

```bash
abap-ai-workbench-mcp --help 2>&1 | head -3   # 能打印启动信息即正常
npm ls -g abap-ai-workbench-mcp                # 应显示 0.9.2
```

## 4. 连接配置

在你使用的 MCP 客户端（Claude Desktop / ZCode / 其他）的 MCP servers 配置中添加
一个条目。把 `<尖括号>` 内容替换为实际值：

```json
{
  "mcpServers": {
    "sap-low-release": {
      "command": "npx",
      "args": ["-y", "abap-ai-workbench-mcp@0.9.2"],
      "env": {
        "SAP_URL": "https://<SAP主机>:<44300或8000>",
        "SAP_CLIENT": "<client，如 100>",
        "SAP_USER": "<对话用户>",
        "SAP_PASSWORD": "<密码>",
        "SAP_LANGUAGE": "EN",
        "SAP_MCP_SYSTEM_ROLE": "DEV",
        "SAP_MCP_TOOL_PROFILE": "development-workbench",
        "SAP_MCP_ALLOWED_HOSTS": "<SAP主机>",
        "SAP_MCP_ALLOWED_CLIENTS": "<client，如 100>",
        "SAP_MCP_ALLOWED_NAMESPACES": "Z,Y",
        "RFC_SYSNR": "<实例号两位，如 00>"
      }
    }
  }
}
```

字段说明：
- `SAP_MCP_SYSTEM_ROLE=DEV`：告诉服务器目标系统是开发系统，允许只读+受控工具面
  （本次任务只做只读收集，受控写工具不会被调用）。
- `SAP_MCP_TOOL_PROFILE=development-workbench`：工具面选择，**收集任务必须用这个
  profile**（含 RFC 指纹与表读取工具）。
- `RFC_SYSNR`：可选但建议填。RFC 通道的主机与凭据自动从 SAP_URL/SAP_USER 推导，
  只有实例号需要单独给。
- 如果你的客户端支持工具调用超时配置（如 `timeoutMs`），建议 ≥ 120000（120 秒）。

配置后**重启 MCP 客户端**使配置生效。

## 5. 连通性验证（三步，全部只读）

重启客户端后，让 agent 依次执行以下三个 MCP 工具调用，每步都要求报告结果：

1. **`healthcheck`**（无参数）——预期返回服务器健康状态与会话信息。
   失败说明服务器没起来：检查 Node 版本与配置 JSON 语法。
2. **`inspectSapSystem`**（无参数）——预期返回目标系统身份与 ADT 能力探测结果。
   失败通常是 SAP_URL/凭据/证书问题（见第 6 节排障）。
3. **`probeRfcSystem`**（无参数）——预期返回 RFC 通道指纹（sysid/release/kernel/
   host/codepage）。失败时记录错误原样（RFC 通道不通不影响后续收集，ADT 通道
   够用即可，但要如实记录失败原因）。

**完成判据**：第 1、2 步成功（第 3 步成功更佳）。把三步的完整输出保存下来，
与《信息收集提示词》的产出一起回传。

## 6. 低版本常见排障

| 症状 | 原因与处理 |
|---|---|
| HTTPS 握手失败 / `TLS` 相关报错 | 7.50/7.51 的 ICM 若只支持旧 TLS 版本，与 Node 22 默认策略冲突。让 BASIS 把 ICM SSL 配置升到 TLS 1.2+（`icm/HTTPS/ssl_config`）；**不要**降级 Node 安全策略 |
| 证书不受信 / `self-signed certificate` | STRUST 里 ICM SSL Server PSE 的证书链不完整。让 BASIS 修正，不要在客户端关证书校验 |
| 连接超时 | 确认端口（44300=严格 TLS / 8000=HTTP）；确认防火墙；确认 `SAP_URL` 主机名可解析 |
| 401/403 | 用户被锁、密码过期、或用户无 ICM/ADT 访问权。用 SAP GUI 登录一次同一用户验证 |
| `probeRfcSystem` 失败但前两步成功 | RFC 网关端口(33xx)不通或 S_RFC 缺失，记录即可，不阻塞收集任务 |

## 7. 红线

- 本次接入与后续收集**全程只读**：不调用任何名称含 `preview...Change`/`apply...`/
  `create`/`delete`/`set` 的工具，不执行任何 `INSERT/UPDATE/DELETE/DDL`。
- 不连接生产系统或 QAS。若你手头只有生产凭据，停止并向发起人说明。
- 凭据不要写进任何会回传的文档里。
