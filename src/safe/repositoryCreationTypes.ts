import type { ToolDefinition } from '../types/tools.js';
import type { ToolProfile } from './types.js';

export const REPOSITORY_OBJECT_KINDS = [
  'PROGRAM',
  'FUNCTION_GROUP',
  'FUNCTION_GROUP_INCLUDE',
  'FUNCTION_MODULE',
  'PACKAGE',
  'DATABASE_TABLE',
  'DDIC_TABLE_TYPE',
  'DDIC_STRUCTURE',
  'DDIC_DOMAIN',
  'DATA_ELEMENT',
  'MESSAGE_CLASS',
  'DDIC_TYPE_GROUP',
  'DDIC_LOCK_OBJECT',
  'LOGICAL_EXTERNAL_SCHEMA',
  'NUMBER_RANGE_OBJECT',
  'SAP_OBJECT_TYPE',
  'SAP_OBJECT_NODE_TYPE',
  'CHANGE_DOCUMENT_OBJECT',
  'ABAP_CLASS',
  'ABAP_INTERFACE',
  'PROGRAM_INCLUDE',
  'CDS_DATA_DEFINITION',
  'CDS_ACCESS_CONTROL',
  'CDS_METADATA_EXTENSION',
  'CDS_ANNOTATION_DEFINITION',
  'SERVICE_DEFINITION',
  'BEHAVIOR_DEFINITION',
  'CDS_TYPE',
  'CDS_ASPECT',
  'CDS_ENTITY_BUFFER',
  'SERVICE_BINDING'
] as const;

export type RepositoryObjectKind = typeof REPOSITORY_OBJECT_KINDS[number];

export type RepositoryCreationMaturity =
  | 'DISCOVERED'
  | 'SCHEMA_EXTRACTED'
  | 'CLIENT_IMPLEMENTED'
  | 'CONTROLLED_IMPLEMENTED'
  | 'AUTOMATION_VERIFIED'
  | 'REAL_DEV_VERIFIED'
  | 'UNAVAILABLE';

export type RepositoryCreationEvidenceSource =
  | 'CURRENT_CONTROLLED_WORKFLOW'
  | 'ECLIPSE_ADT_3_60_2'
  | 'ECLIPSE_COMMUNICATION_LOG'
  | 'TARGET_ADT_DISCOVERY'
  | 'ABAP_ADT_API_8_4_2'
  | 'VSCODE_ABAP_REMOTE_FS'
  | 'REAL_DEV_EXECUTION';

export interface RepositoryCreationContext {
  systemHost?: string;
  client?: string;
  /**
   * M2-A 目标系统 BASIS release（数值 751 = 7.51）：registry 清单与 preview
   * 按 REPOSITORY_CREATION_KIND_MIN_RELEASE 收窄 RAP 时代 kind。undefined
   * （指纹未接入/不可得）= 不收窄，目录与既有版本零变化。
   */
  basisRelease?: number;
  sapUser?: string;
  systemRole: string;
  toolProfile: ToolProfile;
  allowedNamespaces?: string[];
  realDevValidationEnabled?: boolean;
  realDevValidationObjects?: string[];
  realDevValidationPrefix?: string;
  realDevValidationPackage?: string;
  realDevValidationTransport?: string;
}

export type RepositoryCreationPlanStatus =
  | 'PREVIEWED'
  | 'APPLYING'
  | 'APPLIED'
  | 'FAILED'
  | 'OUTCOME_UNKNOWN'
  | 'COMPENSATED'
  | 'COMPENSATION_FAILED'
  | 'EXPIRED';

export interface RepositoryCreationStageResult {
  stage: string;
  success: boolean;
  timestamp: string;
  message?: string;
}

export interface RepositoryCreationTarget {
  objectKind: RepositoryObjectKind;
  objectName: string;
  adtType: string;
  parentName?: string;
  packageName?: string;
}

export interface RepositoryCreationPlan {
  creationPlanId: string;
  createdAt: number;
  expiresAt: number;
  status: RepositoryCreationPlanStatus;
  terminalAt?: number;
  context: RepositoryCreationContext;
  target: RepositoryCreationTarget;
  transportRequest?: string;
  summary: string;
  payloadHash: string;
  payloadBytes: number;
  payload?: unknown;
  stages: RepositoryCreationStageResult[];
  compensationLimits: string[];
  actualResources?: Array<{ type: string; name: string }>;
  resultSummary?: string;
  primaryError?: { code: string; stage: string; message: string; details?: Record<string, unknown> };
}

export type RepositoryCreationPlanView = Omit<RepositoryCreationPlan, 'createdAt' | 'expiresAt' | 'terminalAt' | 'payload' | 'context'> & {
  createdAt: string;
  expiresAt: string;
  terminalAt?: string;
  systemHost: string;
  client: string;
  sapUser: string;
  systemRole: string;
  toolProfile: ToolProfile;
};

export interface PreparedRepositoryCreation {
  target: RepositoryCreationTarget;
  transportRequest?: string;
  summary: string;
  payload: unknown;
  review: Record<string, unknown>;
  compensationLimits: string[];
}

export interface RepositoryCreationExecutionResult {
  resultSummary: string;
  actualResources: Array<{ type: string; name: string }>;
}

export interface RepositoryObjectCreationAdapter {
  readonly objectKind: RepositoryObjectKind;
  prepare(request: Record<string, unknown>): Promise<PreparedRepositoryCreation>;
  execute(
    plan: RepositoryCreationPlan,
    recordStage: (stage: string, success: boolean, message?: string) => void
  ): Promise<RepositoryCreationExecutionResult>;
  compensate?(
    plan: RepositoryCreationPlan,
    recordStage: (stage: string, success: boolean, message?: string) => void
  ): Promise<boolean>;
}

export interface RepositoryCreationRequirements {
  source: boolean;
  attributes: boolean;
  technicalSettings: boolean;
  transportRequest: boolean;
  separateActivation: boolean;
}

export interface RepositoryCreationCapabilityDefinition {
  objectKind: RepositoryObjectKind;
  adtType: string;
  displayName: string;
  family: string;
  parentKind?: RepositoryObjectKind | 'PACKAGE';
  maturity: RepositoryCreationMaturity;
  targetAvailable: boolean;
  targetUnavailableReason?: string;
  evidenceSources: RepositoryCreationEvidenceSource[];
  requirements: RepositoryCreationRequirements;
  summary: string;
  inputSchema: ToolDefinition['inputSchema'];
  fixedDefaults: Record<string, string | number | boolean>;
  validationRules: string[];
  executionStages: string[];
  compensationLimits: string[];
}

export interface RepositoryCreationCapabilityView {
  objectKind: RepositoryObjectKind;
  adtType: string;
  displayName: string;
  family: string;
  parentKind?: RepositoryObjectKind | 'PACKAGE';
  maturity: RepositoryCreationMaturity;
  available: boolean;
  writable: boolean;
  unavailableReason?: string;
  evidenceSources: RepositoryCreationEvidenceSource[];
  requirements: RepositoryCreationRequirements;
}

export interface RepositoryCreationDescription extends RepositoryCreationCapabilityView {
  summary: string;
  inputSchema: ToolDefinition['inputSchema'];
  fixedDefaults: Record<string, string | number | boolean>;
  validationRules: string[];
  executionStages: string[];
  compensationLimits: string[];
}
