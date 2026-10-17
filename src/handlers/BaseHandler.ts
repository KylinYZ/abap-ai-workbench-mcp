import type { ToolDefinition } from "../types/tools";
import type { ADTClient } from "../adt/index.js";
import { performance } from 'perf_hooks';
import { createLogger } from '../lib/logger';
import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import { serializeJsonText } from '../lib/jsonResponse';

export abstract class BaseHandler {
  protected readonly adtclient: ADTClient;
  /**
   * 读域客户端：read-only 类工具的方法必须走它（stateless 克隆会话，
   * 与写域结构性隔离，支撑读槽并发）。混合型 handler 在装配处传入；
   * 不传时回退主客户端（= 旧行为，写域），保证既有子类/测试零改动。
   */
  protected readonly readDomain: ADTClient;
  protected readonly logger = createLogger(this.constructor.name);
  private readonly metrics = {
    requestCount: 0,
    errorCount: 0,
    successCount: 0,
    totalTime: 0
  };

  constructor(adtclient: ADTClient, readDomain?: ADTClient) {
    this.adtclient = adtclient;
    this.readDomain = readDomain ?? adtclient;
  }

  protected trackRequest(startTime: number, success: boolean): void {
    const duration = performance.now() - startTime;
    this.metrics.requestCount++;
    this.metrics.totalTime += duration;
    
    if (success) {
      this.metrics.successCount++;
    } else {
      this.metrics.errorCount++;
    }

    this.logger.info('Request completed', {
      duration,
      success,
      metrics: this.getMetrics()
    });
  }

  protected getMetrics() {
    return {
      ...this.metrics,
      averageTime: this.metrics.requestCount > 0 
        ? this.metrics.totalTime / this.metrics.requestCount 
        : 0
    };
  }

  protected async executeClientCall(action: string, operation: () => Promise<unknown>): Promise<Record<string, unknown>> {
    const startTime = performance.now();
    try {
      const result = await operation();
      this.trackRequest(startTime, true);
      return {
        content: [{
          type: 'text',
          text: serializeJsonText({ status: 'success', result })
        }]
      };
    } catch {
      this.trackRequest(startTime, false);
      // Raw ADT errors can contain headers or target details; expose neither.
      throw new McpError(ErrorCode.InternalError, `${action} failed.`);
    }
  }

  abstract getTools(): ToolDefinition[];
}
