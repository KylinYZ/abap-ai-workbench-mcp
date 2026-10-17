/**
 * 受控对象激活的 MCP 工具处理器（SafeActivationHandlers）。
 *
 * 暴露 3 个工具（与 QualityCheck 三件套同构）：
 * - previewObjectActivation：只读收集未激活对象并冻结激活 plan（read-only）。
 * - applyObjectActivation：发起原生确认并单次执行冻结 plan（mutating）。
 * - getObjectActivationStatus：本地查询 plan 状态（local 语义）。
 *
 * 安全规则：
 * - apply 不接受调用方布尔确认，只走 ObjectActivationConfirmation 的
 *   MCP form elicitation 原生确认；plan 之外的对象引用一律不可传入。
 * - profile/role 门控由 ToolOperationPolicy 与 ToolProfiles 承担：
 *   三工具仅 DEV + development/development-workbench 可见可用。
 */
import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import {
  ObjectActivationConfirmation,
  type ObjectActivationConfirmationOptions,
  type ObjectActivationStatusReader
} from '../safe/ObjectActivationConfirmation.js';
import type {
  ObjectActivationEmptyResult,
  ObjectActivationPlanView,
  ObjectActivationPreviewResult,
  PreviewObjectActivationInput
} from '../safe/objectActivationTypes.js';
import type { ToolDefinition } from '../types/tools.js';
import { serializeJsonText } from '../lib/jsonResponse';

/** handlers 依赖的工作流端口（便于测试 mock）。 */
export interface SafeActivationWorkflowPort extends ObjectActivationStatusReader {
  preview(input: PreviewObjectActivationInput): Promise<ObjectActivationPreviewResult | ObjectActivationEmptyResult>;
}

/** 本 handlers 拥有的工具名集合（supports 判定用）。 */
const SAFE_ACTIVATION_TOOL_NAMES = new Set([
  'previewObjectActivation',
  'applyObjectActivation',
  'getObjectActivationStatus'
]);

export class SafeActivationHandlers {
  private readonly confirmation: ObjectActivationConfirmation;

  constructor(
    private readonly workflow: SafeActivationWorkflowPort,
    confirmationOptions: ObjectActivationConfirmationOptions
  ) {
    this.confirmation = new ObjectActivationConfirmation(workflow, confirmationOptions);
  }

  /** 是否由本 handlers 处理该工具。 */
  supports(toolName: string): boolean {
    return SAFE_ACTIVATION_TOOL_NAMES.has(toolName);
  }

  /** 工具定义：preview/status 只读，apply 需原生确认。 */
  getTools(): ToolDefinition[] {
    return [
      activationTool(
        'previewObjectActivation',
        'List currently inactive ABAP objects (read-only) and freeze one bounded activation plan without activating anything.',
        previewSchema(),
        true,
        false
      ),
      activationTool(
        'applyObjectActivation',
        'Open one native confirmation and activate the frozen inactive objects exactly once; unknown outcomes are never retried.',
        planIdSchema(),
        false,
        true
      ),
      activationTool(
        'getObjectActivationStatus',
        'Read the local status and bounded result summary of one object-activation plan.',
        planIdSchema(),
        true,
        false
      )
    ];
  }

  /** 工具分发：apply 走原生确认链，preview/status 直接读工作流。 */
  async handle(toolName: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    switch (toolName) {
      case 'previewObjectActivation':
        return render(await this.workflow.preview(args as unknown as PreviewObjectActivationInput));
      case 'applyObjectActivation':
        return this.confirmation.confirmAndRun(String(args.activationPlanId || ''));
      case 'getObjectActivationStatus':
        return render({ status: 'success', plan: this.workflow.status(String(args.activationPlanId || '')) });
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown safe activation tool: ${toolName}`);
    }
  }
}

/** 构造统一注解的工具定义（与 SafeQualityHandlers 同构）。 */
function activationTool(
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

/** preview 输入：仅可选的对象名过滤与 preaudit 开关；无任何对象引用/URL 字段。 */
function previewSchema(): ToolDefinition['inputSchema'] {
  return {
    type: 'object',
    properties: {
      objectNames: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        optional: true,
        items: { type: 'string', minLength: 1, maxLength: 128 }
      },
      preauditRequested: { type: 'boolean', optional: true }
    },
    required: []
  };
}

/** apply/status 输入：仅接受 server 生成的 plan id。 */
function planIdSchema(): ToolDefinition['inputSchema'] {
  return {
    type: 'object',
    properties: {
      activationPlanId: { type: 'string', minLength: 1, maxLength: 128 }
    },
    required: ['activationPlanId']
  };
}

/** 统一 MCP 响应：text + structuredContent 双通道。 */
function render(value: unknown): Record<string, unknown> {
  const structuredContent = value as Record<string, unknown>;
  return {
    content: [{ type: 'text', text: serializeJsonText(structuredContent) }],
    structuredContent
  };
}
