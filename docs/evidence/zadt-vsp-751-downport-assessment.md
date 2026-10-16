# ZADT_VSP helper 7.51 兼容性评估与 downport 方案

> 日期：2026-10-16。评估对象：ZADT_VSP helper 全部 7 个 CLAS（源码取自
> sap-demo 高版本系统实时读取 + 仓库备份）。
> 背景：外部用户系统（ED1，S/4 1610 SP2 / BASIS 751）的 ZADT_VSP 与 abapGit
> 均未安装（C4），git 导出面（M3）验证前需完成部署。

## 1. 结论

**当前源码不能直接部署到 7.51：唯一硬性不兼容点是 `FIND/REPLACE PCRE` 语句变体
（PCRE 正则 7.55 起才引入，特性矩阵 7.50/7.51/7.52 列全部 unavailable），全库
21 处、跨全部 7 个类。** 适配方式是机械替换 `PCRE` → `REGEX`（所有模式均为简单
POSIX 兼容模式：`\s`、`\d`、`[^"]`、字符交替，无需改写正则文本本身）。

除 PCRE 外**未发现其他版本边界语法**——以下扫描项全部 7.40+ 兼容（7.51 可用）：
内联声明 `DATA(...)`、`VALUE #` 构造、字符串模板、`CONV #`、`xsdbool`、`COND string`、
内置函数 `find( val = ... sub = ... )`、`CL_SYSTEM_UUID=>CREATE_UUID_C32_STATIC`、
APC 全套 API（`CL_APC_WSP_EXT_STATEFUL_BASE` 基类 + `IF_APC_WSP_EXTENSION` 接口 +
`IF_APC_WSP_MESSAGE_MANAGER`）、`CL_ABAP_DOCU=>CONVERT_ITF_TO_HTML`、`string_table`。

## 2. `FIND PCRE` 全量分布（20 处，7.51 编译必失败点）

| 类 | 处数 | 行号（sap-demo 版源码） |
|---|---|---|
| ZCL_VSP_APC_HANDLER | 4 | 117, 118, 119, 148（消息 id/domain/action/timeout 提取） |
| ZCL_VSP_UTILS | 2 | 104, 112（extract_param / extract_param_int） |
| ZCL_VSP_RFC_SERVICE | 1 | 571（参数提取） |
| ZCL_VSP_DEBUG_SERVICE | 2 | 1006, 1013 |
| ZCL_VSP_AMDP_SERVICE | 2 | 849, 853 |
| ZCL_VSP_REPORT_SERVICE | 4 | 118, 362, 397, 484 |
| ZCL_VSP_GIT_SERVICE | 5 | 197, 200, 213, 217, 220（gitTypes/gitExport 参数解析） |

> **downport 已执行（2026-10-16）**：在 sap-demo（S4D 300/816）上对 7 类原位改写
> 20 处 `PCRE` → `REGEX` 并全部激活（每处激活均回报 POSIX deprecated 警告
> forceSupported=true = 高版本合法可运行、低版本兼容的形态）；改写后全库 PCRE
> 零命中。冒烟回归：`gitTypes` 返回 166 类型（APC handler 的 parse_message 改写处
> 每条消息实测）+ 带参 RFC 调用 subrc=0（RFC_SERVICE extract_param 改写处实测）。
> **改写后源码已落仓交付**：`docs/evidence/sap-dev-backups/751/`（9 文件 4197 行：
> 7 CLAS + ZIF_VSP_SERVICE 接口 + 新发现的依赖 ZADT_CL_TADIR_MOVE）。
> 已知非回归问题：sap-demo 上 gitExport 对 `$` 本地包报 "No objects found"（TADIR
> 查询与本地包的既有组合行为，PCRE 时代相同），不影响交付物。

> 检测方式：grepObjects 对 7 类统一正则扫描 + APC_HANDLER/UTILS 全文审阅 +
> git_service 仓库备份（`docs/evidence/sap-dev-backups/*.abap`）复核。
> abaplint（Standard 配置）对 PCRE 无告警——其 Standard 语法集不区分
> targetRelease，版本边界只能靠此类清单化扫描（留档为方法论）。

## 3. abapGit 类库与部署形态

- **必须 developer edition（full package）**：`ZCL_VSP_GIT_SERVICE` 引用
  `zcl_abapgit_*` 全局类；standalone 单程序版把类做成程序内局部类，外部无法引用。
- abapGit 官方长期支持 7.02+，7.51 兼容无忧；体量约 560 对象。
- 部署通道：0.10.0 自带的受控导入链（`previewRepositoryObjectImport` →
  `applyRepositoryObjectImport`，transportable 模式带传输号，CLAS/INTF/PROG 支持
  面正好覆盖）；已知留档问题：个别 AFF 序列化器 inactive 收敛（sap-dev 轮 13 个）。
- ZADT_VSP 的 7 个 CLAS + `ZIF_VSP_SERVICE` 接口同样走受控导入（$ZADT_VSP 本地包
  或传输包）。

## 4. SAPC/SICF/APC（配置级，非语法级）

- APC 自 7.40 引入，7.51 支持 SAPC 应用 + WebSocket handler；SAPC 创建/激活、
  handler 绑定、SICF 节点激活是 GUI 配置动作（MCP 不可达，需系统侧人工）。
- **真机变量**：ICM 层 WebSocket 升级行为与可能的 profile 参数——用户系统
  C8（SICF `/default_host/sap/bc/apc` 节点人工确认）是部署前第一步。
- 用户系统现状（C4）：helper 与 abapGit 均未安装，部署起点为零。

## 5. downport 轮工作清单（待启动）

1. 拉取 7 类 + 接口源码落仓备份（`docs/evidence/sap-dev-backups/751/`）。
2. 21 处 `PCRE` → `REGEX` 机械改写（模式文本不动）。
3. 复验：abaplint 全量 + 高风险语法清单二次扫描（应零命中 PCRE）。
4. 产出 7.51 兼容源码包 + 部署交接（受控导入步骤 + SAPC/SICF 人工步清单 +
   abapGit developer edition 导入序列）。
5. 用户系统部署后跑 gitTypes/gitExport WebSocket 冒烟（M3 验收）。
