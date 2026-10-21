// 受控传输请求释放链真机 smoke（sap-demo，受控释放，2026-10-21 所有者授权）：
// 全链验证 healthcheck（目标身份铁律）→ catalog（三工具可见、原子 transportRelease
// 不在受控目录）→ 受控创建链建空请求（取释放目标）→ previewTransportRelease
//（红线：owner=本人+status=D）→ 原生确认拒绝分支（cancel → confirmation_declined，
// plan 仍 PREVIEWED）→ 原生确认接受分支（release_transport）→ apply 单次标准释放
// + 轮询读回 → SUCCEEDED + releasedVerified + readbackStatus=R → 独立直连读回佐证
//（tm:status=R）→ 已释放红线（同一请求再 preview 拒绝）→ 属主红线（他人请求
// preview 拒绝，只读无副作用）。
// 边界：释放后的请求按 SAP 语义留在系统（已释放请求不可删，属主手工归档），
// 本 smoke 不删除任何对象、不触碰 E071/E071K、不做 STMS 导入；全程串行。
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ADTClient } from '../dist/adt/index.js';
import { transportDetails } from '../dist/adt/api/transports.js';

// 环境文件：默认 sap-demo.env（所有者 2026-09-22 指示），可显式传入覆盖
const environmentFile = resolve(process.argv[2] || 'C:/Users/068157/.codex/sap-abap-adt/env/sap-demo.env');
const envText = readFileSync(environmentFile, 'utf8');
const envVars = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) envVars[m[1]] = m[2];
}
// 红线：本 smoke 仅授权 sap-demo（10.30.254.48）；其他系统一律拒绝执行
if (!String(envVars.SAP_URL || '').includes('10.30.254.48')) {
  console.error('红线预检失败：SAP_URL 不是 sap-demo（10.30.254.48），本 smoke 只允许在 sap-demo 上执行受控释放。');
  process.exit(1);
}
// 测试目标：既有包 Z001（与创建链 smoke 同包，探针已验证 RECORDING=X）
const DEVCLASS = 'Z001';
// 请求描述：ASCII 安全且带 smoke 标记（AS4TEXT ≤60 字符）
const REQUEST_TEXT = `AI release smoke ${new Date().toISOString().slice(0, 10)}`;
const SAP_USER = String(envVars.SAP_USER || '').trim().toUpperCase();

// —— 阶段化 elicitation 应答：每个阶段显式声明预期关键词与 decision 值 ——
// 消息不含预期关键词时一律 cancel，防止无人值守会话批准任何意外确认框。
let expectedConfirmation = { keywords: [], decision: 'cancel' };

function parse(result) {
  const text = (result.content || [])
    .filter(item => item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('');
  try {
    return JSON.parse(text);
  } catch {
    return { __unparsed: text.slice(0, 400), __isError: Boolean(result.isError) };
  }
}

function assert(condition, message, payload) {
  if (!condition) {
    throw new Error(`SMOKE FAILED: ${message}\n实际响应: ${JSON.stringify(payload || {}).slice(0, 800)}`);
  }
  process.stdout.write(`PASS ${message}\n`);
}

async function call(name, args = {}) {
  // 确认+释放+轮询读回链可能超过默认 60s；newreleasejobs 实测 ~34s（sap-demo），
  // 显式放宽到 420s 覆盖慢释放检查与写槽排队
  return parse(await client.callTool({ name, arguments: args }, undefined, { timeout: 420000 }));
}

const childEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === 'string')
);
Object.assign(childEnvironment, {
  SAP_MCP_ENV_FILE: environmentFile,
  SAP_MCP_LOG_LEVEL: 'warn',
  SAP_MCP_REAL_DEV_VALIDATION: 'false'
});

const client = new Client(
  { name: 'transport-release-real-dev-smoke', version: '1.0.0' },
  // 声明 elicitation 能力：受控释放的原生确认走 MCP 表单通道
  { capabilities: { elicitation: {} } }
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['./dist/index.js'],
  cwd: process.cwd(),
  env: childEnvironment,
  stderr: 'inherit' // server 端日志直达控制台：apply 卡因取证
});

// client 构造完成后注册阶段化确认应答（与创建链 smoke 同构）
client.setRequestHandler(ElicitRequestSchema, request => {
  const message = String(request.params?.message || '');
  const matched = expectedConfirmation.keywords.every(keyword => message.includes(keyword));
  if (!matched) {
    process.stdout.write(`WARN elicitation 未匹配预期 [${expectedConfirmation.keywords}]，已取消：${message.slice(0, 160)}\n`);
    return { action: 'cancel' };
  }
  return { action: 'accept', content: { decision: expectedConfirmation.decision } };
});

/** 只读查询当前用户在 E070 的既有请求号集合（创建前后对照，证明确系新请求）。 */
async function existingRequestNumbers() {
  const variants = [...new Set([SAP_USER, SAP_USER.replace(/^0+/, '')])].filter(Boolean);
  const result = await call('runQuery', {
    sqlQuery: `SELECT trkorr FROM e070 WHERE as4user IN (${variants.map(v => `'${v}'`).join(', ')})`
  });
  const payload = result?.result || result;
  const rows = Array.isArray(payload) ? payload
    : payload?.rows || payload?.results || payload?.values || payload?.DATA || [];
  const numbers = new Set();
  for (const row of rows) {
    const value = typeof row === 'string' ? row : row?.TRKORR || row?.trkorr;
    const normalized = String(value || '').trim().toUpperCase();
    if (/^[A-Z0-9]{3,20}$/.test(normalized)) numbers.add(normalized);
  }
  return numbers;
}

/** 直连 ADT 只读读回请求详情（独立于 MCP 链的佐证通道）。 */
async function directReadback(number) {
  const raw = new ADTClient(envVars.SAP_URL, envVars.SAP_USER, envVars.SAP_PASSWORD,
    envVars.SAP_CLIENT, envVars.SAP_LANGUAGE || 'EN', {});
  raw.stateful = 'stateless';
  await raw.h.login();
  try {
    return await transportDetails(raw.h, number);
  } finally {
    await raw.h.logout().catch(() => {});
  }
}

/** 属主比较剥前导零（真机形态：ADT 对数字型用户名返回 68157，登录名 068157）。 */
const stripZeros = value => String(value || '').trim().toUpperCase().replace(/^0+/, '');

async function main() {
  await client.connect(transport);

  // 1. 目标身份铁律：healthcheck 确认连接与 DEV 角色（不可用即停）
  const health = await call('healthcheck');
  const healthText = JSON.stringify(health);
  assert(!health.__unparsed && !health.__isError, 'healthcheck 可用', health);
  process.stdout.write(`INFO healthcheck: ${healthText.slice(0, 400)}\n`);
  assert(/"DEV"/.test(healthText) || /systemRole[^,]*DEV/.test(healthText), 'healthcheck 报告 DEV 角色', health);
  // auto 确认模式（SAP_MCP_CONFIRMATION_MODE=auto）下 apply 直接执行、无拒绝分支：
  // 部署级开关只由环境变量驱动，脚本据此裁剪确认分支场景
  const confirmationAuto = /"confirmationMode":"auto"/.test(healthText);
  process.stdout.write(`INFO confirmationMode: ${confirmationAuto ? 'auto (apply runs directly)' : 'native (elicitation form)'}\n`);

  // 2. catalog：释放三件套在 focused（workbench）目录可见；原子释放工具不在
  const tools = await client.listTools();
  const names = tools.tools.map(t => t.name);
  for (const tool of ['previewTransportRelease', 'applyTransportRelease', 'getTransportReleaseStatus']) {
    assert(names.includes(tool), `${tool} 在 focused catalog`);
  }
  assert(!names.includes('transportRelease'), '受控目录不含原子 transportRelease（红线在受控链）');
  // 依赖的创建链三件套也在（本 smoke 用它准备释放目标）
  assert(names.includes('previewTransportCreation') && names.includes('applyTransportCreation'),
    '创建链三件套在 catalog（释放目标准备用）');

  // 3. 受控创建链准备释放目标：preview → 确认接受 → apply → 新空请求
  const before = await existingRequestNumbers();
  process.stdout.write(`INFO 用户 ${SAP_USER} 既有请求数（基线）: ${before.size}\n`);
  const creationPreview = await call('previewTransportCreation', { requestText: REQUEST_TEXT, devClass: DEVCLASS });
  assert(creationPreview.status === 'preview', '创建 preview 返回 preview 状态', creationPreview);
  const creationPlanId = creationPreview.plan?.transportCreationPlanId;
  assert(Boolean(creationPlanId), '创建 preview 生成 planId', creationPreview);
  expectedConfirmation = { keywords: ['Create workbench transport request', DEVCLASS], decision: 'create_transport' };
  const creationApplied = await call('applyTransportCreation', { transportCreationPlanId: creationPlanId });
  assert(creationApplied.status === 'success', '确认后创建 apply 执行成功', creationApplied);
  const newNumber = String(creationApplied.plan?.result?.transportNumber || '').trim().toUpperCase();
  assert(/^[A-Z][A-Z0-9]{2}K[0-9]{6}$/.test(newNumber), `创建返回合法请求号 ${newNumber}`, creationApplied.plan?.result);
  assert(!before.has(newNumber), '新请求号不在创建前基线中（确系本次创建）', newNumber);

  // 4. 释放 preview：只读核验两条红线并冻结 plan（含子任务/对象透出）
  const releasePreview = await call('previewTransportRelease', { transportNumber: newNumber });
  assert(releasePreview.status === 'preview', '释放 preview 返回 preview 状态', releasePreview);
  const releasePlanId = releasePreview.plan?.transportReleasePlanId;
  assert(Boolean(releasePlanId), '释放 preview 生成 planId', releasePreview);
  assert(releasePreview.plan?.status === 'PREVIEWED', '释放 plan 状态 PREVIEWED', releasePreview.plan);
  assert(stripZeros(releasePreview.plan?.target?.owner) === stripZeros(SAP_USER),
    `红线核验：请求属主为当前用户 ${SAP_USER}`, releasePreview.plan?.target);
  assert(releasePreview.plan?.target?.requestStatus === 'D', '红线核验：请求状态 D（可修改）', releasePreview.plan?.target);
  assert(releasePreview.plan?.target?.transportNumber === newNumber, 'plan 目标请求号与创建一致', releasePreview.plan?.target);
  assert(releasePreview.confirmationRequired === true, 'preview 声明需要原生确认', releasePreview);

  // 5. 原生确认·拒绝分支：仅 native 模式存在；auto 模式 apply 直接执行（跳过）
  if (!confirmationAuto) {
    expectedConfirmation = { keywords: ['__smoke_never_matches__'], decision: 'release_transport' };
    const declined = await call('applyTransportRelease', { transportReleasePlanId: releasePlanId });
    assert(declined.status === 'confirmation_declined', '确认被拒绝时不执行释放', declined);
    const statusAfterDecline = await call('getTransportReleaseStatus', { transportReleasePlanId: releasePlanId });
    assert(statusAfterDecline.plan?.status === 'PREVIEWED', '拒绝后 plan 仍为 PREVIEWED（可再次确认）', statusAfterDecline.plan);
  } else {
    process.stdout.write('SKIP 拒绝分支（auto 确认模式下 apply 直接执行，无 elicitation）\n');
  }

  // 6. 原生确认·接受分支：关键词匹配 + decision=release_transport → 单次标准释放
  expectedConfirmation = { keywords: ['Release transport request', newNumber], decision: 'release_transport' };
  const releaseApplied = await call('applyTransportRelease', { transportReleasePlanId: releasePlanId });
  assert(releaseApplied.status === 'success', '确认后释放 apply 执行成功', releaseApplied);
  assert(releaseApplied.plan?.status === 'SUCCEEDED', '释放 plan 终态 SUCCEEDED', releaseApplied.plan);
  assert(releaseApplied.plan?.result?.kind === 'TRANSPORT_RELEASE', '结果摘要类型 TRANSPORT_RELEASE', releaseApplied.plan?.result);
  assert(releaseApplied.plan?.result?.releasedVerified === true, '轮询读回验证 releasedVerified=true', releaseApplied.plan?.result);
  assert(releaseApplied.plan?.result?.readbackStatus === 'R', `读回状态 R（实际 ${releaseApplied.plan?.result?.readbackStatus}）`, releaseApplied.plan?.result);
  // 阶段轨迹：workflow 只记 PREVIEW/EXECUTE/READBACK（CONFIRM 是审计事件层概念，
  // 与清理链 smoke 的阶段断言同款）；auto 确认模式下无 elicitation 环节。
  const stageNames = (releaseApplied.plan?.stages || []).map(stage => stage.stage);
  for (const stage of ['PREVIEW', 'EXECUTE', 'READBACK']) {
    assert(stageNames.includes(stage), `阶段轨迹含 ${stage}`, stageNames);
  }

  // 7. 重复 apply 拒绝（终态 plan 不可再次消费）
  const replay = await call('applyTransportRelease', { transportReleasePlanId: releasePlanId });
  assert(JSON.stringify(replay).includes('PLAN_ALREADY_CONSUMED'), '重复 apply 被拒绝（PLAN_ALREADY_CONSUMED）', replay);

  // 8. 独立直连读回佐证（不经 MCP 链）：请求状态已变为 R
  const direct = await directReadback(newNumber);
  assert(String(direct?.['tm:number'] || '').trim() === newNumber, `直连读回请求号一致 ${newNumber}`, direct);
  assert(String(direct?.['tm:status'] || '').trim() === 'R', '直连读回确认已释放（R）', direct);

  // 9. 已释放红线：对同一请求再 preview → 状态非 D 确定性拒绝、不建 plan
  const reRelease = await call('previewTransportRelease', { transportNumber: newNumber });
  assert(JSON.stringify(reRelease).includes("only modifiable 'D' requests can be released"),
    '已释放请求被 preview 拒绝（状态红线）', reRelease);

  // 10. 属主红线（只读）：E070 找一个未释放的他人请求 → preview 拒绝、不建 plan
  const others = await call('runQuery', {
    sqlQuery: `SELECT trkorr FROM e070 WHERE as4user NOT IN (${[SAP_USER, SAP_USER.replace(/^0+/, '')]
      .map(v => `'${v}'`).join(', ')}) AND trstatus = 'D' AND strkorr = ''`
  });
  const othersPayload = others?.result || others;
  const otherRows = Array.isArray(othersPayload) ? othersPayload
    : othersPayload?.rows || othersPayload?.results || othersPayload?.values || othersPayload?.DATA || [];
  const otherRequest = String(otherRows[0]?.TRKORR || otherRows[0]?.trkorr || '').trim().toUpperCase();
  if (/^[A-Z][A-Z0-9]{2}K[0-9]{6}$/.test(otherRequest)) {
    const otherPreview = await call('previewTransportRelease', { transportNumber: otherRequest });
    assert(JSON.stringify(otherPreview).includes(`owned by`) && JSON.stringify(otherPreview).includes('not the current user'),
      `他人请求 ${otherRequest} 被 preview 拒绝（属主红线）`, otherPreview);
  } else {
    process.stdout.write(`WARN 未找到未释放的他人请求，属主红线场景由单测覆盖（真机跳过）\n`);
  }

  // 零残留声明：释放后的请求按 SAP 语义留在系统（已释放请求不可删），
  // 属主可手工归档；本 smoke 未删除/修改任何对象，未触碰 E071/E071K。
  process.stdout.write(`RESIDUAL 1 个已释放请求 ${newNumber}（SAP 正常产物，属主手工归档）\n`);
  process.stdout.write('SMOKE OK\n');
  process.exit(0);
}

main().catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});
