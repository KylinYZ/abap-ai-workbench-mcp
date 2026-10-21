/**
 * 受控传输请求清理链测试（TransportCleanup）——空请求边界。
 *
 * 业务背景（所有者 2026-09-29 边界调整）：空请求允许删除；红线=未释放（D）
 * + 零对象 + 本人属主，三条同时满足才可删。
 *
 * 覆盖点（全部 mock adtclient，绝不连接真实 SAP）：
 * - preview：三条红线逐条核验（非属主/已释放/非空各自确定性拒绝）、请求号
 *   格式校验、未知字段拒绝、请求不存在拒绝、属主剥零比较、审计失败置 FAILED；
 *   preview 阶段绝不调用 transportDelete。
 * - apply：确认后单次删除 + 缺席验证（读回应抛异常）；重复 apply、未知 plan、
 *   过期 plan 拒绝；删除异常/请求仍可读 → UNKNOWN_OUTCOME 终结不重试。
 * - 处理器：六工具注解、清理 apply 仅走 MCP form elicitation 原生确认
 *   （cancel/错误 decision 都不执行）、清理工作流未装配时确定性报错。
 * - profile/role 门控：六工具仅 DEV + development/development-workbench 可见；
 *   legacy legacy-full 原子 transportDelete 仍不进受控目录。
 */
import { AbapAdtServer } from '../index';
import { SafeTransportCreationHandlers } from '../handlers/SafeTransportCreationHandlers';
import { SafetyPolicy } from '../safe/SafetyPolicy';
import { TransportCleanupPlanStore } from '../safe/TransportCleanupPlanStore';
import { TransportCleanupWorkflow } from '../safe/TransportCleanupWorkflow';
import { toolOperationClass } from '../config/ToolOperationPolicy';
import type { TransportCleanupPlanView } from '../safe/transportCleanupTypes.js';

const originalEnvironment = { ...process.env };

/** 清理三件套工具名。 */
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

/** transportDetails 读回样例：可按需覆写属主/状态/对象。 */
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
    transportDelete: jest.fn().mockResolvedValue(undefined),
    ...overrides
  };
  const auditEvents: Record<string, unknown>[] = [];
  const audit = {
    append: jest.fn(async (event: unknown) => { auditEvents.push(event as Record<string, unknown>); })
  };
  let planCounter = 0;
  const store = new TransportCleanupPlanStore(ttlMs, () => clock.now, () => `tcx-${++planCounter}`);
  const workflow = new TransportCleanupWorkflow(client as never, policy, store, audit);
  return { workflow, client, auditEvents, audit, store, policy, clock };
}

/** preview 并收窄类型。 */
async function expectPreview(
  workflow: TransportCleanupWorkflow,
  input: Record<string, unknown> = { transportNumber: 'S4HK900023' }
) {
  const result = await workflow.preview(input as never);
  if (result.status !== 'preview') throw new Error(`Expected a preview plan but got ${result.status}`);
  return result;
}

/** 构造可确认的清理 plan 视图（apply 确认链的 status 端口返回值）。 */
function previewedCleanupPlan(): TransportCleanupPlanView {
  return {
    transportCleanupPlanId: 'tcx-1',
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
      objectCount: 0
    },
    payloadHash: 'b'.repeat(64),
    stages: [],
    confirmationMode: 'elicitation'
  };
}

function setupHandlers(cleanupOptionsOverrides: Record<string, unknown> = {}) {
  const creationWorkflow = {
    preview: jest.fn(),
    status: jest.fn()
  };
  const cleanupWorkflow = {
    preview: jest.fn().mockResolvedValue({ status: 'preview', confirmationRequired: true, plan: previewedCleanupPlan() }),
    status: jest.fn().mockReturnValue(previewedCleanupPlan())
  };
  const applyCleanupConfirmed = jest.fn().mockResolvedValue({
    status: 'success',
    plan: { status: 'SUCCEEDED', result: { kind: 'TRANSPORT_CLEANUP', transportNumber: 'S4HK900023', absenceVerified: true } }
  });
  const handlers = new SafeTransportCreationHandlers(
    creationWorkflow as never,
    {
      supportsFormElicitation: () => true,
      elicitInput: jest.fn().mockResolvedValue({ action: 'accept', content: { decision: 'create_transport' } }),
      applyConfirmed: jest.fn()
    },
    cleanupWorkflow as never,
    {
      supportsFormElicitation: () => true,
      elicitInput: jest.fn().mockResolvedValue({ action: 'accept', content: { decision: 'delete_transport' } }),
      applyConfirmed: applyCleanupConfirmed,
      ...cleanupOptionsOverrides
    }
  );
  return { handlers, creationWorkflow, cleanupWorkflow, applyCleanupConfirmed };
}

describe('TransportCleanupWorkflow', () => {
  it('previews an empty own unreleased request and freezes a bounded plan without deleting', async () => {
    const test = setup();
    const result = await expectPreview(test.workflow);

    expect(test.client.transportDetails).toHaveBeenCalledWith('S4HK900023');
    expect(test.client.transportDelete).not.toHaveBeenCalled();
    expect(result.plan).toMatchObject({
      status: 'PREVIEWED',
      systemHost: 'dev.example.test',
      sapUser: '068157',
      target: {
        transportNumber: 'S4HK900023',
        owner: '68157',
        requestStatus: 'D',
        taskCount: 0,
        objectCount: 0
      }
    });
    expect(test.auditEvents).toHaveLength(1);
    expect(test.auditEvents[0]).toMatchObject({ eventType: 'TRANSPORT_CLEANUP_PREVIEW_CREATED', success: true });
  });

  it('counts objects across the request body and all tasks for the empty red line', async () => {
    const test = setup({
      transportDetails: jest.fn().mockResolvedValue(readbackRequest({
        tasks: [{ 'tm:number': 'S4HK900023', objects: [{ 'tm:name': 'ZPROG' }] }]
      }))
    });
    // 子任务里有对象：非空，拒绝
    await expect(test.workflow.preview({ transportNumber: 'S4HK900023' } as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(JSON.stringify(test.auditEvents)).not.toContain('TRANSPORT_CLEANUP_PREVIEW_CREATED');
  });

  it('rejects each red line with a deterministic validation failure and no plan', async () => {
    const notOwner = setup({
      transportDetails: jest.fn().mockResolvedValue(readbackRequest({ 'tm:owner': 'OTHERUSER' }))
    });
    await expect(notOwner.workflow.preview({ transportNumber: 'S4HK900023' } as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const released = setup({
      transportDetails: jest.fn().mockResolvedValue(readbackRequest({ 'tm:status': 'R' }))
    });
    await expect(released.workflow.preview({ transportNumber: 'S4HK900023' } as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const nonEmpty = setup({
      transportDetails: jest.fn().mockResolvedValue(readbackRequest({
        objects: [{ 'tm:name': 'ZPROG' }]
      }))
    });
    await expect(nonEmpty.workflow.preview({ transportNumber: 'S4HK900023' } as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const missing = setup({
      transportDetails: jest.fn().mockRejectedValue(new Error('not found'))
    });
    await expect(missing.workflow.preview({ transportNumber: 'S4HK900023' } as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('strips leading zeros when comparing the owner against the current user', async () => {
    // 登录名 068157 与读回属主 68157 视为同一用户（真机形态差异）
    const test = setup();
    await expect(expectPreview(test.workflow)).resolves.toBeTruthy();
  });

  it('bounds and validates the transport number input and rejects unknown fields', async () => {
    const test = setup();
    await expect(test.workflow.preview({ transportNumber: 'SHORT' } as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(test.workflow.preview({ transportNumber: 'S4HK9000AB' } as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(test.workflow.preview({ transportNumber: 'S4HK900023', objectUrl: '/x' } as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('marks the plan FAILED without touching SAP when preview audit fails', async () => {
    const test = setup();
    (test.audit.append as jest.Mock).mockRejectedValueOnce(new Error('audit disk full'));
    await expect(test.workflow.preview({ transportNumber: 'S4HK900023' } as never))
      .rejects.toThrow('audit disk full');
    expect(test.workflow.status('tcx-1')).toMatchObject({ status: 'FAILED' });
    expect(test.client.transportDelete).not.toHaveBeenCalled();
  });

  it('deletes once and verifies absence on the happy path', async () => {
    const test = setup({
      // 缺席验证：第一次读回（preview 核验）成功，删除后的第二次读回抛异常（请求已不在）
      transportDetails: jest.fn()
        .mockResolvedValueOnce(readbackRequest())
        .mockRejectedValue(new Error('not found'))
    });
    await expectPreview(test.workflow);
    const result = await test.workflow.apply('tcx-1');

    expect(test.client.transportDelete).toHaveBeenCalledTimes(1);
    expect(test.client.transportDelete).toHaveBeenCalledWith('S4HK900023');
    // 缺席验证：删除后读回应抛异常（mock 第二次调用改为拒绝）
    expect(result).toMatchObject({
      status: 'success',
      plan: expect.objectContaining({
        status: 'SUCCEEDED',
        result: { kind: 'TRANSPORT_CLEANUP', transportNumber: 'S4HK900023', absenceVerified: true }
      })
    });
    // 终态后同一 plan 不可再次 apply
    await expect(test.workflow.apply('tcx-1')).rejects.toMatchObject({ code: 'PLAN_ALREADY_CONSUMED' });
    expect(test.client.transportDelete).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['delete call throws', { transportDelete: jest.fn().mockRejectedValue(new Error('connection reset')) }],
    ['request still readable after delete', {
      transportDetails: jest.fn()
        .mockResolvedValueOnce(readbackRequest())
        .mockResolvedValue(readbackRequest())
    }]
  ])('stops with UNKNOWN_OUTCOME and never retries when %s', async (_label, overrides) => {
    const test = setup(overrides as Record<string, unknown>);
    await expectPreview(test.workflow);
    await expect(test.workflow.apply('tcx-1')).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });

    const view = test.workflow.status('tcx-1');
    expect(view.status).toBe('UNKNOWN_OUTCOME');
    expect(view.primaryError).toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    await expect(test.workflow.apply('tcx-1')).rejects.toMatchObject({ code: 'PLAN_ALREADY_CONSUMED' });
    expect(test.client.transportDelete).toHaveBeenCalledTimes(1);
  });

  it('rejects apply for unknown and expired plans', async () => {
    const test = setup();
    await expect(test.workflow.apply('missing-plan')).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });

    await expectPreview(test.workflow);
    test.clock.now = 61_001;
    await expect(test.workflow.apply('tcx-1')).rejects.toMatchObject({ code: 'PLAN_EXPIRED' });
    expect(test.client.transportDelete).not.toHaveBeenCalled();
  });
});

describe('SafeTransportCreationHandlers cleanup trio', () => {
  it('exposes creation and cleanup trios with correct hints', () => {
    const { handlers } = setupHandlers();
    expect(handlers.getTools().map(tool => tool.name)).toEqual([
      'previewTransportCreation', 'applyTransportCreation', 'getTransportCreationStatus',
      ...CLEANUP_TOOL_NAMES,
      // 2026-10-21 起追加受控释放三件套（细节由 TransportRelease.test.ts 断言）
      'previewTransportRelease', 'applyTransportRelease', 'getTransportReleaseStatus'
    ]);
    const cleanupTools = handlers.getTools().filter(tool => CLEANUP_TOOL_NAMES.includes(tool.name));
    expect(cleanupTools.map(tool => tool._meta?.approvalRequired)).toEqual([false, true, false]);
  });

  it('maps the cleanup trio to read-only / advanced-mutation / local operation classes', () => {
    expect(toolOperationClass('previewTransportCleanup')).toBe('read-only');
    expect(toolOperationClass('applyTransportCleanup')).toBe('advanced-mutation');
    expect(toolOperationClass('getTransportCleanupStatus')).toBe('local');
  });

  it('runs cleanup apply only after a native elicitation accept with the delete_transport decision', async () => {
    const { handlers, applyCleanupConfirmed } = setupHandlers();
    const result = await handlers.handle('applyTransportCleanup', { transportCleanupPlanId: 'tcx-1' });
    expect(applyCleanupConfirmed).toHaveBeenCalledWith('tcx-1', 'elicitation');
    expect(result).toMatchObject({ status: 'success' });
  });

  it('returns confirmation_declined on cancel or a wrong decision without executing', async () => {
    const { applyCleanupConfirmed } = setupHandlers();
    for (const elicited of [
      { action: 'cancel' },
      { action: 'accept', content: { decision: 'create_transport' } }
    ]) {
      const declining = new SafeTransportCreationHandlers(
        { preview: jest.fn(), status: jest.fn() } as never,
        {
          supportsFormElicitation: () => true,
          elicitInput: jest.fn(),
          applyConfirmed: jest.fn()
        },
        { preview: jest.fn(), status: jest.fn().mockReturnValue(previewedCleanupPlan()) } as never,
        {
          supportsFormElicitation: () => true,
          elicitInput: jest.fn().mockResolvedValue(elicited),
          applyConfirmed: applyCleanupConfirmed
        }
      );
      const result = await declining.handle('applyTransportCleanup', { transportCleanupPlanId: 'tcx-1' });
      expect(result).toMatchObject({ status: 'confirmation_declined', transportCleanupPlanId: 'tcx-1' });
    }
    expect(applyCleanupConfirmed).not.toHaveBeenCalled();
  });

  it('rejects cleanup when the cleanup workflow is not configured', async () => {
    const handlers = new SafeTransportCreationHandlers(
      { preview: jest.fn(), status: jest.fn() } as never,
      {
        supportsFormElicitation: () => true,
        elicitInput: jest.fn(),
        applyConfirmed: jest.fn()
      }
    );
    await expect(handlers.handle('applyTransportCleanup', { transportCleanupPlanId: 'tcx-1' }))
      .rejects.toThrow('Transport cleanup workflow is not configured.');
  });
});

describe('transport cleanup profile and role gating', () => {
  afterAll(() => {
    process.env = originalEnvironment;
  });

  it.each(['QAS', 'PRD', '', 'UNKNOWN'])('hides and rejects controlled transport cleanup for role %p', async role => {
    const server = configureServer(role, 'development');
    const handlers = (server as any).safeTransportCreationHandlers;
    const handle = jest.spyOn(handlers, 'handle');

    expect((server as any).toolCatalog.map((tool: { name: string }) => tool.name))
      .toEqual(expect.not.arrayContaining(CLEANUP_TOOL_NAMES));
    await expect((server as any).dispatchTool('previewTransportCleanup', {}))
      .rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await expect((server as any).dispatchTool('applyTransportCleanup', { transportCleanupPlanId: 'forged' }))
      .rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(handle).not.toHaveBeenCalled();
  });

  it('exposes the full transport trio set to DEV development and development-workbench only', () => {
    for (const profile of ['development', 'development-workbench', 'focused']) {
      const names = (configureServer('DEV', profile) as any).toolCatalog.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(expect.arrayContaining([...CLEANUP_TOOL_NAMES]));
    }
    for (const profile of ['safe', 'diagnostic-readonly', 'legacy-full', 'business-readonly', 'operations-readonly']) {
      const names = (configureServer('DEV', profile) as any).toolCatalog.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(expect.not.arrayContaining(CLEANUP_TOOL_NAMES));
    }
  });

  it('keeps the atomic transportDelete out of controlled catalogs (red line stays with the bounded chain)', () => {
    // 原子 transportDelete 依旧不进受控目录：删除只能走带红线核验的受控清理链
    for (const profile of ['development', 'development-workbench', 'focused']) {
      const names = (configureServer('DEV', profile) as any).toolCatalog.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(expect.not.arrayContaining(['transportDelete', 'transportRelease']));
    }
  });
});
