import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import {
  QualityCheckConfirmation,
  type QualityCheckConfirmationOptions,
  type QualityCheckStatusReader
} from '../safe/QualityCheckConfirmation.js';
import type {
  QualityCheckPreviewResult,
  QualityVariantRequiredResult
} from '../safe/qualityTypes.js';
import type { PreviewQualityCheckInput } from '../safe/QualityCheckWorkflow.js';
import type { ToolDefinition } from '../types/tools.js';
import { serializeJsonText } from '../lib/jsonResponse';

export interface SafeQualityWorkflowPort extends QualityCheckStatusReader {
  preview(input: PreviewQualityCheckInput): Promise<QualityCheckPreviewResult | QualityVariantRequiredResult>;
}

const SAFE_QUALITY_TOOL_NAMES = new Set([
  'previewQualityCheck',
  'runQualityCheck',
  'getQualityCheckStatus'
]);

export class SafeQualityHandlers {
  private readonly confirmation: QualityCheckConfirmation;

  constructor(
    private readonly workflow: SafeQualityWorkflowPort,
    confirmationOptions: QualityCheckConfirmationOptions
  ) {
    this.confirmation = new QualityCheckConfirmation(workflow, confirmationOptions);
  }

  supports(toolName: string): boolean {
    return SAFE_QUALITY_TOOL_NAMES.has(toolName);
  }

  getTools(): ToolDefinition[] {
    return [
      qualityTool(
        'previewQualityCheck',
        'Resolve and freeze one bounded DEV ABAP Unit or ATC plan without executing the quality check.',
        previewSchema(),
        true,
        false
      ),
      qualityTool(
        'runQualityCheck',
        'Open one native confirmation and run the frozen quality plan exactly once; unknown outcomes are never retried.',
        planIdSchema(),
        false,
        true
      ),
      qualityTool(
        'getQualityCheckStatus',
        'Read the local status and bounded result summary of one quality-check plan.',
        planIdSchema(),
        true,
        false
      )
    ];
  }

  async handle(toolName: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    switch (toolName) {
      case 'previewQualityCheck':
        return render(await this.workflow.preview(args as unknown as PreviewQualityCheckInput));
      case 'runQualityCheck':
        return this.confirmation.confirmAndRun(String(args.qualityPlanId || ''));
      case 'getQualityCheckStatus':
        return render({ status: 'success', plan: this.workflow.status(String(args.qualityPlanId || '')) });
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown safe quality tool: ${toolName}`);
    }
  }
}

function qualityTool(
  name: string,
  description: string,
  inputSchema: ToolDefinition['inputSchema'],
  readOnlyHint: boolean,
  approvalRequired: boolean
): ToolDefinition {
  return {
    name,
    description,
    inputSchema: { ...inputSchema, additionalProperties: false },
    annotations: {
      readOnlyHint,
      destructiveHint: !readOnlyHint,
      idempotentHint: readOnlyHint,
      openWorldHint: true
    },
    _meta: { operationClass: readOnlyHint ? 'read-only tenant' : 'mutating tenant', approvalRequired }
  };
}

function previewSchema(): ToolDefinition['inputSchema'] {
  return {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['ABAP_UNIT', 'ATC'] },
      objects: {
        type: 'array', minItems: 1, maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            objectType: { type: 'string', enum: ['PROGRAM', 'INCLUDE', 'CLASS', 'FUNCTION_MODULE'] },
            objectName: { type: 'string', minLength: 1, maxLength: 128 }
          },
          required: ['objectType', 'objectName']
        }
      },
      variant: { type: 'string', minLength: 1, maxLength: 64, optional: true },
      riskLevel: { type: 'string', enum: ['HARMLESS', 'DANGEROUS', 'CRITICAL'], optional: true },
      duration: { type: 'string', enum: ['SHORT', 'MEDIUM', 'LONG'], optional: true },
      timeoutSeconds: { type: 'number', minimum: 5, maximum: 600, optional: true }
    },
    required: ['kind', 'objects']
  };
}

function planIdSchema(): ToolDefinition['inputSchema'] {
  return {
    type: 'object',
    properties: {
      qualityPlanId: { type: 'string', minLength: 1, maxLength: 128 }
    },
    required: ['qualityPlanId']
  };
}

function render(value: unknown): Record<string, unknown> {
  const structuredContent = value as Record<string, unknown>;
  return {
    content: [{ type: 'text', text: serializeJsonText(structuredContent) }],
    structuredContent
  };
}
