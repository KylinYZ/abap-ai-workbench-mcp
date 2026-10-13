/**
 * ============================================================================
 * abapGit 离线包部署计划构建器（Stage 2 执行器的输入契约）
 * ============================================================================
 *
 * 用途：把解析出的逻辑对象清单编排为**依赖有序**的部署动作清单——包先于
 * 代码、接口先于类（类实现接口）、其余代码随后；范围外对象（W3MI/TRAN）
 * 显式跳过并保留原因。计划是纯数据：Stage 2 的受控执行器（preview plan →
 * 一次原生确认 → 批量 apply → 进度/续传）消费本结构，不含任何 SAP 往返。
 *
 * 排序口径（本离线包实测为纯代码对象，无 DDIC，无需 DDIC 前置波次）：
 *   DEVC（按文件夹深度：根包 → 子包）→ INTF → CLAS → PROG → FUGR → SKIP。
 *   类对接口的依赖在 ABAP 激活队列下可由"接口先于类 + 失败重激活波次"兜底
 *   （Stage 2 执行器职责），本层只保证静态弱序。
 */

import type { AbapGitObject, AbapGitParseResult, DeployableObjectType } from './serialization.js'

/** 单个部署动作。 */
export interface DeploymentAction {
  readonly objectType: DeployableObjectType
  readonly objectName: string
  /** 目标包（根包名；Stage 2 可按 folder 映射子包）。 */
  readonly packageName: string
  /** 描述（创建时使用；XML TPOOL 提取或对象名回退）。 */
  readonly description: string
  /** 要写入的源文件（写序列：主源 → 局部定义 → 局部实现 → 测试类）。 */
  readonly sources: ReadonlyArray<{ readonly part: 'main' | 'locals_def' | 'locals_imp' | 'testclasses', readonly text: string }>
}

/** 跳过的对象（范围外）。 */
export interface DeploymentSkip {
  readonly objectType: string
  readonly objectName: string
  readonly reason: string
}

/** 部署计划。 */
export interface AbapGitDeploymentPlan {
  /** 根目标包。 */
  readonly packageName: string
  /** 执行序动作清单（包 → 接口 → 类 → 程序 → 函数组）。 */
  readonly actions: readonly DeploymentAction[]
  /** 范围外跳过清单。 */
  readonly skips: readonly DeploymentSkip[]
  /** 各类型计数汇总。 */
  readonly counts: Readonly<Record<string, number>>
  /** 计划级说明（执行器随结果回显）。 */
  readonly notes: readonly string[]
}

/** 类型静态弱序（越小越先）：包 → 接口 → 类 → 程序 → 函数组。 */
const TYPE_ORDER: Record<DeployableObjectType, number> = {
  DEVC: 0,
  INTF: 1,
  CLAS: 2,
  PROG: 3,
  FUGR: 4
}

/** 源文件段的写入序。 */
const PART_ORDER: Record<string, number> = { main: 0, locals_def: 1, locals_imp: 2, testclasses: 3 }

/**
 * 从解析结果构建部署计划。
 *
 * @param parsed 离线包解析结果
 * @param packageName 根目标包（本地包约定 $ 前缀，如 $ABAPGIT）
 */
export function buildDeploymentPlan(
  parsed: AbapGitParseResult,
  packageName: string
): AbapGitDeploymentPlan {
  // 包名只做形态校验；$ 本地包与 transportable 包均接受——模式语义（本地包
  // 仅 PROG / transportable 全型）由调用方（受控导入工作流）按传输号判定。
  if (!/^\$?(?:\/[A-Z0-9_]+\/)?[A-Z][A-Z0-9_]{0,29}$/.test(packageName)) {
    throw new Error(`buildDeploymentPlan: package "${packageName}" is not a valid ABAP repository name.`)
  }
  const skips: DeploymentSkip[] = parsed.skippedObjects.map(skip => ({
    objectType: skip.type,
    objectName: skip.name,
    // W3MI=Web GUI 前端静态资源、TRAN=事务码——均不在 ADT 集成的关键路径上
    reason: `${skip.type} is out of deployment scope (web GUI artifacts / transaction code); not required for the ADT git integration`
  }))

  const counts: Record<string, number> = {}
  const actions: DeploymentAction[] = parsed.objects
    .slice()
    .sort((left, right) =>
      (TYPE_ORDER[left.type] - TYPE_ORDER[right.type])
      || left.folder.localeCompare(right.folder)
      || left.name.localeCompare(right.name))
    .map(object => {
      counts[object.type] = (counts[object.type] ?? 0) + 1
      const sources: Array<{ part: 'main' | 'locals_def' | 'locals_imp' | 'testclasses', text: string }> = []
      if (object.mainSource !== undefined) sources.push({ part: 'main', text: object.mainSource })
      if (object.localsDefSource !== undefined) sources.push({ part: 'locals_def', text: object.localsDefSource })
      if (object.localsImpSource !== undefined) sources.push({ part: 'locals_imp', text: object.localsImpSource })
      if (object.testclassesSource !== undefined) sources.push({ part: 'testclasses', text: object.testclassesSource })
      return {
        objectType: object.type,
        objectName: object.name,
        packageName,
        description: object.description,
        sources
      }
    })

  const notes = [
    'plan order: packages → interfaces → classes → programs → function groups (static weak order; activation-wave retries are the executor\'s duty)',
    ...(parsed.unrecognized.length > 0
      ? [`${parsed.unrecognized.length} file(s) unrecognized and excluded (mime payloads / non-object artifacts)`]
      : [])
  ]
  return { packageName, actions, skips, counts, notes }
}
