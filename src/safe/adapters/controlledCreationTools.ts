import type {
  AbapObjectStructure,
  ActivationResult,
  AdtDiscoveryResult,
  AdtLock,
  ControlledPackageCreationResult,
  ControlledPackageDocument,
  ControlledPackageInput,
  ControlledSourceObjectCreationResult,
  ControlledSourceObjectInput,
  ControlledServiceBindingInput,
  ControlledTableCreationResult,
  ControlledTableDocument,
  ControlledTableSettingsDocument,
  ControlledTableShellInput,
  ControlledTableTechnicalSettings,
  ControlledStructureCreationResult,
  ControlledStructureShellInput,
  ControlledTypeGroupCreationResult,
  ControlledTypeGroupShellInput,
  ControlledTableTypeShellInput,
  ControlledTableTypeProperties,
  ControlledTableTypeDocument,
  ControlledTableTypeCreationResult,
  ControlledAbapTypeCapability,
  ControlledLockObjectCreationResult,
  ControlledLockObjectShellInput,
  ControlledLogicalExternalSchemaShellInput,
  ControlledLogicalExternalSchemaContent,
  ControlledLogicalExternalSchemaCreationResult,
  ControlledNumberRangeObjectShellInput,
  ControlledNumberRangeObjectContent,
  ControlledNumberRangeObjectCreationResult,
  ControlledSapObjectTypeShellInput,
  ControlledSapObjectTypeCreationContent,
  ControlledSapObjectTypeContent,
  ControlledSapObjectTypeCreationContract,
  ControlledSapObjectTypeCreationResult,
  ControlledSapObjectNodeTypeShellInput,
  ControlledSapObjectNodeTypeCreationContent,
  ControlledSapObjectNodeTypeContent,
  ControlledSapObjectNodeTypeCreationContract,
  ControlledSapObjectNodeTypeCreationResult,
  ControlledChangeDocumentObjectShellInput,
  ControlledChangeDocumentObjectContent,
  ControlledChangeDocumentObjectContract,
  ControlledChangeDocumentObjectCreationResult,
  DataElementMetaData,
  DataElementProperties,
  DomainMetaData,
  DomainProperties,
  NewObjectOptions,
  ValidateOptions,
  SearchResult,
  SyntaxCheckResult,
  TransportInfo,
  TransportRequest,
  ValidationResult
} from '../../adt/index.js'

export interface ControlledCreationAdtClient {
  searchObject(query: string, objType?: string, max?: number): Promise<SearchResult[]>
  transportInfo(objectUrl: string, devClass?: string, operation?: string): Promise<TransportInfo>
  transportDetails(transportNumber: string): Promise<TransportRequest>
  validateControlledPackage(input: ControlledPackageInput, mode: 'basic' | 'full'): Promise<ValidationResult>
  getControlledPackageConstraints(
    input: Pick<ControlledPackageInput, 'name' | 'parentPackageName' | 'softwareComponent'>
  ): Promise<string>
  readControlledPackage(packageName: string): Promise<ControlledPackageDocument>
  createControlledPackage(input: ControlledPackageInput): Promise<ControlledPackageCreationResult>
  validateControlledSourceObject(input: ControlledSourceObjectInput): Promise<ValidationResult>
  createControlledSourceObjectShell(input: ControlledSourceObjectInput): Promise<ControlledSourceObjectCreationResult>
  getStatelessControlledCreationClient?(): ControlledCreationAdtClient
  validateControlledServiceBinding?(input: ControlledServiceBindingInput): Promise<ValidationResult>
  createControlledServiceBinding?(input: ControlledServiceBindingInput): Promise<{ location: string; name: string; adtType: 'SRVB/SVB' }>
  objectStructure(objectUrl: string, version?: 'active' | 'inactive' | 'workingArea'): Promise<AbapObjectStructure>
  getObjectSource(objectSourceUrl: string, options?: { version?: 'active' | 'inactive' | 'workingArea' }): Promise<string>
  setObjectSource(objectSourceUrl: string, source: string, lockHandle: string, transport?: string): Promise<void>
  syntaxCheck(
    artifactUrl: string,
    objectUrl: string,
    content: string,
    mainProgram?: string,
    version?: string
  ): Promise<SyntaxCheckResult[]>
  activate(objectName: string, objectUrl: string, mainInclude?: string, preauditRequested?: boolean): Promise<ActivationResult>
  // typed objectReference 重载：body 带 adtcore:type/parentUri（激活器定位
  // 非活动版本所需；字符串简写在部分系统上激活异常——真机因素矩阵定案）
  activate(
    object: { 'adtcore:uri': string; 'adtcore:type': string; 'adtcore:name': string; 'adtcore:parentUri': string },
    preauditRequested?: boolean
  ): Promise<ActivationResult>
  validateControlledTableShell(input: Pick<ControlledTableShellInput, 'name' | 'description'>): Promise<ValidationResult>
  createControlledTableShell(input: ControlledTableShellInput): Promise<ControlledTableCreationResult>
  readControlledTable(name: string, version?: 'active' | 'inactive' | 'workingArea'): Promise<ControlledTableDocument>
  readControlledTableSource(name: string, version?: 'active' | 'inactive' | 'workingArea'): Promise<string>
  writeControlledTableSource(name: string, source: string, lockHandle: string, transportRequest: string): Promise<string>
  runControlledTableCheck(name: string, reporter: 'tableStatusCheck' | 'abapCheckRun', source?: string): Promise<SyntaxCheckResult[]>
  readControlledTableSettings(name: string, version?: 'active' | 'inactive' | 'workingArea'): Promise<ControlledTableSettingsDocument>
  writeControlledTableSettings(
    current: ControlledTableSettingsDocument,
    settings: ControlledTableTechnicalSettings,
    lockHandle: string,
    transportRequest: string
  ): Promise<ControlledTableSettingsDocument>
  activateControlledTable(name: string): Promise<ActivationResult>
  activateControlledTableSettings(name: string): Promise<ActivationResult>
  validateControlledStructureShell?(input: Pick<ControlledStructureShellInput, 'name' | 'description'>): Promise<ValidationResult>
  createControlledStructureShell?(input: ControlledStructureShellInput, contentType: string): Promise<ControlledStructureCreationResult>
  activateControlledStructure?(name: string): Promise<ActivationResult>
  validateControlledTypeGroupShell?(input: Pick<ControlledTypeGroupShellInput, 'name' | 'description' | 'packageName'>): Promise<ValidationResult>
  createControlledTypeGroupShell?(input: ControlledTypeGroupShellInput, contentType: string): Promise<ControlledTypeGroupCreationResult>
  activateControlledTypeGroup?(name: string): Promise<ActivationResult>
  validateControlledTableTypeShell?(input: Pick<ControlledTableTypeShellInput, 'name' | 'description'>): Promise<ValidationResult>
  createControlledTableTypeShell?(input: ControlledTableTypeShellInput): Promise<ControlledTableTypeCreationResult>
  readControlledTableType?(name: string, version?: 'active' | 'inactive' | 'workingArea'): Promise<ControlledTableTypeDocument>
  writeControlledTableType?(name: string, current: ControlledTableTypeDocument, properties: ControlledTableTypeProperties, lockHandle: string, transportRequest: string): Promise<ControlledTableTypeDocument>
  readControlledAbapTypeCapabilities?(): Promise<ControlledAbapTypeCapability[]>
  activateControlledTableType?(name: string): Promise<ActivationResult>
  validateControlledLockObjectShell?(input: Pick<ControlledLockObjectShellInput, 'name' | 'description' | 'packageName'>): Promise<ValidationResult>
  createControlledLockObjectShell?(input: ControlledLockObjectShellInput, contentType: string): Promise<ControlledLockObjectCreationResult>
  validateControlledLogicalExternalSchema?(input: Pick<ControlledLogicalExternalSchemaShellInput, 'name' | 'description' | 'packageName'>): Promise<ValidationResult>
  readControlledLogicalExternalSchemaSchema?(): Promise<unknown>
  createControlledLogicalExternalSchemaShell?(input: ControlledLogicalExternalSchemaShellInput, contentType: string): Promise<ControlledLogicalExternalSchemaCreationResult>
  readControlledLogicalExternalSchemaContent?(contentUrl: string, contentType: string, version?: 'active' | 'inactive' | 'workingArea'): Promise<ControlledLogicalExternalSchemaContent>
  writeControlledLogicalExternalSchemaContent?(contentUrl: string, content: ControlledLogicalExternalSchemaContent, contentType: string, lockHandle: string, transportRequest: string): Promise<ControlledLogicalExternalSchemaContent>
  validateControlledNumberRangeObject?(input: Pick<ControlledNumberRangeObjectShellInput, 'name' | 'description' | 'packageName'>): Promise<ValidationResult>
  readControlledNumberRangeObjectSchema?(): Promise<unknown>
  createControlledNumberRangeObjectShell?(input: ControlledNumberRangeObjectShellInput, contentType: string): Promise<ControlledNumberRangeObjectCreationResult>
  readControlledNumberRangeObjectContent?(contentUrl: string, contentType: string, version?: 'active' | 'inactive' | 'workingArea'): Promise<ControlledNumberRangeObjectContent>
  writeControlledNumberRangeObjectContent?(contentUrl: string, content: ControlledNumberRangeObjectContent, contentType: string, lockHandle: string, transportRequest: string): Promise<ControlledNumberRangeObjectContent>
  validateControlledSapObjectType?(input: ControlledSapObjectTypeShellInput, content: ControlledSapObjectTypeCreationContent): Promise<ValidationResult>
  readControlledSapObjectTypeCreationContract?(): Promise<ControlledSapObjectTypeCreationContract>
  createControlledSapObjectType?(input: ControlledSapObjectTypeShellInput, content: ControlledSapObjectTypeCreationContent, contentType: string): Promise<ControlledSapObjectTypeCreationResult>
  readControlledSapObjectTypeContent?(contentUrl: string, contentType: string, version?: 'active' | 'inactive' | 'workingArea'): Promise<ControlledSapObjectTypeContent>
  validateControlledSapObjectNodeType?(input: ControlledSapObjectNodeTypeShellInput, content: ControlledSapObjectNodeTypeCreationContent): Promise<ValidationResult>
  readControlledSapObjectNodeTypeCreationContract?(): Promise<ControlledSapObjectNodeTypeCreationContract>
  createControlledSapObjectNodeType?(input: ControlledSapObjectNodeTypeShellInput, content: ControlledSapObjectNodeTypeCreationContent, contentType: string): Promise<ControlledSapObjectNodeTypeCreationResult>
  readControlledSapObjectNodeTypeContent?(contentUrl: string, contentType: string, version?: 'active' | 'inactive' | 'workingArea'): Promise<ControlledSapObjectNodeTypeContent>
  validateControlledChangeDocumentObject?(input: Pick<ControlledChangeDocumentObjectShellInput, 'name' | 'description' | 'packageName'>): Promise<ValidationResult>
  readControlledChangeDocumentObjectContract?(): Promise<ControlledChangeDocumentObjectContract>
  createControlledChangeDocumentObjectShell?(input: ControlledChangeDocumentObjectShellInput, contentType: string): Promise<ControlledChangeDocumentObjectCreationResult>
  readControlledChangeDocumentObjectContent?(contentUrl: string, contentType: string, version?: 'active' | 'inactive' | 'workingArea'): Promise<ControlledChangeDocumentObjectContent>
  writeControlledChangeDocumentObjectContent?(contentUrl: string, content: ControlledChangeDocumentObjectContent, contentType: string, lockHandle: string, transportRequest: string): Promise<ControlledChangeDocumentObjectContent>
  validateNewObject?(input: ValidateOptions): Promise<ValidationResult>
  createObject?(input: NewObjectOptions): Promise<void>
  createObjectStateless?(input: NewObjectOptions): Promise<void>
  getDomainProperties?(domainUrl: string, version?: 'active' | 'inactive' | 'workingArea'): Promise<{ metaData: DomainMetaData; properties: DomainProperties }>
  setDomainProperties?(domainUrl: string, properties: DomainProperties, metaData: DomainMetaData, lockHandle: string, transport?: string): Promise<void>
  getDataElementProperties?(dataElementUrl: string, version?: 'active' | 'inactive' | 'workingArea'): Promise<{ metaData: DataElementMetaData; properties: DataElementProperties }>
  setDataElementProperties?(dataElementUrl: string, properties: DataElementProperties, metaData: DataElementMetaData, lockHandle: string, transport?: string): Promise<void>
  lock(objectUrl: string, accessMode?: string): Promise<AdtLock>
  unLock(objectUrl: string, lockHandle: string): Promise<string>
  deleteObject(objectUrl: string, lockHandle: string, transport?: string): Promise<void>
  findCollectionByUrl?(url: string): Promise<{ discoveryResult: AdtDiscoveryResult; collection: AdtDiscoveryResult['collection'][number] } | undefined>
}
