# 交接：ZADT_VSP WebSocket 桥 + abapGit 在 S/4 7.51 的部署（M3 部署段）

> 交给对象：在 S/4HANA 1610（BASIS 7.51）DEV 系统上使用本 MCP 的用户。
> 前置确认：0.10.0 已安装且 healthcheck 正常（2026-10-16 已验证 ✅）。
> 目的：启用 `gitTypes`/`gitExport`（abapGit 序列化导出）能力。
> 兼容性评估：`docs/evidence/zadt-vsp-751-downport-assessment.md`——
> helper 源码已完成 7.51 downport（20 处 PCRE→REGEX），**直接使用本目录源码，
> 不要从其他系统重新拉取**。

## 部署物料（随本文件交付）

`docs/evidence/sap-dev-backups/751/` 下 9 个源文件（已在 7.55+ 系统上激活验证、
POSIX REGEX 形态、7.51 兼容）：

```
zif_vsp_service.intf.abap        (30 行,  接口，最先部署)
zcl_vsp_utils.clas.abap          (219 行)
zadt_cl_tadir_move.clas.abap     (117 行)
zcl_vsp_rfc_service.clas.abap    (659 行)
zcl_vsp_debug_service.clas.abap  (1038 行)
zcl_vsp_amdp_service.clas.abap   (857 行)
zcl_vsp_report_service.clas.abap (545 行)
zcl_vsp_git_service.clas.abap    (424 行)
zcl_vsp_apc_handler.clas.abap    (308 行,  APC 入口，最后部署)
```

依赖顺序：接口 → utils → tadir_move → 各 service → apc_handler（handler 在
class_constructor 里实例化全部 service，必须最后激活）。

## 部署步骤

### 第 1 步：abapGit developer edition（helper 的前置依赖）

`ZCL_VSP_GIT_SERVICE` 引用 `zcl_abapgit_*` 全局类，**必须装 developer edition**
（full 包；standalone 单程序版的类是程序局部类，无法被外部引用）。

推荐路径（系统可出网时，abapGit 官方标准安装法）：
1. 从 abapGit GitHub 下载 `zabapgit.standalone.zip`（或 `zabapgit.prog.abap` 单文件）；
2. SE38 创建程序 `ZABAPGIT_STANDALONE` 粘贴激活并运行；
3. 在 abapGit UI 中 New Online：URL=`https://github.com/abapGit/abapGit.git`，
   Package=`$ABAPGIT`，Branch=`main` → Pull（约 560 对象）。
4. 验证：SE24 打开 `ZCL_ABAPGIT_OBJECTS` 存在且激活。

系统不可出网时：联系开发者侧从已部署系统分批导出 $ABAPGIT 子包 ZIP 走离线导入
（备选路径，需要时反馈）。

### 第 2 步：部署 ZADT_VSP helper（9 个源文件）

两种方式任选：

**方式 A（推荐，用 0.10.0 自带的受控导入链）**：把 9 个源文件按 abapGit 目录规范
打成本地 ZIP（`src/zif_vsp_service.intf.abap` 等），在你的 agent 里调用
`previewRepositoryObjectImport`（zipPath 指向 ZIP，目标 `$` 本地包 + 传输号，
transportable 模式）→ 原生确认 → `applyRepositoryObjectImport`。
按依赖顺序分两批导入：第一批接口+utils+tadir_move；第二批其余 6 类。

**方式 B（SE80 手工）**：按依赖顺序逐个创建类/接口，粘贴源码激活。

### 第 3 步：SAPC 应用 + SICF（人工 GUI，MCP 不可达）

1. **SICF**：T-CODE SICF → 确认 `/default_host/sap/bc/apc` 节点存在且激活
   （这一步也是之前收集项 C8 的答案，请顺手记录节点状态）。
2. **SAPC**：T-CODE SAPC（或 SE80 → APC Application）创建应用：
   - Application ID：`ZADT_VSP`
   - Handler Class：`ZCL_VSP_APC_HANDLER`
   - Session：**Stateful**
   - Package：`$ZADT_VSP`
   激活应用。
3. **SICF 激活服务节点**：SAPC 创建后生成的 SICF 节点（`/sap/bc/apc/...`下）
   右键激活。

### 第 4 步：验证（把结果回传）

1. agent 调用 `gitTypes`——预期返回 abapGit 支持类型清单（百余个类型名）。
2. agent 调用 `gitExport`（packages=`["<你系统里任一 Z 包>"]`）——预期返回
   `objectCount/fileCount/zipBase64`（zipBase64 是导出 ZIP 的 base64，可忽略内容）。
3. 两个都通过 = M3 部署段完成；任一失败原样记录报错回传。

## 红线

- 全程不触碰生产/QAS；abapGit Pull 只写 `$ABAPGIT` 本地包。
- helper 部署到 `$ZADT_VSP` 本地包（无传输号）；如需传输到其他系统再改用传输包。
- 部署中任何失败：原样记录后停止，不要自行改源码绕过。
