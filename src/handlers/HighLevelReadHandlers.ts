import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import { RuntimeDumpReader, type RuntimeDumpInput } from '../read/RuntimeDumpReader.js';
import { ClassicTableInspector } from '../read/ClassicTableInspector.js';
import { SystemInspector } from '../read/SystemInspector.js';
import { AbapMemberSourceReader, type AbapMemberSourceInput } from '../read/AbapMemberSourceReader.js';
import { serializeJsonText } from '../lib/jsonResponse';

type HighLevelReadToolDefinition = ToolDefinition & {
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

const HIGH_LEVEL_READ_TOOL_NAMES = new Set([
  'readRuntimeDumps',
  'describeClassicTable',
  'inspectSapSystem',
  'getAbapMemberSource'
]);

export class HighLevelReadHandlers {
  constructor(
    private readonly runtimeDumps: RuntimeDumpReader,
    private readonly classicTables: ClassicTableInspector,
    private readonly systemInspector?: SystemInspector,
    private readonly memberSources?: AbapMemberSourceReader
  ) {}

  supports(toolName: string): boolean {
    return HIGH_LEVEL_READ_TOOL_NAMES.has(toolName);
  }

  getTools(): HighLevelReadToolDefinition[] {
    return [
      readOnlyTool(
        'readRuntimeDumps',
        'Read bounded ST22 runtime dump summaries for one explicit SAP-local time window without accepting raw feed queries.',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            from: { type: 'string', description: 'ISO-8601 start timestamp with an explicit target-system offset.', maxLength: 40 },
            to: { type: 'string', description: 'ISO-8601 end timestamp with the same explicit target-system offset.', maxLength: 40 },
            limit: { type: 'number', description: 'Maximum summaries to return; defaults to 20.', minimum: 1, maximum: 50, optional: true },
            user: { type: 'string', description: 'Optional exact SAP user filter.', maxLength: 40, optional: true },
            objectName: { type: 'string', description: 'Optional contained ABAP object-name filter.', maxLength: 128, optional: true },
            runtimeError: { type: 'string', description: 'Optional contained runtime-error filter.', maxLength: 128, optional: true },
            exception: { type: 'string', description: 'Optional contained exception-class filter.', maxLength: 128, optional: true }
          },
          required: ['from', 'to']
        }
      ),
      readOnlyTool(
        'describeClassicTable',
        'Read classic ABAP Dictionary table column metadata through a server-generated zero-row data-preview query.',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            tableName: { type: 'string', description: 'One classic ABAP Dictionary table name.', minLength: 1, maxLength: 30 }
          },
          required: ['tableName']
        }
      ),
      readOnlyTool(
        'inspectSapSystem',
        'Inspect configured target identity and independently probe bounded SAP ADT capabilities without inferring a product release.',
        {
          type: 'object',
          additionalProperties: false,
          properties: {}
        }
      ),
      readOnlyTool(
        'getAbapMemberSource',
        'Read one ABAP class member, class include, or function module using only SAP-provided source URIs and source ranges.',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            objectName: { type: 'string', description: 'Exact ABAP object name.', minLength: 1, maxLength: 128 },
            objectType: { type: 'string', description: 'Supported ABAP object type.', enum: ['CLASS', 'FUNCTION_MODULE'] },
            memberName: { type: 'string', description: 'Exact class member/include or function-module name.', minLength: 1, maxLength: 128 },
            version: { type: 'string', description: 'Source version; defaults to active.', enum: ['active', 'inactive', 'workingArea'], optional: true }
          },
          required: ['objectName', 'objectType', 'memberName']
        }
      )
    ];
  }

  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      if (toolName === 'readRuntimeDumps') {
        return success(await this.runtimeDumps.read(argumentsValue as unknown as RuntimeDumpInput));
      }
      if (toolName === 'describeClassicTable') {
        return success(await this.classicTables.describe(argumentsValue.tableName));
      }
      if (toolName === 'inspectSapSystem' && this.systemInspector) {
        return success(await this.systemInspector.inspect());
      }
      if (toolName === 'getAbapMemberSource' && this.memberSources) {
        return success(await this.memberSources.read(argumentsValue as unknown as AbapMemberSourceInput));
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown high-level read tool: ${toolName}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      // Raw ADT responses may contain target details, headers, or values; expose none of them.
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }
}

function readOnlyTool(
  name: string,
  description: string,
  inputSchema: ToolDefinition['inputSchema']
): HighLevelReadToolDefinition {
  return {
    name,
    description,
    inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    _meta: { operationClass: 'read-only tenant', approvalRequired: false }
  };
}

function success(result: unknown): Record<string, any> {
  const structuredContent = { status: 'success', result };
  return {
    content: [{ type: 'text', text: serializeJsonText(structuredContent) }],
    structuredContent
  };
}
