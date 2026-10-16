#!/usr/bin/env node

import { config } from 'dotenv';
import { randomUUID } from 'crypto';
// 0.9.0：协议栈迁移到官方 v2 双栈包（2026-07-28 modern + 2025 legacy）；0.9.1：能力收编批次；0.9.2：analysis.lint 与 rfc.helper-bridge 晋级 64/71 + 受控导入三件套；0.10.0：S/4 低版本适配（BASIS 7.50/7.51 版本能力协商 + RFC 读表 72 字符兼容，见 CHANGELOG）。
// 低层 Server 保留自管工具目录模式；stdio 传输生命周期由 serveStdio 拥有。
import { Server, inputRequired } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { McpError, ErrorCode } from "./lib/McpErrorCompat.js";
import { createMrtrElicitPort, ConfirmationRequiredError } from "./lib/MrtrElicitation.js";
import { ADTClient, session_types } from "./adt/index.js";
import path from 'path';
import { AuthHandlers } from './handlers/AuthHandlers.js';
import { TransportHandlers } from './handlers/TransportHandlers.js';
import { ObjectHandlers } from './handlers/ObjectHandlers.js';
import { ClassHandlers } from './handlers/ClassHandlers.js';
import { CodeAnalysisHandlers } from './handlers/CodeAnalysisHandlers.js';
import { ObjectLockHandlers } from './handlers/ObjectLockHandlers.js';
import { ObjectSourceHandlers } from './handlers/ObjectSourceHandlers.js';
import { ObjectDeletionHandlers } from './handlers/ObjectDeletionHandlers.js';
import { ObjectManagementHandlers } from './handlers/ObjectManagementHandlers.js';
import { ObjectRegistrationHandlers } from './handlers/ObjectRegistrationHandlers.js';
import { NodeHandlers } from './handlers/NodeHandlers.js';
import { DiscoveryHandlers } from './handlers/DiscoveryHandlers.js';
import { UnitTestHandlers } from './handlers/UnitTestHandlers.js';
import { PrettyPrinterHandlers } from './handlers/PrettyPrinterHandlers.js';
import { GitHandlers } from './handlers/GitHandlers.js';
import { DdicHandlers } from './handlers/DdicHandlers.js';
import { ServiceBindingHandlers } from './handlers/ServiceBindingHandlers.js';
import { QueryHandlers } from './handlers/QueryHandlers.js';
import { FeedHandlers } from './handlers/FeedHandlers.js';
import { DebugHandlers } from './handlers/DebugHandlers.js';
import { RenameHandlers } from './handlers/RenameHandlers.js';
import { AtcHandlers } from './handlers/AtcHandlers.js';
import { TraceHandlers } from './handlers/TraceHandlers.js';
import { RefactorHandlers } from './handlers/RefactorHandlers.js';
import { RevisionHandlers } from './handlers/RevisionHandlers.js';
import { RapGeneratorHandlers } from './handlers/RapGeneratorHandlers.js';
import { Sm21Handlers } from './handlers/Sm21Handlers.js';
import { SafeAbapHandlers } from './handlers/SafeAbapHandlers.js';
import { SafeDebugHandlers } from './handlers/SafeDebugHandlers.js';
import { SafeAdvancedHandlers } from './handlers/SafeAdvancedHandlers.js';
import { SafeQualityHandlers } from './handlers/SafeQualityHandlers.js';
import { SafeActivationHandlers } from './handlers/SafeActivationHandlers.js';
import { SafeTransportCreationHandlers } from './handlers/SafeTransportCreationHandlers.js';
import {
  RepositoryObjectCreationHandlers
} from './handlers/RepositoryObjectCreationHandlers.js';
import { HighLevelReadHandlers } from './handlers/HighLevelReadHandlers.js';
import { CdsAnalysisHandlers } from './handlers/CdsAnalysisHandlers.js';
import { AbapChangeWorkflow } from './safe/AbapChangeWorkflow.js';
import { AbapCreationResolver } from './safe/AbapCreationResolver.js';
import { AbapObjectCreationWorkflow } from './safe/AbapObjectCreationWorkflow.js';
import { AbapObjectResolver } from './safe/AbapObjectResolver.js';
import { AuditLogger } from './safe/AuditLogger.js';
import { ChangePlanStore } from './safe/ChangePlanStore.js';
import { CreationPlanStore } from './safe/CreationPlanStore.js';
import { DebugControlWorkflow } from './safe/DebugControlWorkflow.js';
import { DebugOperationPlanStore } from './safe/DebugOperationPlanStore.js';
import { DebugSessionAuthorizationStore } from './safe/DebugSessionAuthorizationStore.js';
import { AdvancedOperationPlanStore } from './safe/AdvancedOperationPlanStore.js';
import { DdicPropertyChangeWorkflow } from './safe/DdicPropertyChangeWorkflow.js';
import { PackageChangeWorkflow } from './safe/PackageChangeWorkflow.js';
import { RapOperationWorkflow } from './safe/RapOperationWorkflow.js';
import { QualityCheckPlanStore } from './safe/QualityCheckPlanStore.js';
import { QualityCheckWorkflow } from './safe/QualityCheckWorkflow.js';
import { ObjectActivationPlanStore } from './safe/ObjectActivationPlanStore.js';
import { ObjectActivationWorkflow } from './safe/ObjectActivationWorkflow.js';
import { TransportCreationPlanStore } from './safe/TransportCreationPlanStore.js';
import { TransportCreationWorkflow } from './safe/TransportCreationWorkflow.js';
import { TransportCleanupPlanStore } from './safe/TransportCleanupPlanStore.js';
import { TransportCleanupWorkflow } from './safe/TransportCleanupWorkflow.js';
import { RepositoryObjectCreationRegistry } from './safe/RepositoryObjectCreationRegistry.js';
import { RepositoryObjectCreationPlanStore } from './safe/RepositoryObjectCreationPlanStore.js';
import { RepositoryObjectCreationWorkflow } from './safe/RepositoryObjectCreationWorkflow.js';
import { RepositoryObjectCleanupPlanStore } from './safe/RepositoryObjectCleanupPlanStore.js';
import { RepositoryObjectCleanupWorkflow } from './safe/RepositoryObjectCleanupWorkflow.js';
import { RepositoryCreationConfirmationChallengeStore } from './safe/RepositoryCreationConfirmationChallengeStore.js';
import { createRepositoryCreationConfirmationProvider } from './safe/RepositoryCreationConfirmationProvider.js';
import { INITIAL_REPOSITORY_CREATION_CAPABILITIES } from './safe/repositoryCreationCapabilities.js';
import { PackageCreationAdapter } from './safe/adapters/PackageCreationAdapter.js';
import { DatabaseTableCreationAdapter } from './safe/adapters/DatabaseTableCreationAdapter.js';
import { AbapSourceCreationAdapter, FunctionGroupIncludeCreationAdapter } from './safe/adapters/AbapSourceCreationAdapter.js';
import { FunctionGroupCreationAdapter } from './safe/adapters/FunctionGroupCreationAdapter.js';
import { SourceObjectCreationAdapter } from './safe/adapters/SourceObjectCreationAdapter.js';
import { ServiceBindingCreationAdapter } from './safe/adapters/ServiceBindingCreationAdapter.js';
import { StructureCreationAdapter } from './safe/adapters/StructureCreationAdapter.js';
import { TypeGroupCreationAdapter } from './safe/adapters/TypeGroupCreationAdapter.js';
import { TableTypeCreationAdapter } from './safe/adapters/TableTypeCreationAdapter.js';
import { LockObjectCreationAdapter } from './safe/adapters/LockObjectCreationAdapter.js';
import { LogicalExternalSchemaCreationAdapter } from './safe/adapters/LogicalExternalSchemaCreationAdapter.js';
import { NumberRangeObjectCreationAdapter } from './safe/adapters/NumberRangeObjectCreationAdapter.js';
import { SapObjectTypeCreationAdapter } from './safe/adapters/SapObjectTypeCreationAdapter.js';
import { SapObjectNodeTypeCreationAdapter } from './safe/adapters/SapObjectNodeTypeCreationAdapter.js';
import { ChangeDocumentObjectCreationAdapter } from './safe/adapters/ChangeDocumentObjectCreationAdapter.js';
import { DataElementCreationAdapter, DomainCreationAdapter } from './safe/adapters/DdicPrimitiveCreationAdapter.js';
import { MessageClassCreationAdapter } from './safe/adapters/MessageClassCreationAdapter.js';
import { SafeAbapError } from './safe/errors.js';
import { SafetyPolicy } from './safe/SafetyPolicy.js';
import { RuntimeGuardrails, type RuntimeGuardrailValues } from './config/RuntimeGuardrails.js';
import { ToolExecutionGate } from './lib/ToolExecutionGate.js';
import { adtClientOptions, createGateSelector, executeGuardedToolCall } from './lib/serverGuardrails.js';
import type { ToolDefinition } from './types/tools.js';
import { sourceCache } from './lib/sourceCache.js';
import { configureLogLevel } from './lib/logger.js';
import { AdtHttpSm21Client } from './sm21/AdtHttpSm21Client.js';
import { sm21ConfigFromEnvironment } from './sm21/config.js';
import { selectProfileTools, isReadOnlyLegacyTool } from './config/ToolProfiles.js';
import {
  detectBasisReleaseFromSystemInfo,
  isToolAvailableForBasisRelease,
  resolveConfiguredBasisRelease,
  TOOL_MIN_BASIS_RELEASE,
  unavailableCreationKindsForBasisRelease,
  unavailableToolsForBasisRelease
} from './config/SapReleaseCapability.js';
import { REPOSITORY_OBJECT_KINDS } from './safe/repositoryCreationTypes.js';
import { assertToolCatalogClassified, toolOperationClass } from './config/ToolOperationPolicy.js';
import { createCdsAnalysisClient } from './adt/CdsDependencyApi.js';
import {
  createSourceGrepClient
} from './adt/SourceGrepApi.js';
import { WhereUsedConfigHandlers } from './handlers/WhereUsedConfigHandlers.js';
import { createWhereUsedConfigClient } from './adt/WhereUsedConfigApi.js';
import { UsageExamplesHandlers } from './handlers/UsageExamplesHandlers.js';
import { TextPoolHandlers } from './handlers/TextPoolHandlers.js';
import { TextPoolWorkflow } from './safe/TextPoolWorkflow.js';
import { Ui5WriteHandlers } from './handlers/Ui5WriteHandlers.js';
import { RepositoryObjectImportHandlers } from './handlers/RepositoryObjectImportHandlers.js';
import { HealthHandlers } from './handlers/HealthHandlers.js';
import { GitBridgeHandlers, gitBridgeTargetFromEnv } from './handlers/GitBridgeHandlers.js';
import { ReportHandlers } from './handlers/ReportHandlers.js';
import { createReportVariantsClient } from './adt/ReportVariantsApi.js';
import { createReportJobClient } from './adt/ReportJobApi.js';
import { HelperRfcBridge } from './adt/HelperRfcApi.js';
import { AnalyzeLintHandlers } from './handlers/AnalyzeLintHandlers.js';
import type { HealthCapability } from './adt/HealthApi.js';
import { runUnitTest } from './adt/api/unittest.js';
import { Ui5WriteWorkflow } from './safe/Ui5WriteWorkflow.js';
import { RepositoryObjectImportWorkflow, type RepositoryImportAdtClient } from './safe/RepositoryObjectImportWorkflow.js';
import { createImportObjectShell } from './adt/api/ImportShellCreation.js';
import { createUi5WriteClient } from './adt/Ui5FilestoreApi.js';
import { createUsageExamplesClient } from './adt/UsageExamplesApi.js';
import { createClusterReadClient } from './adt/ClusterReadApi.js';
import { createImpactAnalysisClient } from './adt/ImpactAnalysisApi.js';
import {
  createUnitCoverageClient
} from './adt/UnitCoverageApi.js';
import {
  createExecuteAbapClient
} from './adt/ExecuteAbapApi.js';
import {
  createApplicationLogClient
} from './adt/ApplicationLogApi.js';
import {
  bindRunSqlToAdtQuery,
  createCrossReferenceClient
} from './adt/CrossReferenceApi.js';
import { createContextAnalysisClient } from './adt/ContextCompressionApi.js';
import { createUi5FilestoreClient } from './adt/Ui5FilestoreApi.js';
import { createSpoolJobClient, bindSpoolJobQueryRunner } from './adt/SpoolJobApi.js';
import { createAmdpDiscoveryClient } from './adt/AmdpDiscoveryApi.js';
import { AmdpDiscoveryHandlers } from './handlers/AmdpDiscoveryHandlers.js';
import { DescriptionChangeHandlers } from './handlers/DescriptionChangeHandlers.js';
import { DescriptionChangeWorkflow, bindDescriptionPorts } from './safe/DescriptionChangeWorkflow.js';
import { MessageTextWorkflow } from './safe/MessageTextWorkflow.js';
import { MessageTextHandlers } from './handlers/MessageTextHandlers.js';
import { bindMessageClassPorts } from './adt/MessageClassApi.js';
import { CloneObjectHandlers } from './handlers/CloneObjectHandlers.js';
import { CloneObjectWorkflow } from './safe/CloneObjectWorkflow.js';
import { RenameControlledHandlers } from './handlers/RenameControlledHandlers.js';
import { RenameControlledWorkflow } from './safe/RenameControlledWorkflow.js';
import { createMessageClassReadClient } from './adt/MessageClassReadApi.js';
import { createRevisionSourceClient } from './adt/RevisionSourceApi.js';
import { createI18nReadClient } from './adt/I18nReadApi.js';
import { createBoundaryCheckClient } from './adt/BoundaryCheckApi.js';
import { createTransactionReadClient } from './adt/TransactionReadApi.js';
import { createInstallDiagnosticsClient } from './adt/InstallDiagnosticsApi.js';
import { createKnowledgeQueriesClient } from './adt/KnowledgeQueriesApi.js';
import { createTransportHistoryClient } from './adt/TransportHistoryApi.js';
import { TransportScopeHandlers } from './handlers/TransportScopeHandlers.js';
import { RfcProbeHandlers } from './handlers/RfcProbeHandlers.js';
import { SourceGrepHandlers } from './handlers/SourceGrepHandlers.js';
import { UnitCoverageHandlers } from './handlers/UnitCoverageHandlers.js';
import { ExecuteAbapHandlers } from './handlers/ExecuteAbapHandlers.js';
import { ApplicationLogHandlers } from './handlers/ApplicationLogHandlers.js';
import { CrossReferenceHandlers } from './handlers/CrossReferenceHandlers.js';
import { ContextAnalysisHandlers } from './handlers/ContextAnalysisHandlers.js';
import { Ui5Handlers } from './handlers/Ui5Handlers.js';
import { SpoolJobHandlers } from './handlers/SpoolJobHandlers.js';
import { MessageClassReadHandlers } from './handlers/MessageClassReadHandlers.js';
import { RevisionSourceHandlers } from './handlers/RevisionSourceHandlers.js';
import { I18nReadHandlers } from './handlers/I18nReadHandlers.js';
import { BoundaryCheckHandlers } from './handlers/BoundaryCheckHandlers.js';
import { TransactionReadHandlers } from './handlers/TransactionReadHandlers.js';
import { InstallDiagnosticsHandlers } from './handlers/InstallDiagnosticsHandlers.js';
import { KnowledgeQueriesHandlers } from './handlers/KnowledgeQueriesHandlers.js';
import { TransportHistoryHandlers } from './handlers/TransportHistoryHandlers.js';
import { LoadGraphHandlers } from './handlers/LoadGraphHandlers.js';
import { DependencyGraphHandlers } from './handlers/DependencyGraphHandlers.js';
import { createLoadGraphClient } from './adt/LoadGraphApi.js';
import { DumpAnalysisHandlers } from './handlers/DumpAnalysisHandlers.js';
import { selectEnvironmentFile } from './config/EnvironmentFile.js';
import { RuntimeDumpReader } from './read/RuntimeDumpReader.js';
import { ClassicTableInspector } from './read/ClassicTableInspector.js';
import { SystemInspector } from './read/SystemInspector.js';
import { AbapMemberSourceReader } from './read/AbapMemberSourceReader.js';
import { SessionSupervisor } from './lib/SessionSupervisor.js';
import { sessionResilienceConfigFromEnvironment, type SessionResilienceConfig } from './config/SessionResilienceConfig.js';
import { resolveSapPassword } from './config/CredentialProvider.js';
import { FocusedTaskHandlers } from './handlers/FocusedTaskHandlers.js';

const environmentFile = selectEnvironmentFile(
  process.env.SAP_MCP_ENV_FILE,
  process.cwd(),
  path.resolve(__dirname, '../.env')
);
const environmentLoad = config({ path: environmentFile.path });
if (environmentFile.explicit && environmentLoad.error) {
  throw new Error(`Failed to load SAP_MCP_ENV_FILE: ${environmentLoad.error.message}`);
}

export class AbapAdtServer extends Server {
  private adtClient: ADTClient;
  private sessionSupervisor?: SessionSupervisor;
  private safetyPolicy: SafetyPolicy;
  private readonly guardrails: RuntimeGuardrailValues;
  private readonly executionGate: ToolExecutionGate;
  private readonly readExecutionGate: ToolExecutionGate;
  private readonly gateSelector: (toolName: string) => ToolExecutionGate | undefined;
  private readonly sessionResilience: SessionResilienceConfig;
  private toolCatalog: ToolDefinition[] = [];
  /**
   * M1 版本指纹缓存：懒探测一次并定格（resolved 标记探测已尝试——undefined
   * 也是有效结论"指纹不可得 = 不裁剪"，避免每次 listTools 重复探测失败）。
   * 优先级：env SAP_MCP_BASIS_RELEASE 显式配置 > RFC_SYSTEM_INFO 探测。
   */
  private basisReleaseProbe?: { value: number | undefined; resolved: boolean };
  private safeAbapHandlers: SafeAbapHandlers;
  private safeDebugHandlers: SafeDebugHandlers;
  private safeAdvancedHandlers: SafeAdvancedHandlers;
  private safeQualityHandlers: SafeQualityHandlers;
  private safeActivationHandlers: SafeActivationHandlers;
  private safeTransportCreationHandlers: SafeTransportCreationHandlers;
  private repositoryObjectCreationHandlers: RepositoryObjectCreationHandlers;
  private highLevelReadHandlers: HighLevelReadHandlers;
  private cdsAnalysisHandlers: CdsAnalysisHandlers;
  private sourceGrepHandlers: SourceGrepHandlers;
  private unitCoverageHandlers: UnitCoverageHandlers;
  private executeAbapHandlers: ExecuteAbapHandlers;
  private applicationLogHandlers: ApplicationLogHandlers;
  private crossReferenceHandlers: CrossReferenceHandlers;
  private contextAnalysisHandlers: ContextAnalysisHandlers;
  private ui5Handlers: Ui5Handlers;
  private spoolJobHandlers: SpoolJobHandlers;
  private amdpDiscoveryHandlers: AmdpDiscoveryHandlers;
  private descriptionChangeHandlers: DescriptionChangeHandlers;
  private messageTextHandlers: MessageTextHandlers;
  private cloneObjectHandlers: CloneObjectHandlers;
  private renameControlledHandlers: RenameControlledHandlers;
  private messageClassReadHandlers: MessageClassReadHandlers;
  private revisionSourceHandlers: RevisionSourceHandlers;
  private i18nReadHandlers: I18nReadHandlers;
  private boundaryCheckHandlers: BoundaryCheckHandlers;
  private transactionReadHandlers: TransactionReadHandlers;
  private installDiagnosticsHandlers: InstallDiagnosticsHandlers;
  private knowledgeQueriesHandlers: KnowledgeQueriesHandlers;
  private transportHistoryHandlers: TransportHistoryHandlers;
  private transportScopeHandlers: TransportScopeHandlers;
  private loadGraphHandlers: LoadGraphHandlers;
  private whereUsedConfigHandlers: WhereUsedConfigHandlers;
  private usageExamplesHandlers: UsageExamplesHandlers;
  private textPoolHandlers: TextPoolHandlers;
  private ui5WriteHandlers: Ui5WriteHandlers;
  private repositoryObjectImportHandlers: RepositoryObjectImportHandlers;
  private healthHandlers: HealthHandlers;
  private gitBridgeHandlers: GitBridgeHandlers;
  private reportHandlers: ReportHandlers;
  private analyzeLintHandlers: AnalyzeLintHandlers;
  private dependencyGraphHandlers = new DependencyGraphHandlers();
  private rfcProbeHandlers: RfcProbeHandlers;
  private dumpAnalysisHandlers: DumpAnalysisHandlers;
  private focusedTaskHandlers: FocusedTaskHandlers;
  private authHandlers: AuthHandlers;
  private transportHandlers: TransportHandlers;
  private objectHandlers: ObjectHandlers;
  private classHandlers: ClassHandlers;
  private codeAnalysisHandlers: CodeAnalysisHandlers;
  private objectLockHandlers: ObjectLockHandlers;
  private objectSourceHandlers: ObjectSourceHandlers;
  private objectDeletionHandlers: ObjectDeletionHandlers;
  private objectManagementHandlers: ObjectManagementHandlers;
  private objectRegistrationHandlers: ObjectRegistrationHandlers;
    private nodeHandlers: NodeHandlers;
    private discoveryHandlers: DiscoveryHandlers;
    private unitTestHandlers: UnitTestHandlers;
    private prettyPrinterHandlers: PrettyPrinterHandlers;
    private gitHandlers: GitHandlers;
    private ddicHandlers: DdicHandlers;
    private serviceBindingHandlers: ServiceBindingHandlers;
    private queryHandlers: QueryHandlers;
    private feedHandlers: FeedHandlers;
    private debugHandlers: DebugHandlers;
    private renameHandlers: RenameHandlers;
    private atcHandlers: AtcHandlers;
    private traceHandlers: TraceHandlers;
    private refactorHandlers: RefactorHandlers;
    private revisionHandlers: RevisionHandlers;
    private rapGeneratorHandlers: RapGeneratorHandlers;
    private sm21Handlers?: Sm21Handlers;
    /**
     * 当前正在执行的 tools/call 请求的 MRTR 确认 port。
     * v2 把确认流移到 input_required 多轮模型：port 在无响应轮抛
     * ConfirmationRequiredError（由 handler 转 inputRequired 结果），
     * 在重试轮从 inputResponses 恢复确认结果；legacy 连接经 v2 官方
     * shim 自动转 elicitation/create，行为与 0.8.x 一致。
     * 单并发执行模型下以实例字段传递。
     */
    private activeElicitPort?: (params: import("@modelcontextprotocol/server").ElicitRequestFormParams | import("@modelcontextprotocol/server").ElicitRequestURLParams, timeoutMs: number) => Promise<import("@modelcontextprotocol/server").ElicitResult>;
    /**
     * 当前请求 envelope 携带的客户端能力（modern era：2026-07-28 每请求
     * _meta envelope；legacy era 为 null，回落 initialize 握手填充的实例能力）。
     */
    private activeEnvelopeCapabilities?: { elicitation?: { form?: unknown } } | null;

  constructor(passwordOverride?: string) {
    super(
      {
        name: "abap-ai-workbench-mcp",
        version: "0.10.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.guardrails = RuntimeGuardrails.fromEnvironment();
    this.sessionResilience = sessionResilienceConfigFromEnvironment();
    configureLogLevel(this.guardrails.logLevel);
    // 分级执行门（读槽/写槽）：
    // - 写槽：SAP 写路径（stateful 会话/锁链/受控 apply）必须串行，默认 1。
    //   受控链确认层内部的 applyConfirmed 等调用点也复用本实例（自持写槽）。
    // - 读槽：read-only 类工具绑定读域会话（statelessClone，永远 stateless），
    //   可安全并发；默认 2，SAP_MCP_MAX_READ_CONCURRENT_TOOLS 可调。
    // 两槽独立排队与 429 背压，互不占对方的槽。
    this.executionGate = new ToolExecutionGate(this.guardrails.maxConcurrentTools, this.guardrails.maxQueuedTools);
    this.readExecutionGate = new ToolExecutionGate(this.guardrails.maxReadConcurrentTools, this.guardrails.maxQueuedTools);
    this.gateSelector = createGateSelector(this.readExecutionGate, this.executionGate);
    sourceCache.configure({
      maxEntries: this.guardrails.sourceCacheMaxEntries,
      maxItemBytes: this.guardrails.sourceCacheMaxItemBytes,
      ttlMs: this.guardrails.sourceCacheTtlMs
    });
    const sapPassword = passwordOverride || process.env.SAP_PASSWORD;
    const missingVars = ['SAP_URL', 'SAP_USER'].filter(v => !process.env[v]);
    if (!sapPassword) missingVars.push('SAP_PASSWORD (or external credential provider)');
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
    
    this.adtClient = new ADTClient(
      process.env.SAP_URL as string,
      process.env.SAP_USER as string,
      sapPassword as string,
      process.env.SAP_CLIENT as string,
      process.env.SAP_LANGUAGE as string,
      {
        ...adtClientOptions(this.guardrails),
        sessionEventCallback: event => this.sessionSupervisor?.handleEvent(event)
      }
    );
    this.adtClient.stateful = session_types.stateful
    this.sessionSupervisor = new SessionSupervisor(this.adtClient, {
      enabled: this.sessionResilience.sessionRecovery
    });
    this.safetyPolicy = SafetyPolicy.fromEnvironment();
    const repositoryCreationContext = {
      systemHost: this.safetyPolicy.systemHost,
      client: this.safetyPolicy.client,
      sapUser: this.safetyPolicy.sapUser,
      systemRole: this.safetyPolicy.systemRole,
      toolProfile: this.safetyPolicy.toolProfile,
      allowedNamespaces: [...this.safetyPolicy.allowedNamespaces],
      realDevValidationEnabled: this.safetyPolicy.realDevValidationEnabled,
      realDevValidationObjects: [...this.safetyPolicy.realDevValidationObjects],
      realDevValidationPrefix: this.safetyPolicy.realDevValidationPrefix,
      realDevValidationPackage: this.safetyPolicy.realDevValidationPackage,
      realDevValidationTransport: this.safetyPolicy.realDevValidationTransport
    };
    const repositoryCreationRegistry = new RepositoryObjectCreationRegistry(INITIAL_REPOSITORY_CREATION_CAPABILITIES);
    const sm21Config = sm21ConfigFromEnvironment();
    
    // Initialize handlers
    // 读域客户端：read-only 类工具统一走 stateless 克隆（永远 stateless），
    // 与写域（主实例，按需 stateful + 写槽串行）结构性隔离。读域懒创建——
    // 构造不发起任何 SAP 请求，首次读请求才登录；SAP 侧 stateless 请求
    // 处理完即释放会话，不占常驻会话。SAP_MCP_STATELESS_READS=false 可
    // 显式退回单会话旧行为（此时读槽并发安全性由部署者自行保证）。
    const readClient = this.sessionResilience.statelessReads
      ? this.adtClient.statelessClone
      : this.adtClient;
    const objectResolver = new AbapObjectResolver(this.adtClient);
    const readObjectResolver = this.sessionResilience.statelessReads
      ? new AbapObjectResolver(readClient)
      : objectResolver;
    this.authHandlers = new AuthHandlers(this.adtClient);
    this.transportHandlers = new TransportHandlers(this.adtClient, readClient);
    this.objectHandlers = new ObjectHandlers(this.adtClient, readClient);
    // 纯读 handler（全部工具 ∈ read-only 类）：绑定读域客户端
    this.classHandlers = new ClassHandlers(readClient);
    this.nodeHandlers = new NodeHandlers(readClient);
    this.discoveryHandlers = new DiscoveryHandlers(readClient);
    this.feedHandlers = new FeedHandlers(readClient);
    this.queryHandlers = new QueryHandlers(readClient);
    this.revisionHandlers = new RevisionHandlers(readClient);
    this.transportHandlers = new TransportHandlers(this.adtClient);
    this.objectHandlers = new ObjectHandlers(this.adtClient);
    this.codeAnalysisHandlers = new CodeAnalysisHandlers(this.adtClient, readClient);
    this.objectLockHandlers = new ObjectLockHandlers(this.adtClient);
    this.objectSourceHandlers = new ObjectSourceHandlers(this.adtClient, readClient);
    this.objectDeletionHandlers = new ObjectDeletionHandlers(this.adtClient);
    this.objectManagementHandlers = new ObjectManagementHandlers(this.adtClient, readClient);
    this.objectRegistrationHandlers = new ObjectRegistrationHandlers(this.adtClient, readClient);
    this.unitTestHandlers = new UnitTestHandlers(this.adtClient, readClient);
    this.prettyPrinterHandlers = new PrettyPrinterHandlers(this.adtClient, readClient);
    this.gitHandlers = new GitHandlers(this.adtClient, readClient);
    this.ddicHandlers = new DdicHandlers(this.adtClient, readClient);
    this.serviceBindingHandlers = new ServiceBindingHandlers(this.adtClient, readClient);
    this.debugHandlers = new DebugHandlers(this.adtClient, readClient);
    this.renameHandlers = new RenameHandlers(this.adtClient, readClient);
    this.atcHandlers = new AtcHandlers(this.adtClient, readClient);
    this.traceHandlers = new TraceHandlers(this.adtClient, readClient);
    this.refactorHandlers = new RefactorHandlers(this.adtClient, readClient);
    this.rapGeneratorHandlers = new RapGeneratorHandlers(this.adtClient, readClient);
    // dump 增值分析（groupRuntimeDumps/findSimilarDumps）与 readRuntimeDumps
    // 共享同一个 RuntimeDumpReader（无状态，可安全复用）
    const dumpReader = new RuntimeDumpReader(readClient);
    this.dumpAnalysisHandlers = new DumpAnalysisHandlers(dumpReader);
    this.highLevelReadHandlers = new HighLevelReadHandlers(
      dumpReader,
      new ClassicTableInspector(readClient),
      new SystemInspector(readClient, {
        host: this.safetyPolicy.systemHost,
        client: this.safetyPolicy.client,
        toolProfile: this.safetyPolicy.toolProfile,
        systemRole: this.safetyPolicy.systemRole
      }),
      new AbapMemberSourceReader(readClient, readObjectResolver)
    );
    // CDS 依赖分析三工具（read.cds-analysis）：只读 ADT 能力，与 highLevelRead
    // 相同复用 readClient（statelessReads 开启时走无状态克隆）的 AdtHTTP 会话。
    this.cdsAnalysisHandlers = new CdsAnalysisHandlers(createCdsAnalysisClient(readClient.httpClient));
    // Wave 3 分析四工具（grep/callees/applog 只读 + coverage 执行）：与 highLevelRead
    // 相同复用 readClient 的 AdtHTTP 会话；getCallees 的交叉表查询经 bindRunSqlToAdtQuery
    // 走 runQuery 的 datapreview 通道（decode=true，DIRECT 标志依赖解码）。
    this.sourceGrepHandlers = new SourceGrepHandlers(createSourceGrepClient(readClient.httpClient));
    this.unitCoverageHandlers = new UnitCoverageHandlers(createUnitCoverageClient(this.adtClient.httpClient));
    // 受控 ABAP 执行（devtools.execute-abap 行）：临时程序包装 + ABAP Unit
    // 单次运行。锁/源码写入是 stateful 专属操作（ValidateStateful），必须绑
    // 主会话 adtClient（写域 stateful），与 runClass/unitTestRun 同面。
    this.executeAbapHandlers = new ExecuteAbapHandlers(createExecuteAbapClient(this.adtClient.httpClient));
    // Health 聚合查询（analysis.history 行 health 子操作）：tests 信号真正执行
    // 单测（执行行为），执行类原语绑主会话 adtClient；boundaries 复用已真机
    // 验证的包边界证据链（readClient），TADIR 枚举走同款自由 SQL 通道。
    const healthCapability: HealthCapability = {
      runUnitTest: url => runUnitTest(this.adtClient.httpClient, url),
      createAtcRun: (variant, mainUrl, maxResults) => this.adtClient.createAtcRun(variant, mainUrl, maxResults),
      atcWorklists: runResultId => this.adtClient.atcWorklists(runResultId),
      checkPackageBoundaries: input => createBoundaryCheckClient(readClient).checkPackageBoundaries(input),
      revisions: objectUrl => this.adtClient.revisions(objectUrl),
      listPackageObjects: async (packageName, kinds, limit) => {
        const kindList = kinds.map(k => `'${k}'`).join(', ');
        const rows = (await readClient.runQuery(
          `SELECT obj_name, object FROM tadir WHERE pgmid = 'R3TR' AND devclass = '${packageName}' AND object IN (${kindList}) ORDER BY obj_name`,
          limit
        )).values ?? [];
        return rows.map(row => ({
          name: String(row['OBJ_NAME'] ?? row['obj_name'] ?? '').trim().toUpperCase(),
          type: String(row['OBJECT'] ?? row['object'] ?? '').trim().toUpperCase()
        }));
      },
      objectUrl: (objectType, objectName, parent) => {
        const name = objectName.toLowerCase();
        switch (objectType) {
          case 'CLAS': return `/sap/bc/adt/oo/classes/${name}`;
          case 'INTF': return `/sap/bc/adt/oo/interfaces/${name}`;
          case 'PROG': return `/sap/bc/adt/programs/programs/${name}`;
          case 'FUGR': return `/sap/bc/adt/functions/groups/${name}`;
          case 'FUNC': return parent ? `/sap/bc/adt/functions/groups/${parent.toLowerCase()}/fmodules/${name}` : undefined;
          default: return undefined;
        }
      }
    };
    this.healthHandlers = new HealthHandlers(healthCapability);
    // git 域桥接（git.abapgit）：ZADT_VSP APC WebSocket 的只读导出面
    // （gitTypes/gitExport）。桥走独立 TCP+Basic auth（同 ADT 凭据），不占用
    // ADT 会话；仅 DEV + development-workbench（policy 门控）。
    this.gitBridgeHandlers = new GitBridgeHandlers(
      gitBridgeTargetFromEnv(process.env, process.env.SAP_URL as string, process.env.SAP_CLIENT as string)
    );
    // 报表执行面（report.run/async/variants 收编，2026-10-07 所有者放开）：
    // variants=纯 ADT SQL（readClient）；runReport=桥 report 域（同 git 桥目标）；
    // submitReportJob=受控执行核包装 JOB_OPEN/SUBMIT/JOB_CLOSE（写域主会话）。
    this.reportHandlers = new ReportHandlers(
      createReportVariantsClient(readClient),
      createReportJobClient(
        createExecuteAbapClient(this.adtClient.httpClient),
        async (sql, rowLimit) => (await readClient.runQuery(sql, rowLimit, true)) ?? { values: [] },
        createSpoolJobClient(bindSpoolJobQueryRunner(readClient))
      ),
      // helper 桥 rfc 域（rfc.helper-bridge 收编）：与 git 桥同 APC 目标；
      // allowlist 默认=callRfm 只读白名单（fail-closed）
      new HelperRfcBridge(
        gitBridgeTargetFromEnv(process.env, process.env.SAP_URL as string, process.env.SAP_CLIENT as string)
      )
    );
    // analyzeLint（analysis.lint 收编，2026-10-10）：本地 abaplint 引擎（@abaplint/core），
    // 纯客户端执行——无 SAP 交互，全角色/全环境可见
    this.analyzeLintHandlers = new AnalyzeLintHandlers();
    this.applicationLogHandlers = new ApplicationLogHandlers(createApplicationLogClient(readClient.httpClient));
    this.crossReferenceHandlers = new CrossReferenceHandlers(
      createCrossReferenceClient(bindRunSqlToAdtQuery(readClient))
    );
    // 依赖上下文四工具（codeintel.context）：只读客户端侧分析，SAP 交互仅有
    // searchObject/objectStructure/getObjectSource 组成的 GET 取源链（串行执行），
    // 与 highLevelRead 相同复用 readClient 的 AdtHTTP 会话。
    this.contextAnalysisHandlers = new ContextAnalysisHandlers(createContextAnalysisClient(readClient));
    // UI5/Fiori BSP 只读三工具（ui5.read）：filestore GET（列表/文件树/文件内容），
    // 与 CDS 分析同型绑定 readClient 的 AdtHTTP 会话。
    this.ui5Handlers = new Ui5Handlers(createUi5FilestoreClient(readClient.httpClient));
    // SPOOL/后台作业只读二工具（diagnostics.spool-jobs 只读子集）：自由 SQL 通道
    // 查询 TSP01/TST01/TBTCP/TBTCO（与 getCallees 的 bindRunSqlToAdtQuery 同底座，
    // decode=true，补零标识依赖解码），逐次查询传入各自行数限额。
    this.spoolJobHandlers = new SpoolJobHandlers(createSpoolJobClient(bindSpoolJobQueryRunner(readClient)));
    // AMDP 调试可用性探测（debug.amdp-adt 的 discovery 前置）：无状态只读 GET，
    // 复用 readClient 会话（discovery 不受 AMDP 调试的会话保持约束）。
    this.amdpDiscoveryHandlers = new AmdpDiscoveryHandlers(createAmdpDiscoveryClient(readClient.httpClient));
    // 消息类文本只读工具（read.message-class-texts）：messageclass 资源 GET，
    // 与 CDS 分析同型绑定 readClient 的 AdtHTTP 会话。
    this.messageClassReadHandlers = new MessageClassReadHandlers(createMessageClassReadClient(readClient.httpClient));
    // 版本源码只读工具（revisions.source）：quick search → revisions 清单 →
    // 版本源码 GET 三段只读链；版本与源 URI 全部服务端解析，不接受任意 URL。
    this.revisionSourceHandlers = new RevisionSourceHandlers(createRevisionSourceClient(readClient));
    // i18n 按语言只读四工具（i18n.read 语言覆盖部分）：对象内容/数据元素标签/
    // 文本池/双语对比，源 URL 由 objectType+objectName 服务端解析。
    this.i18nReadHandlers = new I18nReadHandlers(createI18nReadClient(readClient));
    // 包边界只读检查工具（analysis.boundaries 只读子集）：TADIR 枚举 + 源码
    // 依赖提取 + TADIR 目标包反查，全部只读 SQL/GET。
    this.boundaryCheckHandlers = new BoundaryCheckHandlers(createBoundaryCheckClient(readClient));
    // 事务码元数据只读工具（read.transaction）：TSTC/TSTCT 自由 SQL（该 DEV 的
    // vit/wb TRAN 端点无映射，VSP 同源受限）。
    this.transactionReadHandlers = new TransactionReadHandlers(createTransactionReadClient(readClient));
    // 安装前置只读发现工具（install.diagnostics）：ZADT_VSP helper TADIR 探测 +
    // 激活状态核验（SEOCLSRC/REPOSRC）+ APC/SICF WebSocket 服务面探测 +
    // abapGit 服务可达性分类 + 本地运行时；不做任何安装动作。git repos 与
    // APC 服务的 GET 由 httpClient 直发（状态码分类需要原始 status 而非异常）。
    this.installDiagnosticsHandlers = new InstallDiagnosticsHandlers(
      createInstallDiagnosticsClient({
        searchObject: (query, objType, max) => readClient.searchObject(query, objType, max),
        runQuery: (sqlQuery, rowNumber, decode) => readClient.runQuery(sqlQuery, rowNumber, decode),
        requestGitRepos: () => readClient.httpClient.request('/sap/bc/adt/abapgit/repos', {
          method: 'GET',
          headers: { Accept: 'application/abapgit.adt.repos.v2+xml' }
        }),
        // F2 深化：APC WebSocket 服务面探测（404=未配置；400/405 等其他状态=服务面存在）
        requestApcService: () => readClient.httpClient.request('/sap/bc/apc/sap/zadt_vsp', {
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      })
    );
    // 知识查询只读二工具（diagnostics.knowledge-queries 子集）：DOKIL/DOKTL
    // 文档 + IMG 自定义活动/文件夹检索，自由 SQL 只读。
    // cluster_read 收编（2026-10-07）：任意集群表读取（复用 datapreview 通道，
    // 同 readClient——decode=false 保真 hex 由解码器还原）
    this.knowledgeQueriesHandlers = new KnowledgeQueriesHandlers(
      createKnowledgeQueriesClient(readClient),
      createClusterReadClient(readClient)
    );
    // 传输历史只读二工具（analysis.history 子集）：E071/E070 自由 SQL（真机
    // 复测可用——早前"受限"为 datapreview 会话预算耗尽的叠加假象）。
    // impact 收编（2026-10-07）：反向影响面（WBCROSSGT 多跳 BFS，同 readClient）
    this.transportHistoryHandlers = new TransportHistoryHandlers(
      createTransportHistoryClient(readClient),
      createImpactAnalysisClient(readClient)
    );
    this.transportScopeHandlers = new TransportScopeHandlers(async (sql, limit) => {
      const result = await readClient.runQuery(sql, limit, true);
      return result ?? {};
    });
    // D010INC 加载图只读工具（analysis.history 的 loads 子操作）：编译期加载
    // 关系（INCLUDE 拆分依赖），datapreview SQL 通道同款只读。
    this.loadGraphHandlers = new LoadGraphHandlers(createLoadGraphClient(readClient));
    // where-used-config 只读工具（analysis.history 的 where_used_config 子操作）：
    // TVARVC 配置引用分析 = 交叉表 SQL + grepObjects 源码确认两通道组合。
    this.whereUsedConfigHandlers = new WhereUsedConfigHandlers(createWhereUsedConfigClient({
      runSql: async (sql, rowLimit) => {
        const result = await readClient.runQuery(sql, rowLimit, true);
        return { values: result?.values ?? [] };
      },
      grepObjects: input => createSourceGrepClient(readClient.httpClient).grepObjects(input)
    }));
    // usage-examples 只读工具（analysis.history 的 usage_examples 子操作）：
    // 交叉表候选 + 逐候选源码读取（source/main GET）做形态匹配片段提取。
    this.usageExamplesHandlers = new UsageExamplesHandlers(createUsageExamplesClient({
      runSql: async (sql, rowLimit) => {
        const result = await readClient.runQuery(sql, rowLimit, true);
        return { values: result?.values ?? [] };
      },
      readSource: async input => {
        // 候选只产 CLAS/INTF/PROG 三类（FUGR 已排除），URI 模板同 grepObjects
        const uriByType: Record<string, string> = {
          CLAS: `/sap/bc/adt/oo/classes/${input.objectName.toLowerCase()}`,
          INTF: `/sap/bc/adt/oo/interfaces/${input.objectName.toLowerCase()}`,
          PROG: `/sap/bc/adt/programs/programs/${input.objectName.toLowerCase()}`
        };
        const uri = uriByType[input.objectType];
        if (!uri) throw new Error(`no source URL for ${input.objectType} ${input.objectName}`);
        const response = await readClient.httpClient.request(`${uri}/source/main`, {
          method: 'GET',
          headers: { Accept: 'text/plain' }
        });
        return typeof response.body === 'string' ? response.body : '';
      }
    }));
    // RFC 探测只读工具（rfc.remote-enabled.discovery 直链）：open-rfc 直连
    // SAP 网关（node:net，无 SDK），连接参数由既有 ADT 环境推导（主机/
    // client/凭据同源，实例号经 RFC_SYSNR 覆盖，缺省 '01' 与专用 DEV
    // .vsp.json rfc_sysnr 实测一致）。
    const rfcTargetHost = new URL(process.env.SAP_URL as string).hostname;
    this.rfcProbeHandlers = new RfcProbeHandlers(
      {
        host: rfcTargetHost,
        client: (process.env.SAP_CLIENT ?? '001').padStart(3, '0'),
        user: process.env.SAP_USER ?? '',
        password: sapPassword,
        language: (process.env.SAP_LANGUAGE ?? 'EN').slice(0, 2),
        sysnr: process.env.RFC_SYSNR
      }
    );
    // SM21 is read-only; it follows the stateless read rollout switch when enabled.
    this.sm21Handlers = new Sm21Handlers(new AdtHttpSm21Client(readClient.httpClient), sm21Config, readClient);
    const changePlans = new ChangePlanStore(
      this.safetyPolicy.planTtlMs,
      () => Date.now(),
      undefined,
      this.guardrails.changePlanMaxEntries,
      this.guardrails.rollbackFailedRetentionMs
    );
    const auditLogger = new AuditLogger(
      this.safetyPolicy.auditPath || path.resolve(process.cwd(), '.sap-mcp-audit-disabled')
    );
    // 受控描述修改（crud.set-description）：与 DDIC 属性受控链同面的写工作流
    //（plan + 原生确认 + 锁链单次执行 + readback），仅 DEV 受控 profiles。
    const descriptionPorts = bindDescriptionPorts(this.adtClient as never);
    const descriptionWorkflow = new DescriptionChangeWorkflow({
      ...descriptionPorts,
      policy: this.safetyPolicy,
      audit: auditLogger
    } as never);
    this.descriptionChangeHandlers = new DescriptionChangeHandlers(descriptionWorkflow, {
      supportsFormElicitation: () => Boolean(this.currentClientCapabilities()?.elicitation?.form),
      // 部署级自动确认开关：SAP_MCP_CONFIRMATION_MODE=auto（仅 DEV）时各确认链跳过人工表单
      autoApprove: () => this.safetyPolicy.confirmationAutoApprove,
      elicitInput: (params, timeoutMs) => this.elicitViaActiveRequest(params, timeoutMs)
    });
    // 受控消息类文本写入（i18n.write 的 write_message_texts）：与描述链同面的
    // 受控写工作流（plan + 原生确认 + stateful 锁链单次执行 + readback）。
    const messageTextWorkflow = new MessageTextWorkflow({
      http: descriptionPorts.http,
      locks: bindMessageClassPorts(this.adtClient as never).locks,
      policy: this.safetyPolicy,
      audit: auditLogger
    } as never);
    this.messageTextHandlers = new MessageTextHandlers(messageTextWorkflow, {
      supportsFormElicitation: () => Boolean(this.currentClientCapabilities()?.elicitation?.form),
      // 部署级自动确认开关：SAP_MCP_CONFIRMATION_MODE=auto（仅 DEV）时各确认链跳过人工表单
      autoApprove: () => this.safetyPolicy.confirmationAutoApprove,
      elicitInput: (params, timeoutMs) => this.elicitViaActiveRequest(params, timeoutMs)
    });
    // 受控程序文本池写入（F1 完整方案，report.text-elements 受控化收尾）：
    // 与消息文本链同面的受控写工作流（plan + 原生确认 + 程序对象锁单次执行 +
    // readback）。锁句柄由本 server 会话持有（真机实证跨会话句柄被拒）。
    const textPoolWorkflow = new TextPoolWorkflow({
      read: async (program, category) => {
        const result = await this.adtClient.getTextElements(
          `/sap/bc/adt/programs/programs/${program.toLowerCase()}`, category);
        return result.textElements.map(e => ({
          id: e.id, text: e.text,
          ...(e.maxLength && e.maxLength > 0 ? { maxLength: e.maxLength } : {})
        }));
      },
      write: (program, category, elements, lockHandle, transport) =>
        this.adtClient.setTextElements(
          `/sap/bc/adt/programs/programs/${program.toLowerCase()}`, category, elements, lockHandle, transport),
      locks: {
        lock: async (programUrl, mode) => await this.adtClient.lock(programUrl, mode),
        unLock: async (programUrl, handle) => await this.adtClient.unLock(programUrl, handle)
      },
      policy: this.safetyPolicy,
      audit: auditLogger
    });
    this.textPoolHandlers = new TextPoolHandlers(textPoolWorkflow, {
      supportsFormElicitation: () => Boolean(this.currentClientCapabilities()?.elicitation?.form),
      autoApprove: () => this.safetyPolicy.confirmationAutoApprove,
      elicitInput: (params, timeoutMs) => this.elicitViaActiveRequest(params, timeoutMs),
      planSummary: planId => {
        const plan = textPoolWorkflow.status(planId);
        return { program: plan.program, category: plan.category, newCount: plan.newElements.length,
          systemHost: plan.systemHost, client: plan.client };
      }
    });
    // 受控 UI5 filestore 写入（F5：ui5.write 关缺口）：四 kind（create_app/
    // upload_file/delete_file/delete_app）受控链。写域必须绑定 stateful 主会话
    // （this.adtClient.httpClient），与读域 stateless client 分离；filestore 写
    // 不走 workbench 对象锁，事务边界由 preview 冻结 + apply 漂移复核/readback 补齐。
    const ui5WriteWorkflow = new Ui5WriteWorkflow({
      client: createUi5WriteClient(this.adtClient.httpClient),
      policy: this.safetyPolicy,
      audit: auditLogger
    });
    this.ui5WriteHandlers = new Ui5WriteHandlers(ui5WriteWorkflow, {
      supportsFormElicitation: () => Boolean(this.currentClientCapabilities()?.elicitation?.form),
      autoApprove: () => this.safetyPolicy.confirmationAutoApprove,
      elicitInput: (params, timeoutMs) => this.elicitViaActiveRequest(params, timeoutMs),
      planSummary: planId => {
        const plan = ui5WriteWorkflow.status(planId);
        return { kind: plan.kind, appName: plan.appName, filePath: plan.filePath,
          fileCount: plan.oldState.fileCount, systemHost: plan.systemHost, client: plan.client };
      }
    });
    // 受控对象导入链（deploy-zip/fileio.import-export 关缺口）：abapGit ZIP →
    // $ 本地包批量受控导入（preview 冻结逐对象存在性/漂移基线 → 原生确认 →
    // 逐对象建/改+锁链+语法检查+激活+readback）。锁/写/激活是 stateful 专属，
    // 必须绑写域主会话 adtClient（与受控创建链同面）；建壳走无传输号路径
    // （本地包对象不进 CTS，corrNr 不携带）。
    const repositoryImportClient: RepositoryImportAdtClient = {
      searchObject: (query, objType, max) => this.adtClient.searchObject(query, objType, max),
      objectStructure: (objectUrl, version) => this.adtClient.objectStructure(objectUrl, version),
      getObjectSource: (objectSourceUrl, options) => this.adtClient.getObjectSource(objectSourceUrl, options),
      setObjectSource: (objectSourceUrl, source, lockHandle, transport) =>
        this.adtClient.setObjectSource(objectSourceUrl, source, lockHandle, transport),
      lock: (objectUrl, accessMode) => this.adtClient.lock(objectUrl, accessMode),
      unLock: (objectUrl, lockHandle) => this.adtClient.unLock(objectUrl, lockHandle),
      activate: (object, preauditRequested) => this.adtClient.activate(object, preauditRequested),
      readControlledPackage: packageName => this.adtClient.readControlledPackage(packageName),
      transportInfo: (objectUrl, devClass, operation) => this.adtClient.transportInfo(objectUrl, devClass, operation),
      transportDetails: transportNumber => this.adtClient.transportDetails(transportNumber),
      createImportShell: input => createImportObjectShell(this.adtClient.httpClient, input)
    };
    const repositoryImportWorkflow = new RepositoryObjectImportWorkflow({
      client: repositoryImportClient,
      policy: this.safetyPolicy,
      audit: auditLogger
    }, this.safetyPolicy.planTtlMs);
    this.repositoryObjectImportHandlers = new RepositoryObjectImportHandlers(repositoryImportWorkflow, {
      supportsFormElicitation: () => Boolean(this.currentClientCapabilities()?.elicitation?.form),
      // 部署级自动确认开关：SAP_MCP_CONFIRMATION_MODE=auto（仅 DEV）时各确认链跳过人工表单
      autoApprove: () => this.safetyPolicy.confirmationAutoApprove,
      elicitInput: (params, timeoutMs) => this.elicitViaActiveRequest(params, timeoutMs),
      planSummary: planId => {
        const plan = repositoryImportWorkflow.status(planId);
        return {
          packageName: plan.packageName,
          objectCount: plan.objects.length,
          createCount: plan.objects.filter(item => item.action === 'create').length,
          updateCount: plan.objects.filter(item => item.action === 'update').length,
          skipCount: plan.skips.length,
          systemHost: plan.systemHost,
          client: plan.client
        };
      }
    });

    const changeWorkflow = new AbapChangeWorkflow(
      this.adtClient,
      objectResolver,
      this.safetyPolicy,
      changePlans,
      auditLogger
    );
    const creationWorkflow = new AbapObjectCreationWorkflow(
      this.adtClient,
      new AbapCreationResolver(this.adtClient, this.safetyPolicy),
      this.safetyPolicy,
      new CreationPlanStore(
        this.safetyPolicy.planTtlMs,
        () => Date.now(),
        undefined,
        this.guardrails.changePlanMaxEntries,
        this.guardrails.rollbackFailedRetentionMs
      ),
      auditLogger
    );
    const repositoryCreationPlanStore = new RepositoryObjectCreationPlanStore(
      this.safetyPolicy.planTtlMs,
      () => Date.now(),
      undefined,
      this.guardrails.changePlanMaxEntries
    );
    const repositoryCreationWorkflow = new RepositoryObjectCreationWorkflow(
      repositoryCreationRegistry,
      repositoryCreationContext,
      repositoryCreationPlanStore,
      [
        new AbapSourceCreationAdapter('PROGRAM', creationWorkflow),
        new FunctionGroupCreationAdapter(creationWorkflow),
        new AbapSourceCreationAdapter('FUNCTION_MODULE', creationWorkflow),
        new FunctionGroupIncludeCreationAdapter(creationWorkflow),
        new PackageCreationAdapter(this.adtClient, this.safetyPolicy),
        new DatabaseTableCreationAdapter(this.adtClient, this.safetyPolicy),
        new StructureCreationAdapter(this.adtClient, this.safetyPolicy),
        new TypeGroupCreationAdapter(this.adtClient, this.safetyPolicy),
        new TableTypeCreationAdapter(this.adtClient, this.safetyPolicy),
        new LockObjectCreationAdapter(this.adtClient, this.safetyPolicy),
        new LogicalExternalSchemaCreationAdapter(this.adtClient, this.safetyPolicy),
        new NumberRangeObjectCreationAdapter(this.adtClient, this.safetyPolicy),
        new SapObjectTypeCreationAdapter(this.adtClient, this.safetyPolicy),
        new SapObjectNodeTypeCreationAdapter(this.adtClient, this.safetyPolicy),
        new ChangeDocumentObjectCreationAdapter(this.adtClient, this.safetyPolicy),
        new DomainCreationAdapter(this.adtClient, this.safetyPolicy),
        new DataElementCreationAdapter(this.adtClient, this.safetyPolicy),
        new MessageClassCreationAdapter(this.adtClient, this.safetyPolicy),
        new SourceObjectCreationAdapter('ABAP_CLASS', this.adtClient, this.safetyPolicy),
        new SourceObjectCreationAdapter('ABAP_INTERFACE', this.adtClient, this.safetyPolicy),
        new SourceObjectCreationAdapter('PROGRAM_INCLUDE', this.adtClient, this.safetyPolicy),
        new SourceObjectCreationAdapter('CDS_DATA_DEFINITION', this.adtClient, this.safetyPolicy),
        new SourceObjectCreationAdapter('CDS_ACCESS_CONTROL', this.adtClient, this.safetyPolicy),
        new SourceObjectCreationAdapter('CDS_METADATA_EXTENSION', this.adtClient, this.safetyPolicy),
        new SourceObjectCreationAdapter('CDS_ANNOTATION_DEFINITION', this.adtClient, this.safetyPolicy),
        new SourceObjectCreationAdapter('SERVICE_DEFINITION', this.adtClient, this.safetyPolicy),
        new SourceObjectCreationAdapter('BEHAVIOR_DEFINITION', this.adtClient, this.safetyPolicy),
        new SourceObjectCreationAdapter('CDS_TYPE', this.adtClient, this.safetyPolicy),
        new SourceObjectCreationAdapter('CDS_ASPECT', this.adtClient, this.safetyPolicy),
        new SourceObjectCreationAdapter('CDS_ENTITY_BUFFER', this.adtClient, this.safetyPolicy),
        new ServiceBindingCreationAdapter(this.adtClient, this.safetyPolicy)
      ],
      // M2-A：低 BASIS 版本收窄 RAP 时代 kind（BDEF/SRVD 等，ED1/1610 真机
      // BDEF=0/SRVD=0 实证）；指纹不可得 = 不收窄，行为零变化。
      () => this.resolveBasisRelease()
    );
    const repositoryConfirmationSessionId = randomUUID();
    const repositoryConfirmationChallenges = new RepositoryCreationConfirmationChallengeStore();
    const repositoryConfirmationProvider = createRepositoryCreationConfirmationProvider({
      environment: process.env,
      platform: process.platform,
      // 部署级自动确认开关：auto 模式下工厂返回直接放行的 AutoConfig provider
      confirmationAutoApprove: this.safetyPolicy.confirmationAutoApprove,
      supportsFormElicitation: () => Boolean(this.currentClientCapabilities()?.elicitation?.form),
      elicitInput: (params, timeoutMs) => this.elicitViaActiveRequest(params, timeoutMs)
    });
    const repositoryCleanupWorkflow = new RepositoryObjectCleanupWorkflow(
      this.adtClient,
      repositoryCreationRegistry,
      repositoryCreationContext,
      new RepositoryObjectCleanupPlanStore(
        this.safetyPolicy.planTtlMs,
        () => Date.now(),
        undefined,
        this.guardrails.changePlanMaxEntries
      ),
      repositoryCreationPlanStore
    );
    this.repositoryObjectCreationHandlers = new RepositoryObjectCreationHandlers(
      repositoryCreationRegistry,
      repositoryCreationContext,
      repositoryCreationWorkflow,
      {
        provider: repositoryConfirmationProvider,
        challengeStore: repositoryConfirmationChallenges,
        sessionId: repositoryConfirmationSessionId,
        applyConfirmed: creationPlanId => this.executionGate.run(() => repositoryCreationWorkflow.apply(creationPlanId)),
        audit: event => auditLogger.append({
          correlationId: `repository-confirmation:${event.plan.creationPlanId}`,
          creationPlanId: event.plan.creationPlanId,
          eventType: `REPOSITORY_CREATION_CONFIRMATION_${event.challengeStatus}`,
          systemHost: event.plan.systemHost,
          client: event.plan.client,
          systemRole: event.plan.systemRole,
          objectType: event.plan.target.objectKind,
          objectName: event.plan.target.objectName,
          parentObject: event.plan.target.parentName,
          packageName: event.plan.target.packageName || event.plan.target.parentName,
          transportRequest: event.plan.transportRequest,
          targetHash: event.plan.payloadHash,
          confirmationMode: event.providerMode,
          resultSummary: event.action,
          success: event.challengeStatus !== 'CANCELLED'
        })
      },
      repositoryCleanupWorkflow,
      {
        provider: repositoryConfirmationProvider,
        sessionId: `${repositoryConfirmationSessionId}:cleanup`,
        applyConfirmed: cleanupPlanId => this.executionGate.run(() => repositoryCleanupWorkflow.apply(cleanupPlanId)),
        audit: event => auditLogger.append({
          correlationId: `repository-cleanup-confirmation:${event.plan.cleanupPlanId}`,
          creationPlanId: event.plan.cleanupPlanId,
          eventType: `REPOSITORY_CLEANUP_CONFIRMATION_${event.challengeStatus}`,
          systemHost: event.plan.systemHost,
          client: event.plan.client,
          systemRole: event.plan.systemRole,
          objectType: event.plan.target.objectKind,
          objectName: event.plan.target.objectName,
          packageName: event.plan.target.packageName,
          transportRequest: event.plan.transportRequest,
          targetHash: event.plan.payloadHash,
          confirmationMode: event.providerMode,
          resultSummary: event.action,
          success: event.challengeStatus !== 'CANCELLED'
        })
      },
      // M2-A：list/describe 的 registry 清单按 release 收窄（RAP 时代 kind 隐藏）。
      () => this.resolveBasisRelease()
    );
    // 受控对象克隆（crud.clone-object 一站式工作流）：preview 只做源码快照与
    // 声明改名（只读 GET + 本地字符串操作），apply 委托既有受控创建链
    //（壳创建/锁/写/语法检查/激活/源码 hash 比对/失败补偿，单确认单执行）。
    // 创建链在确认层内部自持 executionGate，本层不重复过 gate。
    const cloneWorkflow = new CloneObjectWorkflow({
      http: this.adtClient.httpClient as never,
      creation: repositoryCreationWorkflow as never,
      policy: this.safetyPolicy,
      audit: auditLogger
    } as never);
    this.cloneObjectHandlers = new CloneObjectHandlers(cloneWorkflow, {
      supportsFormElicitation: () => Boolean(this.currentClientCapabilities()?.elicitation?.form),
      // 部署级自动确认开关：SAP_MCP_CONFIRMATION_MODE=auto（仅 DEV）时各确认链跳过人工表单
      autoApprove: () => this.safetyPolicy.confirmationAutoApprove,
      elicitInput: (params, timeoutMs) => this.elicitViaActiveRequest(params, timeoutMs)
    });
    // 受控对象重命名（refactor.rename 一站式）：preview 只读快照+改名冻结，
    // apply 单确认两步——①复用克隆工作流落地新对象（受控创建链保证）；
    // ②复用受控清理链删除旧对象；删除失败按 PARTIAL_RENAME 终结（双对象
    // 保留待人工处置，不自动重试不回滚）。确认型工具，外层 gate 豁免。
    const renameWorkflow = new RenameControlledWorkflow({
      http: this.adtClient.httpClient as never,
      clone: cloneWorkflow as never,
      cleanup: repositoryCleanupWorkflow as never,
      policy: this.safetyPolicy,
      audit: auditLogger
    } as never);
    this.renameControlledHandlers = new RenameControlledHandlers(renameWorkflow, {
      supportsFormElicitation: () => Boolean(this.currentClientCapabilities()?.elicitation?.form),
      // 部署级自动确认开关：SAP_MCP_CONFIRMATION_MODE=auto（仅 DEV）时各确认链跳过人工表单
      autoApprove: () => this.safetyPolicy.confirmationAutoApprove,
      elicitInput: (params, timeoutMs) => this.elicitViaActiveRequest(params, timeoutMs)
    });
    this.safeAbapHandlers = new SafeAbapHandlers(changeWorkflow, {
      allowTextConfirmation: this.safetyPolicy.allowTextConfirmation,
      supportsFormElicitation: () => Boolean(this.currentClientCapabilities()?.elicitation?.form),
      // 部署级自动确认开关：SAP_MCP_CONFIRMATION_MODE=auto（仅 DEV）时各确认链跳过人工表单
      autoApprove: () => this.safetyPolicy.confirmationAutoApprove,
      elicitInput: (params, timeoutMs) => this.elicitViaActiveRequest(params, timeoutMs),
      applyConfirmed: input => this.executionGate.run(() => changeWorkflow.apply(input))
    }, creationWorkflow, {
      allowTextConfirmation: this.safetyPolicy.allowTextConfirmation,
      supportsFormElicitation: () => Boolean(this.currentClientCapabilities()?.elicitation?.form),
      // 部署级自动确认开关：SAP_MCP_CONFIRMATION_MODE=auto（仅 DEV）时各确认链跳过人工表单
      autoApprove: () => this.safetyPolicy.confirmationAutoApprove,
      elicitInput: (params, timeoutMs) => this.elicitViaActiveRequest(params, timeoutMs),
      applyConfirmed: input => this.executionGate.run(() => creationWorkflow.apply(input))
    });
    const debugWorkflow = new DebugControlWorkflow(
      this.adtClient,
      this.safetyPolicy,
      new DebugOperationPlanStore(
        this.safetyPolicy.planTtlMs,
        () => Date.now(),
        undefined,
        this.guardrails.changePlanMaxEntries
      ),
      new DebugSessionAuthorizationStore(
        this.safetyPolicy.debugAuthTtlMs,
        () => Date.now(),
        undefined,
        this.guardrails.changePlanMaxEntries
      ),
      auditLogger
    );
    this.safeDebugHandlers = new SafeDebugHandlers(debugWorkflow, {
      supportsFormElicitation: () => Boolean(this.currentClientCapabilities()?.elicitation?.form),
      // 部署级自动确认开关：SAP_MCP_CONFIRMATION_MODE=auto（仅 DEV）时各确认链跳过人工表单
      autoApprove: () => this.safetyPolicy.confirmationAutoApprove,
      elicitInput: (params, timeoutMs) => this.elicitViaActiveRequest(params, timeoutMs),
      applyConfirmed: input => this.executionGate.run(() => debugWorkflow.applyOperation(input)),
      authorizeConfirmed: (targetUser, debuggeeId) => this.executionGate.run(
        () => debugWorkflow.authorizeConfirmed(targetUser, debuggeeId)
      )
    });

    const advancedPlans = new AdvancedOperationPlanStore(
      this.safetyPolicy.planTtlMs,
      () => Date.now(),
      undefined,
      this.guardrails.changePlanMaxEntries
    );
    const ddicWorkflow = new DdicPropertyChangeWorkflow(this.adtClient, this.safetyPolicy, advancedPlans, auditLogger);
    const packageWorkflow = new PackageChangeWorkflow(this.adtClient, objectResolver, this.safetyPolicy, advancedPlans, auditLogger);
    const rapWorkflow = new RapOperationWorkflow(this.adtClient, this.safetyPolicy, advancedPlans, auditLogger);
    this.safeAdvancedHandlers = new SafeAdvancedHandlers({
      status: operationPlanId => advancedPlans.view(operationPlanId, {
        systemHost: this.safetyPolicy.systemHost,
        client: this.safetyPolicy.client,
        systemRole: this.safetyPolicy.systemRole,
        toolProfile: this.safetyPolicy.toolProfile
      }),
      previewDdicPropertyChange: args => ddicWorkflow.preview(args),
      previewPackageChange: args => packageWorkflow.preview(args),
      previewRapOperation: args => rapWorkflow.preview(args)
    }, {
      supportsFormElicitation: () => Boolean(this.currentClientCapabilities()?.elicitation?.form),
      // 部署级自动确认开关：SAP_MCP_CONFIRMATION_MODE=auto（仅 DEV）时各确认链跳过人工表单
      autoApprove: () => this.safetyPolicy.confirmationAutoApprove,
      elicitInput: (params, timeoutMs) => this.elicitViaActiveRequest(params, timeoutMs),
      applyConfirmed: (operationPlanId, confirmationMode) => this.executionGate.run(async () => {
        const plan = advancedPlans.get(operationPlanId);
        if (plan.operationKind === 'CHANGE_PACKAGE') return packageWorkflow.apply(operationPlanId, confirmationMode);
        if (plan.operationKind === 'RAP_GENERATE' || plan.operationKind === 'RAP_PUBLISH_SERVICE') return rapWorkflow.apply(operationPlanId, confirmationMode);
        return ddicWorkflow.apply(operationPlanId, confirmationMode);
      })
    });

    const qualityPlans = new QualityCheckPlanStore(
      this.safetyPolicy.planTtlMs,
      () => Date.now(),
      undefined,
      this.guardrails.changePlanMaxEntries
    );
    const qualityWorkflow = new QualityCheckWorkflow(
      this.adtClient,
      objectResolver,
      this.safetyPolicy,
      qualityPlans,
      auditLogger
    );
    this.safeQualityHandlers = new SafeQualityHandlers(qualityWorkflow, {
      supportsFormElicitation: () => Boolean(this.currentClientCapabilities()?.elicitation?.form),
      // 部署级自动确认开关：SAP_MCP_CONFIRMATION_MODE=auto（仅 DEV）时各确认链跳过人工表单
      autoApprove: () => this.safetyPolicy.confirmationAutoApprove,
      elicitInput: (params, timeoutMs) => this.elicitViaActiveRequest(params, timeoutMs),
      runConfirmed: (qualityPlanId, confirmationMode) => this.executionGate.run(() => qualityWorkflow.run(qualityPlanId, confirmationMode))
    });

    // 受控对象激活工作流（关闭矩阵缺口 devtools.activate）：
    // preview 只读收集未激活对象并冻结 plan；apply 经原生确认后在执行门内单次激活。
    const activationPlans = new ObjectActivationPlanStore(
      this.safetyPolicy.planTtlMs,
      () => Date.now(),
      undefined,
      this.guardrails.changePlanMaxEntries
    );
    const activationWorkflow = new ObjectActivationWorkflow(
      this.adtClient,
      this.safetyPolicy,
      activationPlans,
      auditLogger
    );
    this.safeActivationHandlers = new SafeActivationHandlers(activationWorkflow, {
      supportsFormElicitation: () => Boolean(this.currentClientCapabilities()?.elicitation?.form),
      // 部署级自动确认开关：SAP_MCP_CONFIRMATION_MODE=auto（仅 DEV）时各确认链跳过人工表单
      autoApprove: () => this.safetyPolicy.confirmationAutoApprove,
      elicitInput: (params, timeoutMs) => this.elicitViaActiveRequest(params, timeoutMs),
      applyConfirmed: (activationPlanId, confirmationMode) => this.executionGate.run(() => activationWorkflow.apply(activationPlanId, confirmationMode))
    });

    // 受控传输请求创建工作流（cts.create-request 专属动作，仅创建）：
    // preview 只读 CTS 预检并冻结 plan；apply 经原生确认后在执行门内单次创建
    // 并读回验证；释放/删除/改属主不在本链路面。
    const transportCreationPlans = new TransportCreationPlanStore(
      this.safetyPolicy.planTtlMs,
      () => Date.now(),
      undefined,
      this.guardrails.changePlanMaxEntries
    );
    const transportCreationWorkflow = new TransportCreationWorkflow(
      this.adtClient,
      this.safetyPolicy,
      transportCreationPlans,
      auditLogger
    );
    // 受控传输请求清理工作流（空请求边界：未释放+零对象+本人属主才可删）：
    // preview 只读核验三条红线并冻结 plan；apply 经原生确认后在执行门内单次
    // 删除 + 缺席验证；非空/已释放/他人请求仍不可删。
    const transportCleanupPlans = new TransportCleanupPlanStore(
      this.safetyPolicy.planTtlMs,
      () => Date.now(),
      undefined,
      this.guardrails.changePlanMaxEntries
    );
    const transportCleanupWorkflow = new TransportCleanupWorkflow(
      this.adtClient,
      this.safetyPolicy,
      transportCleanupPlans,
      auditLogger
    );
    this.safeTransportCreationHandlers = new SafeTransportCreationHandlers(transportCreationWorkflow, {
      supportsFormElicitation: () => Boolean(this.currentClientCapabilities()?.elicitation?.form),
      // 部署级自动确认开关：SAP_MCP_CONFIRMATION_MODE=auto（仅 DEV）时各确认链跳过人工表单
      autoApprove: () => this.safetyPolicy.confirmationAutoApprove,
      elicitInput: (params, timeoutMs) => this.elicitViaActiveRequest(params, timeoutMs),
      applyConfirmed: (planId, confirmationMode) => this.executionGate.run(() => transportCreationWorkflow.apply(planId, confirmationMode))
    }, transportCleanupWorkflow, {
      supportsFormElicitation: () => Boolean(this.currentClientCapabilities()?.elicitation?.form),
      // 部署级自动确认开关：SAP_MCP_CONFIRMATION_MODE=auto（仅 DEV）时各确认链跳过人工表单
      autoApprove: () => this.safetyPolicy.confirmationAutoApprove,
      elicitInput: (params, timeoutMs) => this.elicitViaActiveRequest(params, timeoutMs),
      applyConfirmed: (planId, confirmationMode) => this.executionGate.run(() => transportCleanupWorkflow.apply(planId, confirmationMode))
    });

    this.focusedTaskHandlers = new FocusedTaskHandlers(
      // sap 委托链按"被委托工具"的操作分类选槽与域：委托只读工具（如
      // getObjectSource）走读槽+读域，委托写工具（如 edit 链）走写槽+写域。
      // sap 自身外层豁免门（usesSapExecutionGate=false），不双重占槽。
      (toolName, argumentsValue) => {
        const gate = this.gateSelector(toolName);
        const dispatch = () => this.dispatchTool(toolName, argumentsValue);
        return gate ? gate.run(dispatch) : dispatch();
      },
      () => this.healthcheckResult()
    );


        // Setup tool handlers
    this.toolCatalog = this.createToolCatalog();
    this.setupToolHandlers();
  }

  private serializeResult(result: unknown) {
    try {
      // Handlers already return a well-formed MCP tool result
      // ({ content: [...] }). Re-wrapping it would double-serialize the payload
      // (every quote in the data gets escaped again), needlessly inflating large
      // responses such as object source (issue #4). Pass those through as-is and
      // only wrap raw values (e.g. the healthcheck object).
      if (typeof result === 'object' && result !== null && 'content' in result && Array.isArray(result.content)) {
        return result;
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
          )
        }]
      };
    } catch (error) {
      return this.handleError(new McpError(
        ErrorCode.InternalError,
        'Failed to serialize result'
      ));
    }
  }

  private handleError(error: unknown) {
    // MRTR 确认请求必须穿透守卫链（不能降级为 isError 文本），
    // 由 tools/call handler 捕获并转为 input_required 结果
    if (error instanceof ConfirmationRequiredError) throw error;
    if (!(error instanceof Error)) {
      error = new Error(String(error));
    }
    if (error instanceof SafeAbapError) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(error.toResponse())
        }],
        isError: true
      };
    }
    if (error instanceof McpError) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: error.message,
            code: error.code
          })
        }],
        isError: true
      };
    }
    // 未分类异常兜底：栈走 stderr（不进 MCP 响应、不含凭据），否则 500 无法定位
    console.error('[abap-ai-workbench] unhandled tool error:', error instanceof Error ? (error.stack || error.message) : error);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Internal server error',
          code: ErrorCode.InternalError
        })
      }],
      isError: true
    };
  }

  /**
   * 确认能力感知：modern（2026-07-28）连接的客户端能力在每请求 envelope 中
   * （实例 getClientCapabilities 不填充）；legacy 连接由 initialize 握手填充。
   * 合并读取保证两个 era 的 supportsFormElicitation 判定一致。
   */
  private currentClientCapabilities(): { elicitation?: { form?: unknown } } | undefined {
    return this.activeEnvelopeCapabilities ?? this.getClientCapabilities() ?? undefined;
  }

  /**
   * MRTR 确认桥：把构造期注入的 elicitInput port 转发到当前
   * tools/call 调用的 MRTR 引擎（无响应轮抛确认请求、重试轮恢复结果）。
   */
  private elicitViaActiveRequest(
    params: Parameters<NonNullable<AbapAdtServer['activeElicitPort']>>[0],
    timeoutMs: number
  ) {
    if (!this.activeElicitPort) {
      throw new McpError(ErrorCode.InternalError, 'No active request context for confirmation.');
    }
    return this.activeElicitPort(params, timeoutMs);
  }

  private setupToolHandlers() {
    // v2 低层 API：setRequestHandler 按方法字符串注册（不再传 zod schema）。
    // tools/list 返回静态目录；tools/call 进入统一的守卫执行链。
    this.setRequestHandler('tools/list', async () => {
      // ToolDefinition 是本项目自管的 JSON Schema 子集；wire 合法性由
      // v2 era 校验层在运行时把关（0.8.x 起该目录即按 JSON Schema 输出）。
      // M1 releaseGate 出口裁剪：低 BASIS 版本（如 S/4 1610）隐藏登记了
      // minBasisRelease 的工具（当前=RAP 面）；指纹不可得/高版本 = 目录零变化。
      const basisRelease = await this.resolveBasisRelease();
      const tools = basisRelease === undefined
        ? this.toolCatalog
        : this.toolCatalog.filter(tool => isToolAvailableForBasisRelease(tool.name, basisRelease));
      return { tools } as unknown as import("@modelcontextprotocol/server").ListToolsResult;
    });

    this.setRequestHandler('tools/call', async (request, ctx) => {
      // 单并发执行模型下，为本次调用创建 MRTR 确认 port：
      // - 无 inputResponses（首轮）→ 确认点抛 ConfirmationRequiredError；
      // - 客户端带 inputResponses 重试（legacy 经 shim 自动驱动）→ port 恢复确认结果。
      const callArguments = (request.params.arguments || {}) as Record<string, unknown>;
      this.activeElicitPort = createMrtrElicitPort(
        request.params.name,
        callArguments,
        ctx.mcpReq.inputResponses,
        ctx.mcpReq.requestState()
      );
      this.activeEnvelopeCapabilities =
        ((ctx.mcpReq.envelope as Record<string, unknown> | undefined)?.['io.modelcontextprotocol/clientCapabilities'] as { elicitation?: { form?: unknown } } | undefined) ?? null;
      try {
        return await executeGuardedToolCall(
          request.params.name,
          callArguments,
          this.guardrails,
          (toolName: string) => this.gateSelector(toolName),
          limitedArguments => {
            // 限额参数可能与原始参数不同：port 绑定用原始调用参数（重试请求逐字节一致）
            const dispatchArgs = limitedArguments;
            return this.sessionSupervisor
              ? this.sessionSupervisor.execute(
                request.params.name,
                () => this.dispatchTool(request.params.name, dispatchArgs, ctx.mcpReq.signal)
              )
              : this.dispatchTool(request.params.name, dispatchArgs, ctx.mcpReq.signal);
          },
          result => this.serializeResult(result) as import("@modelcontextprotocol/server").CallToolResult,
          error => this.handleError(error) as import("@modelcontextprotocol/server").CallToolResult
        );
      } catch (error) {
        // 确认请求穿透守卫链（handleError 原样 rethrow），转 MRTR input_required 结果
        if (error instanceof ConfirmationRequiredError) {
          return inputRequired({ inputRequests: error.inputRequests, requestState: error.requestState });
        }
        throw error;
      } finally {
        this.activeElicitPort = undefined;
      }
    });
  }

  private createToolCatalog(): ToolDefinition[] {
    const safeTools = this.safeAbapHandlers.getTools();
    const safeDebugTools = this.safeDebugHandlers.getTools();
    const completeControlledAdvancedTools = [
      ...this.safeAdvancedHandlers.getTools(),
      ...this.repositoryObjectCreationHandlers.getTools(true),
      ...this.descriptionChangeHandlers.getTools(),
      ...this.messageTextHandlers.getTools(),
      ...this.textPoolHandlers.getTools(),
      ...this.ui5WriteHandlers.getTools(),
      ...this.repositoryObjectImportHandlers.getTools(),
      ...this.cloneObjectHandlers.getTools(),
      ...this.renameControlledHandlers.getTools()
    ];
    const controlledAdvancedTools = completeControlledAdvancedTools;
    const qualityTools = this.safeQualityHandlers.getTools();
    // 受控激活三工具：进入 development 分支与 workbench 显式名单的专属集合
    const activationTools = this.safeActivationHandlers.getTools();
    // 受控传输创建三工具：进入 development 分支与 workbench 显式名单的专属集合
    const transportCreationTools = this.safeTransportCreationHandlers.getTools();
    // CDS 依赖分析三工具：只读，进入 development/diagnostic-readonly/legacy-full
    // 分支与 workbench 显式名单（business/operations/safe 不收录）
    const cdsTools = this.cdsAnalysisHandlers.getTools();
    const sm21Tools = this.sm21Handlers?.getTools() || [];
    // Wave 3 只读分析三工具（grepPackage/grepObjects/getCallees/readApplicationLog，
    // 共 4 个名字）+ 依赖上下文四工具（codeintel.context）+ UI5 只读三工具
    //（ui5.read）+ SPOOL/作业只读二工具（diagnostics.spool-jobs 只读子集）
    // + 消息类文本只读工具（read.message-class-texts）+ 版本源码只读工具
    //（revisions.source）+ i18n 按语言只读四工具（i18n.read）+ 包边界只读
    // 检查工具（analysis.boundaries 只读子集）：并入 runtimeTools 后由各
    // profile 分支按既有规则收录（development/diagnostic-readonly/legacy-full
    // 自动获得；business 名单不含；operations 名单显式追加 readApplicationLog）。
    const analyticReadTools = [
      ...this.sourceGrepHandlers.getTools(),
      ...this.crossReferenceHandlers.getTools(),
      ...this.applicationLogHandlers.getTools(),
      ...this.dumpAnalysisHandlers.getTools(),
      ...this.contextAnalysisHandlers.getTools(),
      ...this.ui5Handlers.getTools(),
      ...this.spoolJobHandlers.getTools(),
      ...this.amdpDiscoveryHandlers.getTools(),
      ...this.messageClassReadHandlers.getTools(),
      ...this.revisionSourceHandlers.getTools(),
      ...this.i18nReadHandlers.getTools(),
      ...this.boundaryCheckHandlers.getTools(),
      ...this.transactionReadHandlers.getTools(),
      ...this.installDiagnosticsHandlers.getTools(),
      ...this.knowledgeQueriesHandlers.getTools(),
      ...this.transportHistoryHandlers.getTools(),
      ...this.transportScopeHandlers.getTools(),
      ...this.loadGraphHandlers.getTools(),
      ...this.whereUsedConfigHandlers.getTools(),
      ...this.usageExamplesHandlers.getTools(),
      ...this.dependencyGraphHandlers.getTools(),
      ...this.rfcProbeHandlers.getTools(),
      // 报表变体清单只读工具（report.variants 收编）：与知识查询只读面同流向
      ...[this.reportHandlers.getVariantsTool()],
      // 本地 abaplint 静态分析（analysis.lint 收编）：纯客户端只读，无 SAP 交互
      ...this.analyzeLintHandlers.getTools()
    ];
    // runUnitCoverage 是执行行为（运行被测对象的用户代码），按 other-mutation
    // 语义仅进入 workbench 显式名单与 legacy-full 专家面，不给 development
    // 组合面与 diagnostic-readonly。executeAbap 同级执行类（临时程序包装
    // + ABAP Unit 单次运行），随 coverageTools 进同一 catalog 分组。
    const coverageTools = [
      ...this.unitCoverageHandlers.getTools(),
      ...this.healthHandlers.getTools(),
      ...this.executeAbapHandlers.getTools(),
      ...this.gitBridgeHandlers.getTools(),
      // 报表执行两工具（report.run/async 收编）：执行类（OTHER_MUTATION，
      // DEV-only 门控）；variants 只读工具在 analyticReadTools
      ...this.reportHandlers.getExecutionTools()
    ];
    const runtimeTools = [...this.highLevelReadHandlers.getTools(), ...sm21Tools, ...analyticReadTools];
    const focusedTools = this.focusedTaskHandlers.getTools();
    const legacyTools = [
        ...this.authHandlers.getTools(),
        ...this.transportHandlers.getTools(),
        ...this.objectHandlers.getTools(),
        ...this.classHandlers.getTools(),
        ...this.codeAnalysisHandlers.getTools(),
        ...this.objectLockHandlers.getTools(),
        ...this.objectSourceHandlers.getTools(),
        ...this.objectDeletionHandlers.getTools(),
        ...this.objectManagementHandlers.getTools(),
        ...this.objectRegistrationHandlers.getTools(),
        ...this.nodeHandlers.getTools(),
        ...this.discoveryHandlers.getTools(),
        ...this.unitTestHandlers.getTools(),
        ...this.prettyPrinterHandlers.getTools(),
        ...this.gitHandlers.getTools(),
        ...this.ddicHandlers.getTools(),
        ...this.serviceBindingHandlers.getTools(),
        ...this.queryHandlers.getTools(),
        ...this.feedHandlers.getTools(),
        ...this.debugHandlers.getTools(),
        ...this.renameHandlers.getTools(),
        ...this.atcHandlers.getTools(),
        ...this.traceHandlers.getTools(),
        ...this.refactorHandlers.getTools(),
        ...this.revisionHandlers.getTools(),
        ...this.rapGeneratorHandlers.getTools(),
        {
          name: 'healthcheck',
          description: 'Check local MCP process health and configured target identity without contacting SAP',
          inputSchema: {
            type: 'object' as const,
            properties: {}
          }
        }
      ];
    const completeCatalog = [
      ...safeTools,
      ...safeDebugTools,
      ...controlledAdvancedTools,
      ...qualityTools,
      ...activationTools,
      ...transportCreationTools,
      ...cdsTools,
      ...coverageTools,
      ...runtimeTools,
      ...focusedTools,
      ...legacyTools
    ];
    assertToolCatalogClassified(completeCatalog.map(tool => tool.name));
    return selectProfileTools(
      this.safetyPolicy.toolProfile,
      safeTools,
      legacyTools,
      runtimeTools,
      safeDebugTools,
      this.safetyPolicy.systemRole,
      controlledAdvancedTools,
      qualityTools,
      focusedTools,
      activationTools,
      transportCreationTools,
      cdsTools,
      coverageTools
    ).map(withCanonicalToolMetadata);
  }

  private async dispatchTool(
    toolName: string,
    limitedArguments: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<unknown> {
        let result: unknown;
        // Operation policy and runtime catalog membership both protect direct calls.
        this.safetyPolicy.assertToolOperationAllowed(toolName);
        if (!this.toolCatalog.some(tool => tool.name === toolName)) {
          throw new McpError(ErrorCode.MethodNotFound, `Tool '${toolName}' is unavailable in the ${this.safetyPolicy.toolProfile} tool profile.`);
        }
        // M1 releaseGate dispatch 拒绝：与 tools/list 隐藏双保留——客户端缓存
        // 旧目录直呼被裁剪工具时在入口显式拒绝，并说明版本原因。
        const dispatchBasisRelease = await this.resolveBasisRelease();
        if (dispatchBasisRelease !== undefined && !isToolAvailableForBasisRelease(toolName, dispatchBasisRelease)) {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Tool '${toolName}' requires SAP_BASIS >= ${TOOL_MIN_BASIS_RELEASE[toolName] ?? 700} but the target system reports BASIS ${dispatchBasisRelease}.`
          );
        }
        if (this.focusedTaskHandlers.supports(toolName)) {
          return this.focusedTaskHandlers.handle(toolName, limitedArguments);
        }
        if ((this.safetyPolicy.toolProfile === 'legacy-full'
          || this.safetyPolicy.toolProfile === 'development'
          || this.safetyPolicy.toolProfile === 'development-workbench'
          || this.safetyPolicy.toolProfile === 'diagnostic-readonly'
          || this.safetyPolicy.toolProfile === 'operations-readonly')
          && this.sm21Handlers?.supports(toolName)) {
          return this.sm21Handlers.handle(toolName, limitedArguments);
        }
        if (this.safetyPolicy.toolProfile !== 'safe' && this.highLevelReadHandlers.supports(toolName)) {
          return this.highLevelReadHandlers.handle(toolName, limitedArguments);
        }
        // CDS 依赖分析三工具：全只读，与 highLevelRead 相同按"非 safe 即可派发"——
        // diagnostic-readonly 也允许（三工具为 read-only 类，符合诊断入口定位）；
        // safe profile 下 catalog 无三工具，前置成员检查已拒绝。
        if (this.safetyPolicy.toolProfile !== 'safe' && this.dumpAnalysisHandlers.supports(toolName)) {
          return this.dumpAnalysisHandlers.handle(toolName, limitedArguments);
        }
        if (this.safetyPolicy.toolProfile !== 'safe' && this.cdsAnalysisHandlers.supports(toolName)) {
          return this.cdsAnalysisHandlers.handle(toolName, limitedArguments);
        }
        if (this.safeQualityHandlers.supports(toolName)) {
          return this.safeQualityHandlers.handle(toolName, limitedArguments);
        }
        // 受控激活链：profile/role 门控已由 assertToolOperationAllowed 前置把关，
        // catalog 成员检查保证非 development/development-workbench profile 不可见。
        if (this.safeActivationHandlers.supports(toolName)) {
          return this.safeActivationHandlers.handle(toolName, limitedArguments);
        }
        // 受控传输创建与清理链（仅创建 + 仅删空请求）：门控语义同上；释放/
        // 改属主等动作无对应工具，不会进入本分发路径。
        if (this.safeTransportCreationHandlers.supports(toolName)) {
          return this.safeTransportCreationHandlers.handle(toolName, limitedArguments);
        }
        // Wave 3 只读分析三工具（grep/callees/applog）：与 CDS 分析同型，
        // safe 之外的全部 profile 分派；runUnitCoverage 是执行类工具，catalog
        // 成员已限定 workbench/legacy-full，QAS/PRD 由入口策略拒绝。
        if (this.safetyPolicy.toolProfile !== 'safe'
          && (this.sourceGrepHandlers.supports(toolName)
            || this.crossReferenceHandlers.supports(toolName)
            || this.applicationLogHandlers.supports(toolName))) {
          if (this.sourceGrepHandlers.supports(toolName)) return this.sourceGrepHandlers.handle(toolName, limitedArguments);
          if (this.crossReferenceHandlers.supports(toolName)) return this.crossReferenceHandlers.handle(toolName, limitedArguments);
          return this.applicationLogHandlers.handle(toolName, limitedArguments);
        }
        // 依赖上下文四工具（codeintel.context）与 UI5 只读三工具（ui5.read）：
        // 全只读，与 Wave 3 分析同型，safe 之外的全部 profile 分派；
        // catalog 成员已限定可见 profile。
        if (this.safetyPolicy.toolProfile !== 'safe' && this.contextAnalysisHandlers.supports(toolName)) {
          return this.contextAnalysisHandlers.handle(toolName, limitedArguments);
        }
        if (this.safetyPolicy.toolProfile !== 'safe' && this.ui5Handlers.supports(toolName)) {
          return this.ui5Handlers.handle(toolName, limitedArguments);
        }
        // SPOOL/作业只读二工具（diagnostics.spool-jobs 只读子集）：全只读，
        // 与上述分析工具同型分派；catalog 成员已限定可见 profile。
        if (this.safetyPolicy.toolProfile !== 'safe' && this.spoolJobHandlers.supports(toolName)) {
          return this.spoolJobHandlers.handle(toolName, limitedArguments);
        }
        if (this.safetyPolicy.toolProfile !== 'safe' && this.amdpDiscoveryHandlers.supports(toolName)) {
          return this.amdpDiscoveryHandlers.handle(toolName, limitedArguments);
        }
        // 消息类文本只读工具（read.message-class-texts）：全只读，同型分派。
        if (this.safetyPolicy.toolProfile !== 'safe' && this.messageClassReadHandlers.supports(toolName)) {
          return this.messageClassReadHandlers.handle(toolName, limitedArguments);
        }
        // 版本源码只读工具（revisions.source）：全只读，同型分派。
        if (this.safetyPolicy.toolProfile !== 'safe' && this.revisionSourceHandlers.supports(toolName)) {
          return this.revisionSourceHandlers.handle(toolName, limitedArguments);
        }
        // i18n 按语言只读四工具（i18n.read）：全只读，同型分派。
        if (this.safetyPolicy.toolProfile !== 'safe' && this.i18nReadHandlers.supports(toolName)) {
          return this.i18nReadHandlers.handle(toolName, limitedArguments);
        }
        // 包边界只读检查工具（analysis.boundaries）：全只读，同型分派。
        if (this.safetyPolicy.toolProfile !== 'safe' && this.boundaryCheckHandlers.supports(toolName)) {
          return this.boundaryCheckHandlers.handle(toolName, limitedArguments);
        }
        // 事务码元数据只读工具（read.transaction）：全只读，同型分派。
        if (this.safetyPolicy.toolProfile !== 'safe' && this.transactionReadHandlers.supports(toolName)) {
          return this.transactionReadHandlers.handle(toolName, limitedArguments);
        }
        // 安装前置只读发现工具（install.diagnostics）：全只读，同型分派。
        if (this.safetyPolicy.toolProfile !== 'safe' && this.installDiagnosticsHandlers.supports(toolName)) {
          return this.installDiagnosticsHandlers.handle(toolName, limitedArguments);
        }
        // 知识查询只读二工具（diagnostics.knowledge-queries 子集）：全只读，同型分派。
        if (this.safetyPolicy.toolProfile !== 'safe' && this.knowledgeQueriesHandlers.supports(toolName)) {
          return this.knowledgeQueriesHandlers.handle(toolName, limitedArguments);
        }
        // 传输历史只读二工具（analysis.history 子集）：全只读，同型分派。
        if (this.safetyPolicy.toolProfile !== 'safe' && this.transportHistoryHandlers.supports(toolName)) {
          return this.transportHistoryHandlers.handle(toolName, limitedArguments);
        }
        if (this.safetyPolicy.toolProfile !== 'safe' && this.transportScopeHandlers.supports(toolName)) {
          return this.transportScopeHandlers.handle(toolName, limitedArguments);
        }
        // D010INC 加载图只读工具（analysis.history 的 loads 子操作）：同型分派。
        if (this.safetyPolicy.toolProfile !== 'safe' && this.loadGraphHandlers.supports(toolName)) {
          return this.loadGraphHandlers.handle(toolName, limitedArguments);
        }
        // where-used-config 只读工具（analysis.history 的 where_used_config 子操作）：同型分派。
        if (this.safetyPolicy.toolProfile !== 'safe' && this.whereUsedConfigHandlers.supports(toolName)) {
          return this.whereUsedConfigHandlers.handle(toolName, limitedArguments);
        }
        // usage-examples 只读工具（analysis.history 的 usage_examples 子操作）：同型分派。
        if (this.safetyPolicy.toolProfile !== 'safe' && this.usageExamplesHandlers.supports(toolName)) {
          return this.usageExamplesHandlers.handle(toolName, limitedArguments);
        }
        if (this.dependencyGraphHandlers.supports(toolName)) {
          return this.dependencyGraphHandlers.handle(toolName, limitedArguments);
        }
        // RFC 探测只读工具（rfc.remote-enabled.discovery 直链）：全只读，同型分派。
        if (this.safetyPolicy.toolProfile !== 'safe' && this.rfcProbeHandlers.supports(toolName)) {
          return this.rfcProbeHandlers.handle(toolName, limitedArguments);
        }
        if (this.unitCoverageHandlers.supports(toolName)) {
          return this.unitCoverageHandlers.handle(toolName, limitedArguments);
        }
        // git 域桥接只读二工具（git.abapgit）：经 ZADT_VSP WebSocket，独立于
        // ADT 会话；DEV + workbench 门控见 policy。
        if (this.gitBridgeHandlers.supports(toolName)) {
          return this.gitBridgeHandlers.handle(toolName, limitedArguments);
        }
        // 受控 ABAP 执行（devtools.execute-abap）：执行类工具，catalog 成员
        // 已限定 workbench/legacy-full 面，QAS/PRD 由入口策略拒绝，写槽串行。
        if (this.executeAbapHandlers.supports(toolName)) {
          return this.executeAbapHandlers.handle(toolName, limitedArguments);
        }
        // 报表执行面（variants 只读 / runReport+submitReportJob 执行类）：
        // 必须位于 legacy 兜底门（f1LegacyWriteAllowlist）之前，否则 workbench
        // 面的非只读 legacy 拒绝会先命中。
        if (this.reportHandlers.supports(toolName)) {
          return this.reportHandlers.handle(toolName, limitedArguments);
        }
        // analyzeLint：纯客户端静态分析（本地 abaplint 引擎），只读，无 SAP 交互
        if (this.analyzeLintHandlers.supports(toolName)) {
          return this.analyzeLintHandlers.handle(toolName, limitedArguments);
        }
        // Health 聚合查询（执行级——tests 信号运行用户测试代码）：catalog 成员
        // 已限定 workbench/legacy-full 面。
        if (this.healthHandlers.supports(toolName)) {
          return this.healthHandlers.handle(toolName, limitedArguments);
        }
        if (this.repositoryObjectCreationHandlers.supports(toolName)) {
          return this.repositoryObjectCreationHandlers.handle(toolName, limitedArguments, signal);
        }
        if (this.safetyPolicy.toolProfile === 'diagnostic-readonly'
          && toolName !== 'inspectAbapObject'
          && !isReadOnlyLegacyTool(toolName)) {
          throw new McpError(ErrorCode.MethodNotFound, `Tool '${toolName}' is unavailable in the diagnostic-readonly tool profile.`);
        }
        if (this.safeAbapHandlers.supports(toolName)) {
          result = await this.safeAbapHandlers.handle(
            toolName,
            limitedArguments
          );
          return result;
        }
        if ((this.safetyPolicy.toolProfile === 'development' || this.safetyPolicy.toolProfile === 'development-workbench')
          && this.safeAdvancedHandlers.supports(toolName)) {
          return this.safeAdvancedHandlers.handle(toolName, limitedArguments);
        }
        if ((this.safetyPolicy.toolProfile === 'development' || this.safetyPolicy.toolProfile === 'development-workbench')
          && this.descriptionChangeHandlers.supports(toolName)) {
          return this.descriptionChangeHandlers.handle(toolName, limitedArguments);
        }
        if ((this.safetyPolicy.toolProfile === 'development' || this.safetyPolicy.toolProfile === 'development-workbench')
          && this.messageTextHandlers.supports(toolName)) {
          return this.messageTextHandlers.handle(toolName, limitedArguments);
        }
        // 受控程序文本池写入（F1 完整方案）：同型分派（DEV + workbench/development）。
        if ((this.safetyPolicy.toolProfile === 'development' || this.safetyPolicy.toolProfile === 'development-workbench')
          && this.textPoolHandlers.supports(toolName)) {
          return this.textPoolHandlers.handle(toolName, limitedArguments);
        }
        // 受控 UI5 filestore 写入（F5：ui5.write）：同型分派（DEV + workbench/development）。
        if ((this.safetyPolicy.toolProfile === 'development' || this.safetyPolicy.toolProfile === 'development-workbench')
          && this.ui5WriteHandlers.supports(toolName)) {
          return this.ui5WriteHandlers.handle(toolName, limitedArguments);
        }
        // 受控对象导入链（deploy-zip/fileio.import-export）：同型分派
        // （DEV + workbench/development）。
        if ((this.safetyPolicy.toolProfile === 'development' || this.safetyPolicy.toolProfile === 'development-workbench')
          && this.repositoryObjectImportHandlers.supports(toolName)) {
          return this.repositoryObjectImportHandlers.handle(toolName, limitedArguments);
        }
        // 受控对象克隆链：profile/role 门控已由 assertToolOperationAllowed 前置把关，
        // catalog 成员检查保证非 development/development-workbench profile 不可见。
        if ((this.safetyPolicy.toolProfile === 'development' || this.safetyPolicy.toolProfile === 'development-workbench')
          && this.cloneObjectHandlers.supports(toolName)) {
          return this.cloneObjectHandlers.handle(toolName, limitedArguments);
        }
        // 受控对象重命名链：同克隆链的 profile/role 门控与 catalog 成员检查。
        if ((this.safetyPolicy.toolProfile === 'development' || this.safetyPolicy.toolProfile === 'development-workbench')
          && this.renameControlledHandlers.supports(toolName)) {
          return this.renameControlledHandlers.handle(toolName, limitedArguments);
        }
        if ((this.safetyPolicy.toolProfile === 'development' || this.safetyPolicy.toolProfile === 'development-workbench')
          && this.safeDebugHandlers.supports(toolName)) {
          return this.safeDebugHandlers.handle(toolName, limitedArguments);
        }
        if (this.safetyPolicy.toolProfile === 'safe') {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Tool '${toolName}' is unavailable in the safe tool profile.`
          );
        }

        // F1（交接文档 2026-09-30）：程序文本池原子写 setTextElements 及其配套
        // lock/unLock（"caller manages locking" 模式，锁句柄须与写调用同 server
        // 会话）纳入 development-workbench（focused/developer 入口）写路径——
        // 仍 DEV 专属、分类与执行槽不变，其余非只读 legacy 工具照旧拒绝。
        const f1LegacyWriteAllowlist = toolName === 'setTextElements'
          || toolName === 'lock' || toolName === 'unLock';
        if ((this.safetyPolicy.toolProfile === 'development' || this.safetyPolicy.toolProfile === 'development-workbench')
          && !isReadOnlyLegacyTool(toolName)
          && !(f1LegacyWriteAllowlist && this.safetyPolicy.systemRole === 'DEV')) {
          throw new McpError(ErrorCode.MethodNotFound, `Tool '${toolName}' is unavailable in the ${this.safetyPolicy.toolProfile} tool profile.`);
        }

        switch (toolName) {
            case 'login':
            case 'logout':
            case 'dropSession':
                result = await this.authHandlers.handle(toolName, limitedArguments);
                break;
            case 'transportInfo':
            case 'createTransport':
            case 'hasTransportConfig':
            case 'transportConfigurations':
            case 'getTransportConfiguration':
            case 'setTransportsConfig':
            case 'createTransportsConfig':
            case 'userTransports':
            case 'transportsByConfig':
            case 'transportDelete':
            case 'transportRelease':
            case 'transportSetOwner':
            case 'transportAddUser':
            case 'systemUsers':
            case 'transportReference':
                result = await this.transportHandlers.handle(toolName, limitedArguments);
                break;
            case 'lock':
            case 'unLock':
                result = await this.objectLockHandlers.handle(toolName, limitedArguments);
                break;
            case 'objectStructure':
            case 'objectStructureElements':
            case 'searchObject':
            case 'findObjectPath':
            case 'objectTypes':
            case 'reentranceTicket':
                result = await this.objectHandlers.handle(toolName, limitedArguments);
                break;
            case 'classIncludes':
            case 'classComponents':
                result = await this.classHandlers.handle(toolName, limitedArguments);
                break;
            case 'syntaxCheckCode':
            case 'syntaxCheckCdsUrl':
            case 'codeCompletion':
            case 'findDefinition':
            case 'usageReferences':
            case 'syntaxCheckTypes':
            case 'codeCompletionFull':
            case 'runClass':
            case 'codeCompletionElement':
            case 'usageReferenceSnippets':
            case 'fixProposals':
            case 'fixEdits':
            case 'fragmentMappings':
            case 'abapDocumentation':
            case 'typeHierarchy':
            case 'objectEnhancements':
                result = await this.codeAnalysisHandlers.handle(toolName, limitedArguments);
                break;
            case 'getObjectSource':
            case 'setObjectSource':
                result = await this.objectSourceHandlers.handle(toolName, limitedArguments);
                break;
            case 'deleteObject':
                result = await this.objectDeletionHandlers.handle(toolName, limitedArguments);
                break;
            case 'activateObjects':
            case 'activateByName':
            case 'inactiveObjects':
                result = await this.objectManagementHandlers.handle(toolName, limitedArguments);
                break;
            case 'objectRegistrationInfo':
            case 'validateNewObject':
            case 'createObject':
                result = await this.objectRegistrationHandlers.handle(toolName, limitedArguments);
                break;
            case 'nodeContents':
            case 'mainPrograms':
                result = await this.nodeHandlers.handle(toolName, limitedArguments);
                break;
            case 'featureDetails':
            case 'collectionFeatureDetails':
            case 'findCollectionByUrl':
            case 'loadTypes':
            case 'adtDiscovery':
            case 'adtCoreDiscovery':
            case 'adtCompatibiliyGraph':
                result = await this.discoveryHandlers.handle(toolName, limitedArguments);
                break;
            case 'unitTestRun':
            case 'unitTestEvaluation':
            case 'unitTestOccurrenceMarkers':
            case 'createTestInclude':
                result = await this.unitTestHandlers.handle(toolName, limitedArguments);
                break;
            case 'prettyPrinterSetting':
            case 'setPrettyPrinterSetting':
            case 'prettyPrinter':
                result = await this.prettyPrinterHandlers.handle(toolName, limitedArguments);
                break;
            case 'gitRepos':
            case 'gitExternalRepoInfo':
            case 'gitCreateRepo':
            case 'gitPullRepo':
            case 'gitUnlinkRepo':
            case 'stageRepo':
            case 'pushRepo':
            case 'checkRepo':
            case 'remoteRepoInfo':
            case 'switchRepoBranch':
                result = await this.gitHandlers.handle(toolName, limitedArguments);
                break;
            case 'annotationDefinitions':
            case 'ddicElement':
            case 'ddicRepositoryAccess':
            case 'packageSearchHelp':
            case 'getDomainProperties':
            case 'setDomainProperties':
            case 'getDataElementProperties':
            case 'setDataElementProperties':
            case 'getTextElements':
            case 'setTextElements':
                result = await this.ddicHandlers.handle(toolName, limitedArguments);
                break;
            case 'publishServiceBinding':
            case 'unPublishServiceBinding':
            case 'bindingDetails':
                result = await this.serviceBindingHandlers.handle(toolName, limitedArguments);
                break;
            case 'tableContents':
            case 'runQuery':
                result = await this.queryHandlers.handle(toolName, limitedArguments);
                break;
            case 'feeds':
            case 'dumps':
                result = await this.feedHandlers.handle(toolName, limitedArguments);
                break;
            case 'debuggerListeners':
            case 'debuggerListen':
            case 'debuggerDeleteListener':
            case 'debuggerSetBreakpoints':
            case 'debuggerDeleteBreakpoints':
            case 'debuggerAttach':
            case 'debuggerSaveSettings':
            case 'debuggerStackTrace':
            case 'debuggerVariables':
            case 'debuggerChildVariables':
            case 'debuggerStep':
            case 'debuggerGoToStack':
            case 'debuggerSetVariableValue':
                result = await this.debugHandlers.handle(toolName, limitedArguments);
                break;
            case 'renameEvaluate':
            case 'renamePreview':
            case 'renameExecute':
                result = await this.renameHandlers.handle(toolName, limitedArguments);
                break;
            case 'atcCustomizing':
            case 'atcCheckVariant':
            case 'createAtcRun':
            case 'atcWorklists':
            case 'atcUsers':
            case 'atcExemptProposal':
            case 'atcRequestExemption':
            case 'isProposalMessage':
            case 'atcContactUri':
            case 'atcChangeContact':
            case 'atcDocumentation':
                result = await this.atcHandlers.handle(toolName, limitedArguments);
                break;
            case 'tracesList':
            case 'tracesListRequests':
            case 'tracesHitList':
            case 'tracesDbAccess':
            case 'tracesStatements':
            case 'tracesSetParameters':
            case 'tracesCreateConfiguration':
            case 'tracesDeleteConfiguration':
            case 'tracesDelete':
                result = await this.traceHandlers.handle(toolName, limitedArguments);
                break;
            case 'extractMethodEvaluate':
            case 'extractMethodPreview':
            case 'extractMethodExecute':
            case 'changePackagePreview':
            case 'changePackageExecute':
                result = await this.refactorHandlers.handle(toolName, limitedArguments);
                break;
            case 'rapGenValidateInitial':
            case 'rapGenGetSchema':
            case 'rapGenGetContent':
            case 'rapGenGetUiConfig':
            case 'rapGenValidateContent':
            case 'rapGenPreview':
            case 'rapGenGenerate':
            case 'rapGenIsAvailable':
            case 'rapGenPublishService':
                result = await this.rapGeneratorHandlers.handle(toolName, limitedArguments);
                break;
            case 'revisions':
                result = await this.revisionHandlers.handle(toolName, limitedArguments);
                break;
            case 'healthcheck':
                result = { ...this.healthcheckResult(), sapRelease: await this.sapReleaseReport() };
                break;
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
        }

        return result;
  }

  private healthcheckResult(): Record<string, unknown> {
    return {
      status: 'healthy',
      scope: 'mcp-process',
      sapConnectionVerified: false,
      configuredTarget: {
        host: this.safetyPolicy.systemHost,
        client: this.safetyPolicy.client,
        toolProfile: this.safetyPolicy.toolProfile,
        systemRole: this.safetyPolicy.systemRole
      },
      session: this.sessionSupervisor?.snapshot(),
      sessionRecovery: this.sessionResilience.sessionRecovery,
      statelessReads: this.sessionResilience.statelessReads,
      // 受控链二次确认模式回显：native=人工确认；auto=部署配置预授权（仅 DEV 可配置）
      confirmationMode: this.safetyPolicy.confirmationMode,
      // M1 版本能力协商状态回显：configured=env 显式配置（探测被跳过）；
      // cached=已探测定格；unresolved=尚未探测（下次 tools/list/healthcheck 触发）。
      // 探测结果不可得（RFC 通道不通等）= releaseGate 关闭、目录零变化。
      sapRelease: {
        configured: resolveConfiguredBasisRelease(process.env.SAP_MCP_BASIS_RELEASE) ?? null,
        probe: this.basisReleaseProbe?.resolved
          ? (this.basisReleaseProbe.value ?? null)
          : 'unresolved',
        source: this.basisReleaseSource(),
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    };
  }

  /** 当前生效指纹的来源标注（healthcheck report 用）。 */
  private basisReleaseSource(): 'configured-env' | 'rfc-probe' | 'unresolved' | 'unavailable' {
    if (resolveConfiguredBasisRelease(process.env.SAP_MCP_BASIS_RELEASE) !== undefined) return 'configured-env';
    if (!this.basisReleaseProbe?.resolved) return 'unresolved';
    return this.basisReleaseProbe.value !== undefined ? 'rfc-probe' : 'unavailable';
  }

  /**
   * M1 指纹解析（懒探测 + 缓存）：env SAP_MCP_BASIS_RELEASE 显式配置优先
   * （部署者声明即对目标系统负责，探测跳过）；否则 RFC_SYSTEM_INFO 探测一次
   * （RFCSAPRL = BASIS release，ED1/7.51 真机证实）。探测失败缓存为 undefined
   * 且只记日志不抛错——指纹不可得时 releaseGate 关闭，目录与 dispatch 行为
   * 与既有版本完全一致（fail-closed：不得猜测裁剪）。
   */
  private async resolveBasisRelease(): Promise<number | undefined> {
    const configured = resolveConfiguredBasisRelease(process.env.SAP_MCP_BASIS_RELEASE);
    if (configured !== undefined) return configured;
    if (this.basisReleaseProbe?.resolved) return this.basisReleaseProbe.value;
    this.basisReleaseProbe = { value: undefined, resolved: true };
    try {
      // 8 秒专用短超时：RFC_SYSTEM_INFO 极轻（ED1 实测毫秒级），8s 只兜防火墙
      // drop 的挂死场景，确保 tools/list 首呼不会被探测拖过客户端协议超时。
      const systemInfo = await this.rfcProbeHandlers.fetchSystemInfo(8_000);
      this.basisReleaseProbe.value = detectBasisReleaseFromSystemInfo(systemInfo);
    } catch (error) {
      console.error(
        '[SapRelease] RFC fingerprint probe failed; release gating disabled:',
        error instanceof Error ? error.message : error
      );
    }
    return this.basisReleaseProbe.value;
  }

  /**
   * healthcheck 的 release capability report：生效指纹 + 来源 + 被裁剪工具清单
   * （unavailableTools 按 minBasisRelease 排序输出，可 diff）。unresolved 时
   * 触发一次探测（healthcheck 本就是诊断入口，探测耗时 30s 上限可接受）。
   */
  private async sapReleaseReport(): Promise<Record<string, unknown>> {
    const basisRelease = await this.resolveBasisRelease();
    const catalogNames = this.toolCatalog.map(tool => tool.name);
    return {
      basisRelease: basisRelease ?? null,
      source: this.basisReleaseSource(),
      // 口径声明（0.10.0 ED1 实测口径差反馈）：unavailableTools/unavailableCreationKinds
      // 基于**当前 profile 目录**（this.toolCatalog 已按 profile 选定）计算——不在当前
      // profile 的登记工具（如 rapGenGenerate/rapGenPublishService 属 legacy-full/
      // development 的 raw 面）不会进清单，但其 dispatch 拒绝仍由 TOOL_MIN_BASIS_RELEASE
      // 独立生效，不受目录口径影响。
      scope: 'current-profile-catalog',
      unavailableTools: unavailableToolsForBasisRelease(catalogNames, basisRelease),
      gatedToolCount: basisRelease === undefined ? 0 : unavailableToolsForBasisRelease(catalogNames, basisRelease).length,
      // M2-A：受控创建 31 类中按版本收窄的 kind（RAP 时代等），清单可 diff
      unavailableCreationKinds: unavailableCreationKindsForBasisRelease(REPOSITORY_OBJECT_KINDS, basisRelease)
    };
  }

  async run() {
    // v2 双栈：传输生命周期由 serveStdio 拥有（main() 中装配），
    // 这里只负责进程级关闭钩子与错误上报。
    console.error('MCP ABAP ADT API server running on stdio (dual-era: 2026-07-28 + 2025 legacy)');
    if (this.safetyPolicy.toolProfile === 'legacy-full') {
      console.error('WARNING: SAP_MCP_TOOL_PROFILE=legacy-full exposes raw mutating and destructive ADT tools.');
    }

    // Handle shutdown
    process.on('SIGINT', async () => {
      await this.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.close();
      process.exit(0);
    });

    // Handle errors
    this.onerror = (error) => {
      console.error('[MCP Error]', error);
    };
  }
}

function withCanonicalToolMetadata(tool: ToolDefinition): ToolDefinition {
  const operationClass = toolOperationClass(tool.name);
  if (!operationClass) throw new Error(`MCP tool '${tool.name}' has no operation policy classification.`);
  const local = operationClass === 'local';
  const readOnly = local || operationClass === 'read-only';
  const metadataClass = local ? 'local-only' : readOnly ? 'read-only tenant' : 'mutating tenant';
  return {
    ...tool,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: !readOnly,
      idempotentHint: readOnly,
      openWorldHint: !local,
      ...tool.annotations
    },
    _meta: {
      operationClass: metadataClass,
      approvalRequired: false,
      ...tool._meta
    }
  };
}

export async function main(): Promise<void> {
  const password = await resolveSapPassword();
  // v2 双栈入口：同一工厂服务两个协议 era——
  // - modern（2026-07-28）客户端走 server/discover 探测后按新协议服务；
  // - legacy（2025）客户端走 initialize 握手，行为与 0.8.x 完全一致。
  // serveStdio 默认 legacy:'serve'，每个连接 pin 一个工厂实例。
  serveStdio(() => {
    const server = new AbapAdtServer(password);
    void server.run();
    return server;
  }, {
    onerror: (error) => console.error('[serveStdio error]', error instanceof Error ? error.message : error)
  });
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  });
}
