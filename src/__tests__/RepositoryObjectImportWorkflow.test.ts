import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RepositoryObjectImportWorkflow,
  type RepositoryImportAdtClient
} from '../safe/RepositoryObjectImportWorkflow';
import { SafetyPolicy } from '../safe/SafetyPolicy';
import type { AuditSink } from '../safe/AbapChangeWorkflow';
import { writeZipStoredEntries } from '../abapgit/zip-reader';

/**
 * 受控对象导入工作流单测（离线内存模型，绝不连接 SAP）——v2 双包模式。
 * 断言九类内容：
 *   1. preview 输入校验：ZIP 二选一、$ 本地包（缺省模式）/transportable 包
 *      （带传输号）互斥规则、包存在性、命名空间白名单、类型包含白名单；
 *   2. 包模式语义：local-package 仅 PROG 可导（INTF/CLAS 进 skips 带原因）；
 *      transportable 模式 CLAS/PROG 可导、INTF 仍跳过（接口池生成损坏）；
 *   3. transportable 传输校验：传输存在/未释放（assertTransportAvailable）；
 *   4. apply 本地模式：PROG 建壳→锁→写（无传输）→激活(preaudit)→readback；
 *   5. apply transportable：CLAS 建壳带 corrNr、PUT 带传输号、激活带 preaudit；
 *   6. 漂移：preview 后源码被改 → STATE_DRIFT（写未发出）；
 *   7. UNKNOWN：写请求发出后失败 → OUTCOME_UNKNOWN 终结；
 *   8. 确定性失败：激活错误 → ACTIVATION_FAILED（锁仍释放）；
 *   9. 状态机：单次消费 / 过期 / 未知 plan / 跨工作流拒绝 + 审计事件。
 */

function policy(): SafetyPolicy {
  return new SafetyPolicy({
    sapUrl: 'https://dev.example.com:44300',
    sapClient: '100',
    systemRole: 'DEV',
    allowedHosts: 'dev.example.com',
    allowedClients: '100',
    allowedNamespaces: 'Z,Y',
    auditPath: 'C:\\audit',
    toolProfile: 'development-workbench'
  });
}

/** 样例 abapGit 离线包（INTF+CLAS+PROG 三对象 + DEVC/W3MI 跳过面）。 */
function sampleZipEntries() {
  return [
    { path: 'zif_hello.intf.abap', text: 'INTERFACE ZIF_HELLO.\n  METHODS say_hello.\nENDINTERFACE.' },
    { path: 'zcl_hello.clas.abap', text: 'CLASS zcl_hello DEFINITION PUBLIC FINAL.\n  PUBLIC SECTION.\n    INTERFACES ZIF_HELLO.\nENDCLASS.\nCLASS zcl_hello IMPLEMENTATION.\nENDCLASS.' },
    { path: 'zcl_hello.clas.testclasses.abap', text: 'CLASS ltcl_hello DEFINITION FINAL FOR TESTING.\nENDCLASS.' },
    { path: 'zcl_hello.clas.xml', text: '<?xml version="1.0"?><abapGit><TPOOL><item><ID>S</ID><KEY>00</KEY><ENTRY>Hello class</ENTRY></item></TPOOL></abapGit>' },
    { path: 'zprog.prog.abap', text: "REPORT zprog.\nWRITE: 'hello'." },
    { path: 'package.devc.xml', text: '<?xml version="1.0"?><DEVC/>',
    },
    { path: 'zmime.w3mi.abap', text: 'dummy w3mi payload' }
  ];
}

/** 仅 PROG 的样例包（本地模式语义）。 */
function progOnlyZipEntries() {
  return [
    { path: 'zprog.prog.abap', text: "REPORT zprog.\nWRITE: 'hello'." },
    { path: 'package.devc.xml', text: '<?xml version="1.0"?><DEVC/>' }
  ];
}

function base64Zip(entries: ReadonlyArray<{ path: string; text: string }>): string {
  return writeZipStoredEntries(entries as Array<{ path: string; text: string }>).toString('base64');
}

interface MockObject {
  adtType: string;
  sources: Record<string, string>;
  activated: boolean;
}

type MockObjectMap = Record<string, MockObject>;

/** 内存对象模型驱动的窄客户端 mock（可注入写失败/激活失败）。 */
function clientHarness(initial: MockObjectMap = {}) {
  const objects: MockObjectMap = JSON.parse(JSON.stringify(initial));
  const calls: string[] = [];
  let activateFailureFor: string | undefined;
  let writeFailureFor: string | undefined;

  const canonicalUrl = (adtType: string, name: string): string => {
    const lower = name.toLowerCase();
    if (adtType === 'CLAS/OC') return `/sap/bc/adt/oo/classes/${lower}`;
    if (adtType === 'INTF/OI') return `/sap/bc/adt/oo/interfaces/${lower}`;
    return `/sap/bc/adt/programs/programs/${lower}`;
  };
  // ADT 真机形态：include links 返回相对 href（followUrl 语义=相对 objectUrl 追加）
  const classIncludes = (url: string): Array<Record<string, unknown>> => ([
    { 'class:includeType': 'main', links: [{ type: 'text/plain', href: 'source/main' }] },
    { 'class:includeType': 'definitions', links: [{ type: 'text/plain', href: 'includes/definitions' }] },
    { 'class:includeType': 'implementations', links: [{ type: 'text/plain', href: 'includes/implementations' }] },
    { 'class:includeType': 'testclasses', links: [{ type: 'text/plain', href: 'includes/testclasses' }] }
  ]);

  const client = {
    searchObject: jest.fn(async (query: string, objType?: string) => {
      const upper = query.toUpperCase();
      if (objType === 'DEVC/K') {
        return [{ 'adtcore:name': upper, 'adtcore:type': 'DEVC/K', 'adtcore:uri': `/sap/bc/adt/packages/${lower(upper)}` }];
      }
      return Object.entries(objects)
        .filter(([, object]) => object.adtType === objType)
        .filter(([url]) => url.toUpperCase().endsWith(`/${upper}`))
        .map(([url, object]) => ({ 'adtcore:name': upper, 'adtcore:type': object.adtType, 'adtcore:uri': url }));
    }),
    objectStructure: jest.fn(async (objectUrl: string, version?: string) => {
      const object = objects[objectUrl.replace(/\/(source\/main|includes\/\w+)$/, '')];
      if (!object) throw Object.assign(new Error('Request failed with status code 404'), { status: 404 });
      const name = decodeURIComponent(objectUrl.split('/').pop() || '').toUpperCase();
      if (object.adtType === 'CLAS/OC') {
        return {
          objectUrl,
          metaData: {
            'adtcore:name': name, 'adtcore:type': object.adtType,
            'adtcore:version': object.activated ? 'active' : 'inactive',
            // isClassStructure 以 class:visibility 判定类结构（缺失会被当简单结构解析）
            'class:visibility': 'public', 'class:final': true, 'class:abstract': false
          },
          includes: classIncludes(objectUrl)
        };
      }
      return {
        objectUrl,
        metaData: {
          'adtcore:name': name, 'adtcore:type': object.adtType,
          'adtcore:version': object.activated ? 'active' : 'inactive',
          'abapsource:sourceUri': 'source/main'
        },
        links: [{ type: 'text/plain', href: 'source/main' }]
      };
    }),
    getObjectSource: jest.fn(async (objectSourceUrl: string) => sourceText(objectSourceUrl)),
    setObjectSource: jest.fn(async (objectSourceUrl: string, source: string) => {
      if (writeFailureFor && objectSourceUrl === writeFailureFor) {
        throw new Error('write failed: session terminated');
      }
      sourceWrite(objectSourceUrl, source);
    }),
    lock: jest.fn(async () => ({ LOCK_HANDLE: `LOCK-${calls.length}` })),
    unLock: jest.fn(async () => 'unlocked'),
    activate: jest.fn(async (objectRef: { 'adtcore:objectUrl': string; 'adtcore:uri': string }) => {
      const objectUrl = objectRef['adtcore:uri'];
      const object = objects[objectUrl];
      if (!object) throw new Error('activate: object missing');
      if (activateFailureFor === objectUrl) {
        return { success: false, messages: [{ shortText: 'activation failed: E message' }] };
      }
      object.activated = true;
      return { success: true, messages: [] };
    }),
    readControlledPackage: jest.fn(async (packageName: string) => {
      // transportable 包带完整身份；$ 本地包不存 masterSystem（真机实证）
      if (packageName.startsWith('$')) return { language: 'EN', masterLanguage: 'EN', responsible: 'DEVEL' };
      return { language: 'EN', masterLanguage: 'EN', masterSystem: 'SAP', responsible: 'DEVEL' };
    }),
    transportInfo: jest.fn(async () => ({ TRANSPORTS: [{ TRKORR: 'S4DK900109' }] })),
    transportDetails: jest.fn(async () => ({ 'tm:status': 'M' })),
    createImportShell: jest.fn(async (input: { objectType: string; name: string }) => {
      const adtType = input.objectType === 'CLAS' ? 'CLAS/OC' : input.objectType === 'INTF' ? 'INTF/OI' : 'PROG/P';
      const url = canonicalUrl(adtType, input.name);
      objects[url] = { adtType, sources: {}, activated: false };
      return { location: url };
    })
  };

  // 源 URL → 所属对象（mock 内部解析；生产由 ADT 服务端路由）
  function ownerOf(objectSourceUrl: string): { object: MockObject | undefined } {
    for (const [url, object] of Object.entries(objects)) {
      if (objectSourceUrl.startsWith(`${url}/`)) return { object };
    }
    return { object: undefined };
  }
  function sourceText(objectSourceUrl: string): string {
    return ownerOf(objectSourceUrl).object?.sources[objectSourceUrl] ?? '';
  }
  function sourceWrite(objectSourceUrl: string, source: string): void {
    const owner = ownerOf(objectSourceUrl);
    if (!owner.object) throw new Error('write to unknown object');
    owner.object.sources[objectSourceUrl] = source;
  }

  return {
    client: client as unknown as RepositoryImportAdtClient,
    raw: client,
    objects,
    calls,
    injectWriteFailure: (url: string) => { writeFailureFor = url; },
    injectActivationFailure: (url: string) => { activateFailureFor = url; }
  };
}

function lower(value: string): string { return value.toLowerCase(); }

function harness(options?: { initial?: MockObjectMap; ttlMs?: number; now?: () => number }) {
  const { client, raw, objects, injectWriteFailure, injectActivationFailure } = clientHarness(options?.initial ?? {});
  const audit = { append: jest.fn().mockResolvedValue(undefined) } as unknown as AuditSink & { append: jest.Mock };
  const workflow = new RepositoryObjectImportWorkflow(
    { client, policy: policy(), audit, ...(options?.now ? { now: options.now } : {}) },
    options?.ttlMs ?? 15 * 60 * 1000
  );
  return { workflow, client: raw, objects, audit, injectWriteFailure, injectActivationFailure };
}

describe('RepositoryObjectImportWorkflow', () => {
  let tempDir: string;
  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'repo-import-')); });
  afterAll(() => { if (tempDir) rmSync(tempDir, { recursive: true, force: true }); });

  it('local-package mode: only PROG is importable, INTF/CLAS land in skips with reasons', async () => {
    const { workflow } = harness();
    const result = await workflow.preview({
      packageName: '$IMPORT',
      zipBase64: base64Zip(sampleZipEntries())
    }) as { plan: Record<string, any>; summary: string };

    expect(result.plan.status).toBe('PREVIEWED');
    expect(result.plan.mode).toBe('local-package');
    expect(result.plan.transportRequest).toBeUndefined();
    expect(result.plan.objects.map((item: Record<string, any>) => `${item.objectType}:${item.action}`)).toEqual(['PROG:create']);
    const skipTypes = result.plan.skips.map((skip: Record<string, any>) => skip.objectType);
    expect(skipTypes).toContain('DEVC');
    expect(skipTypes).toContain('W3MI');
    expect(skipTypes).toContain('INTF');
    expect(skipTypes).toContain('CLAS');
    const intfSkip = result.plan.skips.find((skip: Record<string, any>) => skip.objectType === 'INTF');
    expect(intfSkip.reason).toContain('interface-pool');
    const clasSkip = result.plan.skips.find((skip: Record<string, any>) => skip.objectType === 'CLAS');
    expect(clasSkip.reason).toContain('transportRequest');
    expect(result.plan.identity).toMatchObject({ language: 'EN', responsible: 'DEVEL' });
  });

  it('transportable mode: CLAS/PROG deployable, INTF still skipped, transport frozen', async () => {
    const { workflow, client } = harness();
    const result = await workflow.preview({
      packageName: 'Z001',
      transportRequest: 's4dk900109',
      zipBase64: base64Zip(sampleZipEntries())
    }) as { plan: Record<string, any> };

    expect(result.plan.mode).toBe('transportable');
    expect(result.plan.transportRequest).toBe('S4DK900109');
    const actions = result.plan.objects.map((item: Record<string, any>) => `${item.objectType}:${item.action}`).sort();
    expect(actions).toEqual(['CLAS:create', 'PROG:create']);
    // testclasses 部件拆出进 skips（类池生成损坏，系统修复前不写测试类）
    const clasObject = result.plan.objects.find((item: Record<string, any>) => item.objectName === 'ZCL_HELLO');
    expect(clasObject.parts.map((part: Record<string, any>) => part.part)).toEqual(['main']);
    expect(result.plan.skips.some((skip: Record<string, any>) => skip.objectName === 'ZCL_HELLO|testclasses')).toBe(true);
    const skipTypes = result.plan.skips.map((skip: Record<string, any>) => skip.objectType);
    expect(skipTypes).toContain('INTF');
    // 传输校验被调用（transportInfo + transportDetails）
    expect(client.transportInfo).toHaveBeenCalled();
    expect(client.transportDetails).toHaveBeenCalledWith('S4DK900109');
  });

  it('rejects invalid inputs: mode/package mismatch, both sources, bad base64, and out-of-scope parts', async () => {
    const { workflow } = harness();
    const zip = base64Zip(progOnlyZipEntries());
    await expect(workflow.preview({ packageName: '$IMPORT', zipBase64: zip, zipPath: 'C:\\x.zip' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(workflow.preview({ packageName: 'ZTR', zipBase64: zip }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(workflow.preview({ packageName: '$IMPORT', transportRequest: 'S4DK900109', zipBase64: zip }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(workflow.preview({ packageName: '$IMPORT', zipBase64: 'not-base64!' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(workflow.preview({ packageName: '$IMPORT', transportRequest: 'S4DK900109', zipBase64: zip }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    // 命名空间白名单：对象名必须以允许的命名空间开头
    await expect(workflow.preview({
      packageName: '$IMPORT',
      zipBase64: base64Zip([{ path: 'nv_bad.prog.abap', text: 'REPORT nv_bad.' }])
    })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('transportable mode validates the transport (released transport refused)', async () => {
    const { workflow, client } = harness();
    (client.transportDetails as jest.Mock).mockResolvedValue({ 'tm:status': 'R' });
    await expect(workflow.preview({
      packageName: 'Z001', transportRequest: 'S4DK900109', zipBase64: base64Zip(sampleZipEntries())
    })).rejects.toMatchObject({ code: 'TRANSPORT_INVALID' });
  });

  it('applies filters: typeFilter narrows the plan, nameFilter matches substrings', async () => {
    const { workflow } = harness();
    const zip = base64Zip(sampleZipEntries());
    const byType = await workflow.preview({ packageName: 'Z001', transportRequest: 'S4DK900109', zipBase64: zip, typeFilter: ['PROG'] }) as { plan: Record<string, any> };
    expect(byType.plan.objects.map((item: Record<string, any>) => item.objectName)).toEqual(['ZPROG']);
    const byName = await workflow.preview({ packageName: '$IMPORT', zipBase64: zip, nameFilter: 'zprog' }) as { plan: Record<string, any> };
    expect(byName.plan.objects.map((item: Record<string, any>) => item.objectName)).toEqual(['ZPROG']);
  });

  it('deploys local-mode PROG through the full chain and marks the plan APPLIED', async () => {
    const { workflow, client, objects } = harness();
    const preview = await workflow.preview({ packageName: '$IMPORT', zipBase64: base64Zip(progOnlyZipEntries()) }) as { plan: Record<string, any> };
    const result = await workflow.applyConfirmed(preview.plan.importPlanId) as Record<string, any>;

    expect(result.status).toBe('success');
    expect(result.plan.status).toBe('APPLIED');
    expect(result.plan.outcomes).toHaveLength(1);
    expect(result.plan.outcomes[0]).toMatchObject({ objectType: 'PROG', result: 'APPLIED' });
    expect(objects['/sap/bc/adt/programs/programs/zprog'].activated).toBe(true);
    expect(client.createImportShell).toHaveBeenCalledTimes(1);
    // 本地模式：建壳/写源不带传输号
    expect((client.createImportShell as jest.Mock).mock.calls[0][0].transport).toBe('');
    expect((client.setObjectSource as jest.Mock).mock.calls[0][3]).toBeUndefined();
    // 激活带 preauditRequested=true（受控创建链/VSP 同款）
    // typed objectReference：body 必须带 adtcore:type/parentUri（激活根因修复）
    expect(client.activate).toHaveBeenCalledWith({
      'adtcore:uri': '/sap/bc/adt/programs/programs/zprog',
      'adtcore:type': 'PROG/P',
      'adtcore:name': 'ZPROG',
      'adtcore:parentUri': '/sap/bc/adt/packages/$import'
    }, true);
    expect(client.unLock).toHaveBeenCalledTimes(1);
    // 终结后源码全文从内存剥离（parts.text 置空），hash 保留
    const after = workflow.status(preview.plan.importPlanId);
    for (const object of after.objects) {
      for (const part of object.parts) {
        expect((part as Record<string, unknown>).text).toBeUndefined();
      }
    }
  });

  it('deploys transportable CLAS with corrNr on shell creation and transport on PUT', async () => {
    const { workflow, client, objects } = harness();
    const preview = await workflow.preview({
      packageName: 'Z001', transportRequest: 'S4DK900109', zipBase64: base64Zip(sampleZipEntries())
    }) as { plan: Record<string, any> };
    const result = await workflow.applyConfirmed(preview.plan.importPlanId) as Record<string, any>;
    expect(result.status).toBe('success');
    const shellCall = (client.createImportShell as jest.Mock).mock.calls.find(call => call[0].objectType === 'CLAS')[0];
    expect(shellCall.transport).toBe('S4DK900109');
    expect(shellCall.packageName).toBe('Z001');
    const clasPut = (client.setObjectSource as jest.Mock).mock.calls.find(call => call[0].includes('zcl_hello'));
    expect(clasPut[3]).toBe('S4DK900109');
    expect(objects['/sap/bc/adt/oo/classes/zcl_hello'].activated).toBe(true);
  });

  it('deploys update objects without shell creation and baselines existing sources', async () => {
    const existing = {
      '/sap/bc/adt/programs/programs/zprog': {
        adtType: 'PROG/P', activated: true,
        sources: { '/sap/bc/adt/programs/programs/zprog/source/main': "REPORT zprog.\nWRITE: 'old'." }
      }
    };
    const { workflow, client } = harness({ initial: existing });
    const preview = await workflow.preview({ packageName: '$IMPORT', zipBase64: base64Zip(progOnlyZipEntries()) }) as { plan: Record<string, any> };
    expect(preview.plan.objects[0].action).toBe('update');
    const result = await workflow.applyConfirmed(preview.plan.importPlanId) as Record<string, any>;
    expect(result.status).toBe('success');
    expect(client.createImportShell).not.toHaveBeenCalled();
    expect((client.setObjectSource as jest.Mock).mock.calls.some(call =>
      call[0] === '/sap/bc/adt/programs/programs/zprog/source/main' && String(call[1]).includes('hello'))).toBe(true);
  });

  it('fails fast with STATE_DRIFT when an update target changed after preview (no write issued)', async () => {
    const existing = {
      '/sap/bc/adt/programs/programs/zprog': {
        adtType: 'PROG/P', activated: true,
        sources: { '/sap/bc/adt/programs/programs/zprog/source/main': "REPORT zprog.\nWRITE: 'old'." }
      }
    };
    const { workflow, objects } = harness({ initial: existing });
    const preview = await workflow.preview({ packageName: '$IMPORT', zipBase64: base64Zip(progOnlyZipEntries()) }) as { plan: Record<string, any> };
    // preview 之后目标被他人改动
    objects['/sap/bc/adt/programs/programs/zprog'].sources['/sap/bc/adt/programs/programs/zprog/source/main'] = "REPORT zprog.\nWRITE: 'someone-else'.";
    await expect(workflow.applyConfirmed(preview.plan.importPlanId)).rejects.toMatchObject({ code: 'STATE_DRIFT' });
    const view = workflow.status(preview.plan.importPlanId);
    expect(view.status).toBe('FAILED');
    expect(view.outcomes?.[0]).toMatchObject({ objectName: 'ZPROG', result: 'FAILED' });
  });

  it('terminates OUTCOME_UNKNOWN when a source write fails after being sent', async () => {
    const { workflow, injectWriteFailure, client } = harness();
    const preview = await workflow.preview({ packageName: '$IMPORT', zipBase64: base64Zip(progOnlyZipEntries()) }) as { plan: Record<string, any> };
    injectWriteFailure('/sap/bc/adt/programs/programs/zprog/source/main');
    await expect(workflow.applyConfirmed(preview.plan.importPlanId)).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    const view = workflow.status(preview.plan.importPlanId);
    expect(view.status).toBe('OUTCOME_UNKNOWN');
    expect(view.outcomes?.[0]).toMatchObject({ objectName: 'ZPROG', result: 'UNKNOWN' });
    expect(client.activate).not.toHaveBeenCalled();
  });

  it('fails deterministically on activation errors and still releases the lock', async () => {
    const { workflow, client, injectActivationFailure } = harness();
    const preview = await workflow.preview({ packageName: '$IMPORT', zipBase64: base64Zip(progOnlyZipEntries()) }) as { plan: Record<string, any> };
    injectActivationFailure('/sap/bc/adt/programs/programs/zprog');
    await expect(workflow.applyConfirmed(preview.plan.importPlanId)).rejects.toMatchObject({ code: 'ACTIVATION_FAILED' });
    const view = workflow.status(preview.plan.importPlanId);
    expect(view.status).toBe('FAILED');
    expect(view.primaryError?.message).toContain('ZPROG');
    expect(client.unLock).toHaveBeenCalledTimes(1);
  });

  it('enforces single consumption, expiry, unknown plans, and context binding', async () => {
    const { workflow } = harness();
    const preview = await workflow.preview({ packageName: '$IMPORT', zipBase64: base64Zip(progOnlyZipEntries()) }) as { plan: Record<string, any> };
    await workflow.applyConfirmed(preview.plan.importPlanId);
    await expect(workflow.applyConfirmed(preview.plan.importPlanId)).rejects.toMatchObject({ code: 'PLAN_ALREADY_CONSUMED' });
    expect(workflow.status(preview.plan.importPlanId).status).toBe('APPLIED');
    expect(() => workflow.status('no-such-plan')).toThrow(/does not exist/);

    // 过期：now 推进越过 TTL
    let clock = Date.now();
    const expiring = harness({ ttlMs: 1000, now: () => clock });
    const expiringPreview = await expiring.workflow.preview({ packageName: '$IMPORT', zipBase64: base64Zip(progOnlyZipEntries()) }) as { plan: Record<string, any> };
    clock += 2000;
    await expect(expiring.workflow.applyConfirmed(expiringPreview.plan.importPlanId)).rejects.toMatchObject({ code: 'PLAN_EXPIRED' });

    // 跨工作流（上下文一致但 plan 不在其存储）→ PLAN_NOT_FOUND
    const other = harness();
    await expect(other.workflow.applyConfirmed(preview.plan.importPlanId)).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
  });

  it('records audit events across the lifecycle', async () => {
    const { workflow, audit } = harness();
    const preview = await workflow.preview({ packageName: '$IMPORT', zipBase64: base64Zip(progOnlyZipEntries()) }) as { plan: Record<string, any> };
    await workflow.applyConfirmed(preview.plan.importPlanId);
    const eventTypes = audit.append.mock.calls.map(call => call[0].eventType);
    expect(eventTypes).toContain('REPO_IMPORT_PREVIEW_CREATED');
    expect(eventTypes).toContain('REPO_IMPORT_COMPLETED');
  });
});
