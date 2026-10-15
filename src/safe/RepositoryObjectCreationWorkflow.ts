import { createHash } from 'crypto';
import { SafeAbapError, errorMessage } from './errors.js';
import type { RepositoryObjectCreationRegistry } from './RepositoryObjectCreationRegistry.js';
import type { RepositoryObjectCreationPlanStore } from './RepositoryObjectCreationPlanStore.js';
import type {
  PreparedRepositoryCreation,
  RepositoryCreationContext,
  RepositoryCreationPlanView,
  RepositoryObjectCreationAdapter,
  RepositoryObjectKind
} from './repositoryCreationTypes.js';

export class RepositoryCreationOutcomeUnknownError extends Error {}

export class RepositoryObjectCreationWorkflow {
  private readonly adapters = new Map<RepositoryObjectKind, RepositoryObjectCreationAdapter>();

  constructor(
    private readonly registry: RepositoryObjectCreationRegistry,
    private readonly context: RepositoryCreationContext,
    private readonly plans: RepositoryObjectCreationPlanStore,
    adapters: RepositoryObjectCreationAdapter[] = [],
    /**
     * M2-A release 解析器（可选注入）：preview 时解析目标系统 BASIS release
     * 并用 context 副本走 registry.describe——登记了 minRelease 的 RAP 时代
     * kind 在低版本被显式拒绝（plan 状态机不进入）。未注入 = 指纹未接入，
     * context 原样使用（行为零变化）。apply 不重复校验：plan 在 preview 冻结
     * 时已过门禁，immutable plan 语义以创建当时判定为准。
     */
    private readonly releaseResolver?: () => Promise<number | undefined>
  ) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.objectKind)) throw new Error(`Duplicate repository creation adapter '${adapter.objectKind}'.`);
      this.adapters.set(adapter.objectKind, adapter);
    }
  }

  /** M2-A：context 副本合并 release 指纹（未注入 resolver 时原样返回）。 */
  private async contextWithRelease(): Promise<RepositoryCreationContext> {
    if (!this.releaseResolver) return this.context;
    const basisRelease = await this.releaseResolver();
    return basisRelease === undefined ? this.context : { ...this.context, basisRelease };
  }

  async preview(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const objectKind = String(request.objectKind || '').trim().toUpperCase() as RepositoryObjectKind;
    const capability = this.registry.describe(objectKind, await this.contextWithRelease());
    if (!capability.available) {
      throw new SafeAbapError('POLICY_DENIED', 'capability', capability.unavailableReason || 'Repository creation is unavailable.');
    }
    if (this.context.systemRole !== 'DEV'
      || !['development', 'development-workbench'].includes(this.context.toolProfile)) {
      throw new SafeAbapError('POLICY_DENIED', 'capability', 'Repository creation preview requires an approved DEV development profile.');
    }
    if (this.context.realDevValidationEnabled) assertValidationRequest(this.context, objectKind, request);
    const adapter = this.adapters.get(objectKind);
    if (!adapter) throw new SafeAbapError('VALIDATION_FAILED', 'adapter', `No controlled adapter is registered for ${objectKind}.`);
    let prepared: PreparedRepositoryCreation;
    try {
      prepared = await adapter.prepare(request);
    } catch (error) {
      if (error instanceof SafeAbapError) throw error;
      throw new SafeAbapError('VALIDATION_FAILED', 'preview', `Repository creation preview failed: ${errorMessage(error)}`);
    }
    if (this.context.realDevValidationEnabled) {
      assertValidationTarget(this.context, prepared.target, prepared.transportRequest);
    }
    const serialized = JSON.stringify(prepared.payload);
    const plan = this.plans.create(this.context, prepared, {
      payloadHash: createHash('sha256').update(serialized).digest('hex'),
      payloadBytes: Buffer.byteLength(serialized, 'utf8')
    });
    return { status: 'preview', plan, review: prepared.review, confirmationRequired: true };
  }

  status(creationPlanId: string): RepositoryCreationPlanView {
    return this.plans.view(creationPlanId, this.context);
  }

  async apply(creationPlanId: string): Promise<Record<string, unknown>> {
    const previewed = this.plans.view(creationPlanId, this.context);
    const capability = this.registry.describe(previewed.target.objectKind, this.context);
    const validationAllowed = this.context.realDevValidationEnabled
      && validationTargetMatches(this.context, previewed.target, previewed.transportRequest);
    if (!capability.writable && !validationAllowed) {
      throw new SafeAbapError(
        'POLICY_DENIED',
        'capability',
        capability.unavailableReason || 'Repository creation apply is unavailable.'
      );
    }
    if (validationAllowed && capability.writable) {
      throw new SafeAbapError('POLICY_DENIED', 'validation', 'REAL_DEV validation plans must remain below REAL_DEV_VERIFIED maturity.');
    }
    const plan = this.plans.begin(creationPlanId, this.context);
    const adapter = this.adapters.get(plan.target.objectKind);
    if (!adapter) {
      return this.fail(plan.creationPlanId, 'VALIDATION_FAILED', 'adapter', 'The controlled adapter is no longer registered.');
    }
    const record = (stage: string, success: boolean, message?: string) =>
      this.plans.recordStage(plan.creationPlanId, stage, success, message);
    try {
      const execution = await adapter.execute(plan, record);
      return { status: 'success', plan: this.plans.settle(plan.creationPlanId, 'APPLIED', execution) };
    } catch (error) {
      if (error instanceof RepositoryCreationOutcomeUnknownError) {
        const settled = this.plans.settle(plan.creationPlanId, 'OUTCOME_UNKNOWN', {
          primaryError: { code: 'UNKNOWN_OUTCOME', stage: 'apply', message: errorMessage(error) }
        });
        throw new SafeAbapError('UNKNOWN_OUTCOME', 'apply', 'The remote write outcome is unknown; no retry or deletion was attempted.', { plan: settled });
      }
      if (adapter.compensate) {
        try {
          const compensated = await adapter.compensate(plan, record);
          if (compensated) {
            const settled = this.plans.settle(plan.creationPlanId, 'COMPENSATED', {
              primaryError: {
                code: 'REMOTE_WRITE_FAILED', stage: 'apply', message: errorMessage(error),
                ...(safeSourceMismatchDetails(error) ? { details: safeSourceMismatchDetails(error) } : {})
              }
            });
            throw new SafeAbapError('REMOTE_WRITE_FAILED', 'apply', 'Creation failed and owned resources were compensated.', { plan: settled });
          }
        } catch (compensationError) {
          if (compensationError instanceof SafeAbapError) throw compensationError;
          const settled = this.plans.settle(plan.creationPlanId, 'COMPENSATION_FAILED', {
            primaryError: { code: 'COMPENSATION_FAILED', stage: 'compensation', message: errorMessage(compensationError) }
          });
          throw new SafeAbapError('COMPENSATION_FAILED', 'compensation', 'Creation compensation failed.', { plan: settled });
        }
      }
      return this.fail(plan.creationPlanId, 'REMOTE_WRITE_FAILED', 'apply', errorMessage(error));
    }
  }

  private fail(creationPlanId: string, code: 'VALIDATION_FAILED' | 'REMOTE_WRITE_FAILED', stage: string, message: string): never {
    const settled = this.plans.settle(creationPlanId, 'FAILED', { primaryError: { code, stage, message } });
    throw new SafeAbapError(code, stage, message, { plan: settled });
  }
}

function safeSourceMismatchDetails(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof SafeAbapError) || error.code !== 'SOURCE_VERIFY_FAILED') return undefined;
  const details = error.details;
  const mismatch = details?.mismatch;
  if (!isRecord(mismatch)) return undefined;
  const hashes = ['expectedHash', 'actualHash', 'expectedLineHash', 'actualLineHash']
    .map(key => [key, validHash(mismatch[key])] as const);
  const numbers = ['expectedLineCount', 'actualLineCount', 'firstMismatchLine', 'expectedLineBytes', 'actualLineBytes']
    .map(key => [key, validNonNegativeInteger(mismatch[key])] as const);
  if ([...hashes, ...numbers].some(([, value]) => value === undefined)) return undefined;
  return {
    sourceMatchType: typeof details?.sourceMatchType === 'string' ? details.sourceMatchType : 'DIFFERENT',
    mismatch: Object.fromEntries([...hashes, ...numbers])
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validHash(value: unknown): string | undefined {
  const candidate = String(value || '');
  return /^[a-f0-9]{64}$/i.test(candidate) ? candidate : undefined;
}

function validNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function assertValidationRequest(
  context: RepositoryCreationContext,
  objectKind: RepositoryObjectKind,
  request: Record<string, unknown>
): void {
  const prefix = context.realDevValidationPrefix || '';
  const objectName = String(request.name || '').trim().toUpperCase();
  const parentFunctionGroup = String(request.parentFunctionGroup || '').trim().toUpperCase();
  const packageName = String(request.packageName || request.parentPackageName || '').trim().toUpperCase();
  const transportRequest = String(request.transportRequest || '').trim().toUpperCase();
  const nameMatches = objectKind === 'FUNCTION_GROUP_INCLUDE'
    ? parentFunctionGroup.startsWith(prefix)
    : objectKind === 'DDIC_LOCK_OBJECT'
      ? objectName.startsWith(`E${prefix}`)
      : objectName.startsWith(prefix);
  const providedPackageMatches = !packageName || packageName === context.realDevValidationPackage;
  if (!context.realDevValidationObjects?.includes(objectKind)
    || !prefix
    || !nameMatches
    || !providedPackageMatches
    || !context.realDevValidationPackage
    || !context.realDevValidationTransport
    || transportRequest !== context.realDevValidationTransport) {
    throw new SafeAbapError('POLICY_DENIED', 'validation', 'REAL_DEV validation is restricted to the configured object, name prefix, package, and transport.');
  }
}

function assertValidationTarget(
  context: RepositoryCreationContext,
  target: RepositoryCreationPlanView['target'],
  transportRequest: unknown
): void {
  if (!validationTargetMatches(context, target, transportRequest)) {
    throw new SafeAbapError('POLICY_DENIED', 'validation', 'REAL_DEV validation target does not match the configured name, parent, package, or transport.');
  }
}

function validationTargetMatches(
  context: RepositoryCreationContext,
  target: RepositoryCreationPlanView['target'],
  transportRequest: unknown
): boolean {
  const prefix = context.realDevValidationPrefix || '';
  const packageName = target.packageName || target.parentName || '';
  const nameMatches = target.objectKind === 'FUNCTION_GROUP_INCLUDE'
    ? Boolean(target.parentName?.startsWith(prefix) && target.objectName.startsWith('L'))
    : target.objectKind === 'DDIC_LOCK_OBJECT'
      ? target.objectName.startsWith(`E${prefix}`)
      : target.objectName.startsWith(prefix);
  return Boolean(context.realDevValidationObjects?.includes(target.objectKind)
    && prefix
    && nameMatches
    && packageName === context.realDevValidationPackage
    && transportRequest === context.realDevValidationTransport);
}
