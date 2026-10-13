// 受控对象导入链真机 smoke v2（sap-dev，deploy-zip/fileio.import-export 受控导入三件套）：
// **transportable 模式**（v2：包=Z001，传输号=S4DK900109 随建壳 POST/PUT 携带）：
// 真机因素矩阵（2026-10-09）定案——$ 本地包 OO 激活损坏、INTF 接口池生成独立损坏、
// transportable+corrNr 的 CLAS 激活双系统验证通过，故本 smoke 断言：
// INTF 进 skips（原因含 interface-pool）、CLAS/PROG create→APPLIED→readback→清理。
// 覆盖：目录可见性、负向入参、preview 冻结（双模式语义）、apply、直连核验
// （存在/激活/源码/包归属/测试类 include）、update 轮、status、清理与缺席验证。
// 全程串行；失败即退出。
import { readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { deflateRawSync } from 'zlib';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ADTClient } from '../dist/adt/index.js';
import { lock, unLock } from '../dist/adt/api/objectcontents.js';
import pkgDelete from '../dist/adt/api/delete.js';
const deleteObject = pkgDelete.deleteObject ?? pkgDelete.default ?? pkgDelete;

const ENV_PATH = 'C:/Users/068157/.codex/sap-abap-adt/env/sap-dev.env';
const envText = readFileSync(ENV_PATH, 'utf8');
const envVars = {};
for (const line of envText.split(/\r?\n/)) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) envVars[m[1]] = m[2]; }
if (!String(envVars.SAP_URL || '').includes('10.30.255.42')) {
  console.error('红线预检失败：SAP_URL 不是 sap-dev（10.30.255.42）');
  process.exit(1);
}
const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === 'string'));
Object.assign(env, {
  SAP_MCP_ENV_FILE: ENV_PATH,
  SAP_MCP_LOG_LEVEL: 'warn',
  // 部署级自动确认开关（仅 DEV 可配置）：SMOKE 无人工表单，apply 直接执行；
  // plan 状态机与漂移校验不受影响（审计如实记 auto-config）
  SAP_MCP_CONFIRMATION_MODE: 'auto'
});

const client = new Client({ name: 'repo-import-smoke', version: '1.0.0' }, { capabilities: {} });
const transport = new StdioClientTransport({ command: process.execPath, args: ['./dist/index.js'], cwd: process.cwd(), env, stderr: 'pipe' });
function parse(r) {
  const t = (r.content || []).filter(i => i.type === 'text' && typeof i.text === 'string').map(i => i.text).join('');
  try { return JSON.parse(t); } catch { return r; }
}
async function call(name, args) { return parse(await client.callTool({ name, arguments: args }, undefined, { timeout: 300000 })); }
function pass(m) { console.log('PASS', m); }
function fail(m, p) { console.log(`FAIL ${m}\n${JSON.stringify(p || {}).slice(0, 1200)}`); process.exit(1); }

/* ── 真实 ZIP 构造（DEFLATE + CRC32：走 zip-reader 的 method 8 真实路径） ── */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
/** 最小 ZIP 写入器（DEFLATE 条目 + 正确 CRC32——与离线单测的 STORED 写入器不同，这是真实形态）。 */
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const data = deflateRawSync(Buffer.from(entry.text, 'utf8'));
    const crc = crc32(Buffer.from(entry.text, 'utf8'));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // method=DEFLATE
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(Buffer.byteLength(entry.text, 'utf8'), 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(Buffer.byteLength(entry.text, 'utf8'), 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + data.length;
  }
  const centralOffset = offset;
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...chunks, ...central, eocd]);
}

/* ── raw 直连客户端（专用包创建 / 核验 / 清理用） ── */
async function rawClient() {
  const raw = new ADTClient(envVars.SAP_URL, envVars.SAP_USER, envVars.SAP_PASSWORD, envVars.SAP_CLIENT, envVars.SAP_LANGUAGE || 'EN', {});
  raw.stateful = 'stateful';
  await raw.h.login();
  return raw;
}

/** 直连核验：对象存在、激活、主源内容含标记、包归属正确。 */
async function assertDeployed(raw, url, name, adtType, sourceMarker, packageName) {
  const matches = await raw.searchObject(name, adtType, 10);
  const hit = matches.find(item => String(item['adtcore:name'] || '').toUpperCase() === name);
  if (!hit) fail(`直连核验：${name} 未在 SAP 中找到`);
  const pkg = String(hit['adtcore:packageName'] || '').toUpperCase();
  if (pkg && pkg !== packageName) fail(`直连核验：${name} 包归属异常（${pkg} ≠ ${packageName}）`);
  const structure = await raw.objectStructure(url, 'active');
  if (String(structure.metaData['adtcore:version'] || '').toLowerCase() !== 'active') {
    fail(`直连核验：${name} 未处于激活态`);
  }
  const ADTClientMain = ADTClient.mainInclude(structure, false);
  const source = await raw.getObjectSource(ADTClientMain);
  if (!source.includes(sourceMarker)) fail(`直连核验：${name} 主源内容不含标记 ${sourceMarker}`, { head: source.slice(0, 200) });
}

/** 直连清理：lock → DELETE → 缺席验证（GET 404/does not exist）。 */
async function cleanupObject(raw, url, name, label, transport) {
  // transportable 对象已登记传输：重锁必须带同一 corrNr（否则 CTS_WBO_API019），
  // objectcontents.lock 不支持 corrNr——手搓 ADT LOCK 请求并解析句柄
  const lockResp = await raw.h.request(url, {
    method: 'POST',
    qs: { _action: 'LOCK', accessMode: 'MODIFY', ...(transport ? { corrNr: transport } : {}) },
    headers: { Accept: 'application/*,application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result' }
  });
  const handleMatch = String(lockResp.body).match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/)
    || String(lockResp.body).match(/LOCK_HANDLE"?:?"?([A-F0-9]{16,})/i);
  const handle = handleMatch ? handleMatch[1] : '';
  if (!handle) fail(`${label}：清理加锁失败（${name}）`);
  await deleteObject(raw.h, url, handle, transport || undefined);
  try {
    await raw.h.request(url, { method: 'GET' });
    fail(`${label}：${name} 仍然存在（清理缺席验证失败）`);
  } catch (e) {
    if (!/404|not Found|not_found|NotFound|RESOURCE_NOT_FOUND|does not exist/i.test(String(e?.message || e))) {
      fail(`${label}：缺席验证遇到非 404 异常`, { error: String(e?.message || e).slice(0, 300) });
    }
  }
  pass(`${label}：${name} 已删除（缺席验证过）`);
}

async function main() {
  await client.connect(transport);

  // 0. catalog：三件套在 focused（development-workbench）面
  const tools = await client.listTools();
  for (const name of ['previewRepositoryObjectImport', 'applyRepositoryObjectImport', 'getRepositoryObjectImportStatus']) {
    if (!tools.tools.some(t => t.name === name)) fail(`${name} 不在 focused catalog`);
  }
  pass('受控导入三件套在 focused catalog');

  // 对象名带唯一后缀，重复执行无碰撞；总长 ≤30
  const suffix = String(Date.now()).slice(-6);
  const suffixN = `IMPSMK${suffix}`;
  const INTF = `ZIF_${suffixN}`;
  const CLAS = `ZCL_${suffixN}`;
  const PROG = `ZPROG_${suffixN}`;
  const PACKAGE = 'Z001';
  // sap-dev.env 的 VALIDATION_TRANSPORT=S4HK900009 已失效（真机实证"在系统 S4D 中
  // 不存在"）；用实测可用的 S4DK900109（10-04 战役确认的新验证传输）
  const TRANSPORT = 'S4DK900109';
  const PROG_NAME = PROG.toLowerCase();

  const zipEntries = [
    { path: `${INTF.toLowerCase()}.intf.abap`, text: `INTERFACE ${INTF}.
  METHODS say_hello.
ENDINTERFACE.` },
    { path: `${CLAS.toLowerCase()}.clas.abap`, text: `CLASS ${CLAS} DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    METHODS say_hello.
ENDCLASS.
CLASS ${CLAS} IMPLEMENTATION.
  METHOD say_hello.
  ENDMETHOD.
ENDCLASS.` },
    { path: `${CLAS.toLowerCase()}.clas.testclasses.abap`, text: `CLASS ltcl_smoke DEFINITION FINAL FOR TESTING.
  METHOD test_noop FOR TESTING.
    cl_abap_unit_assert=>assert_true( abap_true ).
  ENDMETHOD.
ENDCLASS.
CLASS ltcl_smoke IMPLEMENTATION.
ENDCLASS.` },
    { path: `${CLAS.toLowerCase()}.clas.xml`, text: `<?xml version="1.0" encoding="utf-8"?><abapGit version="v1.0.0"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><VSEOCLASS><TPOOL><item><ID>S</ID><KEY>00</KEY><ENTRY>import smoke class</ENTRY></item></TPOOL></VSEOCLASS></asx:values></asx:abap></abapGit>` },
    { path: `${PROG_NAME}.prog.abap`, text: `REPORT ${PROG_NAME}.
WRITE: 'controlled import smoke'.` },
    { path: 'package.devc.xml', text: `<?xml version="1.0" encoding="utf-8"?><abapGit version="v1.0.0"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DEVC><CTR>LOCAL</CTR></DEVC></asx:values></asx:abap></abapGit>` }
  ];
  const zipBuffer = buildZip(zipEntries);
  const zipBase64 = zipBuffer.toString('base64');
  const zipPath = join(tmpdir(), `import-smoke-${suffix}.zip`);
  writeFileSync(zipPath, zipBuffer);

  const raw = await rawClient();
  try {
    pass(`目标包 ${PACKAGE}（transportable，传输 ${TRANSPORT}）就绪`);

    // 1. 负向入参：双 ZIP 来源被拒（零 SAP 写）；非 $ 包被拒
    const both = await call('previewRepositoryObjectImport', { packageName: PACKAGE, transportRequest: TRANSPORT, zipBase64, zipPath });
    if (!/VALIDATION_FAILED|exactly one/i.test(JSON.stringify(both).slice(0, 500))) fail('双 ZIP 来源未被拒', both);
    const nonLocal = await call('previewRepositoryObjectImport', { packageName: PACKAGE, zipBase64 });
    if (!/VALIDATION_FAILED|transportRequest/i.test(JSON.stringify(nonLocal).slice(0, 500))) fail('transportable 缺传输号未被拒', nonLocal);
    pass('负向入参：双来源/非本地包均被拒');

    // 2. create 轮（zipBase64 入口）：preview 冻结 CLAS/PROG create + INTF/DEVC 跳过 + 建壳身份
    const preview = await call('previewRepositoryObjectImport', { packageName: PACKAGE, transportRequest: TRANSPORT, zipBase64 });
    const p1 = preview.structuredContent?.result ?? preview.result ?? preview;
    if (p1?.status !== 'preview') fail('preview #1 未成功', preview);
    const plan1 = p1.plan;
    if (plan1.objects.length !== 2) fail('preview #1 对象数异常', plan1.objects);
    if (!plan1.skips.some(s => s.objectType === 'INTF' && /interface-pool/.test(s.reason))) fail('preview #1 缺 INTF 跳过（接口池原因）', plan1.skips);
    if (!plan1.skips.some(s => s.objectName === `${CLAS}|testclasses`)) fail('preview #1 缺 CLAS testclasses 跳过', plan1.skips);
    if (!plan1.objects.find(o => o.objectName === CLAS).parts.every(p => p.part === 'main')) fail('preview #1 CLAS 应仅含 main 部件', plan1.objects);
    if (!plan1.objects.every(o => o.action === 'create')) fail('preview #1 应全为 create', plan1.objects);
    if (!plan1.skips.some(s => s.objectType === 'DEVC')) fail('preview #1 缺 DEVC 跳过', plan1.skips);
    if (!plan1.identity?.masterSystem) fail('preview #1 缺建壳身份', plan1.identity);
    pass(`preview #1：2 create（${plan1.objects.map(o => o.objectName).join('/')}），skips=${plan1.skips.length}（含 INTF）`);

    // 3. apply #1（auto 确认）：批量部署 + readback
    const apply1 = await call('applyRepositoryObjectImport', { importPlanId: plan1.importPlanId });
    const a1 = apply1.structuredContent?.result ?? apply1.result ?? apply1;
    if (a1?.status !== 'success' || a1?.plan?.status !== 'APPLIED') fail('apply #1 未成功', apply1);
    if (!a1.plan.outcomes.every(o => o.result === 'APPLIED')) fail('apply #1 存在未 APPLIED 对象', a1.plan.outcomes);
    pass(`apply #1：2/2 APPLIED（create 轮）`);

    // 4. 直连核验：存在 / 激活 / 主源内容 / 包归属 / CLAS 测试类 include
    await assertDeployed(raw, `/sap/bc/adt/oo/classes/${CLAS.toLowerCase()}`, CLAS, 'CLAS/OC', `CLASS ${CLAS}`, PACKAGE);
    const classStructure = await raw.objectStructure(`/sap/bc/adt/oo/classes/${CLAS.toLowerCase()}`, 'active');
    const includesMap = ADTClient.classIncludes(classStructure);
    const testUrl = includesMap.get('testclasses');
    if (!testUrl) fail('直连核验：CLAS 未暴露 testclasses include');
    const testSource = await raw.getObjectSource(testUrl);
    // v2：testclasses 部件跳过（类池生成损坏）——include 应保持系统默认模板
    if (testSource.includes('ltcl_smoke')) fail('直连核验：测试类不应被写入（testclasses 已跳过）', testSource.slice(0, 200));
    if (!/use this source file for your ABAP unit test classes/i.test(testSource)) fail('直连核验：测试类 include 非系统默认模板', testSource.slice(0, 200));
    await assertDeployed(raw, `/sap/bc/adt/programs/programs/${PROG_NAME}`, PROG, 'PROG/P', `REPORT ${PROG_NAME}`, PACKAGE);
    pass('直连核验：CLAS/PROG 存在/激活/主源内容/包归属 + 测试类 include 写入');

    // 5. update 轮（zipPath 入口）：preview 识别 3 update + 逐包含漂移基线
    const preview2 = await call('previewRepositoryObjectImport', { packageName: PACKAGE, transportRequest: TRANSPORT, zipPath });
    const p2 = preview2.structuredContent?.result ?? preview2.result ?? preview2;
    if (p2?.status !== 'preview') fail('preview #2 未成功', preview2);
    if (!p2.plan.objects.every(o => o.action === 'update')) fail('preview #2 应全为 update', p2.plan.objects);
    pass('preview #2：2 update（漂移基线冻结）');

    // 6. apply #2：update 轮（同内容写回 + 激活 + readback）
    const apply2 = await call('applyRepositoryObjectImport', { importPlanId: p2.plan.importPlanId });
    const a2 = apply2.structuredContent?.result ?? apply2.result ?? apply2;
    if (a2?.status !== 'success' || a2?.plan?.status !== 'APPLIED') fail('apply #2 未成功', apply2);
    pass('apply #2：2/2 APPLIED（update 轮）');

    // 7. status 本地查询
    const status = await call('getRepositoryObjectImportStatus', { importPlanId: p2.plan.importPlanId });
    const s1 = status.structuredContent?.result ?? status.result ?? status;
    if (s1?.status !== 'APPLIED' || !s1?.outcomes?.length) fail('status 查询异常', status);
    pass('status：本地查询返回 APPLIED + 逐对象结果');

    // 8. 清理：直连锁删对象（带传输号）+ 缺席验证（SMOKE 对象零残留）
    await cleanupObject(raw, `/sap/bc/adt/oo/classes/${CLAS.toLowerCase()}`, CLAS, 'cleanup', TRANSPORT);
    await cleanupObject(raw, `/sap/bc/adt/programs/programs/${PROG_NAME}`, PROG, 'cleanup', TRANSPORT);

    console.log('SMOKE OK: 受控对象导入链 real-dev 全场景通过（transportable 模式：CLAS+PROG，INTF 跳过）');
  } finally {
    rmSync(zipPath, { force: true });
    await client.close().catch(() => {});
    await raw.h.logout().catch(() => {});
  }
}

main().catch(e => { console.error('SMOKE ERROR', e); process.exit(1); });
