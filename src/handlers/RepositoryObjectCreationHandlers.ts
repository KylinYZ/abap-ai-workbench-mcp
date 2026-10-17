import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { RepositoryObjectCreationRegistry } from '../safe/RepositoryObjectCreationRegistry.js';
import {
  RepositoryObjectCreationConfirmation,
  type RepositoryCreationConfirmationOptions,
  type RepositoryCreationStatusReader
} from '../safe/RepositoryObjectCreationConfirmation.js';
import {
  RepositoryObjectCleanupConfirmation,
  type RepositoryCleanupConfirmationOptions,
  type RepositoryCleanupStatusReader
} from '../safe/RepositoryObjectCleanupConfirmation.js';
import { SafeAbapError } from '../safe/errors.js';
import type { RepositoryCreationContext } from '../safe/repositoryCreationTypes.js';
import { REPOSITORY_OBJECT_KINDS } from '../safe/repositoryCreationTypes.js';
import type { ToolDefinition } from '../types/tools.js';
import { serializeJsonText } from '../lib/jsonResponse';

const REPOSITORY_CREATION_TOOL_NAMES = new Set([
  'listRepositoryObjectCreationCapabilities',
  'describeRepositoryObjectCreation',
  'previewRepositoryObjectCreation',
  'applyRepositoryObjectCreation',
  'getRepositoryObjectCreationStatus',
  'previewRepositoryObjectCleanup',
  'applyRepositoryObjectCleanup',
  'getRepositoryObjectCleanupStatus'
]);

export const REPOSITORY_VALIDATION_CLEANUP_TOOL_NAMES = new Set([
  'previewRepositoryObjectCleanup',
  'applyRepositoryObjectCleanup',
  'getRepositoryObjectCleanupStatus'
]);

export interface RepositoryCreationWorkflowPort extends RepositoryCreationStatusReader {
  preview(request: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface RepositoryCleanupWorkflowPort extends RepositoryCleanupStatusReader {
  preview(request: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export class RepositoryObjectCreationHandlers {
  private readonly confirmation?: RepositoryObjectCreationConfirmation;
  private readonly cleanupConfirmation?: RepositoryObjectCleanupConfirmation;

  constructor(
    private readonly registry: RepositoryObjectCreationRegistry,
    private readonly context: RepositoryCreationContext,
    private readonly workflow?: RepositoryCreationWorkflowPort,
    confirmationOptions?: RepositoryCreationConfirmationOptions,
    private readonly cleanupWorkflow?: RepositoryCleanupWorkflowPort,
    cleanupConfirmationOptions?: RepositoryCleanupConfirmationOptions,
    /**
     * M2-A release 解析器（可选注入）：list/describe 前解析目标系统 BASIS
     * release 并合并进 context 副本，registry 据此收窄 RAP 时代 kind。
     * 未注入 = 指纹未接入，context 原样使用（行为零变化）。
     */
    private readonly releaseResolver?: () => Promise<number | undefined>
  ) {
    if (workflow && confirmationOptions) {
      this.confirmation = new RepositoryObjectCreationConfirmation(workflow, confirmationOptions);
    }
    if (cleanupWorkflow && cleanupConfirmationOptions) {
      this.cleanupConfirmation = new RepositoryObjectCleanupConfirmation(cleanupWorkflow, cleanupConfirmationOptions);
    }
  }

  supports(toolName: string): boolean {
    return REPOSITORY_CREATION_TOOL_NAMES.has(toolName);
  }

  getTools(includeValidationCleanup = true): ToolDefinition[] {
    const tools = [
      readOnlyTool(
        'listRepositoryObjectCreationCapabilities',
        'List bounded repository-object creation capabilities and their current maturity without changing SAP.',
        { type: 'object', properties: {}, additionalProperties: false }
      ),
      readOnlyTool(
        'describeRepositoryObjectCreation',
        'Describe the controlled input schema, validation, stages, and compensation limits for one repository-object kind.',
        {
          type: 'object',
          properties: {
            objectKind: {
              type: 'string',
              description: 'Stable repository object kind',
              enum: [...REPOSITORY_OBJECT_KINDS]
            }
          },
          required: ['objectKind'],
          additionalProperties: false
        }
      ),
      readOnlyTool(
        'previewRepositoryObjectCreation',
        'Validate and freeze one controlled repository-object creation plan without writing SAP.',
        previewSchema()
      ),
      mutatingTool(
        'applyRepositoryObjectCreation',
        'Open one native confirmation and apply one immutable repository-object creation plan exactly once.',
        planIdSchema()
      ),
      localTool(
        'getRepositoryObjectCreationStatus',
        'Read the local status, stages, verification, and recovery evidence for one repository creation plan.',
        planIdSchema()
      )
    ];
    if (includeValidationCleanup) {
      tools.push(
        readOnlyTool(
          'previewRepositoryObjectCleanup',
          'Freeze one SAP DEV object cleanup after checking namespace, identity, transport, and dependencies.',
          cleanupPreviewSchema()
        ),
        mutatingTool(
          'applyRepositoryObjectCleanup',
          'Open a separate native deletion confirmation and execute one cleanup plan exactly once.',
          cleanupPlanIdSchema()
        ),
        localTool(
          'getRepositoryObjectCleanupStatus',
          'Read local evidence and final status for one repository cleanup plan.',
          cleanupPlanIdSchema()
        )
      );
    }
    return tools;
  }

  async handle(
    toolName: string,
    args: Record<string, unknown> = {},
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    switch (toolName) {
      case 'listRepositoryObjectCreationCapabilities':
        return render({ status: 'success', capabilities: this.registry.list(await this.contextWithRelease()) });
      case 'describeRepositoryObjectCreation':
        return render({
          status: 'success',
          capability: this.registry.describe(String(args.objectKind || ''), await this.contextWithRelease())
        });
      case 'previewRepositoryObjectCreation':
        return render(await this.requireWorkflow().preview(args));
      case 'applyRepositoryObjectCreation':
        if (!this.confirmation) throw new SafeConfigurationError();
        return this.confirmation.confirmAndApply(String(args.creationPlanId || ''), signal);
      case 'getRepositoryObjectCreationStatus':
        return render({ status: 'success', plan: this.requireWorkflow().status(String(args.creationPlanId || '')) });
      case 'previewRepositoryObjectCleanup':
        return render(await this.requireCleanupWorkflow().preview(args));
      case 'applyRepositoryObjectCleanup':
        this.requireCleanupWorkflow();
        if (!this.cleanupConfirmation) throw new SafeConfigurationError();
        return this.cleanupConfirmation.confirmAndApply(String(args.cleanupPlanId || ''), signal);
      case 'getRepositoryObjectCleanupStatus':
        return render({ status: 'success', plan: this.requireCleanupWorkflow().status(String(args.cleanupPlanId || '')) });
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown repository creation tool: ${toolName}`);
    }
  }

  private requireWorkflow(): RepositoryCreationWorkflowPort {
    if (!this.workflow) throw new SafeConfigurationError();
    return this.workflow;
  }

  private requireCleanupWorkflow(): RepositoryCleanupWorkflowPort {
    if (!this.cleanupWorkflow) throw new SafeConfigurationError();
    return this.cleanupWorkflow;
  }

  /** M2-A：context 副本合并 release 指纹（未注入 resolver 时原样返回）。 */
  private async contextWithRelease(): Promise<RepositoryCreationContext> {
    if (!this.releaseResolver) return this.context;
    const basisRelease = await this.releaseResolver();
    return basisRelease === undefined ? this.context : { ...this.context, basisRelease };
  }
}

function readOnlyTool(name: string, description: string, inputSchema: ToolDefinition['inputSchema']): ToolDefinition {
  return {
    name,
    description,
    inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    _meta: { operationClass: 'read-only tenant', approvalRequired: false }
  };
}

function mutatingTool(name: string, description: string, inputSchema: ToolDefinition['inputSchema']): ToolDefinition {
  return {
    name, description, inputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    _meta: { operationClass: 'mutating tenant', approvalRequired: true }
  };
}

function localTool(name: string, description: string, inputSchema: ToolDefinition['inputSchema']): ToolDefinition {
  return {
    name, description, inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { operationClass: 'local-only', approvalRequired: false }
  };
}

function planIdSchema(): ToolDefinition['inputSchema'] {
  return {
    type: 'object',
    properties: { creationPlanId: { type: 'string', minLength: 1, maxLength: 128 } },
    required: ['creationPlanId'],
    additionalProperties: false
  };
}

function cleanupPlanIdSchema(): ToolDefinition['inputSchema'] {
  return {
    type: 'object',
    properties: { cleanupPlanId: { type: 'string', minLength: 1, maxLength: 128 } },
    required: ['cleanupPlanId'],
    additionalProperties: false
  };
}

function cleanupPreviewSchema(): ToolDefinition['inputSchema'] {
  return {
    type: 'object',
    properties: {
      objectKind: { type: 'string', enum: [...REPOSITORY_OBJECT_KINDS] },
      name: { type: 'string', minLength: 1, maxLength: 128 },
      parentName: { type: 'string', minLength: 1, maxLength: 128, optional: true },
      creationPlanId: {
        type: 'string', minLength: 8, maxLength: 64, optional: true,
        description: 'Bind this cleanup to one FAILED/OUTCOME_UNKNOWN/COMPENSATION_FAILED creation plan to recover its leftover (identity must match the plan target).'
      }
    },
    required: ['objectKind', 'name'],
    additionalProperties: false
  };
}

function previewSchema(): ToolDefinition['inputSchema'] {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      objectKind: { type: 'string', enum: [...REPOSITORY_OBJECT_KINDS] },
      name: { type: 'string', minLength: 1, maxLength: 128 },
      description: { type: 'string', minLength: 1, maxLength: 120 },
      packageName: { type: 'string', maxLength: 30, optional: true },
      parentPackageName: { type: 'string', maxLength: 30, optional: true },
      parentFunctionGroup: { type: 'string', maxLength: 26, optional: true },
      softwareComponent: { type: 'string', maxLength: 30, optional: true },
      transportLayer: { type: 'string', maxLength: 20, optional: true },
      transportRequest: { type: 'string', minLength: 10, maxLength: 10 },
      source: { type: 'string', optional: true },
      properties: {
        type: 'object', additionalProperties: false, optional: true,
        description: 'Typed DDIC domain or data-element properties.',
        properties: {
          typeInformation: {
            type: 'object', additionalProperties: false, optional: true,
            properties: {
              datatype: { type: 'string', minLength: 1, maxLength: 30 },
              length: { type: 'number', minimum: 1, maximum: 5000 },
              decimals: { type: 'number', minimum: 0, maximum: 31 }
            }, required: ['datatype', 'length', 'decimals']
          },
          outputInformation: {
            type: 'object', additionalProperties: false, optional: true,
            properties: {
              length: { type: 'number', minimum: 1, maximum: 5000 },
              style: { type: 'string', maxLength: 30, optional: true },
              conversionExit: { type: 'string', maxLength: 5, optional: true },
              signExists: { type: 'boolean' },
              lowercase: { type: 'boolean' },
              ampmFormat: { type: 'boolean' }
            }, required: ['length', 'signExists', 'lowercase', 'ampmFormat']
          },
          valueInformation: {
            type: 'object', additionalProperties: false, optional: true,
            properties: {
              valueTableRef: { type: 'string', maxLength: 30, optional: true },
              appendExists: { type: 'boolean' },
              fixValues: {
                type: 'array', maxItems: 100, optional: true,
                items: {
                  type: 'object', additionalProperties: false,
                  properties: {
                    low: { type: 'string', minLength: 1, maxLength: 60 },
                    high: { type: 'string', minLength: 1, maxLength: 60, optional: true },
                    text: { type: 'string', minLength: 1, maxLength: 60, optional: true }
                  }, required: ['low']
                }
              }
            }, required: ['appendExists']
          },
          typeName: { type: 'string', maxLength: 30, optional: true },
          dataType: { type: 'string', minLength: 1, maxLength: 30, optional: true },
          dataTypeLength: { type: 'number', minimum: 1, maximum: 5000, optional: true },
          dataTypeDecimals: { type: 'number', minimum: 0, maximum: 31, optional: true },
          fieldLabels: {
            type: 'object', additionalProperties: false, optional: true,
            properties: {
              shortFieldLabel: { type: 'string', minLength: 1, maxLength: 10 },
              shortFieldLength: { type: 'number', minimum: 1, maximum: 10, optional: true },
              mediumFieldLabel: { type: 'string', minLength: 1, maxLength: 20 },
              mediumFieldLength: { type: 'number', minimum: 1, maximum: 20, optional: true },
              longFieldLabel: { type: 'string', minLength: 1, maxLength: 40 },
              longFieldLength: { type: 'number', minimum: 1, maximum: 40, optional: true },
              headingFieldLabel: { type: 'string', minLength: 1, maxLength: 55 },
              headingFieldLength: { type: 'number', minimum: 1, maximum: 55, optional: true }
            }, required: ['shortFieldLabel', 'mediumFieldLabel', 'longFieldLabel', 'headingFieldLabel']
          },
          searchHelp: { type: 'string', maxLength: 30, optional: true },
          searchHelpParameter: { type: 'string', maxLength: 30, optional: true },
          setGetParameter: { type: 'string', maxLength: 20, optional: true },
          defaultComponentName: { type: 'string', maxLength: 30, optional: true },
          deactivateInputHistory: { type: 'boolean', optional: true },
          changeDocument: { type: 'boolean', optional: true },
          leftToRightDirection: { type: 'boolean', optional: true },
          deactivateBIDIFiltering: { type: 'boolean', optional: true }
        }
      },
      referencedObjectName: { type: 'string', maxLength: 30, optional: true },
      serviceDefinition: { type: 'string', maxLength: 30, optional: true },
      bindingType: { type: 'string', enum: ['ODATA_V2_UI', 'ODATA_V2_WEB_API', 'ODATA_V4_UI', 'ODATA_V4_WEB_API'], optional: true },
      bindingCategory: { type: 'string', enum: ['0', '1'], optional: true },
      defaultRemoteSchemaName: { type: 'string', minLength: 1, maxLength: 255, optional: true },
      abapLanguageVersion: { type: 'string', enum: ['standard', 'cloudDevelopment'], optional: true },
      primaryTable: { type: 'string', minLength: 1, maxLength: 30, optional: true },
      numberLengthDomain: { type: 'string', minLength: 1, maxLength: 30, optional: true },
      percentWarning: { type: 'number', minimum: 0.1, maximum: 99.9, optional: true },
      subType: { type: 'string', minLength: 1, maxLength: 30, optional: true },
      untilYear: { type: 'boolean', optional: true },
      rolling: { type: 'boolean', optional: true },
      prefix: { type: 'boolean', optional: true },
      transactionId: { type: 'string', minLength: 1, maxLength: 20, optional: true },
      buffering: { type: 'string', enum: ['mainBuffer', 'parallel', 'none'], optional: true },
      bufferedNumbers: { type: 'number', minimum: 0, maximum: 99999999, optional: true },
      typeCategory: {
        type: 'string',
        enum: ['businessObject', 'technicalObject', 'analyticalObject', 'configurationObject', 'dependentObject', 'hierarchyObject'],
        optional: true
      },
      sapObjectTypeName: { type: 'string', minLength: 1, maxLength: 30, optional: true },
      rootNode: { type: 'boolean', optional: true },
      category: { type: 'string', enum: ['standard', 'behaviorDefinition'], optional: true },
      tablesAndStructures: {
        type: 'array', minItems: 1, maxItems: 100, optional: true,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 30 },
            referenceTable: { type: 'string', maxLength: 30, optional: true },
            multipleChanges: { type: 'boolean', optional: true },
            databaseInsertions: {
              type: 'object', additionalProperties: false, optional: true,
              properties: {
                logValues: { type: 'boolean', optional: true },
                logInitialValues: { type: 'boolean', optional: true }
              }
            },
            databaseDeletions: {
              type: 'object', additionalProperties: false, optional: true,
              properties: {
                logValues: { type: 'boolean', optional: true },
                logInitialValues: { type: 'boolean', optional: true }
              }
            }
          },
          required: ['name']
        }
      },
      errorMessage: {
        type: 'object', additionalProperties: false, optional: true,
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 20 },
          number: { type: 'string', minLength: 3, maxLength: 3 }
        },
        required: ['id', 'number']
      },
      initialFunctionModule: {
        type: 'object', additionalProperties: false, optional: true,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 30 },
          description: { type: 'string', minLength: 1, maxLength: 120 },
          source: { type: 'string', minLength: 1 }
        },
        required: ['name', 'description', 'source']
      },
      fields: {
        type: 'array', minItems: 1, maxItems: 500, optional: true,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 30 },
            key: { type: 'boolean', optional: true },
            type: { type: 'string', minLength: 1, maxLength: 128 },
            length: { type: 'number', minimum: 1, maximum: 5000, optional: true },
            decimals: { type: 'number', minimum: 0, maximum: 31, optional: true },
            notNull: { type: 'boolean', optional: true },
            description: { type: 'string', maxLength: 120, optional: true },
            referenceField: { type: 'string', maxLength: 30, optional: true }
          },
          required: ['name', 'type']
        }
      },
      rowType: {
        type: 'object', additionalProperties: false, optional: true,
        properties: {
          typeKind: { type: 'string', enum: ['predefinedAbapType', 'dictionaryType', 'referenceToPredefinedType', 'referenceToDictionaryType', 'referenceToClassInterface', 'rangeTableOnPredefinedType', 'rangeTableOnDataElement'] },
          typeName: { type: 'string', maxLength: 30, optional: true },
          dataType: { type: 'string', maxLength: 30, optional: true },
          length: { type: 'number', minimum: 1, maximum: 5000, optional: true },
          decimals: { type: 'number', minimum: 0, maximum: 31, optional: true },
          rangeType: { type: 'string', maxLength: 30, optional: true }
        }, required: ['typeKind']
      },
      initialRowCount: { type: 'number', minimum: 0, maximum: 99999, optional: true },
      accessType: { type: 'string', enum: ['standard', 'sorted', 'hashed', 'index'], optional: true },
      primaryKey: {
        type: 'object', additionalProperties: false, optional: true,
        properties: {
          definition: { type: 'string', enum: ['standard', 'rowType', 'keyComponents', 'empty'], optional: true },
          kind: { type: 'string', enum: ['unique', 'nonUnique'], optional: true }
        }
      },
      secondaryKeys: {
        type: 'object', additionalProperties: false, optional: true,
        properties: { allowed: { type: 'string', enum: ['allowed', 'notAllowed', 'notSpecified'], optional: true } }
      },
      technicalSettings: {
        type: 'object', additionalProperties: false, optional: true,
        properties: {
          dataClass: { type: 'string', enum: ['APPL0', 'APPL1', 'APPL2', 'APPL3', 'USER'] },
          sizeCategory: { type: 'number', minimum: 0, maximum: 9 },
          buffering: { type: 'string', enum: ['NOT_ALLOWED'] },
          loggingEnabled: { type: 'boolean' }
        }
      }
    },
    required: ['objectKind', 'name', 'description', 'transportRequest']
  };
}

class SafeConfigurationError extends McpError {
  constructor() {
    super(ErrorCode.InternalError, 'Repository creation workflow is not configured.');
  }
}

function render(structuredContent: Record<string, unknown>): Record<string, unknown> {
  return {
    content: [{ type: 'text', text: serializeJsonText(structuredContent) }],
    structuredContent
  };
}
