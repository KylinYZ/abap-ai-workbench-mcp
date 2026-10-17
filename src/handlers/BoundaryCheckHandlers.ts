import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type { BoundaryCheckClient } from '../adt/BoundaryCheckApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * ============================================================================
 * 包边界只读检查 MCP 工具处理器（关闭能力矩阵缺口 analysis.boundaries）
 * ============================================================================
 *
 * 暴露一个只读工具 checkPackageBoundaries：分析一个 Z 包内源码对象的跨包
 * 依赖，按 VSP boundary.go 六类裁定（STANDARD/SAME_PACKAGE/ALLOWED/VIOLATION/
 * DYNAMIC/UNKNOWN）输出逐条清单与聚合计数（crossedPackages/violatingObjects）。
 *
 * 业务规则：
 *   - 只读工具（readOnlyHint=true、destructiveHint=false、approvalRequired=false；
 *     _meta.operationClass='read-only tenant'）；底层仅 TADIR SELECT 与源码 GET。
 *   - DYNAMIC（动态调用检测）未实现，恒为 0，notes 如实标注。
 *   - 包名/对象名在本处理器做白名单预检（InvalidParams），API 层另有
 *     normalizeRepositoryName 纵深防御。
 *   - 底层异常统一脱敏为 InternalError。
 */

/** 与 CrossReferenceHandlers 一致的只读工具定义强类型。 */
type BoundaryToolDefinition = ToolDefinition & {
  annotations: {
    readOnlyHint: true;
    destructiveHint: false;
    idempotentHint: true;
    openWorldHint: true;
  };
  _meta: {
    operationClass: 'read-only tenant';
    approvalRequired: false;
  };
};

/** 本处理器认领的工具名。 */
const BOUNDARY_TOOL_NAMES = new Set(['checkPackageBoundaries']);

const MAX_OBJECT_LIMIT = 30;

export class BoundaryCheckHandlers {
  /**
   * @param boundaryCheck 只读边界检查客户端（集成时用
   *   src/adt/BoundaryCheckApi.ts 的 createBoundaryCheckClient(readClient) 构造）
   */
  constructor(private readonly boundaryCheck: BoundaryCheckClient) {}

  /** 该工具名是否由本处理器负责。 */
  supports(toolName: string): boolean {
    return BOUNDARY_TOOL_NAMES.has(toolName);
  }

  /** 只读工具定义。 */
  getTools(): BoundaryToolDefinition[] {
    return [
      {
        name: 'checkPackageBoundaries',
        description:
          'Package boundary analysis (clean core): enumerates source-bearing objects (PROG/CLAS/INTF) of a Z package via TADIR, extracts their code dependencies client-side, resolves each dependency\'s target package via TADIR and classifies every edge as SAME_PACKAGE / ALLOWED (whitelist) / STANDARD / VIOLATION / UNKNOWN, with aggregated crossed-package counts and violating objects. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            packageName: {
              type: 'string',
              description: 'The Z package to analyze, e.g. Z001.',
              minLength: 1,
              maxLength: 30
            },
            whitelist: {
              type: 'array',
              description: 'Z-packages that may be crossed without a violation; supports * wildcards, e.g. Z*_COMMON.',
              items: { type: 'string', maxLength: 40 },
              optional: true
            },
            objectKinds: {
              type: 'array',
              description: 'Object kinds to analyze; defaults to PROG+CLAS+INTF.',
              items: { type: 'string', enum: ['PROG', 'CLAS', 'INTF'] },
              optional: true
            },
            namePattern: {
              type: 'string',
              description: 'Only analyze object names starting with this prefix (e.g. ZV).',
              optional: true
            },
            objectLimit: {
              type: 'number',
              description: `Maximum objects to analyze; default 10, cap ${MAX_OBJECT_LIMIT}. Objects are analyzed serially.`,
              minimum: 1,
              maximum: MAX_OBJECT_LIMIT,
              optional: true
            }
          },
          required: ['packageName']
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true
        },
        _meta: { operationClass: 'read-only tenant', approvalRequired: false }
      }
    ];
  }

  /**
   * 分派到注入的只读客户端。MCP 语义错误透传；底层异常脱敏为 InternalError。
   */
  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'checkPackageBoundaries') {
        const rawPackage = typeof argumentsValue?.packageName === 'string' ? argumentsValue.packageName.trim() : '';
        if (!rawPackage || rawPackage.length > 30 || !/^[A-Z0-9_/$]+$/.test(rawPackage.toUpperCase())) {
          throw invalid(
            `${toolName} requires packageName: a non-empty package name of at most 30`
            + ' characters matching [A-Z0-9_/$] (namespaces use leading slashes).'
          );
        }
        const input: Record<string, unknown> = { packageName: rawPackage.toUpperCase() };
        // 以下逐字段填充（此时 packageName 已确保存在，整体满足 BoundaryCheckInput）
        const boundaryInput = input as unknown as Parameters<BoundaryCheckClient['checkPackageBoundaries']>[0];

        const rawWhitelist = argumentsValue?.whitelist;
        if (rawWhitelist !== undefined) {
          if (!Array.isArray(rawWhitelist) || rawWhitelist.some(p => typeof p !== 'string' || p.trim().length > 40 || p.trim() === '')) {
            throw invalid(`${toolName} requires whitelist to be an array of non-empty package patterns (≤40 characters).`);
          }
          boundaryInput.whitelist = (rawWhitelist as string[]).map(p => p.trim().toUpperCase());
        }
        const rawKinds = argumentsValue?.objectKinds;
        if (rawKinds !== undefined) {
          if (!Array.isArray(rawKinds) || rawKinds.some(k => !['PROG', 'CLAS', 'INTF'].includes(String(k)))) {
            throw invalid(`${toolName} requires objectKinds to be a subset of PROG, CLAS, INTF.`);
          }
          boundaryInput.objectKinds = (rawKinds as string[]).map(k => String(k).trim().toUpperCase()) as ('PROG' | 'CLAS' | 'INTF')[];
        }
        const rawPattern = argumentsValue?.namePattern;
        if (rawPattern !== undefined) {
          if (typeof rawPattern !== 'string' || !rawPattern.trim() || rawPattern.trim().length > 30) {
            throw invalid(`${toolName} requires namePattern of at most 30 characters.`);
          }
          boundaryInput.namePattern = rawPattern.trim().toUpperCase();
        }
        const rawLimit = argumentsValue?.objectLimit;
        if (rawLimit !== undefined) {
          if (typeof rawLimit !== 'number' || !Number.isFinite(rawLimit)) {
            throw invalid(`${toolName} requires objectLimit to be a finite number.`);
          }
          boundaryInput.objectLimit = Math.min(Math.max(Math.floor(rawLimit), 1), MAX_OBJECT_LIMIT);
        }
        return success(await this.boundaryCheck.checkPackageBoundaries(boundaryInput));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown boundary tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      // 底层 SQL/ADT 通道错误可能包含目标系统细节；对外只报告工具级失败
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }
}

/** 成功响应包装：content 文本与 structuredContent 同构。 */
function success(result: unknown): Record<string, any> {
  const structuredContent = { status: 'success', result };
  return {
    content: [{ type: 'text', text: serializeJsonText(structuredContent) }],
    structuredContent
  };
}

/** 参数校验失败的 MCP 语义错误。 */
function invalid(message: string): McpError {
  return new McpError(ErrorCode.InvalidParams, message);
}
