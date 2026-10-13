import type {
  AbapObjectStructure,
  ControlledSourceObjectAdtType,
  ControlledSourceObjectInput,
  ControlledSourceObjectKind,
  SearchResult
} from '../../adt/index.js'
import { ADTClient, controlledSourceObjectUrl, isClassStructure } from '../../adt/index.js'
import { RepositoryCreationOutcomeUnknownError } from '../RepositoryObjectCreationWorkflow.js'
import type {
  PreparedRepositoryCreation,
  RepositoryCreationExecutionResult,
  RepositoryCreationPlan,
  RepositoryObjectCreationAdapter,
  RepositoryObjectKind
} from '../repositoryCreationTypes.js'
import type { SafetyPolicy } from '../SafetyPolicy.js'
import { compareAbapClassSources, compareSources, sourceHash } from '../sourceTools.js'
import type { ControlledCreationAdtClient } from './controlledCreationTools.js'
import {
  assertActivation,
  assertNoCheckErrors,
  assertTargetAbsent,
  assertTransportAvailable,
  assertValidation,
  controlledResponsible,
  repositoryName,
  requiredString,
  sameControlledMasterSystem
} from './creationAdapterTools.js'

interface SourceObjectPayload {
  input: ControlledSourceObjectInput
  source: string
  objectUrl: string
  packageUrl: string
  reference?: { name: string; type: string; uri: string }
}

const TYPE_BY_KIND: Record<ControlledSourceObjectKind, ControlledSourceObjectAdtType> = {
  ABAP_CLASS: 'CLAS/OC', ABAP_INTERFACE: 'INTF/OI', PROGRAM_INCLUDE: 'PROG/I',
  CDS_DATA_DEFINITION: 'DDLS/DF', CDS_ACCESS_CONTROL: 'DCLS/DL', CDS_METADATA_EXTENSION: 'DDLX/EX',
  CDS_ANNOTATION_DEFINITION: 'DDLA/ADF', SERVICE_DEFINITION: 'SRVD/SRV',
  BEHAVIOR_DEFINITION: 'BDEF/BDO', CDS_TYPE: 'DRTY/STY', CDS_ASPECT: 'DRAS/RAS',
  CDS_ENTITY_BUFFER: 'DTEB/DF'
}

export class SourceObjectCreationAdapter implements RepositoryObjectCreationAdapter {
  readonly objectKind: Extract<RepositoryObjectKind, ControlledSourceObjectKind>

  constructor(
    objectKind: ControlledSourceObjectKind,
    private readonly client: ControlledCreationAdtClient,
    private readonly policy: SafetyPolicy
  ) {
    this.objectKind = objectKind
  }

  async prepare(request: Record<string, unknown>): Promise<PreparedRepositoryCreation> {
    const name = repositoryName(request, 'name', this.objectKind === 'CDS_TYPE' ? 40 : 30)
    const description = requiredString(request, 'description', 120)
    const packageName = repositoryName(request, 'packageName', 30)
    const transportRequest = this.policy.assertTransportFormat(String(request.transportRequest || ''))
    const source = String(request.source || '')
    const referencedObjectName = needsReference(this.objectKind)
      ? repositoryName(request, 'referencedObjectName', 30)
      : undefined
    const adtType = TYPE_BY_KIND[this.objectKind]
    this.policy.assertMutationAllowed(name)
    this.policy.assertTransportablePackage(packageName)
    // ADT identifies a behavior definition by its root CDS entity, so a
    // different repository name would make ownership verification ambiguous.
    if (this.objectKind === 'BEHAVIOR_DEFINITION' && referencedObjectName !== name) {
      throw new Error('Behavior definition name must match its root CDS entity.')
    }
    assertSourceFrame(this.objectKind, name, source, referencedObjectName)

    const [targetMatches, packageMatches, referenceMatches] = await Promise.all([
      this.client.searchObject(name, adtType, 10),
      this.client.searchObject(packageName, 'DEVC/K', 10),
      referencedObjectName
        ? this.client.searchObject(referencedObjectName, referenceSearchType(this.objectKind), 10)
        : Promise.resolve([])
    ])
    assertTargetAbsent(targetMatches, name, adtType)
    const packageObject = exactMatch(packageMatches, packageName, 'DEVC/K')
    if (!packageObject) throw new Error(`Package ${packageName} was not found.`)
    const reference = referencedObjectName
      ? referenceMatch(referenceMatches, referencedObjectName, referenceSearchType(this.objectKind))
      : undefined
    if (referencedObjectName && !reference) {
      throw new Error(`Referenced object ${referencedObjectName} was not found for ${this.objectKind}.`)
    }
    if (reference) await assertActiveReference(this.client, reference, this.objectKind)
    const packageMetadata = await this.client.readControlledPackage(packageName)
    const language = packageMetadata.language || packageMetadata.masterLanguage
    const masterLanguage = packageMetadata.masterLanguage || language
    const masterSystem = packageMetadata.masterSystem
    const responsible = controlledResponsible(packageMetadata.responsible, this.policy.sapUser)
    if (!language || !masterLanguage || !masterSystem || !responsible) {
      throw new Error(`Package ${packageName} did not expose the identity metadata required for controlled creation.`)
    }
    const input: ControlledSourceObjectInput = {
      objectKind: this.objectKind, adtType, name, description, packageName, transportRequest,
      language, masterLanguage, masterSystem, responsible
    }
    assertValidation(await this.client.validateControlledSourceObject(input), name)
    const [transportInfo, transportDetails] = await Promise.all([
      this.client.transportInfo(packageObject['adtcore:uri'], packageName, 'I'),
      this.client.transportDetails(transportRequest)
    ])
    assertTransportAvailable(transportInfo, transportDetails, transportRequest)
    const objectUrl = controlledSourceObjectUrl(this.objectKind, name)

    return {
      target: { objectKind: this.objectKind, objectName: name, adtType, parentName: packageName },
      transportRequest,
      summary: `Create ${this.objectKind} ${name} in package ${packageName}.`,
      payload: {
        input, source, objectUrl, packageUrl: packageObject['adtcore:uri'],
        reference: reference && {
          name: referencedObjectName!, type: reference['adtcore:type'], uri: reference['adtcore:uri']
        }
      } satisfies SourceObjectPayload,
      review: {
        objectKind: this.objectKind, name, description, packageName, transportRequest, source,
        referencedObjectName, sourceHash: sourceHash(source), shellContract: { adtType, objectUrl }
      },
      compensationLimits: [
        'Only the object proven to have been created by the current plan may be deleted.',
        'Unknown shell, source, unlock, or activation outcomes stop automatic compensation.'
      ]
    }
  }

  async execute(
    plan: RepositoryCreationPlan,
    recordStage: (stage: string, success: boolean, message?: string) => void
  ): Promise<RepositoryCreationExecutionResult> {
    const payload = sourceObjectPayload(plan)
    const { input, source, objectUrl } = payload
    assertTargetAbsent(await this.client.searchObject(input.name, input.adtType, 10), input.name, input.adtType)
    recordStage('REVALIDATE_ABSENCE', true)
    if (payload.reference) {
      const matches = await this.client.searchObject(payload.reference.name, referenceSearchType(this.objectKind), 10)
      const reference = referenceMatch(matches, payload.reference.name, referenceSearchType(this.objectKind))
      if (!reference || reference['adtcore:uri'] !== payload.reference.uri) {
        throw new Error(`Referenced object ${payload.reference.name} no longer matches the confirmed plan.`)
      }
      await assertActiveReference(this.client, reference, this.objectKind)
      recordStage('REVALIDATE_REFERENCE', true, payload.reference.name)
    }
    assertValidation(await this.client.validateControlledSourceObject(input), input.name)
    const [transportInfo, transportDetails] = await Promise.all([
      this.client.transportInfo(payload.packageUrl, input.packageName, 'I'),
      this.client.transportDetails(input.transportRequest)
    ])
    assertTransportAvailable(transportInfo, transportDetails, input.transportRequest)
    recordStage('VALIDATE_TRANSPORT', true)

    let creation
    const artifactClient = input.objectKind === 'ABAP_CLASS'
      ? this.requireStatelessClassClient()
      : this.client
    try {
      creation = await artifactClient.createControlledSourceObjectShell(input)
    } catch (error) {
      throw unknownWrite('Source object shell create', error)
    }
    recordStage('CREATE_SHELL', true, creation.location)

    let createdStructure: AbapObjectStructure
    if (creation.ownershipEvidence === 'POST_CREATE_READBACK_REQUIRED') {
      try {
        createdStructure = await provePostCreateSourceOwnership(artifactClient, input, objectUrl)
      } catch (error) {
        throw unknownWrite('Source object shell ownership proof', error)
      }
      recordStage('PROVE_SHELL_OWNERSHIP', true, objectUrl)
    } else {
      createdStructure = await artifactClient.objectStructure(objectUrl, 'inactive')
      assertStructureIdentity(createdStructure, input)
    }
    plan.actualResources = [{ type: input.adtType, name: input.name }]
    const sourceUrl = sourceUrlFromStructure(createdStructure, objectUrl)
    recordStage('RESOLVE_CREATED_OBJECT', true, sourceUrl)

    const lock = await this.client.lock(objectUrl, 'MODIFY')
    recordStage('LOCK_RESOURCE', true)
    let operationError: unknown
    try {
      try {
        await this.client.setObjectSource(sourceUrl, source, lock.LOCK_HANDLE, input.transportRequest)
      } catch (error) {
        throw unknownWrite('Source write', error)
      }
      recordStage('WRITE_SOURCE', true)
      const checks = await this.client.syntaxCheck(sourceUrl, objectUrl, source, undefined, 'active')
      assertNoCheckErrors(checks, 'RUN_CHECKS')
      recordStage('RUN_CHECKS', true)
    } catch (error) {
      operationError = error
    }
    try {
      await this.client.unLock(objectUrl, lock.LOCK_HANDLE)
      recordStage('UNLOCK_RESOURCE', true)
    } catch (unlockError) {
      recordStage('UNLOCK_RESOURCE', false, errorDetail(unlockError))
      // Preserve an earlier unknown write as the primary outcome; otherwise an
      // unknown unlock blocks activation and compensation on its own.
      if (operationError instanceof RepositoryCreationOutcomeUnknownError) throw operationError
      throw unknownWrite('Source object unlock', unlockError)
    }
    if (operationError) throw operationError

    let activation
    try {
      // typed objectReference（必须带 adtcore:type/parentUri）：字符串简写 body
      // 缺这两个字段时激活器无法定位非活动版本——真机表现为"同名已存在/
      // 骨架激活"等假象（sap-dev+sap-demo 双系统 2026-10-09 实证，与受控导入
      // 链同根因，见 docs/evidence/repository-import-real-dev-verified.md）
      activation = await this.client.activate({
        'adtcore:uri': objectUrl,
        'adtcore:type': input.adtType,
        'adtcore:name': input.name,
        'adtcore:parentUri': payload.packageUrl
      }, true)
    } catch (error) {
      throw unknownWrite('Source object activation', error)
    }
    assertActivation(activation, 'ACTIVATE_OBJECT')
    recordStage('ACTIVATE_OBJECT', true)
    const active = await artifactClient.objectStructure(objectUrl, 'workingArea')
    assertStructureIdentity(active, input)
    const activeSourceUrl = sourceUrlFromStructure(active, objectUrl)
    const actualSource = await artifactClient.getObjectSource(activeSourceUrl, { version: 'workingArea' })
    const comparison = input.objectKind === 'ABAP_CLASS'
      ? compareAbapClassSources(source, actualSource)
      : compareSources(source, actualSource)
    if (!comparison.matches) throw new Error(`Activated source for ${input.name} does not match the confirmed plan.`)
    recordStage('VERIFY_ACTIVE_OBJECT', true)
    recordStage('VERIFY_SOURCE', true, comparison.matchType)
    return {
      resultSummary: `Created, activated, and verified ${this.objectKind} ${input.name}.`,
      actualResources: [{ type: input.adtType, name: input.name }]
    }
  }

  async compensate(
    plan: RepositoryCreationPlan,
    recordStage: (stage: string, success: boolean, message?: string) => void
  ): Promise<boolean> {
    const payload = sourceObjectPayload(plan)
    const { input, objectUrl } = payload
    if (!plan.actualResources?.some(resource => resource.type === input.adtType && resource.name === input.name)) return false
    const lock = await this.client.lock(objectUrl, 'MODIFY')
    recordStage('COMPENSATION_LOCK_RESOURCE', true)
    await this.client.deleteObject(objectUrl, lock.LOCK_HANDLE, input.transportRequest)
    assertTargetAbsent(await this.client.searchObject(input.name, input.adtType, 10), input.name, input.adtType)
    recordStage('COMPENSATE_CREATED_OBJECT', true)
    return true
  }

  private requireStatelessClassClient(): ControlledCreationAdtClient {
    const stateless = this.client.getStatelessControlledCreationClient?.()
    if (!stateless) throw new Error('Controlled stateless ABAP class creation is unavailable in this ADT client.')
    return stateless
  }
}

function assertSourceFrame(
  kind: ControlledSourceObjectKind,
  name: string,
  source: string,
  referencedObjectName?: string
): void {
  if (!source.trim()) throw new Error('source is required.')
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (kind === 'ABAP_CLASS') {
    if (!new RegExp(`\\bCLASS\\s+${escaped}\\s+DEFINITION\\b`, 'i').test(source)
      || !new RegExp(`\\bCLASS\\s+${escaped}\\s+IMPLEMENTATION\\b`, 'i').test(source)) {
      throw new Error(`Class source must contain complete ${name} DEFINITION and IMPLEMENTATION blocks.`)
    }
    const definitionHeader = source.match(new RegExp(`\\bCLASS\\s+${escaped}\\s+DEFINITION\\b([\\s\\S]*?)\\.`, 'i'))?.[1] || ''
    if (!/\bPUBLIC\b/i.test(definitionHeader) || !/\bFINAL\b/i.test(definitionHeader)) {
      throw new Error(`Class source must preserve the controlled public and final defaults for ${name}.`)
    }
  } else if (kind === 'ABAP_INTERFACE'
    && !new RegExp(`\\bINTERFACE\\s+${escaped}\\b[\\s\\S]*\\bENDINTERFACE\\s*\\.`, 'i').test(source)) {
    throw new Error(`Interface source must contain a complete ${name} interface block.`)
  } else if (kind === 'CDS_DATA_DEFINITION'
    && !/\b(?:define|extend)\s+(?:root\s+)?(?:view(?:\s+entity)?|projection\s+view|custom\s+entity|abstract\s+entity|table\s+function|table\s+entity|hierarchy)\b/i.test(source)) {
    // A DDLS repository name is independent from the entity declared in its source.
    throw new Error('CDS data definition source must contain a supported define or extend statement.')
  } else if (kind === 'CDS_ACCESS_CONTROL') {
    if (!new RegExp(`\\bDEFINE\\s+ROLE\\s+${escaped}\\b`, 'i').test(source)) {
      throw new Error(`CDS access control source must define role ${name}.`)
    }
    assertSourceReferences(source, 'on', referencedObjectName!)
  } else if (kind === 'CDS_METADATA_EXTENSION') {
    assertSourceReferences(source, 'annotate(?:\\s+entity)?', referencedObjectName!)
  } else if (kind === 'CDS_ANNOTATION_DEFINITION'
    && !new RegExp(`\\bDEFINE\\s+ANNOTATION\\s+${escaped}\\b`, 'i').test(source)) {
    throw new Error(`CDS annotation definition source must define annotation ${name}.`)
  } else if (kind === 'SERVICE_DEFINITION') {
    if (!new RegExp(`\\bDEFINE\\s+SERVICE\\s+${escaped}\\b`, 'i').test(source)) {
      throw new Error(`Service definition source must define service ${name}.`)
    }
    assertSourceReferences(source, 'expose', referencedObjectName!)
  } else if (kind === 'BEHAVIOR_DEFINITION') {
    assertSourceReferences(source, 'define\\s+behavior\\s+for', referencedObjectName!)
  } else if (kind === 'CDS_TYPE'
    && !new RegExp(`\\bDEFINE\\s+TYPE\\s+${escaped}\\s*:`, 'i').test(source)) {
    throw new Error(`CDS type source must define type ${name}.`)
  } else if (kind === 'CDS_ASPECT'
    && !new RegExp(`\\bDEFINE\\s+ASPECT\\s+${escaped}\\s*\\{[\\s\\S]*\\}`, 'i').test(source)) {
    throw new Error(`CDS aspect source must define aspect ${name}.`)
  } else if (kind === 'CDS_ENTITY_BUFFER') {
    assertSourceReferences(source, 'define\\s+view\\s+entity\\s+buffer\\s+on', referencedObjectName!)
    if (!/\blayer\s+(?:core|transactional)\b/i.test(source)
      || !/\btype\s+(?:single|full|generic)\b/i.test(source)) {
      throw new Error('Entity buffer source must define a controlled layer and buffer type.')
    }
  }
}

function needsReference(kind: ControlledSourceObjectKind): boolean {
  return kind === 'CDS_ACCESS_CONTROL'
    || kind === 'CDS_METADATA_EXTENSION'
    || kind === 'SERVICE_DEFINITION'
    || kind === 'BEHAVIOR_DEFINITION'
    || kind === 'CDS_ENTITY_BUFFER'
}

function referenceSearchType(kind: ControlledSourceObjectKind): string {
  return kind === 'CDS_METADATA_EXTENSION' ? 'DDLS/DF' : 'STOB'
}

function referenceMatch(matches: SearchResult[], name: string, type: string): SearchResult | undefined {
  const upper = name.toUpperCase()
  return matches.find(match => match['adtcore:name'].toUpperCase() === upper
    && (type === 'STOB' ? match['adtcore:type'].toUpperCase().startsWith('STOB') : match['adtcore:type'] === type))
}

async function assertActiveReference(
  client: ControlledCreationAdtClient,
  reference: SearchResult,
  kind: ControlledSourceObjectKind
): Promise<void> {
  const active = await client.objectStructure(activeReferenceUrl(reference), 'active')
  if (String(active.metaData['adtcore:version']).toLowerCase() !== 'active') {
    throw new Error(`Referenced object ${reference['adtcore:name']} is not active.`)
  }
  if (kind === 'CDS_METADATA_EXTENSION') {
    const metadata = active.metaData as unknown as Record<string, unknown>
    const sourceType = String(metadata['ddl:sourceType'] || metadata['ddl:source_type'] || '').toLowerCase()
    if (['extend', 'x', 'view entity extend'].includes(sourceType)) {
      throw new Error(`Metadata extensions cannot annotate DDLS extension object ${reference['adtcore:name']}.`)
    }
  }
}

function assertSourceReferences(source: string, keyword: string, referencedObjectName: string): void {
  const escaped = referencedObjectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!new RegExp(`\\b${keyword}\\s+${escaped}\\b`, 'i').test(source)) {
    throw new Error(`Source must reference ${referencedObjectName}.`)
  }
}

function exactMatch(results: SearchResult[], name: string, adtType: string): SearchResult | undefined {
  return results.find(item => item['adtcore:name'].toUpperCase() === name && item['adtcore:type'].toUpperCase() === adtType)
}

function assertStructureIdentity(structure: AbapObjectStructure, input: ControlledSourceObjectInput): void {
  if (String(structure.metaData['adtcore:name'] || '').toUpperCase() !== input.name
    || String(structure.metaData['adtcore:type'] || '').toUpperCase() !== input.adtType) {
    throw new Error(`SAP object identity for ${input.name} does not match the confirmed plan.`)
  }
  if (input.objectKind === 'ABAP_CLASS'
    && (!isClassStructure(structure)
      || structure.metaData['class:visibility'] !== 'public'
      || structure.metaData['class:final'] !== true)) {
    throw new Error(`SAP class defaults for ${input.name} do not match the controlled public and final contract.`)
  }
}

function activeReferenceUrl(reference: SearchResult): string {
  const uri = String(reference['adtcore:uri'] || '')
  if (!String(reference['adtcore:type'] || '').toUpperCase().startsWith('STOB')) return uri
  const objectUrl = uri.split('#')[0].split('?')[0].replace(/\/source\/main\/?$/i, '')
  if (!/^\/sap\/bc\/adt\/ddic\/ddl\/sources\/[^/]+$/i.test(objectUrl)) {
    throw new Error(`Referenced object ${reference['adtcore:name']} did not expose a controlled DDLS object URL.`)
  }
  return objectUrl
}

async function provePostCreateSourceOwnership(
  client: ControlledCreationAdtClient,
  input: ControlledSourceObjectInput,
  objectUrl: string
): Promise<AbapObjectStructure> {
  const exact = (await client.searchObject(input.name, input.adtType, 10)).filter(item => (
    item['adtcore:name'].toUpperCase() === input.name
    && item['adtcore:type'].toUpperCase() === input.adtType
  ))
  if (exact.length !== 1
    || exact[0]['adtcore:uri'] !== objectUrl
    || String(exact[0]['adtcore:packageName'] || '').toUpperCase() !== input.packageName) {
    throw new Error(`SAP did not return one exact owned shell for ${input.name}.`)
  }
  const active = await client.objectStructure(objectUrl, 'active')
  assertStructureIdentity(active, input)
  const metadata = active.metaData as unknown as Record<string, unknown>
  const metadataChecks = {
    version: String(metadata['adtcore:version'] || '').toLowerCase() === 'active',
    description: String(metadata['adtcore:description'] || exact[0]['adtcore:description'] || '') === input.description,
    responsible: sameSapIdentity(metadata['adtcore:responsible'], input.responsible),
    masterLanguage: String(metadata['adtcore:masterLanguage'] || '').toUpperCase() === input.masterLanguage.toUpperCase(),
    masterSystem: sameControlledMasterSystem(metadata['adtcore:masterSystem'], input.masterSystem)
  }
  if (!Object.values(metadataChecks).every(Boolean)) {
    throw new Error(`SAP active shell metadata for ${input.name} does not prove ownership (${Object.entries(metadataChecks).filter(([, matched]) => !matched).map(([key]) => key).join(',')}).`)
  }
  const [transportInfo, transportDetails] = await Promise.all([
    client.transportInfo(objectUrl, input.packageName, 'I'),
    client.transportDetails(input.transportRequest)
  ])
  assertTransportAvailable(transportInfo, transportDetails, input.transportRequest)
  if (String(transportInfo.OBJECTNAME || transportInfo.LOCKS?.OBJECT_KEY?.OBJ_NAME || '').toUpperCase() !== input.name
    || String(transportInfo.URI || '') !== objectUrl) {
    throw new Error(`SAP transport identity for ${input.name} does not prove ownership.`)
  }
  return active
}

function sameSapIdentity(actual: unknown, expected: string): boolean {
  const left = String(actual ?? '').trim().toUpperCase()
  const right = String(expected || '').trim().toUpperCase()
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    return left.replace(/^0+/, '') === right.replace(/^0+/, '')
  }
  return left === right
}

function sourceUrlFromStructure(structure: AbapObjectStructure, objectUrl: string): string {
  // Use the embedded ADT client's proven class-main-include and simple-source
  // resolution instead of constructing a speculative /source/main path.
  const sourceUrl = ADTClient.mainInclude(structure, false)
  if (sourceUrl === objectUrl
    || !sourceUrl.startsWith('/sap/bc/adt/')
    || !sourceUrl.startsWith(`${objectUrl.replace(/\/+$/, '')}/`)
    || sourceUrl.includes('://')
    || /(^|\/)\.\.(\/|$)/.test(sourceUrl)
    || /[?#]/.test(sourceUrl)) {
    throw new Error(`SAP did not return a controlled source URL for ${structure.metaData['adtcore:name']}.`)
  }
  return sourceUrl
}

function sourceObjectPayload(plan: RepositoryCreationPlan): SourceObjectPayload {
  const payload = plan.payload as SourceObjectPayload | undefined
  if (!payload?.input || !payload.source) throw new Error('Source object creation plan payload is unavailable.')
  return payload
}

function unknownWrite(stage: string, error: unknown): RepositoryCreationOutcomeUnknownError {
  return new RepositoryCreationOutcomeUnknownError(`${stage} outcome is unknown: ${errorDetail(error)}`)
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
