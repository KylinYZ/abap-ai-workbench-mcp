import { promises as fs } from 'fs';
import path from 'path';
import { SafeAbapError, errorMessage } from './errors.js';

export interface AuditEvent {
  timestamp?: string;
  correlationId: string;
  changePlanId?: string;
  creationPlanId?: string;
  eventType: string;
  systemHost: string;
  client: string;
  systemRole: string;
  objectType?: string;
  objectName?: string;
  parentObject?: string;
  packageName?: string;
  activationTarget?: string;
  transportRequest?: string;
  originalHash?: string;
  targetHash?: string;
  verifiedSourceHash?: string;
  sourceMatchType?: string;
  rollbackVerifiedSourceHash?: string;
  rollbackSourceMatchType?: string;
  addedLines?: number;
  removedLines?: number;
  durationMs?: number;
  success: boolean;
  errorCode?: string;
  errorSummary?: string;
  rollbackAttempted?: boolean;
  rollbackSucceeded?: boolean;
  compensationAttempted?: boolean;
  compensationSucceeded?: boolean;
  unlockSucceeded?: boolean;
  confirmationMode?: string;
  activationOutcome?: string;
  activationInactiveCount?: number;
  debugOperationPlanId?: string;
  debugOperationKind?: string;
  targetUser?: string;
  debuggeeId?: string;
  debugAuthHash?: string;
  operationHash?: string;
  oldValueHash?: string;
  newValueHash?: string;
  resultSummary?: string;
  operationPlanId?: string;
  advancedOperationKind?: string;
  inputHash?: string;
  driftHash?: string;
  recoveryHash?: string;
  verificationHash?: string;
  partialSuccess?: boolean;
  unknownOutcome?: boolean;
  qualityPlanId?: string;
  qualityCheckKind?: string;
  qualityObjectCount?: number;
  qualityVariantHash?: string;
  // 受控对象激活工作流（ObjectActivation）专用字段：
  // planId 关联审计链；对象数量与载荷指纹支撑事后核对，不含任何对象 URI 明文。
  activationPlanId?: string;
  activationObjectCount?: number;
  activationPayloadHash?: string;
  // 受控对象克隆工作流（CloneObject）专用字段：planId 关联审计链。
  clonePlanId?: string;
  // 受控对象重命名工作流（RenameControlled）专用字段：planId 关联审计链。
  renamePlanId?: string;
  // 受控传输请求创建工作流（TransportCreation）专用字段：planId 关联审计链；
  // 创建成功的请求号复用既有 transportRequest 字段承载。
  transportCreationPlanId?: string;
  // 受控传输请求清理工作流（TransportCleanup）专用字段：planId 关联审计链；
  // 已删除的请求号复用既有 transportRequest 字段承载。
  transportCleanupPlanId?: string;
  // 受控传输请求释放工作流（TransportRelease）专用字段：planId 关联审计链；
  // 已释放的请求号复用既有 transportRequest 字段承载。
  transportReleasePlanId?: string;
}

export class AuditLogger {
  readonly filePath: string;
  private directoryInitialization?: Promise<void>;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(auditDirectory: string) {
    this.filePath = path.join(path.resolve(auditDirectory), 'abap-change-audit.jsonl');
  }

  append(event: AuditEvent): Promise<void> {
    const record = sanitizeRecord({ ...event, timestamp: event.timestamp || new Date().toISOString() });
    const write = this.writeTail.then(() => this.writeRecord(record));
    this.writeTail = write.catch(() => undefined);
    return write;
  }

  private async writeRecord(record: Record<string, unknown>): Promise<void> {
    try {
      await this.ensureDirectory();
      await fs.appendFile(this.filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8' });
    } catch (error) {
      throw new SafeAbapError('AUDIT_FAILED', 'audit', `Failed to write the audit log: ${errorMessage(error)}`);
    }
  }

  private async ensureDirectory(): Promise<void> {
    if (!this.directoryInitialization) {
      this.directoryInitialization = fs.mkdir(path.dirname(this.filePath), { recursive: true }).then(() => undefined);
    }
    try {
      await this.directoryInitialization;
    } catch (error) {
      this.directoryInitialization = undefined;
      throw error;
    }
  }
}

function sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  // Confirmation phrases and verification codes are one-time secrets and must never reach disk.
  const forbidden = /password|passwd|pwd|cookie|authorization|lockhandle|source|diff|confirmationtext|textconfirmation|challenge|verificationcode|oldvalue|newvalue|variablevalue|debugvalue/i;
  const safeDiagnosticFields = new Set([
    'verifiedSourceHash',
    'sourceMatchType',
    'rollbackVerifiedSourceHash',
    'rollbackSourceMatchType',
    'oldValueHash',
    'newValueHash'
  ]);
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => safeDiagnosticFields.has(key) || !forbidden.test(key))
      .map(([key, value]) => [key, typeof value === 'string' ? sanitizeValue(value) : value])
  );
}

function sanitizeValue(value: string): string {
  return value
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [REDACTED]')
    .replace(/(password|passwd|pwd|cookie|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 2000);
}
