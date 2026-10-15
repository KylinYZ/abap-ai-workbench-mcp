import { RepositoryObjectCreationHandlers } from '../handlers/RepositoryObjectCreationHandlers';
import { RepositoryObjectCreationRegistry } from '../safe/RepositoryObjectCreationRegistry';
import { INITIAL_REPOSITORY_CREATION_CAPABILITIES } from '../safe/repositoryCreationCapabilities';
import { RepositoryCreationConfirmationChallengeStore } from '../safe/RepositoryCreationConfirmationChallengeStore';

describe('RepositoryObjectCreationHandlers', () => {
  function handlers(): RepositoryObjectCreationHandlers {
    return new RepositoryObjectCreationHandlers(
      new RepositoryObjectCreationRegistry(INITIAL_REPOSITORY_CREATION_CAPABILITIES),
      { systemRole: 'DEV', toolProfile: 'development' }
    );
  }

  it('exposes the bounded creation and cleanup tool surface', () => {
    const tools = handlers().getTools();
    expect(tools.map(tool => tool.name)).toEqual([
      'listRepositoryObjectCreationCapabilities',
      'describeRepositoryObjectCreation',
      'previewRepositoryObjectCreation',
      'applyRepositoryObjectCreation',
      'getRepositoryObjectCreationStatus',
      'previewRepositoryObjectCleanup',
      'applyRepositoryObjectCleanup',
      'getRepositoryObjectCleanupStatus'
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
    expect(tools.find(tool => tool.name === 'applyRepositoryObjectCreation')).toMatchObject({
      inputSchema: { properties: { creationPlanId: expect.any(Object) }, required: ['creationPlanId'] },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      _meta: { operationClass: 'mutating tenant', approvalRequired: true }
    });
    expect(tools.find(tool => tool.name === 'getRepositoryObjectCreationStatus')).toMatchObject({
      _meta: { operationClass: 'local-only', approvalRequired: false }
    });
    const previewProperties = tools.find(tool => tool.name === 'previewRepositoryObjectCreation')!.inputSchema.properties;
    expect(previewProperties).toEqual(expect.objectContaining({
      primaryTable: expect.any(Object),
      numberLengthDomain: expect.any(Object),
      typeCategory: expect.any(Object),
      sapObjectTypeName: expect.any(Object),
      serviceDefinition: expect.any(Object),
      tablesAndStructures: expect.any(Object)
    }));
    expect(previewProperties.properties.properties).toEqual(expect.objectContaining({
      typeInformation: expect.any(Object),
      outputInformation: expect.any(Object),
      fieldLabels: expect.any(Object)
    }));
    expect(previewProperties.rowType).toEqual(expect.any(Object));
    expect(tools[1].inputSchema.properties.objectKind.enum).toEqual([
      'PROGRAM', 'FUNCTION_GROUP', 'FUNCTION_GROUP_INCLUDE', 'FUNCTION_MODULE', 'PACKAGE', 'DATABASE_TABLE', 'DDIC_TABLE_TYPE', 'DDIC_STRUCTURE', 'DDIC_DOMAIN', 'DATA_ELEMENT', 'MESSAGE_CLASS', 'DDIC_TYPE_GROUP', 'DDIC_LOCK_OBJECT', 'LOGICAL_EXTERNAL_SCHEMA', 'NUMBER_RANGE_OBJECT',
      'SAP_OBJECT_TYPE', 'SAP_OBJECT_NODE_TYPE', 'CHANGE_DOCUMENT_OBJECT', 'ABAP_CLASS', 'ABAP_INTERFACE', 'PROGRAM_INCLUDE', 'CDS_DATA_DEFINITION',
      'CDS_ACCESS_CONTROL', 'CDS_METADATA_EXTENSION', 'CDS_ANNOTATION_DEFINITION',
      'SERVICE_DEFINITION', 'BEHAVIOR_DEFINITION', 'CDS_TYPE', 'CDS_ASPECT', 'CDS_ENTITY_BUFFER', 'SERVICE_BINDING'
    ]);
  });

  it('uses one native confirmation and never accepts caller confirmation fields', async () => {
    const workflow = {
      preview: jest.fn(),
      status: jest.fn().mockReturnValue({
        creationPlanId: 'plan-1', createdAt: '2026-08-19T00:00:00.000Z', expiresAt: '2099-08-19T00:15:00.000Z',
        status: 'PREVIEWED', systemHost: 'dev.example.test', client: '100', sapUser: 'TEST_USER', systemRole: 'DEV',
        toolProfile: 'development', target: { objectKind: 'PROGRAM', objectName: 'ZTEST', adtType: 'PROG/P' },
        summary: 'Create program', payloadHash: 'hash', payloadBytes: 10, stages: [], compensationLimits: []
      }),
      apply: jest.fn()
    };
    const applyConfirmed = jest.fn().mockResolvedValue({ status: 'success' });
    const configured = new RepositoryObjectCreationHandlers(
      new RepositoryObjectCreationRegistry(INITIAL_REPOSITORY_CREATION_CAPABILITIES),
      { systemRole: 'DEV', toolProfile: 'development' },
      workflow,
      {
        provider: {
          mode: 'windows-native',
          confirm: jest.fn().mockImplementation(async request => ({ action: 'apply', challengeId: request.challengeId }))
        },
        challengeStore: new RepositoryCreationConfirmationChallengeStore(),
        sessionId: 'session-1',
        applyConfirmed
      }
    );

    const applyTool = configured.getTools().find(tool => tool.name === 'applyRepositoryObjectCreation')!;
    expect(Object.keys(applyTool.inputSchema.properties)).toEqual(['creationPlanId']);
    await configured.handle('applyRepositoryObjectCreation', { creationPlanId: 'plan-1' });
    expect(applyConfirmed).toHaveBeenCalledWith('plan-1');
  });

  it('renders a stable capability list as text and structured content', async () => {
    const result = await handlers().handle('listRepositoryObjectCreationCapabilities');
    expect(result).toMatchObject({
      content: [{ type: 'text' }],
      structuredContent: { status: 'success', capabilities: expect.any(Array) }
    });
    expect(JSON.parse(String((result.content as Array<{ text: string }>)[0].text)))
      .toEqual(result.structuredContent);
  });

  it('exposes cleanup tools only for explicit validation and accepts no protocol controls', () => {
    const configured = new RepositoryObjectCreationHandlers(
      new RepositoryObjectCreationRegistry(INITIAL_REPOSITORY_CREATION_CAPABILITIES),
      { systemRole: 'DEV', toolProfile: 'development', realDevValidationEnabled: true }
    );
    const cleanupTools = configured.getTools().filter(tool => tool.name.includes('Cleanup'));
    expect(cleanupTools.map(tool => tool.name)).toEqual([
      'previewRepositoryObjectCleanup',
      'applyRepositoryObjectCleanup',
      'getRepositoryObjectCleanupStatus'
    ]);
    expect(Object.keys(cleanupTools[0].inputSchema.properties)).toEqual(['objectKind', 'name', 'parentName', 'creationPlanId']);
    expect(Object.keys(cleanupTools[1].inputSchema.properties)).toEqual(['cleanupPlanId']);
    expect(cleanupTools[1]).toMatchObject({
      annotations: { destructiveHint: true, idempotentHint: false },
      _meta: { approvalRequired: true }
    });
  });

  it('describes controlled CURR and QUAN references without arbitrary transport fields', async () => {
    const result = await handlers().handle('describeRepositoryObjectCreation', { objectKind: 'DATABASE_TABLE' });
    const capability = (result.structuredContent as any).capability;
    const serialized = JSON.stringify(capability);

    expect(capability).toMatchObject({ objectKind: 'DATABASE_TABLE', adtType: 'TABL/DT', writable: true });
    expect(capability.inputSchema.properties.fields.items.properties.referenceField).toBeDefined();
    expect(serialized).toContain('CURR');
    expect(serialized).toContain('QUAN');
    expect(capability.inputSchema.properties).not.toHaveProperty('url');
    expect(capability.inputSchema.properties).not.toHaveProperty('xml');
    expect(capability.inputSchema.properties).not.toHaveProperty('annotations');
    expect(capability.inputSchema.properties).not.toHaveProperty('lockHandle');
    expect(capability.inputSchema.properties).not.toHaveProperty('mediaType');
  });

  it('describes a real-DEV-verified Phase 2 class without exposing protocol inputs', async () => {
    const result = await handlers().handle('describeRepositoryObjectCreation', { objectKind: 'ABAP_CLASS' });
    const capability = (result.structuredContent as any).capability;

    expect(capability).toMatchObject({
      objectKind: 'ABAP_CLASS', adtType: 'CLAS/OC', maturity: 'REAL_DEV_VERIFIED',
      available: true, writable: true, fixedDefaults: { visibility: 'public', final: true }
    });
    expect(capability.inputSchema.required).toEqual([
      'name', 'description', 'packageName', 'transportRequest', 'source'
    ]);
    expect(capability.inputSchema.properties).not.toHaveProperty('url');
    expect(capability.inputSchema.properties).not.toHaveProperty('xml');
    expect(capability.executionStages).toContain('VERIFY_SOURCE');
  });

  it('describes real-DEV-verified DDIC structure creation without exposing protocol inputs', async () => {
    const result = await handlers().handle('describeRepositoryObjectCreation', { objectKind: 'DDIC_STRUCTURE' });
    const capability = (result.structuredContent as any).capability;
    expect(capability).toMatchObject({
      objectKind: 'DDIC_STRUCTURE', adtType: 'TABL/DS', maturity: 'REAL_DEV_VERIFIED', available: true, writable: true,
      fixedDefaults: { creationContentType: 'ADT_DISCOVERY' }
    });
    expect(capability.inputSchema.required).toEqual(['name', 'description', 'packageName', 'transportRequest', 'fields']);
    expect(capability.inputSchema.properties).not.toHaveProperty('url');
    expect(capability.inputSchema.properties).not.toHaveProperty('mediaType');
  });

  it('describes the reviewed DESD application/json source contract', async () => {
    const result = await handlers().handle('describeRepositoryObjectCreation', { objectKind: 'LOGICAL_EXTERNAL_SCHEMA' });
    const capability = (result.structuredContent as any).capability;
    expect(capability).toMatchObject({
      objectKind: 'LOGICAL_EXTERNAL_SCHEMA', adtType: 'DESD/TYP', maturity: 'REAL_DEV_VERIFIED',
      available: true, writable: true,
      fixedDefaults: {
        shellContentType: 'application/vnd.sap.adt.blues.v1+xml',
        contentType: 'application/json',
        formatVersion: '1'
      }
    });
    expect(capability.inputSchema.properties).not.toHaveProperty('json');
    expect(capability.inputSchema.properties).not.toHaveProperty('mediaType');
  });

  it('describes all controlled Number Range fields without exposing JSON or ADT controls', async () => {
    const result = await handlers().handle('describeRepositoryObjectCreation', { objectKind: 'NUMBER_RANGE_OBJECT' });
    const capability = (result.structuredContent as any).capability;
    expect(capability).toMatchObject({
      objectKind: 'NUMBER_RANGE_OBJECT', adtType: 'NROB/NRO', maturity: 'REAL_DEV_VERIFIED',
      available: true, writable: true, fixedDefaults: { contentType: 'application/json', schemaFramework: 'objectTypes.v1' }
    });
    expect(capability.inputSchema.required).toEqual([
      'name', 'description', 'packageName', 'numberLengthDomain', 'percentWarning',
      'untilYear', 'rolling', 'prefix', 'buffering', 'bufferedNumbers', 'transportRequest'
    ]);
    expect(capability.inputSchema.properties).not.toHaveProperty('json');
    expect(capability.inputSchema.properties).not.toHaveProperty('url');
    expect(capability.inputSchema.properties).not.toHaveProperty('mediaType');
    expect(capability.inputSchema.properties).not.toHaveProperty('lockHandle');
  });

  it('describes controlled SAP Object Type creation without exposing the embedded payload', async () => {
    const result = await handlers().handle('describeRepositoryObjectCreation', { objectKind: 'SAP_OBJECT_TYPE' });
    const capability = (result.structuredContent as any).capability;
    expect(capability).toMatchObject({
      objectKind: 'SAP_OBJECT_TYPE', adtType: 'RONT/ROT', maturity: 'REAL_DEV_VERIFIED',
      available: true, writable: true,
      fixedDefaults: {
        shellContentType: 'application/vnd.sap.adt.blues.v2+xml',
        creationFramework: 'newObjectTypes.v1',
        objectTypeCodeAssignedBySap: true
      }
    });
    expect(capability.inputSchema.required).toEqual([
      'name', 'description', 'packageName', 'typeCategory', 'transportRequest'
    ]);
    expect(capability.inputSchema.properties.typeCategory.enum).toHaveLength(6);
    expect(capability.inputSchema.properties).not.toHaveProperty('json');
    expect(capability.inputSchema.properties).not.toHaveProperty('xml');
    expect(capability.inputSchema.properties).not.toHaveProperty('url');
    expect(capability.inputSchema.properties).not.toHaveProperty('mediaType');
    expect(capability.inputSchema.properties).not.toHaveProperty('objectTypeCode');
  });

  it('describes controlled SAP Object Node Type creation without exposing derived RONT metadata', async () => {
    const result = await handlers().handle('describeRepositoryObjectCreation', { objectKind: 'SAP_OBJECT_NODE_TYPE' });
    const capability = (result.structuredContent as any).capability;
    expect(capability).toMatchObject({
      objectKind: 'SAP_OBJECT_NODE_TYPE', adtType: 'NONT/NOT', maturity: 'REAL_DEV_VERIFIED',
      available: true, writable: true,
      fixedDefaults: {
        shellContentType: 'application/vnd.sap.adt.blues.v2+xml',
        creationFramework: 'newObjectTypes.v1',
        sapObjectTypeReferenceUsesRepositoryName: true
      }
    });
    expect(capability.inputSchema.required).toEqual([
      'name', 'description', 'packageName', 'sapObjectTypeName', 'rootNode', 'transportRequest'
    ]);
    expect(capability.inputSchema.properties.sapObjectTypeName.description).toContain('uppercase RONT');
    expect(capability.inputSchema.properties).not.toHaveProperty('sapObjectTypeSemanticName');
    expect(capability.inputSchema.properties).not.toHaveProperty('json');
    expect(capability.inputSchema.properties).not.toHaveProperty('xml');
    expect(capability.inputSchema.properties).not.toHaveProperty('url');
    expect(capability.inputSchema.properties).not.toHaveProperty('mediaType');
  });

  it('describes controlled Change Document Object creation without exposing generated-object controls', async () => {
    const result = await handlers().handle('describeRepositoryObjectCreation', { objectKind: 'CHANGE_DOCUMENT_OBJECT' });
    const capability = (result.structuredContent as any).capability;
    expect(capability).toMatchObject({
      objectKind: 'CHANGE_DOCUMENT_OBJECT', adtType: 'CHDO/CHD', maturity: 'REAL_DEV_VERIFIED',
      available: true, writable: true,
      fixedDefaults: {
        shellContentType: 'application/vnd.sap.adt.blues.v1+xml',
        sourceContentType: 'application/json',
        generatedObjectAssignedBySap: true,
        behaviorDefinitionSapValue: 'behaviorDefiniton',
        errorMessageId: 'CD',
        errorMessageNumber: '600'
      }
    });
    expect(capability.inputSchema.required).toEqual([
      'name', 'description', 'packageName', 'category', 'tablesAndStructures', 'transportRequest'
    ]);
    expect(capability.inputSchema.properties.category.enum).toEqual(['standard', 'behaviorDefinition']);
    expect(capability.inputSchema.properties).not.toHaveProperty('errorMessage');
    expect(capability.inputSchema.properties).not.toHaveProperty('generatedObject');
    expect(capability.inputSchema.properties).not.toHaveProperty('json');
    expect(capability.inputSchema.properties).not.toHaveProperty('xml');
    expect(capability.inputSchema.properties).not.toHaveProperty('url');
    expect(capability.inputSchema.properties).not.toHaveProperty('lockHandle');
  });

  it('describes CDS reference constraints without exposing ADT protocol controls', async () => {
    const result = await handlers().handle('describeRepositoryObjectCreation', {
      objectKind: 'CDS_METADATA_EXTENSION'
    });
    const capability = (result.structuredContent as any).capability;

    expect(capability).toMatchObject({
      objectKind: 'CDS_METADATA_EXTENSION', adtType: 'DDLX/EX',
      maturity: 'REAL_DEV_VERIFIED', available: true, writable: true
    });
    expect(capability.inputSchema.required).toContain('referencedObjectName');
    expect(capability.executionStages).toContain('REVALIDATE_REFERENCE');
    expect(capability.inputSchema.properties).not.toHaveProperty('url');
    expect(capability.inputSchema.properties).not.toHaveProperty('mediaType');
  });

  it.each([
    ['CDS_ANNOTATION_DEFINITION', 'DDLA/ADF', false, 'AUTOMATION_VERIFIED', false],
    ['SERVICE_DEFINITION', 'SRVD/SRV', true, 'REAL_DEV_VERIFIED', true],
    ['BEHAVIOR_DEFINITION', 'BDEF/BDO', true, 'REAL_DEV_VERIFIED', true]
  ])('describes controlled Slice 2C kind %s with evidence-backed write state', async (
    objectKind, adtType, requiresReference, maturity, writable
  ) => {
    const result = await handlers().handle('describeRepositoryObjectCreation', { objectKind });
    const capability = (result.structuredContent as any).capability;

    expect(capability).toMatchObject({
      objectKind, adtType, maturity, available: true, writable
    });
    expect(capability.inputSchema.required.includes('referencedObjectName')).toBe(requiresReference);
    expect(capability.inputSchema.properties).not.toHaveProperty('url');
    expect(capability.inputSchema.properties).not.toHaveProperty('xml');
    expect(capability.inputSchema.properties).not.toHaveProperty('mediaType');
  });
});

describe('RepositoryObjectCreationHandlers release gating（M2-A：kind × BASIS release 收窄）', () => {
  function gatedHandlers(basisRelease: number | undefined): RepositoryObjectCreationHandlers {
    return new RepositoryObjectCreationHandlers(
      new RepositoryObjectCreationRegistry(INITIAL_REPOSITORY_CREATION_CAPABILITIES),
      { systemRole: 'DEV', toolProfile: 'development' },
      undefined, undefined, undefined, undefined,
      async () => basisRelease
    );
  }

  it('751：list 收窄 RAP 时代 kind（BDEF/SRVD/SRVB/CDS_TYPE/CDS_ASPECT 隐藏），CDS_METADATA_EXTENSION 保留', async () => {
    const result = await gatedHandlers(751).handle('listRepositoryObjectCreationCapabilities', {});
    const kinds = (result.structuredContent as any).capabilities.map((c: any) => c.objectKind);
    expect(kinds).toContain('CDS_METADATA_EXTENSION');
    expect(kinds).not.toContain('BEHAVIOR_DEFINITION');
    expect(kinds).not.toContain('SERVICE_DEFINITION');
    expect(kinds).not.toContain('SERVICE_BINDING');
    expect(kinds).not.toContain('CDS_TYPE');
    expect(kinds).not.toContain('CDS_ASPECT');
    expect(kinds).not.toContain('CDS_ENTITY_BUFFER');
  });

  it('750：CDS_METADATA_EXTENSION 也被收窄（7.50 无 metadata extensions）', async () => {
    const result = await gatedHandlers(750).handle('listRepositoryObjectCreationCapabilities', {});
    const kinds = (result.structuredContent as any).capabilities.map((c: any) => c.objectKind);
    expect(kinds).not.toContain('CDS_METADATA_EXTENSION');
    expect(kinds).toContain('CDS_DATA_DEFINITION');
  });

  it('指纹不可得（undefined）：清单零变化（31 类全在）', async () => {
    const result = await gatedHandlers(undefined).handle('listRepositoryObjectCreationCapabilities', {});
    const kinds = (result.structuredContent as any).capabilities.map((c: any) => c.objectKind);
    expect(kinds).toContain('BEHAVIOR_DEFINITION');
    expect(kinds).toContain('CDS_ENTITY_BUFFER');
  });

  it('751：describe RAP kind 显式拒绝并带版本原因', async () => {
    await expect(
      gatedHandlers(751).handle('describeRepositoryObjectCreation', { objectKind: 'BEHAVIOR_DEFINITION' })
    ).rejects.toThrow(/requires SAP_BASIS >= 755[\s\S]*BASIS 751/);
  });

  it('755：BDEF/SRVD 解禁、CDS_ENTITY_BUFFER（757）仍收窄', async () => {
    const described = await gatedHandlers(755).handle('describeRepositoryObjectCreation', { objectKind: 'BEHAVIOR_DEFINITION' });
    expect((described.structuredContent as any).capability.objectKind).toBe('BEHAVIOR_DEFINITION');
    await expect(
      gatedHandlers(755).handle('describeRepositoryObjectCreation', { objectKind: 'CDS_ENTITY_BUFFER' })
    ).rejects.toThrow(/requires SAP_BASIS >= 757/);
  });
});
