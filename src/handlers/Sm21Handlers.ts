import { McpError, ErrorCode } from '../lib/McpErrorCompat.js';
import type { ADTClient } from '../adt/index.js';
import type { ToolDefinition } from '../types/tools.js';
import { analyzeRuntimeErrors } from '../sm21/runtimeAnalysis.js';
import { parseSm21Request } from '../sm21/request.js';
import type { Sm21Client, Sm21RuntimeConfig } from '../sm21/types.js';
import { serializeJsonText } from '../lib/jsonResponse';

export class Sm21Handlers {
  constructor(
    private readonly sm21Client: Sm21Client,
    private readonly config: Sm21RuntimeConfig,
    private readonly adtClient: Pick<ADTClient, 'dumps'>
  ) {}

  getTools(): ToolDefinition[] {
    const commonProperties = {
      fromDateTime: { type: 'string', description: 'Inclusive ISO 8601 start timestamp in the configured SAP system time zone.' },
      toDateTime: { type: 'string', description: 'Inclusive ISO 8601 end timestamp in the configured SAP system time zone.' },
      instances: { type: 'array', description: 'Optional instance-name filters, maximum 20.', optional: true },
      users: { type: 'array', description: 'Optional SAP user filters, maximum 20.', optional: true },
      programs: { type: 'array', description: 'Optional ABAP program filters, maximum 20.', optional: true },
      tcodes: { type: 'array', description: 'Optional transaction-code filters, maximum 20.', optional: true },
      messageIds: { type: 'array', description: 'Optional SM21 message-ID filters, maximum 20.', optional: true },
      severity: { type: 'string', description: 'ALL, ERROR, WARNING, or ERROR_WARNING.', optional: true },
      offset: { type: 'number', description: 'Zero-based offset into the stable request result set.', optional: true },
      pageSize: { type: 'number', description: 'Requested result rows, from 1 through configured maximum.', optional: true }
    };
    return [
      {
        name: 'sm21Read',
        description: 'Read a bounded, read-only page of SAP SM21 system logs through the configured ADT HTTP service.',
        inputSchema: { type: 'object', properties: commonProperties, required: ['fromDateTime', 'toDateTime'] }
      },
      {
        name: 'analyzeRuntimeErrors',
        description: 'Read SM21 and ADT ST22 dump summaries, then return conservative text-evidence correlations.',
        inputSchema: {
          type: 'object',
          properties: { ...commonProperties, dumpQuery: { type: 'string', description: 'Optional ADT dump feed query.', optional: true } },
          required: ['fromDateTime', 'toDateTime']
        }
      }
    ];
  }

  supports(toolName: string): boolean {
    return toolName === 'sm21Read' || toolName === 'analyzeRuntimeErrors';
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown>): Promise<Record<string, unknown>> {
    const request = parseSm21Request(argumentsValue, this.config);
    try {
      const sm21 = await this.sm21Client.read(request);
      if (toolName === 'sm21Read') {
        return success({
          source: 'SM21', ...sm21, truncated: sm21.hasMore,
          nextOffset: sm21.hasMore ? request.offset + sm21.logs.length : undefined,
          range: { from: request.from, to: request.to, timeZone: this.config.timeZone }
        });
      }
      if (toolName === 'analyzeRuntimeErrors') {
        const dumps = await this.adtClient.dumps(typeof argumentsValue.dumpQuery === 'string' ? argumentsValue.dumpQuery : undefined);
        const partial = sm21.hasMore;
        return success({ source: 'SM21_AND_ST22', sm21, dumps: dumps.dumps, analysis: analyzeRuntimeErrors(dumps.dumps, sm21.logs, partial) });
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown SM21 tool '${toolName}'.`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, 'Unable to retrieve or analyze runtime logs.');
    }
  }
}

function success(payload: Record<string, unknown>): Record<string, unknown> {
  return { content: [{ type: 'text', text: serializeJsonText({ status: 'success', ...payload }) }] };
}
