import { RepositoryObjectImportHandlers } from '../handlers/RepositoryObjectImportHandlers';
import type { RepositoryObjectImportWorkflow } from '../safe/RepositoryObjectImportWorkflow';

/**
 * 受控对象导入处理器单测（mock workflow，零 SAP 交互）。
 * 断言：preview/status 直通不确认；apply 必经原生表单确认（拒绝/取消/接受
 * 三分支 + 部署级 autoApprove 跳表单）；缺 planId → InvalidParams。
 */

function elicit(action: string, decision?: string) {
  return { action, ...(decision ? { content: { decision } } : {}) };
}

function harness(options: { elicited?: { action: string; content?: unknown }; autoApprove?: boolean } = {}) {
  const workflow = {
    preview: jest.fn().mockResolvedValue({ status: 'preview', plan: { importPlanId: 'plan-1' }, confirmationRequired: true }),
    applyConfirmed: jest.fn().mockResolvedValue({ status: 'success', plan: { importPlanId: 'plan-1', status: 'APPLIED' } }),
    status: jest.fn().mockReturnValue({
      importPlanId: 'plan-1', status: 'PREVIEWED', packageName: '$IMPORT',
      objects: [{ action: 'create' }, { action: 'update' }], skips: [{}], systemHost: 'dev.example.com', client: '100'
    })
  };
  const elicitInput = jest.fn().mockResolvedValue(options.elicited ?? elicit('accept', 'apply'));
  const handlers = new RepositoryObjectImportHandlers(workflow as unknown as RepositoryObjectImportWorkflow, {
    supportsFormElicitation: () => true,
    elicitInput,
    ...(options.autoApprove ? { autoApprove: () => true } : {}),
    planSummary: planId => ({
      packageName: '$IMPORT', objectCount: 2, createCount: 1, updateCount: 1, skipCount: 1,
      systemHost: 'dev.example.com', client: '100'
    })
  });
  return { handlers, workflow, elicitInput };
}

describe('RepositoryObjectImportHandlers', () => {
  it('previews without confirmation and returns the frozen plan', async () => {
    const { handlers, workflow, elicitInput } = harness();
    const result = await handlers.handle('previewRepositoryObjectImport', { packageName: '$IMPORT', zipBase64: 'AAAA' });
    expect(result.structuredContent.result.status).toBe('preview');
    expect(workflow.preview).toHaveBeenCalledWith({ packageName: '$IMPORT', zipBase64: 'AAAA' });
    expect(elicitInput).not.toHaveBeenCalled();
  });

  it('applies only after an explicit native form confirmation', async () => {
    const { handlers, workflow, elicitInput } = harness({ elicited: elicit('accept', 'apply') });
    const result = await handlers.handle('applyRepositoryObjectImport', { importPlanId: 'plan-1' });
    expect(result.structuredContent.result.plan.status).toBe('APPLIED');
    expect(elicitInput).toHaveBeenCalledTimes(1);
    expect(workflow.applyConfirmed).toHaveBeenCalledWith('plan-1');
    const form = elicitInput.mock.calls[0][0];
    expect(form.message).toContain('$IMPORT');
    expect(form.requestedSchema.properties.decision.enum).toEqual(['apply', 'cancel']);
  });

  it('refuses the write when elicitation declines or cancels', async () => {
    const declined = harness({ elicited: elicit('decline') });
    await expect(declined.handlers.handle('applyRepositoryObjectImport', { importPlanId: 'plan-1' }))
      .rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(declined.workflow.applyConfirmed).not.toHaveBeenCalled();

    const cancelled = harness({ elicited: elicit('accept', 'cancel') });
    await expect(cancelled.handlers.handle('applyRepositoryObjectImport', { importPlanId: 'plan-1' }))
      .rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(cancelled.workflow.applyConfirmed).not.toHaveBeenCalled();
  });

  it('skips the form only under the deployment-level auto-approve switch', async () => {
    const { handlers, workflow, elicitInput } = harness({ autoApprove: true });
    await handlers.handle('applyRepositoryObjectImport', { importPlanId: 'plan-1' });
    expect(elicitInput).not.toHaveBeenCalled();
    expect(workflow.applyConfirmed).toHaveBeenCalledWith('plan-1');
  });

  it('status is a local passthrough and apply validates the plan id', async () => {
    const { handlers, workflow } = harness();
    const result = await handlers.handle('getRepositoryObjectImportStatus', { importPlanId: 'plan-1' });
    expect(result.structuredContent.result.status).toBe('PREVIEWED');
    expect(workflow.status).toHaveBeenCalledWith('plan-1');
    await expect(handlers.handle('applyRepositoryObjectImport', {})).rejects.toMatchObject({ code: -32602 });
    await expect(handlers.handle('getRepositoryObjectImportStatus', {})).rejects.toMatchObject({ code: -32602 });
  });
});
