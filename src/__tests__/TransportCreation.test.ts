/**
 * 受控传输请求创建链测试（TransportCreation）。
 *
 * 覆盖点（全部 mock adtclient，绝不连接真实 SAP）：
 * - preview：只读 CTS 预检（transportInfo）→ 冻结 immutable plan（锚点 URI 由
 *   server 从包名推导）；输入校验（请求描述长度、本地包拒绝、命名空间包、
 *   传输层）、未知字段拒绝、预检失败不创建 plan、审计失败置 FAILED；
 *   preview 阶段绝不调用 createTransport。
 * - apply：原生确认后精确调用创建一次并读回验证（create/readback 双步）；
 *   重复 apply、未知 plan、过期 plan、跨上下文 plan 拒绝；创建异常/空请求号/
 *   读回失败/请求号不一致一律置 UNKNOWN_OUTCOME 并停止，绝不重试。
 * - 处理器：三工具注解、apply 仅走 MCP form elicitation 原生确认
 *   （cancel/错误 decision 都不执行）、无确认能力直接拒绝。
 * - profile/role 门控（configureServer 模式，本地构造）：仅 DEV +
 *   development/development-workbench 可见；QAS/PRD/缺失/未知角色隐藏且
 *   dispatch 拒绝；legacy-full 即使 DEV 也拒绝；business/diagnostic/safe/
 *   operations 不收录。
 * - 仅创建边界：释放/删除/改属主工具绝不出现在受控 profile 的 catalog 中。
 */
import { AbapAdtServer } from '../index';
import { SafeTransportCreationHandlers } from '../handlers/SafeTransportCreationHandlers';
import { SafetyPolicy } from '../safe/SafetyPolicy';
import { TransportCreationPlanStore } from '../safe/TransportCreationPlanStore';
import { TransportCreationWorkflow } from '../safe/TransportCreationWorkflow';
import { toolOperationClass } from '../config/ToolOperationPolicy';
import type { TransportCreationPlanView } from '../safe/transportCreationTypes.js';

const originalEnvironment = { ...process.env };

/** 受控传输创建三工具名。 */
const TRANSPORT_CREATION_TOOL_NAMES = [
  'previewTransportCreation', 'applyTransportCreation', 'getTransportCreationStatus'
];

/** 受控传输清理三工具名（空请求边界，同 handlers 类暴露）。 */
const CLEANUP_TOOL_NAMES = [
  'previewTransportCleanup', 'applyTransportCleanup', 'getTransportCleanupStatus'
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

/** transportDetails 读回的成功样例（请求号/属主/状态与创建预期一致）。 */
function readbackRequest(number = 'S4HK900111') {
  return {
    'tm:number': number,
    'tm:owner': 'DEVUSER',
    'tm:desc': 'AI 创建的请求',
    'tm:status': 'D',
    tasks: []
  };
}

/** 工作流测试装配：可变时钟 + 计数器式固定 planId + 全 mock 客户端。 */
function setup(overrides: Record<string, unknown> = {}, ttlMs = 60_000) {
  const clock = { now: 1_000 };
  const policy = new SafetyPolicy({
    sapUrl: 'https://dev.example.test', sapClient: '100', sapUser: 'DEVUSER', systemRole: 'DEV',
    allowedHosts: 'dev.example.test', allowedClients: '100', allowedNamespaces: 'Z',
    auditPath: 'C:\\audit', toolProfile: 'development-workbench'
  });
  const client = {
    transportInfo: jest.fn().mockResolvedValue({}),
    createTransport: jest.fn().mockResolvedValue('S4HK900111'),
    transportDetails: jest.fn().mockResolvedValue(readbackRequest()),
    ...overrides
  };
  const auditEvents: Record<string, unknown>[] = [];
  const audit = {
    append: jest.fn(async (event: unknown) => { auditEvents.push(event as Record<string, unknown>); })
  };
  let planCounter = 0;
  const store = new TransportCreationPlanStore(ttlMs, () => clock.now, () => `tc-${++planCounter}`);
  const workflow = new TransportCreationWorkflow(client as never, policy, store, audit);
  return { workflow, client, auditEvents, audit, store, policy, clock };
}

/**
 * preview 并收窄类型：只有 status='preview' 才返回 plan 视图，
 * 校验类失败由专门用例断言。
 */
async function expectPreview(
  workflow: TransportCreationWorkflow,
  input: Record<string, unknown> = { requestText: 'AI 创建的请求', devClass: 'ZPKG' }
) {
  const result = await workflow.preview(input as never);
  if (result.status !== 'preview') throw new Error(`Expected a preview plan but got ${result.status}`);
  return result;
}

/** 构造可确认的 plan 视图（apply 确认链的 status 端口返回值）。 */
function previewedPlan(): TransportCreationPlanView {
  return {
    transportCreationPlanId: 'tc-1',
    createdAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    status: 'PREVIEWED',
    systemHost: 'dev.example.test',
    client: '100',
    sapUser: 'DEVUSER',
    systemRole: 'DEV',
    toolProfile: 'development-workbench',
    target: { devClass: 'ZPKG', requestText: 'AI 创建的请求', anchorUri: '/sap/bc/adt/packages/zpkg' },
    payloadHash: 'a'.repeat(64),
    stages: [],
    confirmationMode: 'elicitation'
  };
}

function setupHandlers(overrides: Record<string, unknown> = {}) {
  const workflow = {
    preview: jest.fn().mockResolvedValue({ status: 'preview', confirmationRequired: true, plan: previewedPlan() }),
    status: jest.fn().mockReturnValue(previewedPlan()),
    ...overrides
  };
  const applyConfirmed = jest.fn().mockResolvedValue({ status: 'success', plan: { status: 'SUCCEEDED' } });
  const handlers = new SafeTransportCreationHandlers(workflow as never, {
    supportsFormElicitation: () => true,
    elicitInput: jest.fn().mockResolvedValue({ action: 'accept', content: { decision: 'create_transport' } }),
    applyConfirmed
  });
  return { handlers, workflow, applyConfirmed };
}

describe('TransportCreationWorkflow', () => {
  it('previews via a read-only CTS preflight and freezes a plan without creating anything', async () => {
    const test = setup();
    const result = await expectPreview(test.workflow);

    // 预检使用 server 推导的包锚点 URI，只读 transportInfo，绝不调用创建
    expect(test.client.transportInfo).toHaveBeenCalledWith('/sap/bc/adt/packages/zpkg', 'ZPKG', 'I');
    expect(test.client.createTransport).not.toHaveBeenCalled();
    expect(result.plan).toMatchObject({
      status: 'PREVIEWED',
      systemHost: 'dev.example.test',
      sapUser: 'DEVUSER',
      target: { devClass: 'ZPKG', requestText: 'AI 创建的请求', anchorUri: '/sap/bc/adt/packages/zpkg' }
    });
    // confirmationMode 只在进入执行态（beginRun）时记录，PREVIEWED 阶段为空
    expect(result.plan.confirmationMode).toBeUndefined();
    expect(result.confirmationRequired).toBe(true);
    // 审计记录 preview 事件且不含锚点 URI 明文
    expect(test.auditEvents).toHaveLength(1);
    expect(test.auditEvents[0]).toMatchObject({ eventType: 'TRANSPORT_CREATION_PREVIEW_CREATED', success: true });
    expect(JSON.stringify(test.auditEvents[0])).not.toContain('/sap/bc/adt/packages');
  });

  it('freezes the optional transport layer into the plan target', async () => {
    const test = setup();
    const result = await expectPreview(test.workflow, {
      requestText: 'AI 创建的请求', devClass: 'ZPKG', transportLayer: 'zdev'
    });
    expect(result.plan.target).toMatchObject({ devClass: 'ZPKG', transportLayer: 'ZDEV' });
  });

  it('accepts namespace packages and rejects local or malformed package names', async () => {
    const test = setup();
    // 命名空间包合法
    await expectPreview(test.workflow, { requestText: 'ok', devClass: '/foo/bar' });
    // 本地包（$ 开头）不能锚定可传输请求
    await expect(test.workflow.preview({ requestText: 'ok', devClass: '$TMP' } as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // 非法字符与空值
    await expect(test.workflow.preview({ requestText: 'ok', devClass: 'Z PKG!' } as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(test.workflow.preview({ requestText: 'ok' } as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(test.client.createTransport).not.toHaveBeenCalled();
  });

  it('bounds requestText and transportLayer inputs and rejects unknown fields', async () => {
    const test = setup();
    await expect(test.workflow.preview({ requestText: '', devClass: 'ZPKG' } as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(test.workflow.preview({ requestText: 'x'.repeat(61), devClass: 'ZPKG' } as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(test.workflow.preview({
      requestText: 'ok', devClass: 'ZPKG', transportLayer: 'LAYER-WITH-SPACE'
    } as never)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(test.workflow.preview({
      requestText: 'ok', devClass: 'ZPKG', objectUrl: '/sap/bc/adt/oo/classes/zcl_x'
    } as never)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('fails preview without creating a plan when the CTS preflight rejects the package', async () => {
    const test = setup({
      transportInfo: jest.fn().mockRejectedValue(new Error('Package ZPKG does not exist'))
    });
    await expect(test.workflow.preview({ requestText: 'ok', devClass: 'ZPKG' } as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // 预检失败：不冻结 plan、不写审计，绝不进入创建路径
    expect(test.auditEvents).toHaveLength(0);
    expect(test.client.createTransport).not.toHaveBeenCalled();
  });

  it('marks the plan FAILED without touching SAP when preview audit fails', async () => {
    const test = setup();
    (test.audit.append as jest.Mock).mockRejectedValueOnce(new Error('audit disk full'));
    await expect(test.workflow.preview({ requestText: 'ok', devClass: 'ZPKG' } as never))
      .rejects.toThrow('audit disk full');
    expect(test.workflow.status('tc-1')).toMatchObject({ status: 'FAILED' });
    expect(test.client.createTransport).not.toHaveBeenCalled();
  });

  it('creates once and verifies via read-back on the happy path', async () => {
    const test = setup();
    await expectPreview(test.workflow);
    const result = await test.workflow.apply('tc-1');

    // 精确按冻结载荷调用一次创建；随后读回验证请求号
    expect(test.client.createTransport).toHaveBeenCalledTimes(1);
    expect(test.client.createTransport).toHaveBeenCalledWith(
      '/sap/bc/adt/packages/zpkg', 'AI 创建的请求', 'ZPKG', undefined
    );
    expect(test.client.transportDetails).toHaveBeenCalledWith('S4HK900111');
    expect(result).toMatchObject({
      status: 'success',
      plan: expect.objectContaining({
        status: 'SUCCEEDED',
        result: {
          kind: 'TRANSPORT_CREATION',
          transportNumber: 'S4HK900111',
          owner: 'DEVUSER',
          description: 'AI 创建的请求',
          status: 'D',
          taskCount: 0
        }
      })
    });
    // 终态后同一 plan 不可再次 apply
    await expect(test.workflow.apply('tc-1')).rejects.toMatchObject({ code: 'PLAN_ALREADY_CONSUMED' });
    expect(test.client.createTransport).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['create call throws', { createTransport: jest.fn().mockRejectedValue(new Error('connection reset')) }],
    ['create returns empty', { createTransport: jest.fn().mockResolvedValue('') }],
    ['read-back throws', { transportDetails: jest.fn().mockRejectedValue(new Error('timeout')) }],
    ['read-back number mismatches', { transportDetails: jest.fn().mockResolvedValue(readbackRequest('S4HK999999')) }]
  ])('stops with UNKNOWN_OUTCOME and never retries when %s', async (_label, overrides) => {
    const test = setup(overrides as Record<string, unknown>);
    await expectPreview(test.workflow);
    await expect(test.workflow.apply('tc-1')).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });

    const view = test.workflow.status('tc-1');
    expect(view.status).toBe('UNKNOWN_OUTCOME');
    expect(view.primaryError).toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    // 未知结果绝不重放：plan 已终结，再次 apply 直接拒绝且不再触碰创建端点
    await expect(test.workflow.apply('tc-1')).rejects.toMatchObject({ code: 'PLAN_ALREADY_CONSUMED' });
    expect(test.client.createTransport).toHaveBeenCalledTimes(1);
  });

  it('rejects apply for unknown, expired, and cross-context plans', async () => {
    const test = setup();
    await expect(test.workflow.apply('missing-plan')).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });

    await expectPreview(test.workflow);
    // TTL 过期：plan 置 EXPIRED，apply 必须重新 preview
    test.clock.now = 61_001;
    await expect(test.workflow.apply('tc-1')).rejects.toMatchObject({ code: 'PLAN_EXPIRED' });

    // 跨上下文：DEVUSER 冻结的 plan，不能被同 store 下 OTHERUSER 的工作流消费
    const otherPolicy = new SafetyPolicy({
      sapUrl: 'https://dev.example.test', sapClient: '100', sapUser: 'OTHERUSER', systemRole: 'DEV',
      allowedHosts: 'dev.example.test', allowedClients: '100', allowedNamespaces: 'Z',
      auditPath: 'C:\\audit', toolProfile: 'development-workbench'
    });
    const otherWorkflow = new TransportCreationWorkflow(
      test.client as never, otherPolicy, test.store, test.audit as never
    );
    test.clock.now = 1_500;
    await expectPreview(test.workflow);
    test.clock.now = 2_000;
    await expect(otherWorkflow.apply('tc-2')).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(test.client.createTransport).not.toHaveBeenCalled();
  });
});

describe('SafeTransportCreationHandlers', () => {
  it('exposes the creation trio (plus the cleanup trio) with correct hints', () => {
    const { handlers } = setupHandlers();
    // 创建三件套在前（清理三件套的注解细节由 TransportCleanup.test.ts 断言）
    expect(handlers.getTools().map(tool => tool.name).slice(0, 3)).toEqual(TRANSPORT_CREATION_TOOL_NAMES);
    expect(handlers.getTools()).toEqual([
      expect.objectContaining({ name: 'previewTransportCreation', annotations: expect.objectContaining({ readOnlyHint: true }) }),
      expect.objectContaining({
        name: 'applyTransportCreation',
        annotations: expect.objectContaining({ readOnlyHint: false }),
        _meta: expect.objectContaining({ approvalRequired: true })
      }),
      expect.objectContaining({ name: 'getTransportCreationStatus', annotations: expect.objectContaining({ readOnlyHint: true }) }),
      ...CLEANUP_TOOL_NAMES.map(name => expect.objectContaining({ name })),
      // 2026-10-21 起追加受控释放三件套（细节由 TransportRelease.test.ts 断言）
      ...['previewTransportRelease', 'applyTransportRelease', 'getTransportReleaseStatus']
        .map(name => expect.objectContaining({ name }))
    ]);
    expect(handlers.supports('previewTransportCreation')).toBe(true);
    expect(handlers.supports('previewTransportCleanup')).toBe(true);
    expect(handlers.supports('createTransport')).toBe(false);
    expect(handlers.supports('transportDelete')).toBe(false);
  });

  it('maps the trio to read-only / advanced-mutation / local operation classes', () => {
    expect(toolOperationClass('previewTransportCreation')).toBe('read-only');
    expect(toolOperationClass('applyTransportCreation')).toBe('advanced-mutation');
    expect(toolOperationClass('getTransportCreationStatus')).toBe('local');
  });

  it('dispatches preview and status without executing any creation', async () => {
    const { handlers, workflow, applyConfirmed } = setupHandlers();

    await handlers.handle('previewTransportCreation', { requestText: 'ok', devClass: 'ZPKG' });
    await handlers.handle('getTransportCreationStatus', { transportCreationPlanId: 'tc-1' });

    expect(workflow.preview).toHaveBeenCalledWith({ requestText: 'ok', devClass: 'ZPKG' });
    expect(workflow.status).toHaveBeenCalledWith('tc-1');
    expect(applyConfirmed).not.toHaveBeenCalled();
  });

  it('runs apply only after a native elicitation accept with the create_transport decision', async () => {
    const { handlers, applyConfirmed } = setupHandlers();

    const result = await handlers.handle('applyTransportCreation', { transportCreationPlanId: 'tc-1' });

    expect(applyConfirmed).toHaveBeenCalledWith('tc-1', 'elicitation');
    expect(result).toMatchObject({ status: 'success' });
  });

  it('returns confirmation_declined when the client cancels or picks a wrong decision', async () => {
    const { applyConfirmed } = setupHandlers();
    for (const elicited of [
      { action: 'cancel' },
      { action: 'accept', content: { decision: 'activate' } }
    ]) {
      const declining = new SafeTransportCreationHandlers(
        { preview: jest.fn(), status: jest.fn().mockReturnValue(previewedPlan()) } as never,
        {
          supportsFormElicitation: () => true,
          elicitInput: jest.fn().mockResolvedValue(elicited),
          applyConfirmed
        }
      );
      const result = await declining.handle('applyTransportCreation', { transportCreationPlanId: 'tc-1' });
      expect(result).toMatchObject({ status: 'confirmation_declined', transportCreationPlanId: 'tc-1' });
    }
    expect(applyConfirmed).not.toHaveBeenCalled();
  });

  it('rejects apply entirely when the client cannot do form elicitation', async () => {
    const handlers = new SafeTransportCreationHandlers(
      { preview: jest.fn(), status: jest.fn().mockReturnValue(previewedPlan()) } as never,
      {
        supportsFormElicitation: () => false,
        elicitInput: jest.fn(),
        applyConfirmed: jest.fn()
      }
    );

    await expect(handlers.handle('applyTransportCreation', { transportCreationPlanId: 'tc-1' }))
      .rejects.toMatchObject({ code: 'CONFIRMATION_UNSUPPORTED' });
  });

  it('refuses confirmation for an expired plan', async () => {
    const expired = { ...previewedPlan(), status: 'EXPIRED' as const };
    const handlers = new SafeTransportCreationHandlers(
      { preview: jest.fn(), status: jest.fn().mockReturnValue(expired) } as never,
      {
        supportsFormElicitation: () => true,
        elicitInput: jest.fn(),
        applyConfirmed: jest.fn()
      }
    );

    await expect(handlers.handle('applyTransportCreation', { transportCreationPlanId: 'tc-1' }))
      .rejects.toMatchObject({ code: 'PLAN_EXPIRED' });
  });
});

describe('transport creation profile and role gating', () => {
  afterAll(() => {
    process.env = originalEnvironment;
  });

  it.each(['QAS', 'PRD', '', 'UNKNOWN'])('hides and rejects controlled transport creation for role %p', async role => {
    const server = configureServer(role, 'development-workbench');
    const handlers = (server as any).safeTransportCreationHandlers;
    const handle = jest.spyOn(handlers, 'handle');

    // 三工具全部从 catalog 隐藏
    expect((server as any).toolCatalog.map((tool: { name: string }) => tool.name))
      .toEqual(expect.not.arrayContaining(TRANSPORT_CREATION_TOOL_NAMES));
    // preview（read-only 语义）同样被拒：创建链在非 DEV 角色整体不可用
    await expect((server as any).dispatchTool('previewTransportCreation', {}))
      .rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await expect((server as any).dispatchTool('applyTransportCreation', { transportCreationPlanId: 'forged-plan' }))
      .rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(handle).not.toHaveBeenCalled();
  });

  it('exposes controlled transport creation to DEV development and development-workbench only', () => {
    for (const profile of ['development', 'development-workbench', 'focused']) {
      const names = (configureServer('DEV', profile) as any).toolCatalog.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(expect.arrayContaining(TRANSPORT_CREATION_TOOL_NAMES));
    }
    for (const profile of ['safe', 'diagnostic-readonly', 'legacy-full', 'business-readonly', 'operations-readonly']) {
      const names = (configureServer('DEV', profile) as any).toolCatalog.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(expect.not.arrayContaining(TRANSPORT_CREATION_TOOL_NAMES));
    }
  });

  it('rejects controlled transport creation in DEV legacy-full despite the atomic createTransport tool', async () => {
    const server = configureServer('DEV', 'legacy-full');
    const handlers = (server as any).safeTransportCreationHandlers;
    const handle = jest.spyOn(handlers, 'handle');

    // 专家 profile 不进入受控创建链：catalog 不含且 dispatch 拒绝（专家继续用原子 createTransport）
    expect((server as any).toolCatalog.map((tool: { name: string }) => tool.name))
      .toEqual(expect.not.arrayContaining(TRANSPORT_CREATION_TOOL_NAMES));
    await expect((server as any).dispatchTool('applyTransportCreation', { transportCreationPlanId: 'forged-plan' }))
      .rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(handle).not.toHaveBeenCalled();
  });

  it('keeps release, delete, and owner-mutation transport tools out of the controlled catalogs', () => {
    // 仅创建边界：这些动作在任何受控 profile 都不可见，也永不进入本链路
    const forbidden = ['transportRelease', 'transportDelete', 'transportSetOwner', 'transportAddUser'];
    for (const profile of ['development', 'development-workbench', 'focused']) {
      const names = (configureServer('DEV', profile) as any).toolCatalog.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(expect.not.arrayContaining(forbidden));
    }
  });
});
