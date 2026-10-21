/**
 * 受控传输请求释放链测试（TransportRelease）——受控释放边界。
 *
 * 业务背景（所有者 2026-10-21 边界调整）：释放允许受控执行；红线=状态 D
 * （可修改）+ 本人属主，两条同时满足才可释放；仅走 ADT newreleasejobs
 * 标准动作（无 ignoreLocks/IgnoreATC 绕行）；释放是后台作业，apply 后
 * 轮询只读读回，status 变 R 才算 SUCCEEDED。
 *
 * 覆盖点（全部 mock adtclient，绝不连接真实 SAP）：
 * - preview：两条红线逐条核验（非属主/非 D 状态各自确定性拒绝）、请求号
 *   格式校验、未知字段拒绝、请求不存在拒绝、属主剥零比较、子任务未释放数
 *   透出、审计失败置 FAILED；preview 阶段绝不调用 transportRelease。
 * - apply：确认后单次释放 + 轮询读回到 R（happy path，result 带
 *   releasedVerified 与释放报告摘要）；报告 abortrelapifail、轮询耗尽仍 D、
 *   释放调用异常各自 → UNKNOWN_OUTCOME 终结不重试；首轮读回瞬时异常后
 *   恢复 R 的容错路径；重复 apply、未知 plan、过期 plan 拒绝。
 * - 处理器：九工具注解、释放 apply 仅走 MCP form elicitation 原生确认
 *   （cancel/错误 decision 都不执行）、释放工作流未装配时确定性报错。
 * - profile/role 门控：释放三件套仅 DEV + development/development-workbench/
 *   focused 可见；legacy-full 原子 transportRelease 仍在专家面但不进受控目录。
 */
import { AbapAdtServer } from '../index';
import { SafeTransportCreationHandlers } from '../handlers/SafeTransportCreationHandlers';
import { SafetyPolicy } from '../safe/SafetyPolicy';
import { TransportReleasePlanStore } from '../safe/TransportReleasePlanStore';
import { TransportReleaseWorkflow } from '../safe/TransportReleaseWorkflow';
import { toolOperationClass } from '../config/ToolOperationPolicy';
import type { TransportReleasePlanView } from '../safe/transportReleaseTypes.js';

const originalEnvironment = { ...process.env };

/** 释放三件套工具名。 */
const RELEASE_TOOL_NAMES = [
  'previewTransportRelease', 'applyTransportRelease', 'getTransportReleaseStatus'
];

/** 与 ToolCatalogIntegrity 相同的服务器配置模式（仅本地构造，不连接 SAP）。 */
function configureServer(role: string, profile: string): AbapAdtServer {
  Object.assign(process.env, {
    SAP_URL: 'https://dev.example.test',
    SAP_USER: 'TEST_USER',
    SAP_PASSWORD: 'not-used',
    SAP_CLIENT: '100',
    SAP_LANGUAGE: 'EN',
    SAP_MCP_SYSTEM_ROLE: role,
    SAP_MCP_TOOL_PROFILE: profile,
    SAP_MCP_ALLOWED_HOSTS: 'dev.example.test',
    SAP_MCP_ALLOWED_CLIENTS: '100',
    SAP_MCP_ALLOWED_NAMESPACES: 'Z,Y'
  });
  return new AbapAdtServer();
}

/** transportDetails 读回样例：可按需覆写属主/状态/子任务。 */
function readbackRequest(overrides: Record<string, unknown> = {}) {
  return {
    'tm:number': 'S4HK900023',
    'tm:owner': '68157', // 真机形态：数字型用户名剥前导零
    'tm:desc': 'AI smoke transport',
    'tm:status': 'D',
    tasks: [],
    objects: [],
    ...overrides
  };
}

/** 工作流测试装配：可变时钟 + 计数器式固定 planId + 全 mock 客户端。 */
function setup(overrides: Record<string, unknown> = {}, ttlMs = 60_000) {
  const clock = { now: 1_000 };
  const policy = new SafetyPolicy({
    sapUrl: 'https://dev.example.test', sapClient: '100', sapUser: '068157', systemRole: 'DEV',
    allowedHosts: 'dev.example.test', allowedClients: '100', allowedNamespaces: 'Z',
    auditPath: 'C:\\audit', toolProfile: 'development-workbench'
  });
  const client = {
    transportDetails: jest.fn().mockResolvedValue(readbackRequest()),
    transportRelease: jest.fn().mockResolvedValue([]),
    ...overrides
  };
  const auditEvents: Record<string, unknown>[] = [];
  const audit = {
    append: jest.fn(async (event: unknown) => { auditEvents.push(event as Record<string, unknown>); })
  };
  let planCounter = 0;
  const store = new TransportReleasePlanStore(ttlMs, () => clock.now, () => `trx-${++planCounter}`);
  // sleep 注入为立即 resolve 并计数：轮询语义可测且不真实等待
  const sleeps: number[] = [];
  const workflow = new TransportReleaseWorkflow(
    client as never, policy, store, audit,
    async ms => { sleeps.push(ms); }
  );
  return { workflow, client, auditEvents, audit, store, policy, clock, sleeps };
}

/** preview 并收窄类型。 */
async function expectPreview(
  workflow: TransportReleaseWorkflow,
  input: Record<string, unknown> = { transportNumber: 'S4HK900023' }
) {
  const result = await workflow.preview(input as never);
  if (result.status !== 'preview') throw new Error(`Expected a preview plan but got ${result.status}`);
  return result;
}

/** 构造可确认的释放 plan 视图（apply 确认链的 status 端口返回值）。 */
function previewedReleasePlan(): TransportReleasePlanView {
  return {
    transportReleasePlanId: 'trx-1',
    createdAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    status: 'PREVIEWED',
    systemHost: 'dev.example.test',
    client: '100',
    sapUser: '068157',
    systemRole: 'DEV',
    toolProfile: 'development-workbench',
    target: {
      transportNumber: 'S4HK900023',
      owner: '68157',
      requestStatus: 'D',
      taskCount: 1,
      objectCount: 3,
      unreleasedTaskCount: 1
    },
    payloadHash: 'b'.repeat(64),
    stages: [],
    confirmationMode: 'elicitation'
  };
}

function setupHandlers(releaseOptionsOverrides: Record<string, unknown> = {}) {
  const creationWorkflow = {
    preview: jest.fn(),
    status: jest.fn()
  };
  const releaseWorkflow = {
    preview: jest.fn().mockResolvedValue({ status: 'preview', confirmationRequired: true, plan: previewedReleasePlan() }),
    status: jest.fn().mockReturnValue(previewedReleasePlan())
  };
  const applyReleaseConfirmed = jest.fn().mockResolvedValue({
    status: 'success',
    plan: { status: 'SUCCEEDED', result: { kind: 'TRANSPORT_RELEASE', transportNumber: 'S4HK900023', releasedVerified: true, readbackStatus: 'R' } }
  });
  const handlers = new SafeTransportCreationHandlers(
    creationWorkflow as never,
    {
      supportsFormElicitation: () => true,
      elicitInput: jest.fn().mockResolvedValue({ action: 'accept', content: { decision: 'create_transport' } }),
      applyConfirmed: jest.fn()
    },
    undefined, undefined,
    releaseWorkflow as never,
    {
      supportsFormElicitation: () => true,
      elicitInput: jest.fn().mockResolvedValue({ action: 'accept', content: { decision: 'release_transport' } }),
      applyConfirmed: applyReleaseConfirmed,
      ...releaseOptionsOverrides
    }
  );
  return { handlers, creationWorkflow, releaseWorkflow, applyReleaseConfirmed };
}

describe('TransportReleaseWorkflow', () => {
  it('previews an own modifiable request and freezes a bounded plan with task transparency', async () => {
    // 子任务一释放一未释放：未释放数必须透出（非红线），对象数累计请求本体+任务
    const { workflow, client } = setup({
      transportDetails: jest.fn().mockResolvedValue(readbackRequest({
        objects: [{ 'tm:pgmid': 'R3TR', 'tm:type': 'PROG', 'tm:name': 'ZREPORT', 'tm:dummy_uri': '', 'tm:obj_info': '' }],
        tasks: [
          { 'tm:number': 'S4HK900024', 'tm:owner': '68157', 'tm:desc': 'task', 'tm:status': 'D', 'tm:uri': '', links: [], objects: [] },
          { 'tm:number': 'S4HK900025', 'tm:owner': '68157', 'tm:desc': 'task', 'tm:status': 'R', 'tm:uri': '', links: [], objects: [] }
        ]
      }))
    });
    const result = await expectPreview(workflow);
    expect(result.confirmationRequired).toBe(true);
    expect(result.plan.status).toBe('PREVIEWED');
    expect(result.plan.target).toMatchObject({
      transportNumber: 'S4HK900023', owner: '68157', requestStatus: 'D',
      taskCount: 2, objectCount: 1, unreleasedTaskCount: 1
    });
    // preview 阶段绝不调用释放
    expect(client.transportRelease).not.toHaveBeenCalled();
  });

  it('rejects each red line with a deterministic validation failure and no plan', async () => {
    // 非本人属主：数字型用户名剥前导零后仍不一致即拒
    const otherOwner = setup({ transportDetails: jest.fn().mockResolvedValue(readbackRequest({ 'tm:owner': '9999' })) });
    await expect(otherOwner.workflow.preview({ transportNumber: 'S4HK900023' } as never))
      .rejects.toThrow(/owned by '9999'/);

    // 已释放（R）请求：状态非 D 拒绝
    const released = setup({ transportDetails: jest.fn().mockResolvedValue(readbackRequest({ 'tm:status': 'R' })) });
    await expect(released.workflow.preview({ transportNumber: 'S4HK900023' } as never))
      .rejects.toThrow(/only modifiable 'D' requests can be released/);

    // 请求不存在：读回异常拒绝
    const missing = setup({ transportDetails: jest.fn().mockRejectedValue(new Error('not found')) });
    await expect(missing.workflow.preview({ transportNumber: 'S4HK900023' } as never))
      .rejects.toThrow(/was not found/);

    // 全部拒绝场景都不建 plan（第一个计数 planId 未被消耗）
    for (const scene of [otherOwner, released, missing]) {
      expect(() => scene.store.get('trx-1')).toThrow(/not found/i);
    }
  });

  it('strips leading zeros when comparing the owner against the current user', async () => {
    // 真机形态：属主 068157 与策略用户 68157 应视为同一人
    const { workflow } = setup({
      transportDetails: jest.fn().mockResolvedValue(readbackRequest({ 'tm:owner': '068157' }))
    });
    const result = await expectPreview(workflow);
    expect(result.plan.target.owner).toBe('068157');
  });

  it('bounds and validates the transport number input and rejects unknown fields', async () => {
    const { workflow } = setup();
    // 非法请求号（第 4 位非 K）
    await expect(workflow.preview({ transportNumber: 'S4HKX00023' } as never))
      .rejects.toThrow(/10-character SAP transport request/);
    // 未知字段拒绝：强制变体（ignoreLocks）在受控面无入口
    await expect(workflow.preview({ transportNumber: 'S4HK900023', ignoreLocks: true } as never))
      .rejects.toThrow(/does not accept fields: ignoreLocks/);
  });

  it('marks the plan FAILED without touching SAP when preview audit fails', async () => {
    const { workflow, client, audit } = setup();
    audit.append.mockRejectedValueOnce(new Error('audit down'));
    await expect(workflow.preview({ transportNumber: 'S4HK900023' } as never))
      .rejects.toThrow('audit down');
    expect(client.transportRelease).not.toHaveBeenCalled();
    // plan 已置 FAILED（远端从未被调用，重放不再可用）
    expect(workflow.status('trx-1').status).toBe('FAILED');
  });

  it('releases once and verifies status R on the happy path', async () => {
    const { workflow, client, auditEvents, sleeps } = setup({
      // 读回链：preview 时 D，释放后轮询读回即 R；释放调用返回标准报告
      transportDetails: jest.fn()
        .mockResolvedValueOnce(readbackRequest())
        .mockResolvedValue(readbackRequest({ 'tm:status': 'R' })),
      transportRelease: jest.fn().mockResolvedValue([
        { 'chkrun:reporter': 'user', 'chkrun:triggeringUri': 'uri', 'chkrun:status': 'released', 'chkrun:statusText': 'ok', messages: [] }
      ])
    });
    const previewed = await expectPreview(workflow);
    const outcome = await workflow.apply(previewed.plan.transportReleasePlanId) as { status: string; plan: TransportReleasePlanView };
    expect(outcome.status).toBe('success');
    expect(outcome.plan.status).toBe('SUCCEEDED');
    expect(outcome.plan.result).toMatchObject({
      kind: 'TRANSPORT_RELEASE', transportNumber: 'S4HK900023', releasedVerified: true, readbackStatus: 'R'
    });
    expect(outcome.plan.result?.releaseReport?.status).toBe('released');
    // 单次释放调用 + 轮询读回按固定间隔
    expect(client.transportRelease).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([2000]);
    expect(auditEvents.map(e => e.eventType)).toEqual([
      'TRANSPORT_RELEASE_PREVIEW_CREATED', 'TRANSPORT_RELEASE_CONFIRMED', 'TRANSPORT_RELEASE_COMPLETED'
    ]);
    // 终态后执行载荷清除
    expect(storePayload(workflow, previewed.plan.transportReleasePlanId)).toBeUndefined();
  });

  it('tolerates a transient read-back failure before the status flips to R', async () => {
    const { workflow } = setup({
      transportDetails: jest.fn()
        .mockResolvedValueOnce(readbackRequest()) // preview：D
        .mockRejectedValueOnce(new Error('transient')) // 首轮读回瞬时异常
        .mockResolvedValue(readbackRequest({ 'tm:status': 'R' })) // 第二轮读回：R
    });
    const previewed = await expectPreview(workflow);
    const outcome = await workflow.apply(previewed.plan.transportReleasePlanId) as { status: string };
    expect(outcome.status).toBe('success');
  });

  it('terminates with UNKNOWN_OUTCOME when the release check aborts', async () => {
    const { workflow, client } = setup({
      transportRelease: jest.fn().mockResolvedValue([
        { 'chkrun:reporter': 'user', 'chkrun:triggeringUri': 'uri', 'chkrun:status': 'abortrelapifail', 'chkrun:statusText': 'check failed', messages: [] }
      ])
    });
    const previewed = await expectPreview(workflow);
    await expect(workflow.apply(previewed.plan.transportReleasePlanId)).rejects.toThrow(/rejected the request/);
    const view = workflow.status(previewed.plan.transportReleasePlanId);
    expect(view.status).toBe('UNKNOWN_OUTCOME');
    expect(view.primaryError?.stage).toBe('READBACK');
    // 报告明确拒绝后不再轮询读回（transportDetails 仅 preview 那一次）
    expect(client.transportDetails).toHaveBeenCalledTimes(1);
  });

  it('terminates with UNKNOWN_OUTCOME when read-back never flips to R', async () => {
    const { workflow, client, sleeps } = setup();
    const previewed = await expectPreview(workflow);
    await expect(workflow.apply(previewed.plan.transportReleasePlanId)).rejects.toThrow(/read-back still reports status 'D'/);
    expect(workflow.status(previewed.plan.transportReleasePlanId).status).toBe('UNKNOWN_OUTCOME');
    // 轮询恰好 5 次后保守终结，写操作只发生一次
    expect(sleeps).toHaveLength(5);
    expect(client.transportRelease).toHaveBeenCalledTimes(1);
  });

  it('terminates with UNKNOWN_OUTCOME when the release call itself fails', async () => {
    const { workflow, client } = setup({
      transportRelease: jest.fn().mockRejectedValue(new Error('timeout mid-release'))
    });
    const previewed = await expectPreview(workflow);
    await expect(workflow.apply(previewed.plan.transportReleasePlanId)).rejects.toThrow(/outcome is unknown/);
    expect(workflow.status(previewed.plan.transportReleasePlanId).status).toBe('UNKNOWN_OUTCOME');
    // 写操作异常后绝不自动重试：释放调用只发生一次
    expect(client.transportRelease).toHaveBeenCalledTimes(1);
  });

  it('rejects apply for unknown, expired, and already-consumed plans', async () => {
    const { workflow, clock } = setup();
    // 未知 plan
    await expect(workflow.apply('trx-404')).rejects.toThrow(/not found/i);
    // 过期 plan
    const previewed = await expectPreview(workflow);
    clock.now += 61_000;
    await expect(workflow.apply(previewed.plan.transportReleasePlanId)).rejects.toThrow(/expired/i);
    // 重复 apply：另一会话正常成功一次后再 apply 同一 plan
    const second = setup({
      transportDetails: jest.fn()
        .mockResolvedValueOnce(readbackRequest())
        .mockResolvedValue(readbackRequest({ 'tm:status': 'R' }))
    });
    const previewedAgain = await expectPreview(second.workflow);
    await second.workflow.apply(previewedAgain.plan.transportReleasePlanId);
    await expect(second.workflow.apply(previewedAgain.plan.transportReleasePlanId))
      .rejects.toThrow(/already succeeded/i);
  });
});

/** 读取 store 内部 plan 的载荷（终态后应为 undefined）。 */
function storePayload(workflow: TransportReleaseWorkflow, planId: string): unknown {
  const store = (workflow as unknown as { plans: { get(id: string): { payload?: unknown } } }).plans;
  return store.get(planId).payload;
}

describe('SafeTransportCreationHandlers release trio', () => {
  it('exposes creation, cleanup, and release trios with correct hints', () => {
    const { handlers } = setupHandlers();
    const tools = handlers.getTools();
    const names = tools.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining([...RELEASE_TOOL_NAMES]));
    for (const definition of tools.filter(t => RELEASE_TOOL_NAMES.includes(t.name))) {
      const isApply = definition.name === 'applyTransportRelease';
      expect(definition.annotations?.readOnlyHint).toBe(!isApply);
      expect(definition.annotations?.destructiveHint).toBe(isApply);
      expect(definition._meta?.approvalRequired).toBe(isApply);
    }
  });

  it('maps the release trio to read-only / advanced-mutation / local operation classes', () => {
    expect(toolOperationClass('previewTransportRelease')).toBe('read-only');
    expect(toolOperationClass('applyTransportRelease')).toBe('advanced-mutation');
    expect(toolOperationClass('getTransportReleaseStatus')).toBe('local');
  });

  it('runs release apply only after a native elicitation accept with the release_transport decision', async () => {
    const { handlers, applyReleaseConfirmed } = setupHandlers();
    const result = await handlers.handle('applyTransportRelease', { transportReleasePlanId: 'trx-1' });
    expect(result.status).toBe('success');
    expect(applyReleaseConfirmed).toHaveBeenCalledWith('trx-1', 'elicitation');
  });

  it('returns confirmation_declined on cancel or a wrong decision without executing', async () => {
    const cancelled = setupHandlers({ elicitInput: jest.fn().mockResolvedValue({ action: 'cancel' }) });
    expect(await cancelled.handlers.handle('applyTransportRelease', { transportReleasePlanId: 'trx-1' }))
      .toMatchObject({ status: 'confirmation_declined' });
    expect(cancelled.applyReleaseConfirmed).not.toHaveBeenCalled();

    const wrongDecision = setupHandlers({
      elicitInput: jest.fn().mockResolvedValue({ action: 'accept', content: { decision: 'delete_transport' } })
    });
    expect(await wrongDecision.handlers.handle('applyTransportRelease', { transportReleasePlanId: 'trx-1' }))
      .toMatchObject({ status: 'confirmation_declined' });
    expect(wrongDecision.applyReleaseConfirmed).not.toHaveBeenCalled();
  });

  it('rejects release when the release workflow is not configured', async () => {
    const handlers = new SafeTransportCreationHandlers(
      { preview: jest.fn(), status: jest.fn() } as never,
      {
        supportsFormElicitation: () => true,
        elicitInput: jest.fn(),
        applyConfirmed: jest.fn()
      }
    );
    await expect(handlers.handle('previewTransportRelease', { transportNumber: 'S4HK900023' }))
      .rejects.toThrow(/release workflow is not configured/i);
    await expect(handlers.handle('applyTransportRelease', { transportReleasePlanId: 'trx-1' }))
      .rejects.toThrow(/release workflow is not configured/i);
    await expect(handlers.handle('getTransportReleaseStatus', { transportReleasePlanId: 'trx-1' }))
      .rejects.toThrow(/release workflow is not configured/i);
  });
});

describe('transport release profile and role gating', () => {
  afterAll(() => {
    process.env = originalEnvironment;
  });

  it('hides and rejects the controlled release for non-DEV roles', async () => {
    const server = configureServer('QAS', 'development');
    expect((server as any).toolCatalog.map((tool: { name: string }) => tool.name))
      .toEqual(expect.not.arrayContaining(RELEASE_TOOL_NAMES));
    await expect((server as any).dispatchTool('previewTransportRelease', {}))
      .rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await expect((server as any).dispatchTool('applyTransportRelease', { transportReleasePlanId: 'forged' }))
      .rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('exposes the release trio to DEV development, development-workbench, and focused only', () => {
    for (const profile of ['development', 'development-workbench', 'focused']) {
      const names = (configureServer('DEV', profile) as any).toolCatalog.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(expect.arrayContaining([...RELEASE_TOOL_NAMES]));
    }
    for (const profile of ['safe', 'diagnostic-readonly', 'legacy-full', 'business-readonly', 'operations-readonly']) {
      const names = (configureServer('DEV', profile) as any).toolCatalog.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(expect.not.arrayContaining(RELEASE_TOOL_NAMES));
    }
  });

  it('keeps the atomic transportRelease out of controlled catalogs (red line stays with the bounded chain)', () => {
    // 原子 transportRelease 只在 legacy-full 专家面；受控目录只允许受控三件套
    for (const profile of ['development', 'development-workbench', 'focused']) {
      const names = (configureServer('DEV', profile) as any).toolCatalog.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(expect.not.arrayContaining(['transportRelease']));
      expect(names).toContain('applyTransportRelease');
    }
  });
});
