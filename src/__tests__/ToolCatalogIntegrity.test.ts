import { AbapAdtServer } from '../index';
import {
  CONTROLLED_ADVANCED_MUTATION_TOOL_NAMES,
  RAW_ADVANCED_MUTATION_TOOL_NAMES,
  toolOperationClass
} from '../config/ToolOperationPolicy';

const originalEnvironment = { ...process.env };

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

describe('tool catalog integrity and raw advanced role policy', () => {
  afterAll(() => {
    process.env = originalEnvironment;
  });

  it.each([
    ['safe', 7],
    // development 208：205 + 受控导入三件套（deploy-zip/fileio.import-export）
    ['development', 208],
    // diagnostic-readonly 150：只读诊断入口（不含受控导入写链）
    ['diagnostic-readonly', 150],
    // legacy-full 220：专家完整面（不含受控导入链——同克隆/重命名链不进 legacy）
    ['legacy-full', 220],
    // development-workbench 185：182 + 受控导入三件套（workbench 显式名单）
    ['development-workbench', 185],
    ['business-readonly', 18],
    // operations-readonly 58：运维只读面（不含受控导入写链）
    ['operations-readonly', 58]
  ])('locks the DEV %s catalog at %i unique tools', (profile, expected) => {
    const server = configureServer('DEV', profile);
    const catalog = (server as any).toolCatalog as Array<{ name: string }>;
    expect(catalog).toHaveLength(expected);
    expect(new Set(catalog.map(tool => tool.name))).toHaveProperty('size', expected);
  });

  it('maps the developer-first focused entry point to the workbench catalog', () => {
    const focused = configureServer('DEV', 'focused');
    const workbench = configureServer('DEV', 'development-workbench');
    expect((focused as any).toolCatalog.map((tool: { name: string }) => tool.name))
      .toEqual((workbench as any).toolCatalog.map((tool: { name: string }) => tool.name));
  });

  it.each([
    'safe', 'development', 'diagnostic-readonly', 'legacy-full',
    'development-workbench', 'business-readonly', 'operations-readonly'
  ])('publishes complete runtime safety metadata for DEV %s', profile => {
    const catalog = (configureServer('DEV', profile) as any).toolCatalog as Array<Record<string, any>>;
    for (const tool of catalog) {
      expect(tool.annotations).toEqual(expect.objectContaining({
        readOnlyHint: expect.any(Boolean),
        destructiveHint: expect.any(Boolean),
        idempotentHint: expect.any(Boolean),
        openWorldHint: expect.any(Boolean)
      }));
      expect(tool._meta).toEqual(expect.objectContaining({
        operationClass: expect.stringMatching(/^(local-only|read-only tenant|mutating tenant)$/),
        approvalRequired: expect.any(Boolean)
      }));
      expect(tool.annotations.readOnlyHint).toBe(tool._meta.operationClass !== 'mutating tenant');
      if (tool._meta.operationClass === 'local-only') expect(tool.annotations.openWorldHint).toBe(false);
    }
  });

  it('exposes high-level reads in compatible non-safe profiles only', () => {
    const expected = ['readRuntimeDumps', 'describeClassicTable', 'inspectSapSystem', 'getAbapMemberSource'];
    expect((configureServer('DEV', 'safe') as any).toolCatalog.map((tool: { name: string }) => tool.name))
      .toEqual(expect.not.arrayContaining(expected));
    for (const profile of ['development', 'diagnostic-readonly', 'legacy-full']) {
      const names = (configureServer('DEV', profile) as any).toolCatalog.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(expect.arrayContaining(expected));
    }
    expect((configureServer('DEV', 'development-workbench') as any).toolCatalog.map((tool: { name: string }) => tool.name))
      .toEqual(expect.arrayContaining(expected));
    expect((configureServer('DEV', 'business-readonly') as any).toolCatalog.map((tool: { name: string }) => tool.name))
      .toEqual(expect.arrayContaining(['inspectSapSystem', 'describeClassicTable']));
    expect((configureServer('DEV', 'operations-readonly') as any).toolCatalog.map((tool: { name: string }) => tool.name))
      .toEqual(expect.arrayContaining(['inspectSapSystem', 'readRuntimeDumps']));
  });

  it.each(['DEV', 'QAS', 'PRD', '', 'UNKNOWN'])('dispatches offline graph analysis without SAP for role %p', async role => {
    for (const profile of ['development', 'development-workbench', 'diagnostic-readonly', 'operations-readonly', 'legacy-full']) {
      const server = configureServer(role, profile);
      const client = (server as any).adtClient;
      const query = jest.spyOn(client, 'runQuery').mockRejectedValue(new Error('SAP calls forbidden'));
      const response = await (server as any).dispatchTool('analyzeDependencyGraph', {
        operation: 'stats', graph: { nodes: [], edges: [] }
      });
      expect(response.structuredContent.result).toMatchObject({
        scope: 'caller-supplied-snapshot', sapConnectionVerified: false, analysis: { nodeCount: 0 }
      });
      const boundaries = await (server as any).dispatchTool('analyzeDependencyGraph', {
        operation: 'boundaries', graph: { nodes: [{ id: 'CLAS:ZROOT', name: 'ZROOT', type: 'CLAS' }], edges: [] },
        boundaryScope: { label: 'CR-OFFLINE', objectIds: ['CLAS:ZROOT'] }
      });
      expect(boundaries.structuredContent.result.analysis).toMatchObject({ objectCount: 1, transportMembershipVerified: false });
      expect(query).not.toHaveBeenCalled();
    }
  });

  it.each(['safe', 'business-readonly'])('hides and rejects offline graph analysis in %s', async profile => {
    const server = configureServer('DEV', profile);
    expect((server as any).toolCatalog.map((tool: { name: string }) => tool.name)).not.toContain('analyzeDependencyGraph');
    const handle = jest.spyOn((server as any).dependencyGraphHandlers, 'handle');
    await expect((server as any).dispatchTool('analyzeDependencyGraph', {
      operation: 'stats', graph: { nodes: [], edges: [] }
    })).rejects.toMatchObject({ code: -32601 });
    expect(handle).not.toHaveBeenCalled();
  });

  it.each(['DEV', 'QAS', 'PRD', '', 'UNKNOWN'])('exposes serial load graph reads for role %p without enabling writes', async role => {
    for (const profile of ['development', 'development-workbench', 'diagnostic-readonly', 'operations-readonly', 'legacy-full']) {
      const server = configureServer(role, profile);
      const get = jest.spyOn((server as any).loadGraphHandlers.loadGraph, 'getLoadGraph').mockResolvedValue({
        objectName: 'ZTEST', direction: 'loaded_by', loads: [], loadedBy: [], notes: [],
        collection: { loaded_by: { status: 'ok', rowCount: 0, rowLimit: 2000 } }
      });
      const result = await (server as any).dispatchTool('buildLoadDependencyGraph', { objectType: 'CLAS', objectName: 'ZTEST' });
      expect(result.structuredContent.result.collection.queryCount).toBe(1);
      expect(get).toHaveBeenCalledTimes(1);
      expect(toolOperationClass('buildLoadDependencyGraph')).toBe('read-only');
    }
  });

  it.each(['safe', 'business-readonly'])('hides and rejects load graph builder in %s before reads', async profile => {
    const server = configureServer('DEV', profile);
    const get = jest.spyOn((server as any).loadGraphHandlers.loadGraph, 'getLoadGraph');
    expect((server as any).toolCatalog.map((tool: { name: string }) => tool.name)).not.toContain('buildLoadDependencyGraph');
    await expect((server as any).dispatchTool('buildLoadDependencyGraph', {
      objectType: 'CLAS', objectName: 'ZTEST'
    })).rejects.toMatchObject({ code: -32601 });
    expect(get).not.toHaveBeenCalled();
  });

  it.each(['DEV', 'QAS', 'PRD', '', 'UNKNOWN'])('dispatches transport scope as read-only for role %p', async role => {
    for (const profile of ['development', 'development-workbench', 'diagnostic-readonly', 'operations-readonly', 'legacy-full']) {
      const server = configureServer(role, profile);
      const query = jest.fn().mockResolvedValue({ values: [] });
      (server as any).transportScopeHandlers.runQuery = query;
      const result = await (server as any).dispatchTool('getTransportScope', { transports: ['DEVK900001'] });
      expect(result.structuredContent.result.collection.status).toBe('partial');
      expect(query).toHaveBeenCalledTimes(1);
      expect(toolOperationClass('getTransportScope')).toBe('read-only');
    }
  });

  it.each(['safe', 'business-readonly'])('hides and rejects transport scope in %s before I/O', async profile => {
    const server = configureServer('DEV', profile);
    const handler = jest.spyOn((server as any).transportScopeHandlers, 'handle');
    expect((server as any).toolCatalog.map((tool: { name: string }) => tool.name)).not.toContain('getTransportScope');
    await expect((server as any).dispatchTool('getTransportScope', { transports: ['DEVK900001'] })).rejects.toMatchObject({ code: -32601 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('exposes direct URL source reads only in development and diagnostic profiles', () => {
    for (const profile of ['development', 'diagnostic-readonly', 'legacy-full', 'development-workbench']) {
      const names = (configureServer('DEV', profile) as any).toolCatalog.map((tool: { name: string }) => tool.name);
      expect(names).toContain('getObjectSource');
    }
    for (const profile of ['safe', 'business-readonly', 'operations-readonly']) {
      const names = (configureServer('DEV', profile) as any).toolCatalog.map((tool: { name: string }) => tool.name);
      expect(names).not.toContain('getObjectSource');
    }
  });

  it('exposes repository creation capabilities only in DEV development profiles', () => {
    const expected = [
      'listRepositoryObjectCreationCapabilities', 'describeRepositoryObjectCreation',
      'previewRepositoryObjectCreation', 'applyRepositoryObjectCreation', 'getRepositoryObjectCreationStatus'
    ];
    for (const profile of ['development', 'development-workbench']) {
      const names = (configureServer('DEV', profile) as any).toolCatalog.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(expect.arrayContaining(expected));
    }
    for (const profile of ['safe', 'diagnostic-readonly', 'legacy-full', 'business-readonly', 'operations-readonly']) {
      const names = (configureServer('DEV', profile) as any).toolCatalog.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(expect.not.arrayContaining(expected));
    }
  });

  it.each(['QAS', 'PRD', '', 'UNKNOWN'])('hides and rejects repository creation capabilities for role %p', async role => {
    const server = configureServer(role, 'development');
    const handlers = (server as any).repositoryObjectCreationHandlers;
    const handle = jest.spyOn(handlers, 'handle');

    expect((server as any).toolCatalog.map((tool: { name: string }) => tool.name))
      .not.toContain('listRepositoryObjectCreationCapabilities');
    await expect((server as any).dispatchTool('listRepositoryObjectCreationCapabilities', {}))
      .rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(handle).not.toHaveBeenCalled();
  });

  it('exposes the controlled repository import chain only in DEV development profiles', () => {
    const expected = [
      'previewRepositoryObjectImport', 'applyRepositoryObjectImport', 'getRepositoryObjectImportStatus'
    ];
    for (const profile of ['development', 'development-workbench']) {
      const names = (configureServer('DEV', profile) as any).toolCatalog.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(expect.arrayContaining(expected));
    }
    for (const profile of ['safe', 'diagnostic-readonly', 'legacy-full', 'business-readonly', 'operations-readonly']) {
      const names = (configureServer('DEV', profile) as any).toolCatalog.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(expect.not.arrayContaining(expected));
    }
  });

  it.each(['QAS', 'PRD', '', 'UNKNOWN'])('hides and rejects the controlled repository import chain for role %p', async role => {
    const server = configureServer(role, 'development');
    const handlers = (server as any).repositoryObjectImportHandlers;
    const handle = jest.spyOn(handlers, 'handle');

    expect((server as any).toolCatalog.map((tool: { name: string }) => tool.name))
      .not.toContain('previewRepositoryObjectImport');
    await expect((server as any).dispatchTool('previewRepositoryObjectImport', { packageName: '$TMP' }))
      .rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(handle).not.toHaveBeenCalled();
  });

  it('exposes cleanup independently of the validation switch', () => {
    try {
      Object.assign(process.env, {
        SAP_MCP_REAL_DEV_VALIDATION_OBJECTS: 'PROGRAM',
        SAP_MCP_REAL_DEV_VALIDATION_PREFIX: 'ZV',
        SAP_MCP_REAL_DEV_VALIDATION_PACKAGE: 'Z001',
        SAP_MCP_REAL_DEV_VALIDATION_TRANSPORT: 'S4HK900009'
      });
      for (const validation of ['true', 'false']) {
        process.env.SAP_MCP_REAL_DEV_VALIDATION = validation;
        for (const profile of ['development', 'development-workbench']) {
          const names = (configureServer('DEV', profile) as any).toolCatalog.map((tool: { name: string }) => tool.name);
          expect(names).toEqual(expect.arrayContaining([
            'previewRepositoryObjectCleanup', 'applyRepositoryObjectCleanup', 'getRepositoryObjectCleanupStatus'
          ]));
        }
      }
      for (const profile of ['safe', 'diagnostic-readonly', 'legacy-full', 'business-readonly', 'operations-readonly']) {
        const names = (configureServer('DEV', profile) as any).toolCatalog.map((tool: { name: string }) => tool.name);
        expect(names).not.toContain('previewRepositoryObjectCleanup');
      }
    } finally {
      delete process.env.SAP_MCP_REAL_DEV_VALIDATION;
      delete process.env.SAP_MCP_REAL_DEV_VALIDATION_OBJECTS;
      delete process.env.SAP_MCP_REAL_DEV_VALIDATION_PREFIX;
      delete process.env.SAP_MCP_REAL_DEV_VALIDATION_PACKAGE;
      delete process.env.SAP_MCP_REAL_DEV_VALIDATION_TRANSPORT;
    }
  });

  it.each(['QAS', 'PRD', '', 'UNKNOWN'])('hides and rejects raw advanced writes for role %p', async role => {
    const server = configureServer(role, 'legacy-full');
    const catalog = (server as any).toolCatalog as Array<{ name: string }>;
    const client = (server as any).adtClient;
    client.setDomainProperties = jest.fn();

    expect(catalog.map(tool => tool.name)).toEqual(expect.not.arrayContaining([...RAW_ADVANCED_MUTATION_TOOL_NAMES]));
    await expect((server as any).dispatchTool('setDomainProperties', {
      domainUrl: '/domain', properties: {}, metaData: {}, lockHandle: 'lock'
    })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(client.setDomainProperties).not.toHaveBeenCalled();
  });

  it.each(['QAS', 'PRD', '', 'UNKNOWN'])('limits every profile to local/read-only tools for role %p', role => {
    for (const profile of [
      'safe', 'development', 'diagnostic-readonly', 'legacy-full',
      'development-workbench', 'business-readonly', 'operations-readonly'
    ]) {
      const server = configureServer(role, profile);
      const catalog = (server as any).toolCatalog as Array<{ name: string }>;
      expect(catalog.every(tool => ['local', 'read-only'].includes(String(toolOperationClass(tool.name))))).toBe(true);
      expect(catalog.map(tool => tool.name)).toEqual(expect.not.arrayContaining([
        ...RAW_ADVANCED_MUTATION_TOOL_NAMES,
        ...CONTROLLED_ADVANCED_MUTATION_TOOL_NAMES
      ]));
    }
  });

  it.each(['QAS', 'PRD', '', 'UNKNOWN'])('rejects hidden controlled apply before confirmation for role %p', async role => {
    const server = configureServer(role, 'development');
    const advancedHandlers = (server as any).safeAdvancedHandlers;
    const handle = jest.spyOn(advancedHandlers, 'handle');

    await expect((server as any).dispatchTool('applyRapOperation', { operationPlanId: 'forged-plan' }))
      .rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(handle).not.toHaveBeenCalled();
  });

  it('rejects controlled advanced operations in DEV diagnostic-readonly', async () => {
    const server = configureServer('DEV', 'diagnostic-readonly');
    const advancedHandlers = (server as any).safeAdvancedHandlers;
    const handle = jest.spyOn(advancedHandlers, 'handle');

    await expect((server as any).dispatchTool('applyDdicPropertyChange', { operationPlanId: 'forged-plan' }))
      .rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(handle).not.toHaveBeenCalled();
  });

  it('rejects direct calls to read tools hidden by a task-focused profile', async () => {
    const server = configureServer('DEV', 'business-readonly');
    const client = (server as any).adtClient;
    client.dumps = jest.fn();

    await expect((server as any).dispatchTool('readRuntimeDumps', {
      from: '2026-08-17T00:00:00+08:00', to: '2026-08-17T01:00:00+08:00'
    })).rejects.toMatchObject({ code: -32601 });
    expect(client.dumps).not.toHaveBeenCalled();
  });
});
