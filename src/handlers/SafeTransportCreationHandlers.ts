/**
 * 受控传输请求创建与清理的 MCP 工具处理器（SafeTransportCreationHandlers）。
 *
 * 暴露两组三件套（与受控激活三件套同构）：
 * - 创建（cts.create-request 专属动作）：
 *   previewTransportCreation：只读 CTS 预检并冻结创建 plan（read-only）。
 *   applyTransportCreation：发起原生确认并单次执行冻结 plan（mutating）。
 *   getTransportCreationStatus：本地查询 plan 状态（local 语义）。
 * - 清理（所有者 2026-09-29 边界调整：空请求允许删除）：
 *   previewTransportCleanup：只读核验"未释放 + 零对象 + 本人属主"三条红线
 *   并冻结清理 plan（read-only）；任一红线不满足即拒。
 *   applyTransportCleanup：发起原生确认并单次删除 + 缺席验证（mutating）。
 *   getTransportCleanupStatus：本地查询清理 plan 状态（local 语义）。
 *
 * 安全规则：
 * - 创建：仅创建一个动作；清理：仅删空请求。释放、改属主、加用户与直改
 *   E071/E071K 不在任何工具的入参或链路里。
 * - apply 不接受调用方布尔确认，只走各自 Confirmation 的 MCP form
 *   elicitation 原生确认；plan 之外的任何 URL/请求号一律不可传入。
 * - profile/role 门控由 ToolOperationPolicy 与 ToolProfiles 承担：
 *   六工具均仅 DEV + development/development-workbench 可见可用。
 */
import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import {
  TransportCreationConfirmation,
  type TransportCreationConfirmationOptions,
  type TransportCreationStatusReader
} from '../safe/TransportCreationConfirmation.js';
import {
  TransportCleanupConfirmation,
  type TransportCleanupConfirmationOptions,
  type TransportCleanupStatusReader
} from '../safe/TransportCleanupConfirmation.js';
import type {
  PreviewTransportCreationInput,
  TransportCreationPlanView,
  TransportCreationPreviewResult
} from '../safe/transportCreationTypes.js';
import type {
  PreviewTransportCleanupInput,
  TransportCleanupPlanView,
  TransportCleanupPreviewResult
} from '../safe/transportCleanupTypes.js';
import type { ToolDefinition } from '../types/tools.js';
import { serializeJsonText } from '../lib/jsonResponse';

/** handlers 依赖的工作流端口（便于测试 mock）。 */
export interface SafeTransportCreationWorkflowPort extends TransportCreationStatusReader {
  preview(input: PreviewTransportCreationInput): Promise<TransportCreationPreviewResult>;
}

/** handlers 依赖的清理工作流端口（便于测试 mock）。 */
export interface SafeTransportCleanupWorkflowPort extends TransportCleanupStatusReader {
  preview(input: PreviewTransportCleanupInput): Promise<TransportCleanupPreviewResult>;
}

/** 本 handlers 拥有的工具名集合（supports 判定用）：创建三件套 + 清理三件套。 */
const SAFE_TRANSPORT_CREATION_TOOL_NAMES = new Set([
  'previewTransportCreation',
  'applyTransportCreation',
  'getTransportCreationStatus',
  'previewTransportCleanup',
  'applyTransportCleanup',
  'getTransportCleanupStatus'
]);

export class SafeTransportCreationHandlers {
  private readonly confirmation: TransportCreationConfirmation;
  private readonly cleanupConfirmation?: TransportCleanupConfirmation;

  constructor(
    private readonly workflow: SafeTransportCreationWorkflowPort,
    confirmationOptions: TransportCreationConfirmationOptions,
    private readonly cleanupWorkflow?: SafeTransportCleanupWorkflowPort,
    cleanupConfirmationOptions?: TransportCleanupConfirmationOptions
  ) {
    this.confirmation = new TransportCreationConfirmation(workflow, confirmationOptions);
    if (cleanupWorkflow && cleanupConfirmationOptions) {
      this.cleanupConfirmation = new TransportCleanupConfirmation(cleanupWorkflow, cleanupConfirmationOptions);
    }
  }

  /** 是否由本 handlers 处理该工具。 */
  supports(toolName: string): boolean {
    return SAFE_TRANSPORT_CREATION_TOOL_NAMES.has(toolName);
  }

  /** 工具定义：preview/status 只读，apply 需原生确认；清理三件套可选收录。 */
  getTools(includeCleanup = true): ToolDefinition[] {
    const tools = [
      creationTool(
        'previewTransportCreation',
        'Run a read-only CTS preflight for one package and freeze one bounded transport-request creation plan without creating anything.',
        previewSchema(),
        true,
        false
      ),
      creationTool(
        'applyTransportCreation',
        'Open one native confirmation and create the frozen workbench transport request exactly once; creation-only, unknown outcomes are never retried.',
        planIdSchema(),
        false,
        true
      ),
      creationTool(
        'getTransportCreationStatus',
        'Read the local status and bounded result summary of one transport-creation plan.',
        planIdSchema(),
        true,
        false
      )
    ];
    if (includeCleanup) {
      // 清理三件套（空请求边界：未释放 + 零对象 + 本人属主，preview 全量核验）
      tools.push(
        creationTool(
          'previewTransportCleanup',
          'Verify one transport request is unreleased, empty, and owned by the current user (read-only) and freeze one bounded cleanup plan without deleting anything.',
          cleanupPreviewSchema(),
          true,
          false
        ),
        creationTool(
          'applyTransportCleanup',
          'Open one native confirmation and delete the frozen empty transport request exactly once; absence is verified after deletion and unknown outcomes are never retried.',
          cleanupPlanIdSchema(),
          false,
          true
        ),
        creationTool(
          'getTransportCleanupStatus',
          'Read the local status and bounded result summary of one transport-cleanup plan.',
          cleanupPlanIdSchema(),
          true,
          false
        )
      );
    }
    return tools;
  }

  /** 工具分发：apply 走原生确认链，preview/status 直接读工作流。 */
  async handle(toolName: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    switch (toolName) {
      case 'previewTransportCreation':
        return render(await this.workflow.preview(args as unknown as PreviewTransportCreationInput));
      case 'applyTransportCreation':
        return this.confirmation.confirmAndRun(String(args.transportCreationPlanId || ''));
      case 'getTransportCreationStatus':
        return render({
          status: 'success',
          plan: this.workflow.status(String(args.transportCreationPlanId || ''))
        });
      case 'previewTransportCleanup':
        return render(await this.requireCleanupWorkflow().preview(
          args as unknown as PreviewTransportCleanupInput
        ));
      case 'applyTransportCleanup':
        if (!this.cleanupConfirmation) throw new SafeCleanupConfigurationError();
        return this.cleanupConfirmation.confirmAndRun(String(args.transportCleanupPlanId || ''));
      case 'getTransportCleanupStatus':
        return render({
          status: 'success',
          plan: this.requireCleanupWorkflow().status(String(args.transportCleanupPlanId || ''))
        });
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown transport creation tool: ${toolName}`);
    }
  }

  /** 清理工作流未配置时的确定性错误。 */
  private requireCleanupWorkflow(): SafeTransportCleanupWorkflowPort {
    if (!this.cleanupWorkflow) throw new SafeCleanupConfigurationError();
    return this.cleanupWorkflow;
  }
}

/** 清理工作流未装配时抛出的确定性错误（与创建工作流未装配同语义）。 */
class SafeCleanupConfigurationError extends McpError {
  constructor() {
    super(ErrorCode.InternalError, 'Transport cleanup workflow is not configured.');
  }
}

/** 构造统一注解的工具定义（与 SafeActivationHandlers 同构）。 */
function creationTool(
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

/** preview 输入：仅请求描述、目标包与可选传输层；无任何 URL/请求号字段。 */
function previewSchema(): ToolDefinition['inputSchema'] {
  return {
    type: 'object',
    properties: {
      requestText: { type: 'string', minLength: 1, maxLength: 60 },
      devClass: { type: 'string', minLength: 1, maxLength: 40 },
      transportLayer: { type: 'string', minLength: 1, maxLength: 20, optional: true }
    },
    required: ['requestText', 'devClass']
  };
}

/** apply/status 输入：仅接受 server 生成的 plan id。 */
function planIdSchema(): ToolDefinition['inputSchema'] {
  return {
    type: 'object',
    properties: {
      transportCreationPlanId: { type: 'string', minLength: 1, maxLength: 128 }
    },
    required: ['transportCreationPlanId']
  };
}

/** 清理 preview 输入：仅 10 位请求号一个字段。 */
function cleanupPreviewSchema(): ToolDefinition['inputSchema'] {
  return {
    type: 'object',
    properties: {
      transportNumber: { type: 'string', minLength: 10, maxLength: 10 }
    },
    required: ['transportNumber']
  };
}

/** 清理 apply/status 输入：仅接受 server 生成的清理 plan id。 */
function cleanupPlanIdSchema(): ToolDefinition['inputSchema'] {
  return {
    type: 'object',
    properties: {
      transportCleanupPlanId: { type: 'string', minLength: 1, maxLength: 128 }
    },
    required: ['transportCleanupPlanId']
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
