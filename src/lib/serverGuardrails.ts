import type { RuntimeGuardrailValues } from '../config/RuntimeGuardrails.js';
import { CONTROLLED_WRITE_CHAIN_READONLY_TOOLS, toolOperationClass } from '../config/ToolOperationPolicy.js';
import { ToolExecutionGate } from './ToolExecutionGate.js';
import { applyToolArgumentLimits, assertToolResponseSize } from './requestLimits.js';

export function adtClientOptions(guardrails: RuntimeGuardrailValues): { timeout: number; keepAlive: boolean } {
  return { timeout: guardrails.adtTimeoutMs, keepAlive: true };
}

export function usesSapExecutionGate(toolName: string): boolean {
  return toolName !== 'sap'
    && toolName !== 'analyzeDependencyGraph'
    && toolName !== 'sapDoctor'
    && toolName !== 'applyAbapChange'
    && toolName !== 'getAbapChangeStatus'
    && toolName !== 'applyAbapObjectCreation'
    && toolName !== 'getAbapObjectCreationStatus'
    && toolName !== 'applyDebugOperation'
    && toolName !== 'applyDebugVariableChange'
    && toolName !== 'authorizeDebugSession'
    && toolName !== 'getDebugOperationStatus'
    && toolName !== 'revokeDebugSession'
    && toolName !== 'applyDdicPropertyChange'
    && toolName !== 'applyPackageChange'
    && toolName !== 'applyRapOperation'
    && toolName !== 'applyRepositoryObjectCreation'
    && toolName !== 'getRepositoryObjectCreationStatus'
    && toolName !== 'applyRepositoryObjectCleanup'
    && toolName !== 'getRepositoryObjectCleanupStatus'
    && toolName !== 'runQualityCheck'
    && toolName !== 'getQualityCheckStatus'
    // 受控激活：apply 在确认层内部会再次经过 executionGate（applyConfirmed），
    // 若外层 dispatch 已占用唯一槽位会自我死锁（maxConcurrentTools=1 时必现），
    // 因此与 applyRepositoryObjectCreation 等确认型工具同样豁免外层 gate；
    // getObjectActivationStatus 是纯本地 plan 读取，与同构 status 工具一并豁免。
    && toolName !== 'applyObjectActivation'
    && toolName !== 'getObjectActivationStatus'
    // 受控克隆：apply 在原生确认后委托受控创建链（其确认层内部自持 executionGate），
    // 外层 dispatch 若先占唯一槽位同样会自我死锁，与受控激活同豁免；
    // getCloneObjectStatus 是纯本地 plan 读取，与同构 status 工具一并豁免。
    && toolName !== 'applyCloneObject'
    && toolName !== 'getCloneObjectStatus'
    // 受控重命名：apply 在原生确认后先委托克隆工作流再委托受控清理链（两层
    // 确认层内部均自持 executionGate），与受控激活/克隆同豁免防自我死锁；
    // getControlledRenameStatus 是纯本地 plan 读取，同豁免。
    && toolName !== 'applyControlledRename'
    && toolName !== 'getControlledRenameStatus'
    // 受控传输创建：apply 在确认层内部会再次经过 executionGate（applyConfirmed），
    // 外层 dispatch 若先占唯一槽位同样会自我死锁，与受控激活/克隆同豁免；
    // getTransportCreationStatus 是纯本地 plan 读取，同豁免。
    && toolName !== 'applyTransportCreation'
    && toolName !== 'getTransportCreationStatus'
    // 受控传输清理（空请求边界）：豁免语义与创建链相同（确认层自持 executionGate）；
    // getTransportCleanupStatus 是纯本地 plan 读取，同豁免。
    && toolName !== 'applyTransportCleanup'
    && toolName !== 'getTransportCleanupStatus'
    // 受控传输释放（受控释放边界）：豁免语义与创建/清理链相同（确认层自持
    // executionGate）——外层 dispatch 若先占唯一槽位会自我死锁（sap-demo
    // 真机实证：写槽=1 时 applyTransportRelease 卡死直至客户端超时）；
    // getTransportReleaseStatus 是纯本地 plan 读取，同豁免。
    && toolName !== 'applyTransportRelease'
    && toolName !== 'getTransportReleaseStatus'
    // 受控程序文本池写入（F1 完整方案）：apply 在原生确认层内部自持
    // executionGate（lock→PUT→unlock→readback），外层先占唯一槽位会自我死锁
    // ——与受控激活/克隆/传输链同豁免；status 是纯本地 plan 读取，同豁免。
    && toolName !== 'applyTextPoolChange'
    && toolName !== 'getTextPoolChangeStatus'
    && toolName !== 'healthcheck';
}

/**
 * 分级执行门选择器（读槽/写槽/豁免）。
 *
 * - read-only 类工具 → 读槽（绑读域 stateless 会话，可并发）；
 * - 受控写链只读前段（CONTROLLED_WRITE_CHAIN_READONLY_TOOLS）→ 写槽：
 *   它们绑定写域主客户端（常驻 stateful），挂写槽保证 stateful 会话
 *   永无并发，且与同链 apply 天然互斥；
 * - 其余 SAP 类工具（写入/锁链/调试/受控 apply）→ 写槽（串行）；
 * - 豁免清单（usesSapExecutionGate 为 false：确认型 apply 防自我死锁、
 *   本地 status、healthcheck 等）→ undefined（不过门）。
 *
 * 保守兜底：分类缺失（toolOperationClass 返回 undefined）按写槽处理——
 * 宁可错串行，不可错并发。
 */
export function createGateSelector(
  readGate: ToolExecutionGate,
  writeGate: ToolExecutionGate
): (toolName: string) => ToolExecutionGate | undefined {
  return toolName => {
    if (!usesSapExecutionGate(toolName)) return undefined;
    if (CONTROLLED_WRITE_CHAIN_READONLY_TOOLS.has(toolName)) return writeGate;
    const operationClass = toolOperationClass(toolName);
    return operationClass === 'read-only' ? readGate : writeGate;
  };
}

export async function executeGuardedToolCall<T>(
  toolName: string,
  argumentsValue: Record<string, unknown> | undefined,
  guardrails: RuntimeGuardrailValues,
  selectGate: (toolName: string) => ToolExecutionGate | undefined,
  dispatch: (limitedArguments: Record<string, unknown>) => Promise<unknown>,
  serialize: (result: unknown) => T,
  serializeError: (error: unknown) => T
): Promise<T> {
  let finalResult: T;
  try {
    // Reject invalid request sizes before reserving a scarce SAP execution slot.
    const limitedArguments = applyToolArgumentLimits(toolName, argumentsValue, guardrails);
    const gate = selectGate(toolName);
    const operation = () => dispatch(limitedArguments);
    const result = await (gate ? gate.run(operation) : operation());
    finalResult = serialize(result);
  } catch (error) {
    finalResult = serializeError(error);
  }

  try {
    assertToolResponseSize(finalResult, guardrails.maxResponseBytes);
    return finalResult;
  } catch {
    return responseTooLargeResult() as T;
  }
}

function responseTooLargeResult(): Record<string, unknown> {
  return {
    content: [{
      type: 'text',
      text: '{"error":"Tool response exceeded the configured byte limit.","code":413}'
    }],
    isError: true
  };
}
