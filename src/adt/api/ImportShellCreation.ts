import { AdtHTTP } from '../AdtHTTP'
import { createObject, type NewObjectOptions } from './objectcreator.js'
import {
  buildControlledSourceObjectXml,
  CONTRACTS,
  controlledSourceObjectUrl,
  type ControlledSourceObjectKind
} from './sourceObjectCreation.js'
import { requireCanonicalCreationLocation } from './creationLocation.js'

/**
 * ============================================================================
 * 受控导入链的建壳原语（deploy-zip/fileio.import-export 受控导入工作流）
 * ============================================================================
 *
 * 建壳路径按对象类型/包模式分派（2026-10-09 真机因素矩阵定案，见
 * docs/evidence/repository-import-real-dev-verified.md）：
 *   - CLAS/INTF：受控创建链同款 XML（buildControlledSourceObjectXml，含
 *     ADT 3.60.2 目标所需的 public/final 属性与 testclasses 子节点），
 *     **必须 transportable 包 + corrNr 随 POST**——两台验证系统上，本地包
 *     OO 激活损坏（"A class already exists"），带 corrNr 的 CLAS 激活
 *     双系统验证通过（INTF 因接口池生成独立损坏暂由工作流层跳过）。
 *   - PROG/P：走通用 objectcreator.createObject（ExecuteAbap 临时程序同款，
 *     本地包已验证；transportable 时 corrNr 同样随 qs 携带）。
 */

/** 导入建壳入参（包模式与传输约束由工作流层校验；本层只做请求形态）。 */
export interface ImportShellInput {
  /** 仓库对象类型（受控导入执行面：CLAS/INTF 走受控 XML、PROG 走通用）。 */
  objectType: 'CLAS' | 'INTF' | 'PROG'
  /** 对象名（大写，SAP 对象口径）。 */
  name: string
  /** 描述（来自 abapGit XML TPOOL 提取或对象名回退）。 */
  description: string
  /** 目标包名（transportable 模式必须配 transport）。 */
  packageName: string
  /** 主语言（取目标包元数据 language，缺省回退 masterLanguage）。 */
  language: string
  /** 主语言（取目标包元数据）。 */
  masterLanguage: string
  /** 主系统（取目标包元数据；缺失时工作流层已回退）。 */
  masterSystem: string
  /** 责任人（取目标包元数据，回退当前 SAP 用户）。 */
  responsible: string
  /** 传输号（transportable 模式必填，corrNr 随 POST/PUT 携带；本地包为空）。 */
  transport: string
}

/** 受控导入的仓库对象类型 → 受控创建链 kind 映射。 */
const IMPORT_KIND: Record<'CLAS' | 'INTF', ControlledSourceObjectKind> = {
  CLAS: 'ABAP_CLASS',
  INTF: 'ABAP_INTERFACE'
}

/**
 * 在目标包下建一个源码对象壳（不写源码、不激活）。
 * 返回规范化 Location（受控导入工作流用它做存在性证明与后续锁链锚点）。
 */
export async function createImportObjectShell(
  h: AdtHTTP,
  input: ImportShellInput
): Promise<{ location: string }> {
  if (input.objectType === 'PROG') {
    // 报表程序走通用创建（ExecuteAbap 临时程序同款请求形态）；
    // transportable 时 corrNr 随 qs 携带，本地包不带。
    await createObject(h, {
      objtype: 'PROG/P',
      name: input.name,
      parentName: input.packageName,
      description: input.description,
      contentType: 'application/*',
      responsible: input.responsible,
      ...(input.transport ? { transport: input.transport } : {})
    } as NewObjectOptions)
    return { location: `/sap/bc/adt/programs/programs/${encodeURIComponent(input.name.toLowerCase())}` }
  }

  const kind = IMPORT_KIND[input.objectType]
  const contract = CONTRACTS[kind]
  // 受控创建链同款 XML（CLAS 自动带 public/final 与 testclasses 子节点，
  // 规避部分 ADT 版本"无子节点壳不可读"的问题）；transportRequest 即 corrNr，
  // transportable 模式必带（真机因素矩阵：无 corrNr 的 OO 激活损坏）。
  const body = buildControlledSourceObjectXml({
    objectKind: kind,
    adtType: input.objectType === 'CLAS' ? 'CLAS/OC' : 'INTF/OI',
    name: input.name,
    description: input.description,
    packageName: input.packageName,
    transportRequest: input.transport,
    language: input.language,
    masterLanguage: input.masterLanguage,
    masterSystem: input.masterSystem,
    responsible: input.responsible
  })
  const response = await h.request(contract.collectionPath, {
    method: 'POST',
    qs: input.transport ? { corrNr: input.transport } : undefined,
    headers: { 'Content-Type': contract.contentType, Accept: contract.accept },
    body
  })
  const expectedLocation = controlledSourceObjectUrl(kind, input.name)
  const responseLocation = String(response.headers.location || response.headers.Location || '').trim()
  if (response.status === 200 && !responseLocation && !String(response.body || '').trim()) {
    // 部分源码集合同步建壳但既不回 201 也不回 Location（受控创建链同款容忍）：
    // 返回规范化 URL，由工作流用 inactive 结构读取证明壳存在。
    return { location: expectedLocation }
  }
  const location = requireCanonicalCreationLocation(response, expectedLocation, 'Repository import shell creation')
  return { location }
}
