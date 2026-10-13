/**
 * 受控对象导入工具处理器（deploy-zip/fileio.import-export 受控导入链）。
 *
 * 三工具（仅 DEV 角色 + development/development-workbench；门控同受控 UI5 写链）：
 *   1. previewRepositoryObjectImport —— 只读预检（ZIP 解析 + 逐对象存在性/漂移
 *      基线 + 范围校验）并冻结 immutable plan
 *   2. applyRepositoryObjectImport   —— 原生确认后单次批量执行（逐对象漂移复核
 *      → 建/改 → 锁链 → 激活 → readback）
 *   3. getRepositoryObjectImportStatus —— 本地 plan 状态查询（不触 SAP）
 */
import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ElicitRequestFormParams, ElicitResult } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import { SafeAbapError } from '../safe/errors.js';
import type { RepositoryObjectImportWorkflow } from '../safe/RepositoryObjectImportWorkflow.js';

const IMPORT_TOOL_NAMES = new Set([
  'previewRepositoryObjectImport',
  'applyRepositoryObjectImport',
  'getRepositoryObjectImportStatus'
]);

export interface RepositoryImportConfirmationOptions {
  supportsFormElicitation: () => boolean;
  elicitInput: (params: ElicitRequestFormParams, timeoutMs: number) => Promise<ElicitResult>;
  /** 部署级自动确认开关（SAP_MCP_CONFIRMATION_MODE=auto 且 DEV 时由接线层注入）。 */
  autoApprove?: () => boolean;
  /** 确认表单摘要（接线层用 workflow.status 包装）。 */
  planSummary: (planId: string) => {
    packageName: string;
    objectCount: number;
    createCount: number;
    updateCount: number;
    skipCount: number;
    systemHost: string;
    client: string;
  };
}

export class RepositoryObjectImportHandlers {
  constructor(
    private readonly workflow: RepositoryObjectImportWorkflow,
    private readonly confirmation: RepositoryImportConfirmationOptions
  ) {}

  supports(toolName: string): boolean {
    return IMPORT_TOOL_NAMES.has(toolName);
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'previewRepositoryObjectImport',
        description: 'Read-only precheck for importing objects from an abapGit-format ZIP: parses the package offline, per-object existence/drift baseline, scope validation, then freezes an immutable plan for native confirmation. Two modes: transportable (packageName + transportRequest; CLAS/PROG deploy with corrNr) and $ local-package (PROG only - OO activation in local packages is currently broken on the target systems; INTF is skipped in both modes pending the system fix).',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            packageName: { type: 'string', description: 'Target package name: transportable package (with transportRequest) for CLAS/PROG, or $ local package for PROG-only imports.' },
            transportRequest: { type: 'string', description: 'Transportable mode: unreleased transport number registered to the package (required for CLAS; omit for $ local-package PROG-only imports).', optional: true },
            zipBase64: { type: 'string', description: 'abapGit-format ZIP content as base64 (exactly one of zipBase64/zipPath).', optional: true },
            zipPath: { type: 'string', description: 'Absolute local path to an abapGit-format ZIP file (exactly one of zipBase64/zipPath).', optional: true },
            nameFilter: { type: 'string', description: 'Optional case-insensitive substring filter on object names.', optional: true },
            typeFilter: {
              type: 'array',
              description: 'Optional object type filter (subset of CLAS/INTF/PROG).',
              items: { type: 'string', enum: ['CLAS', 'INTF', 'PROG'] },
              optional: true
            }
          },
          required: ['packageName']
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      },
      {
        name: 'applyRepositoryObjectImport',
        description: 'Open one native confirmation and apply one frozen repository import plan exactly once (per-object drift recheck → shell create or update → lock → write sources → syntax check → activate → readback). Stop-on-first-failure; post-write failures terminate as UNKNOWN_OUTCOME.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { importPlanId: { type: 'string', minLength: 1 } },
          required: ['importPlanId']
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        _meta: { operationClass: 'mutating tenant', approvalRequired: true }
      },
      {
        name: 'getRepositoryObjectImportStatus',
        description: 'Read local status for one repository import plan without contacting SAP.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { importPlanId: { type: 'string', minLength: 1 } },
          required: ['importPlanId']
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { operationClass: 'local-only', approvalRequired: false }
      }
    ];
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'previewRepositoryObjectImport') {
        return success(await this.workflow.preview({
          ...argumentsValue,
          ...(argumentsValue.transportRequest !== undefined
            ? { transportRequest: String(argumentsValue.transportRequest).trim().toUpperCase() }
            : {})
        } as never));
      }
      if (toolName === 'applyRepositoryObjectImport') {
        const planId = String(argumentsValue.importPlanId || '');
        if (!planId) throw new McpError(ErrorCode.InvalidParams, 'applyRepositoryObjectImport requires importPlanId.');
        await this.confirm(planId);
        return success(await this.workflow.applyConfirmed(planId));
      }
      if (toolName === 'getRepositoryObjectImportStatus') {
        const planId = String(argumentsValue.importPlanId || '');
        if (!planId) throw new McpError(ErrorCode.InvalidParams, 'getRepositoryObjectImportStatus requires importPlanId.');
        return success(this.workflow.status(planId));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown repository import tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError || error instanceof SafeAbapError) throw error;
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }

  private async confirm(planId: string): Promise<void> {
    // 部署级自动确认开关：SAP_MCP_CONFIRMATION_MODE=auto（仅 DEV）时跳过人工表单；
    // plan 状态校验仍由 workflow.applyConfirmed 执行。
    if (this.confirmation.autoApprove?.()) return;
    if (!this.confirmation.supportsFormElicitation()) {
      throw new SafeAbapError('CONFIRMATION_UNSUPPORTED', 'confirmation', 'Repository import requires MCP form elicitation.');
    }
    const plan = this.confirmation.planSummary(planId);
    const params: ElicitRequestFormParams = {
      mode: 'form',
      message: `Import ${plan.objectCount} object(s) into package ${plan.packageName} `
        + `(${plan.createCount} create / ${plan.updateCount} update, ${plan.skipCount} skipped) `
        + `· ${plan.systemHost}/${plan.client} · This is a batch repository write executed once.`,
      requestedSchema: {
        type: 'object',
        properties: { decision: { type: 'string', enum: ['apply', 'cancel'] } },
        required: ['decision']
      }
    };
    const elicited = await this.confirmation.elicitInput(params, 60000);
    if (elicited.action !== 'accept' || elicited.content?.decision !== 'apply') {
      throw new SafeAbapError('POLICY_DENIED', 'confirmation', 'Repository import was not confirmed by the user.');
    }
  }
}

function success(result: unknown): Record<string, any> {
  const structuredContent = { status: 'success', result };
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent
  };
}
