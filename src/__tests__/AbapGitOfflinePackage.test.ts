import { readFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { jest } from '@jest/globals'

import { readZipTextEntries, writeZipStoredEntries, ZipParseError } from '../abapgit/zip-reader.js'
import { parseAbapGitOfflineEntries } from '../abapgit/serialization.js'
import { buildDeploymentPlan } from '../abapgit/deployment-plan.js'

/**
 * ============================================================================
 * abapGit 离线包解析与部署计划测试（Stage 1：纯本地，零 SAP 往返）
 * ============================================================================
 *
 * 用合成 ZIP（写入器仅 STORED；DEFLATE 条目用 zlib 手工构造）锁定三层契约：
 *   1. ZIP 读取器：STORED/DEFLATE、目录遍历、坏包报错；
 *   2. 序列化解析：多段文件名归组（clas 主源/测试类/局部/XML）、W3MI/TRAN
 *      跳过、清单提取、未知散件归 unrecognized；
 *   3. 部署计划：包→接口→类→程序→函数组静态弱序、目标写入序、包名校验。
 *
 * 结构样例按真实离线包（sess_1f97b94f 实测：src/<folder>/<名>.<类型>.<扩展>，
 * 全 DEFLATE）构造。
 */

/** 构造一个 DEFLATE 条目的手工 ZIP（本地头+数据+中央目录+EOCD）。 */
function u16(buffer: Buffer, offset: number, value: number): void {
  buffer.writeUInt16LE(value, offset)
}

function u32(buffer: Buffer, offset: number, value: number): void {
  buffer.writeUInt32LE(value, offset)
}

function buildZipWithDeflate(entries: ReadonlyArray<{ path: string, text: string, deflate?: boolean }>): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8')
    const raw = Buffer.from(entry.text, 'utf8')
    const useDeflate = entry.deflate === true
    const data = useDeflate ? deflateRawSync(raw) : raw
    const method = useDeflate ? 8 : 0
    const local = Buffer.alloc(30)
    u32(local, 0, 0x04034b50)
    u16(local, 8, method)
    u32(local, 18, data.length)
    u32(local, 22, raw.length)
    u16(local, 26, name.length)
    chunks.push(local, name, data)
    const centralEntry = Buffer.alloc(46)
    u32(centralEntry, 0, 0x02014b50)
    u16(centralEntry, 10, method)
    u32(centralEntry, 20, data.length)
    u32(centralEntry, 24, raw.length)
    u16(centralEntry, 28, name.length)
    u32(centralEntry, 42, offset)
    central.push(centralEntry, name)
    offset += 30 + name.length + data.length
  }
  const centralOffset = offset
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0)
  const eocd = Buffer.alloc(22)
  u32(eocd, 0, 0x06054b50)
  u16(eocd, 8, entries.length)
  u16(eocd, 10, entries.length)
  u32(eocd, 12, centralSize)
  u32(eocd, 16, centralOffset)
  return Buffer.concat([...chunks, ...central, eocd])
}

describe('zip-reader', () => {
  it('reads STORED entries via the minimal writer round-trip', () => {
    const entries = [
      { path: 'src/zabapgit.prog.abap', text: 'REPORT zabapgit.' },
      { path: '.abapgit.xml', text: '<?xml version="1.0"?><abapGit version="v1.0" />' }
    ]
    const zip = writeZipStoredEntries(entries)
    expect(readZipTextEntries(zip)).toEqual(entries)
  });

  it('reads DEFLATE entries (real offline packages are all deflated)', () => {
    const text = 'CLASS zcl_abapgit_git DEFINITION PUBLIC FINAL.\nENDCLASS.'
    const zip = buildZipWithDeflate([{ path: 'src/git/zcl_abapgit_git.clas.abap', text, deflate: true }])
    expect(readZipTextEntries(zip)).toEqual([{ path: 'src/git/zcl_abapgit_git.clas.abap', text }])
  });

  it('rejects truncated buffers and unknown compression methods', () => {
    expect(() => readZipTextEntries(Buffer.from('tiny'))).toThrow(ZipParseError)
    // 方法 99：手工构造中央目录 + 本地头
    const zip = buildZipWithDeflate([{ path: 'a.txt', text: 'x' }])
    zip.writeUInt16LE(99, 8 + 8 + 30) // 本地头方法字段（第 8 字节偏移后的本地条目区）
    // 直接断言读取端拒绝未知方法：改中央目录与本地头两处
    const firstLocal = 0
    zip.writeUInt16LE(99, firstLocal + 8)
    expect(() => readZipTextEntries(zip)).toThrow(/unsupported compression method 99/)
    void u16
    void u32
  });
});

describe('serialization parser (abapGit offline naming contract)', () => {
  const manifest = '<?xml version="1.0"?><abapGit version="v1.0.2" /></abapGit>'

  it('groups multi-file class objects and extracts the description from TPOOL', () => {
    const entries = [
      { path: '.abapgit.xml', text: manifest },
      { path: 'src/package.devc.xml', text: '<PACKAGE/>' },
      {
        path: 'src/git/zcl_abapgit_git.clas.xml',
        text: '<CLASS><TPOOL><item><ID>S</ID><KEY>00</KEY><ENTRY>Git operations</ENTRY></item></TPOOL></CLASS>'
      },
      { path: 'src/git/zcl_abapgit_git.clas.abap', text: 'CLASS zcl_abapgit_git IMPLEMENTATION.' },
      { path: 'src/git/zcl_abapgit_git.clas.testclasses.abap', text: 'CLASS ltcl_test DEFINITION.' }
    ]
    const zip = buildZipWithDeflate(entries.map(e => ({ ...e, deflate: true })))
    const result = parseAbapGitOfflineEntries(readZipTextEntries(zip))
    expect(result.manifestXml).toBe(manifest)
    // 包定义（src/package.devc.xml）也是对象：CLAS + DEVC 共 2 个
    expect(result.objects).toHaveLength(2)
    const object = result.objects.find(o => o.type === 'CLAS')
    expect(object).toBeDefined()
    expect(object).toMatchObject({
      name: 'ZCL_ABAPGIT_GIT', type: 'CLAS', folder: 'src/git',
      description: 'Git operations',
      mainSource: 'CLASS zcl_abapgit_git IMPLEMENTATION.',
      testclassesSource: 'CLASS ltcl_test DEFINITION.'
    })
    expect(object!.metadataXml).toContain('<CLASS>')
  });

  it('skips W3MI/TRAN objects with reasons and keeps mime payloads unrecognized', () => {
    const entries = [
      { path: 'src/zabapgit.tran.xml', text: '<TRAN/>' },
      { path: 'src/zabapgit_logo.w3mi.xml', text: '<W3MI/>' },
      { path: 'src/img/logo.css', text: 'body {}' },
      { path: 'src/zabapgit.prog.abap', text: 'REPORT zabapgit.' }
    ]
    const result = parseAbapGitOfflineEntries(readZipTextEntries(buildZipWithDeflate(entries)))
    expect(result.skippedObjects).toEqual([
      { name: 'ZABAPGIT', type: 'TRAN', folder: 'src' },
      { name: 'ZABAPGIT_LOGO', type: 'W3MI', folder: 'src' }
    ])
    expect(result.unrecognized.some(u => u.path === 'src/img/logo.css')).toBe(true)
    // 仅 PROG 进入可部署清单
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0].type).toBe('PROG')
  });

  it('parses interface and package objects and sorts by type order', () => {
    const entries = [
      { path: 'src/objects/zif_abapgit_object.intf.abap', text: 'INTERFACE zif_abapgit_object.' },
      { path: 'src/package.devc.xml', text: '<PACKAGE/>' },
      { path: 'src/git/package.devc.xml', text: '<PACKAGE/>' },
      { path: 'src/zcl_abapgit_zip.clas.abap', text: 'CLASS zcl_abapgit_zip IMPLEMENTATION.' }
    ]
    const result = parseAbapGitOfflineEntries(readZipTextEntries(buildZipWithDeflate(entries)))
    // 排序：DEVC → INTF → CLAS（同类型按名字）
    expect(result.objects.map(o => `${o.type}:${o.name}`)).toEqual([
      'DEVC:PACKAGE', 'DEVC:PACKAGE', 'INTF:ZIF_ABAPGIT_OBJECT', 'CLAS:ZCL_ABAPGIT_ZIP'
    ])
  });
});

describe('deployment plan builder (Stage 2 executor input contract)', () => {
  it('orders actions packages → interfaces → classes → programs and freezes write order', () => {
    const parsed = parseAbapGitOfflineEntries(readZipWithObjects([
      { path: 'src/zabapgit.prog.abap', text: 'REPORT zabapgit.' },
      { path: 'src/objects/zif_abapgit_object.intf.abap', text: 'INTERFACE zif_abapgit_object.' },
      { path: 'src/zcl_abapgit_zip.clas.abap', text: 'CLASS zcl_abapgit_zip IMPLEMENTATION.' },
      { path: 'src/zcl_abapgit_zip.clas.locals_imp.abap', text: 'CLASS lcl_helper IMPLEMENTATION.' },
      { path: 'src/zcl_abapgit_zip.clas.testclasses.abap', text: 'CLASS ltcl DEFINITION.' }
    ]))
    const plan = buildDeploymentPlan(parsed, '$ABAPGIT')
    expect(plan.actions.map(a => a.objectType)).toEqual(['INTF', 'CLAS', 'PROG'])
    expect(plan.actions[1].sources.map(s => s.part)).toEqual(['main', 'locals_imp', 'testclasses'])
    expect(plan.packageName).toBe('$ABAPGIT')
    expect(plan.counts).toMatchObject({ INTF: 1, CLAS: 1, PROG: 1 })
    expect(plan.skips).toEqual([])
  });

  it('accepts both $ local and transportable package names, rejects invalid names', () => {
    const parsed = parseAbapGitOfflineEntries(readZipWithObjects([
      { path: 'src/zabapgit.prog.abap', text: 'REPORT zabapgit.' }
    ]))
    // $ 本地包与 transportable 包均接受（模式语义由受控导入工作流按传输号判定）
    expect(buildDeploymentPlan(parsed, '$ABAPGIT').packageName).toBe('$ABAPGIT')
    expect(buildDeploymentPlan(parsed, 'ABAPGIT').packageName).toBe('ABAPGIT')
    expect(() => buildDeploymentPlan(parsed, 'abapgit')).toThrow(/valid ABAP repository name/)
    expect(() => buildDeploymentPlan(parsed, '')).toThrow(/valid ABAP repository name/)
  });
});

/** 测试辅助：按文件清单构建 ZIP 并读取为条目清单。 */
function readZipWithObjects(files: ReadonlyArray<{ path: string, text: string }>) {
  return readZipTextEntries(buildZipWithDeflate(files.map(f => ({ ...f, deflate: true }))))
}

// 读取真实离线包（存在时）做结构回归：ZABAPGIT dev 离线包本地工件，不入库
describe('real offline package structural regression (skipped when artifact absent)', () => {
  const offlinePath = 'D:/MyDev/SAP/tmp-abapgit/zabapgit_dev_offline.zip'
  const offline = (() => {
    try {
      return readFileSync(offlinePath)
    } catch {
      return undefined
    }
  })()

  it('parses the real dev offline package if present on this machine', () => {
    if (offline === undefined) {
      process.stdout.write('SKIP: real offline package not present on this machine\n')
      return
    }
    const parsed = parseAbapGitOfflineEntries(readZipTextEntries(offline))
    const byType: Record<string, number> = {}
    for (const object of parsed.objects) byType[object.type] = (byType[object.type] ?? 0) + 1
    // 真实包口径（sess_1f97b94f 实测）：纯代码对象，无 DDIC
    expect(byType['CLAS']).toBeGreaterThan(400)
    expect(byType['INTF']).toBeGreaterThan(100)
    expect(byType['DEVC']).toBeGreaterThan(40)
    expect(byType['TABL']).toBeUndefined()
    const plan = buildDeploymentPlan(parsed, '$ABAPGIT')
    // 静态弱序：包动作最先，函数组动作最后
    expect(plan.actions[0].objectType).toBe('DEVC')
    expect(plan.actions[plan.actions.length - 1].objectType).toBe('FUGR')
    expect(plan.skips.length).toBeGreaterThan(0)
  })
})
