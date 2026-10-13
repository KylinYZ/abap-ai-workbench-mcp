import { adtException } from '../AdtException'
import type { AdtHTTP } from '../AdtHTTP'
import { encodeEntity, fullParse, xmlArray } from '../utilities'
import type { ValidationResult } from './objectcreator'
import { requireCanonicalCreationLocation } from './creationLocation'

export type ControlledSourceObjectKind =
  | 'ABAP_CLASS'
  | 'ABAP_INTERFACE'
  | 'PROGRAM_INCLUDE'
  | 'CDS_DATA_DEFINITION'
  | 'CDS_ACCESS_CONTROL'
  | 'CDS_METADATA_EXTENSION'
  | 'CDS_ANNOTATION_DEFINITION'
  | 'SERVICE_DEFINITION'
  | 'BEHAVIOR_DEFINITION'
  | 'CDS_TYPE'
  | 'CDS_ASPECT'
  | 'CDS_ENTITY_BUFFER'
export type ControlledSourceObjectAdtType =
  | 'CLAS/OC'
  | 'INTF/OI'
  | 'PROG/I'
  | 'DDLS/DF'
  | 'DCLS/DL'
  | 'DDLX/EX'
  | 'DDLA/ADF'
  | 'SRVD/SRV'
  | 'BDEF/BDO'
  | 'DRTY/STY'
  | 'DRAS/RAS'
  | 'DTEB/DF'

export interface ControlledSourceObjectInput {
  objectKind: ControlledSourceObjectKind
  adtType: ControlledSourceObjectAdtType
  name: string
  description: string
  packageName: string
  transportRequest: string
  language: string
  masterLanguage: string
  masterSystem: string
  responsible: string
}

export interface ControlledSourceObjectCreationResult {
  location: string
  name: string
  adtType: ControlledSourceObjectAdtType
  ownershipEvidence?: 'CANONICAL_LOCATION' | 'POST_CREATE_READBACK_REQUIRED'
}

interface SourceObjectContract {
  validationPath: string
  collectionPath: string
  rootName: string
  namespace: string
  contentType: string
  accept: string
}

const SOURCE_OBJECT_VALIDATION_ACCEPT = 'application/vnd.sap.as+xml'

// 导出给受控导入链复用（同款 Content-Type/Accept/collection 契约，保证建壳
// 请求形态与受控创建链逐字节一致）；修改契约时两条链同步生效。
export const CONTRACTS: Record<ControlledSourceObjectKind, SourceObjectContract> = {
  ABAP_CLASS: {
    validationPath: '/sap/bc/adt/oo/validation/objectname',
    collectionPath: '/sap/bc/adt/oo/classes',
    rootName: 'class:abapClass',
    namespace: 'xmlns:class="http://www.sap.com/adt/oo/classes"',
    contentType: 'application/vnd.sap.adt.oo.classes.v4+xml',
    accept: [
      'application/vnd.sap.adt.oo.classes.v4+xml',
      'application/vnd.sap.adt.oo.classes.v3+xml',
      'application/vnd.sap.adt.oo.classes.v2+xml',
      'application/vnd.sap.adt.oo.classes+xml'
    ].join(', ')
  },
  ABAP_INTERFACE: {
    validationPath: '/sap/bc/adt/oo/validation/objectname',
    collectionPath: '/sap/bc/adt/oo/interfaces',
    rootName: 'intf:abapInterface',
    namespace: 'xmlns:intf="http://www.sap.com/adt/oo/interfaces"',
    contentType: 'application/vnd.sap.adt.oo.interfaces.v5+xml',
    accept: [
      'application/vnd.sap.adt.oo.interfaces.v5+xml',
      'application/vnd.sap.adt.oo.interfaces.v4+xml',
      'application/vnd.sap.adt.oo.interfaces.v3+xml',
      'application/vnd.sap.adt.oo.interfaces.v2+xml',
      'application/vnd.sap.adt.oo.interfaces+xml'
    ].join(', ')
  },
  PROGRAM_INCLUDE: {
    validationPath: '/sap/bc/adt/includes/validation',
    collectionPath: '/sap/bc/adt/programs/includes',
    rootName: 'include:abapInclude',
    namespace: 'xmlns:include="http://www.sap.com/adt/programs/includes"',
    contentType: 'application/vnd.sap.adt.programs.includes.v2+xml',
    accept: [
      'application/vnd.sap.adt.programs.includes.v2+xml',
      'application/vnd.sap.adt.programs.includes+xml'
    ].join(', ')
  },
  CDS_DATA_DEFINITION: {
    validationPath: '/sap/bc/adt/ddic/ddl/validation',
    collectionPath: '/sap/bc/adt/ddic/ddl/sources',
    rootName: 'ddl:ddlSource',
    namespace: 'xmlns:ddl="http://www.sap.com/adt/ddic/ddlsources"',
    contentType: 'application/*',
    accept: 'application/*'
  },
  CDS_ACCESS_CONTROL: {
    validationPath: '/sap/bc/adt/acm/dcl/validation',
    collectionPath: '/sap/bc/adt/acm/dcl/sources',
    rootName: 'dcl:dclSource',
    namespace: 'xmlns:dcl="http://www.sap.com/adt/acm/dclsources"',
    contentType: 'application/vnd.sap.adt.dclSource+xml',
    accept: 'application/vnd.sap.adt.dclSource+xml'
  },
  CDS_METADATA_EXTENSION: {
    validationPath: '/sap/bc/adt/ddic/ddlx/sources/validation',
    collectionPath: '/sap/bc/adt/ddic/ddlx/sources',
    rootName: 'ddlx:ddlxSource',
    namespace: 'xmlns:ddlx="http://www.sap.com/adt/ddic/ddlxsources"',
    contentType: 'application/vnd.sap.adt.ddic.ddlx.v1+xml',
    accept: 'application/vnd.sap.adt.ddic.ddlx.v1+xml'
  },
  CDS_ANNOTATION_DEFINITION: {
    validationPath: '/sap/bc/adt/ddic/ddla/sources/validation',
    collectionPath: '/sap/bc/adt/ddic/ddla/sources',
    rootName: 'ddla:ddlaSource',
    namespace: 'xmlns:ddla="http://www.sap.com/adt/ddic/ddlasources"',
    contentType: 'application/vnd.sap.adt.ddic.ddla.v1+xml',
    accept: 'application/vnd.sap.adt.ddic.ddla.v1+xml'
  },
  SERVICE_DEFINITION: {
    validationPath: '/sap/bc/adt/ddic/srvd/sources/validation',
    collectionPath: '/sap/bc/adt/ddic/srvd/sources',
    rootName: 'srvd:srvdSource',
    namespace: 'xmlns:srvd="http://www.sap.com/adt/ddic/srvdsources"',
    contentType: 'application/vnd.sap.adt.ddic.srvd.v1+xml',
    accept: 'application/vnd.sap.adt.ddic.srvd.v1+xml'
  },
  BEHAVIOR_DEFINITION: {
    validationPath: '/sap/bc/adt/bo/behaviordefinitions/validation',
    collectionPath: '/sap/bc/adt/bo/behaviordefinitions',
    rootName: 'blue:blueSource',
    namespace: 'xmlns:blue="http://www.sap.com/wbobj/blue"',
    contentType: 'application/vnd.sap.adt.blues.v1+xml',
    accept: 'application/vnd.sap.adt.blues.v1+xml'
  },
  CDS_TYPE: {
    validationPath: '/sap/bc/adt/ddic/drty/sources/validation',
    collectionPath: '/sap/bc/adt/ddic/drty/sources',
    rootName: 'blue:blueSource',
    namespace: 'xmlns:blue="http://www.sap.com/wbobj/blue"',
    contentType: 'application/vnd.sap.adt.blues.v1+xml',
    accept: 'application/vnd.sap.adt.blues.v1+xml'
  },
  CDS_ASPECT: {
    validationPath: '/sap/bc/adt/ddic/dras/sources/validation',
    collectionPath: '/sap/bc/adt/ddic/dras/sources',
    rootName: 'blue:blueSource',
    namespace: 'xmlns:blue="http://www.sap.com/wbobj/blue"',
    contentType: 'application/vnd.sap.adt.blues.v1+xml',
    accept: 'application/vnd.sap.adt.blues.v1+xml'
  },
  CDS_ENTITY_BUFFER: {
    validationPath: '/sap/bc/adt/ddic/dteb/sources/validation',
    collectionPath: '/sap/bc/adt/ddic/dteb/sources',
    rootName: 'dteb:dtebSource',
    namespace: 'xmlns:dteb="http://www.sap.com/adt/ddic/dtebsources"',
    contentType: 'application/vnd.sap.adt.ddic.dteb.v1+xml',
    accept: 'application/vnd.sap.adt.ddic.dteb.v1+xml'
  }
}

export async function validateControlledSourceObject(
  h: AdtHTTP,
  input: ControlledSourceObjectInput
): Promise<ValidationResult> {
  const contract = contractFor(input)
  const response = await h.request(contract.validationPath, {
    method: 'POST',
    qs: {
      objname: input.name,
      description: input.description,
      objtype: input.adtType,
      packagename: input.packageName
    },
    headers: { Accept: SOURCE_OBJECT_VALIDATION_ACCEPT }
  })
  return parseSourceObjectValidation(response.body)
}

export async function createControlledSourceObjectShell(
  h: AdtHTTP,
  input: ControlledSourceObjectInput
): Promise<ControlledSourceObjectCreationResult> {
  const contract = contractFor(input)
  const response = await h.request(contract.collectionPath, {
    method: 'POST',
    qs: { corrNr: input.transportRequest },
    headers: { 'Content-Type': contract.contentType, Accept: contract.accept },
    body: buildControlledSourceObjectXml(input)
  })
  const expectedLocation = controlledSourceObjectUrl(input.objectKind, input.name)
  const responseLocation = String(response.headers.location || response.headers.Location || '').trim()
  if (response.status === 200 && !responseLocation && !String(response.body || '').trim()) {
    // Some target source collections synchronously create an active shell but
    // return neither 201 nor Location. The adapter must prove exact ownership
    // through search, active metadata, current user, package, and CTS before write.
    return {
      location: expectedLocation,
      name: input.name,
      adtType: input.adtType,
      ownershipEvidence: 'POST_CREATE_READBACK_REQUIRED'
    }
  }
  const location = requireCanonicalCreationLocation(response, expectedLocation, 'Source object creation')
  // Some ADT 3.60.2 source collections acknowledge shell creation with an
  // empty body. The canonical Location already binds the response to this
  // plan; preserve strict identity checks whenever SAP sends a representation.
  if (!String(response.body || '').trim()) {
    return { location, name: input.name, adtType: input.adtType, ownershipEvidence: 'CANONICAL_LOCATION' }
  }
  const created = parseSourceObjectIdentity(response.body)
  if (created.name !== input.name || created.adtType !== input.adtType) {
    throw adtException('Source object creation response identity does not match the requested object.')
  }
  return {
    location,
    name: created.name,
    adtType: created.adtType as ControlledSourceObjectAdtType,
    ownershipEvidence: 'CANONICAL_LOCATION'
  }
}

export function controlledSourceObjectUrl(kind: ControlledSourceObjectKind, name: string): string {
  return `${CONTRACTS[kind].collectionPath}/${encodeURIComponent(name.toLowerCase())}`
}

export function buildControlledSourceObjectXml(input: ControlledSourceObjectInput): string {
  const contract = contractFor(input)
  const attr = (value: string) => encodeEntity(value)
  // Eclipse ADT 3.60.2 creates a new class as a public final class with an
  // explicit test-class include and empty superclass reference. Without these
  // child nodes, this target persists an unreadable CLAS/OC shell.
  const controlledAttributes = input.objectKind === 'ABAP_CLASS'
    ? ' class:visibility="public" class:final="true"'
    : input.objectKind === 'SERVICE_DEFINITION'
      ? ' srvd:srvdSourceType="S"'
    : input.objectKind === 'CDS_METADATA_EXTENSION'
      ? ' adtcore:version="active"'
      : ''
  const controlledChildren = input.objectKind === 'ABAP_CLASS'
    ? '\n  <class:include adtcore:name="CLAS/OC" adtcore:type="CLAS/OC" class:includeType="testclasses"/>\n  <class:superClassRef/>'
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<${contract.rootName} xmlns:adtcore="http://www.sap.com/adt/core" ${contract.namespace}${controlledAttributes} adtcore:description="${attr(input.description)}" adtcore:language="${attr(input.language)}" adtcore:name="${attr(input.name)}" adtcore:type="${attr(input.adtType)}" adtcore:masterLanguage="${attr(input.masterLanguage)}" adtcore:masterSystem="${attr(input.masterSystem)}" adtcore:responsible="${attr(input.responsible)}">
  <adtcore:packageRef adtcore:name="${attr(input.packageName)}"/>${controlledChildren}
</${contract.rootName}>`
}

export function parseSourceObjectValidation(xml: string): ValidationResult {
  const raw = fullParse(xml)
  const records = xmlArray(raw, 'asx:abap', 'asx:values', 'DATA') as Array<Record<string, unknown>>
  const record = records[0] || {}
  const severity = String(record.SEVERITY || '')
  const shortText = String(record.SHORT_TEXT || '')
  if (['E', 'ERROR'].includes(severity.toUpperCase())) throw adtException(shortText || 'Source object validation failed.')
  return {
    SEVERITY: severity || undefined,
    SHORT_TEXT: shortText || undefined,
    success: Boolean(record.CHECK_RESULT || severity)
  }
}

function contractFor(input: ControlledSourceObjectInput): SourceObjectContract {
  const expectedType: Record<ControlledSourceObjectKind, ControlledSourceObjectAdtType> = {
    ABAP_CLASS: 'CLAS/OC', ABAP_INTERFACE: 'INTF/OI', PROGRAM_INCLUDE: 'PROG/I',
    CDS_DATA_DEFINITION: 'DDLS/DF', CDS_ACCESS_CONTROL: 'DCLS/DL', CDS_METADATA_EXTENSION: 'DDLX/EX',
    CDS_ANNOTATION_DEFINITION: 'DDLA/ADF', SERVICE_DEFINITION: 'SRVD/SRV',
    BEHAVIOR_DEFINITION: 'BDEF/BDO', CDS_TYPE: 'DRTY/STY', CDS_ASPECT: 'DRAS/RAS',
    CDS_ENTITY_BUFFER: 'DTEB/DF'
  }
  if (expectedType[input.objectKind] !== input.adtType) throw adtException('Source object kind and ADT type do not match.')
  return CONTRACTS[input.objectKind]
}

function parseSourceObjectIdentity(xml: string): { name: string; adtType: string } {
  const tag = String(xml || '').match(
    /<(?:class:abapClass|intf:abapInterface|include:abapInclude|ddl:ddlSource|dcl:dclSource|ddlx:ddlxSource|ddla:ddlaSource|srvd:srvdSource|blue:blueSource|dteb:dtebSource)\b[^>]*>/i
  )?.[0] || ''
  const attributes: Record<string, string> = {}
  for (const match of tag.matchAll(/([:\w-]+)="([^"]*)"/g)) attributes[match[1]] = match[2]
  return {
    name: String(attributes['adtcore:name'] || '').toUpperCase(),
    adtType: String(attributes['adtcore:type'] || '').toUpperCase()
  }
}
