# 受控对象导入链真机验证（sap-demo，2026-10-08）

## 结论

- **PROG 方向：真机 SMOKE 全链 PASS（10/10）**——受控导入三件套（`previewRepositoryObjectImport` / `applyRepositoryObjectImport` / `getRepositoryObjectImportStatus`）的工作流全状态机在专用 DEV（sap-demo，workbench profile）真机验证通过。
- **INTF/CLAS 方向：被 sap-demo 环境级激活故障阻塞**（非导入链缺陷，对照矩阵见下）。矩阵两行 `install.deploy-zip` / `fileio.import-export` 维持 **PARTIAL**，解除条件更新为"环境恢复后补验 OO 方向"。
- 环境故障的定性证据充分：与建壳路径、目标包、preaudit 开关、transport 四因素全部无关；同期 `executeAbap`（PROG/P）全链正常；受控创建链（同款激活调用形态）2026-09-30 在同系统真机全绿——**系统状态在那之后发生了变化**。

## SMOKE 明细（`npm run test:import-real-dev`，scripts/repository-import-real-dev-smoke.mjs）

| # | 场景 | 结果 |
| --- | --- | --- |
| 1 | 目录可见性：三件套在 focused（development-workbench）catalog | PASS |
| 2 | 目标包 `$TMP` 身份元数据真机读取（language=ZH/responsible 存在） | PASS |
| 3 | 负向入参：zipBase64+zipPath 双来源被拒、非 `$` 包被拒（零 SAP 写） | PASS |
| 4 | preview #1（zipBase64）：1 create（`ZPROG_IMPSMK*` 唯一后缀）+ W3MI/DEVC 双跳过 | PASS |
| 5 | apply #1（auto 确认）：建壳→锁→写→激活→readback，1/1 APPLIED | PASS |
| 6 | 直连核验：存在/激活态/主源内容含标记/包归属 `pkg=$TMP` | PASS |
| 7 | preview #2（zipPath 入口）：识别为 update + 逐包含漂移基线冻结 | PASS |
| 8 | apply #2：update 轮 1/1 APPLIED | PASS |
| 9 | status：本地查询返回 APPLIED + 逐对象 outcomes | PASS |
| 10 | 直连清理：lock→DELETE→缺席验证（GET does not exist） | PASS |

## OO 激活环境故障对照矩阵（2026-10-08，账号 068157）

### 故障机制定位（专项排查，2026-10-08 续）

1. **POST 建壳同步生成 ACTIVE 骨架**：读"激活失败"对象的 active 版本，内容为建壳骨架
   （`interface X public . endinterface.`，非我们写入的源）；显式声明 `adtcore:version="inactive"`
   建壳同样生成 active 骨架（声明被忽略）。这是 ADT 建壳的固有行为（Eclipse 同款流程）。
2. **激活引擎拒绝覆盖同名 active 加载单元**：PUT 写入 inactive 源后激活，SEO 引擎报
   `CX_CLASS_ALREADY_EXISTS`（"A class already exists with the name"）并向导取消——正常系统上
   激活=用自己的 inactive 版本覆盖自己的 active 壳，理应允许。同对象连续 3 次重试激活结果相同。
3. **故障局限于 OO 激活引擎**：PROG/P 激活（不经 SEO 类池生成）同期反复成功。
4. **系统时间线排查**：9-30 以来 E070 传输全部为本人（无他人改动/无开发传输）；组件版本
   SAP_BASIS 816 / S4CORE 109（extrelease 0001）；ST22 与 SM21 因权限/服务未部署无法取证。
5. **附带的不稳定症状**（疑似同族环境问题）：间歇性 lock 500 / "当前编辑"误报（新壳 POST 后
   立即 lock 偶发被拒，重试/新会话即恢复）；scratch 包 DELETE 半删除态。

**用户侧决定性对照实验**：在 GUI（SE80 或 Eclipse ADT）手工建一个测试接口并激活——GUI 同样失败
即系统 SEO 激活引擎损坏（Basis 层处理，重启实例 /$TAB/$SYNC 缓冲同步是测试系统首选手段）；
GUI 成功则问题在 ADT 服务通道（SICF/服务层）。

### 跨系统对照与激活路径因素矩阵（2026-10-09，决定性进展）

**sap-demo 实例重启（08:39-08:44，RestartSystem，D01+ASCS02）后故障未愈**——排除易失状态；
之前 9-19 以来的 19 天长运行只是背景，不是根因。

**GUI 全新激活成功（ZIF_IMPGUI1009）+ ADT/GUI 激活 ADT 壳同错 → 分叉实验推进到跨系统**：

| # | 类型 | 建壳 | 包/传输 | PUT 带传输 | preaudit | 系统 | 结果 |
|---|---|---|---|---|---|---|---|
| 1 | INTF/CLAS | generic/受控 | $TMP | 否 | 均试 | 两台 | ❌ A class already exists |
| 2 | CLAS | generic | Z001+corrNr(POST) | 是 | true | sap-demo | ❌ |
| 3 | INTF | generic | Z001+corrNr(POST) | 是 | true | sap-dev | ❌ |
| 4 | INTF | 受控 XML | Z001+corrNr(POST) | 是 | true | sap-dev | ❌ **INTF 全灭** |
| 5 | 受控 XML | $TMP | 否 | true | sap-dev | ❌ |
| 6 | 受控 XML | $TMP | 是(仅 PUT) | true | sap-dev | ❌ |
| 7 | **CLAS** | **受控 XML** | **Z001+corrNr(POST)** | **是** | **true** | **sap-dev** | ✅ **激活成功** |
| 8 | **CLAS** | **受控 XML** | **Z001+corrNr(POST)** | **是** | **true** | **sap-demo** | ✅ **激活成功** |

**定案**：
1. **CLAS 可靠激活路径（两台系统验证）**：受控 XML 建壳（oo.classes.v4 + public/final +
   testclasses 子节点 + superClassRef，corrNr 随 POST）→ transportable 包 → PUT 带 transport →
   activate(preaudit=true)。即受控创建链的完整形态。
2. **$ 本地包 OO 激活全灭（两台系统）**——v1 的 `$` 本地包设计在当前系统状态下不可行；
   PROG 不受影响（本地包激活正常）。
3. **INTF 全灭（两台系统，含受控+transportable）**——接口池生成路径独立损坏，待深挖
   （候选：Eclipse INTF POST 形态 / SAP 工单）。
4. GUI 新建激活成功的原因：GUI 保存路径不产生"active 骨架 + inactive 覆盖"状态（从零首活正常）。
5. 系统级根因（两台同期同症状）待 Basis/工单确认；**工程上已不依赖根因**——CLAS 走受控形态即可。

**导入链修复方向（v2 提案）**：CLAS 走受控建壳 + transportable 包 + 传输号（受控传输创建链
提供）；PROG 保留本地包；INTF 临时跳过并记原因（或要求对象已存在走 update 方向）。

### v2 落地与 SMOKE 终验（2026-10-09，A 方案实施完成）

**v2 设计（因素矩阵驱动）**：
- 双包模式：transportable（packageName+transportRequest；CLAS/PROG 全链带 corrNr）
  / $ local-package（仅 PROG）；`buildDeploymentPlan` 包名校验放宽为通用仓库名。
- **激活 body 根因修复（本轮最大发现）**：`activate(name, url, ...)` 字符串简写
  body 的 objectReference **缺 adtcore:type/adtcore:parentUri**，激活器无法定位
  非活动版本——"同名已存在/骨架激活/无 PUBLIC SECTION"三症状同根。改为 typed
  objectReference（uri+type+name+parentUri=包）后 CLAS 激活双系统通。**受控创建
  链 SourceObjectCreationAdapter 同步修复**（同一缺陷，其 OO/CDS 源对象族在当
  前系统上曾必失败）。
- 源 URL 固定模板（`/source/main`、`/includes/{definitions,implementations,
  testclasses}`）替代 objectStructure 解析——sap-dev 对新建壳的 structure GET
  报 "wrong input data"（含 GET source 带 version 参数的间歇形态），已在
  preview 基线/drift 复核/readback 三处去 objectStructure 依赖并加
  readSourceWithRetry（wrong-input-data 抖动 3 次退避重试）。
- PUT 落地校验重写循环：POST 壳后骨架生成异步完成会覆盖紧随的 PUT（真机实证
  "无 PUBLIC SECTION"），每次 PUT 后读回比对（compareSources）未落地即重写
  （≤3 次、幂等安全）。
- INTF 与 testclasses 部件进 skips（带原因）；系统修复后移除对应跳过即恢复。

**SMOKE v2 终验（sap-dev，`npm run test:import-real-dev`）11/11 PASS**：
catalog 门控 / 负向入参 / preview 双模式语义（CLAS+PROG create、INTF+DEVC+
W3MI+testclasses skips）/ apply create 轮 2/2（受控 XML+corrNr 建壳、PUT 带
传输、typed-ref 激活）/ 直连核验（存在/激活/内容/包归属/testclasses 默认模板）
/ update 轮 2/2（漂移基线）/ status / corrNr 锁清理+缺席验证。

**遗留限制（矩阵两行维持 PARTIAL 的依据）**：INTF（接口池生成，双系统）、
$ 本地包 OO 激活（双系统）、CLAS testclasses include 激活（双系统）——三者
同族（OO 生成器/激活队列），建议 Basis/工单；GUI 新建+激活不受影响。

### VSP 路径对照与 INTF 闭合（2026-10-09 终）

- **VSP DeployZip 实现路径**（pkg/adt/workflows_deploy.go + crud.go）：POST collection **精简 XML**
  （仅 description/name/type/responsible + packageRef，不带 language/masterSystem 属性，
  Content-Type application/*）+ corrNr 随 qs（transportable 包自动挑传输）→ SyntaxCheck →
  Lock → WriteSource(带 transport) → POST /sap/bc/adt/activation?method=activate&preauditRequested=true。
  与本项目受控形态同构；VSP 天然只面向 transportable 包（CreateFromFile 签名带 transport）。
- **XML 形态无关**：受控 full 形态与 VSP 精简形态，CLAS 均成功、INTF 均失败——成功因子只有
  **CLAS + transportable + corrNr**。
- **INTF 闭合**：ADT 修改激活 GUI 建的接口也失败（"Only interfaces can be defined in an
  INTERFACE-POOL"）——INTF 的 ADT 新建/修改激活全灭（两台系统），唯一通道=GUI 新建+激活。
- **CLAS 修复路径已在 sap-dev + sap-demo 双系统验证**（受控 full 与 VSP slim 两种 XML 均可）。

### GUI 复现结果与数据库层排查（2026-10-08 续，故障定性完成）

- **SAP GUI 激活同一对象报完全相同的错误**（"接口部分 ZIF_IMPSMK469426 行 1: A class already
  exists with the name ZIF_IMPSMK469426"）——排除 ADT 通道/工具因素，**系统 SEO 激活引擎本身
  在"激活"动作上误判同名冲突**。
- **数据库层排查**（datapreview 只读 SQL）：目录层全部正常——TADIR 一条且名实相符、SEOCLASS
  行 UUID/CLSTYPE 正常且无重复行；生成层 REPOSRC 中壳的 A 行（骨架）与写入的 I 行共存；
  TADIR.GENFLAG 为空（正常）。病灶指向**类池生成器的存在性检查**：激活=用自己的 inactive
  版本覆盖自己的既有 pool（ZIF_...====IP），该系统把"pool 已存在"误判为新建冲突。
- 排查已到 datapreview 只读通道边界；后续属 Basis/内核/SAP 支持范围。

### GUI 分叉实验与修复路径搜索（2026-10-09 续）

- **GUI 全新建 ZIF_IMPGUI1009 并激活成功**（用户操作）——激活引擎"从无到有生成"路径正常；
  ADT 壳（GUI/ADT 双通道）激活全失败——**病灶锁定为 ADT POST 建壳生成的对象状态**
  （REPOSRC 形态差异实证：GUI 对象=3 行纯 ACTIVE；ADT 壳=A 骨架 + I 源码共存，激活拒绝覆盖）。
- **POST 变体矩阵全灭**：不带 masterSystem、Content-Type v5→v2 降版——激活同错。
- **PUT ?version=active 是静默假成功**（HTTP 200 但 active 源不变）——危险形态，禁止用作变通。
- **ADT 修改激活 GUI 对象的实验被僵尸会话编辑锁阻塞**（探针进程崩溃未 unLock 的 SAP 会话
  持锁，GUI 退出清不掉）——待 SM04 终止会话后重测；该实验决定导入链 OO update 方向可用性。
- 根治建议：**重启应用实例**（激活引擎/工作区状态重置）；证据链已齐（GUI 成功 + ADT 壳失败 +
  数据库形态差异 + 变体矩阵全灭）。

| 实验 | 变量 | 结果 |
| --- | --- | --- |
| 受控 XML 建壳 INTF @ `$TMP`（两次独立运行） | 建壳路径 | 激活 `E: A class already exists with the name "<名>"` + `W: Activation was cancelled.` |
| generic `createObject` INTF @ `$TMP` | 建壳路径 | 同错（排除受控 XML 因素） |
| generic INTF @ `$ABAPGIT` | 目标包 | 同错（排除 `$TMP` 因素） |
| preaudit=true 激活（一步到位，无前置默认激活） | 激活开关 | 同错（排除 preaudit 因素；受控创建链真机验证同款参数） |
| INTF @ `Z001` + transport `S4HK900031` | transport | 同错（排除无传输/本地包因素） |
| `abapCheckRun`（active/inactive 版本参数） | 激活前检查 | 同错（检查器同样误报同名冲突） |
| `executeAbap`（PROG/P @ `$TMP`，同期） | 对照组 | **成功**（建壳/激活/运行/删除全链）——系统激活面未全坏，OO 引擎特异 |
| 受控创建链（ABAP_CLASS/ABAP_INTERFACE，同款 activate 形态） | 历史对照 | 2026-09-30 同系统真机全绿（REAL_DEV_VERIFIED 证据）——当时正常 |

激活失败的副作用：对象留下 **"使用者 068157 当前编辑" 编辑锁**（EUDB 型，`lock` 不可接管、非超时回收——与本系统 tabdata 轮 EU510 同族）；受影响对象清单见"残留"。

## 顺带固化进实现的环境事实

1. **本地包不存储 `adtcore:masterSystem`**（系统接受输入但读回丢弃；对象自身存储值即字面 `"SAP"`——受控创建链 `sameControlledMasterSystem` 特判同源）→ 工作流身份校验对 masterSystem 缺失回退 `"SAP"`。
2. **本地包 DELETE 半删除态**：scratch 包 `$IMPSMOKE` 删除后 TADIR 残留（GET 报"从数据库导入对象时出错"），立即重建撞 `already exist`（>60s 不恢复）→ 包现为 TADIR 孤儿，与本系统传输对象删除语义（E071 不消失）同族。
3. **`abapCheckRun` 对"已建壳未激活"的本地对象误报同名冲突** → 导入执行器**移除激活前语法检查**，编译正确性由激活步保证（激活即完整编译，E/A 消息经 `assertActivation` 暴露；语义同 `executeAbap` 的"激活失败不进入下一步"）。
4. 激活取消会在对象上遗留 EUDB 编辑锁（见上）。

## 残留清单（等待服务端锁回收后清理）

| 对象 | 包 | 状态 |
| --- | --- | --- |
| `ZIF_IMPSMK469426` / `ZIF_IMPSMK974038` / `ZIF_IMPSMKGEN1` | `$TMP` | 编辑锁（激活取消遗留） |
| `ZIF_IMPPKG20465` / `ZIF_IMPPKG57471` | `$ABAPGIT` | 编辑锁 |
| `ZIF_IMPTR37577` | `Z001` | 编辑锁（创建/写源带 corrNr=S4HK900031；删除需 transport 参数） |
| `$IMPSMOKE` | — | TADIR 孤儿包（半删除态） |

清理方式：锁回收后 `lock→deleteObject`（Z001 对象需带 corrNr）；或 SM04 终止 068157 会话后立即删。

## 复跑与补验

- 复跑：`npm run test:import-real-dev`（PROG-only；幂等，对象名唯一后缀）。
- OO 方向补验：环境恢复（INTF 激活不再报同名冲突）后，将 SMOKE 的 zipEntries 恢复为 INTF+CLAS(含测试类)+PROG 三对象形态重跑，全绿后两行晋级 EQUIVALENT。
