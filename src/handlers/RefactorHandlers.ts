import { McpError, ErrorCode } from "../lib/McpErrorCompat.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { ADTClient, Range, ExtractMethodProposal, GenericRefactoring } from '../adt/index.js';
import { mutatingRawTool, readOnlyRawTool } from './rawToolMetadata.js';
import { serializeJsonText } from '../lib/jsonResponse';

export class RefactorHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'extractMethodEvaluate',
                description: 'Evaluates an extract method refactoring.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        uri: {
                            type: 'string',
                            description: 'The URI of the object.'
                        },
                        range: {
                            type: 'string',
                            description: 'The range to extract, as a JSON string, e.g. {"start":{"line":1,"column":0},"end":{"line":5,"column":10}}'
                        }
                    },
                    required: ['uri', 'range']
                }
            },
            {
                name: 'extractMethodPreview',
                description: 'Previews an extract method refactoring.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        proposal: {
                            type: 'string',
                            description: 'The extract method proposal returned by extractMethodEvaluate, as a JSON string.'
                        }
                    },
                    required: ['proposal']
                }
            },
            {
                name: 'extractMethodExecute',
                description: 'Executes an extract method refactoring.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        refactoring: {
                            type: 'string',
                            description: 'The refactoring returned by extractMethodPreview, as a JSON string.'
                        }
                    },
                    required: ['refactoring']
                }
            },
            readOnlyRawTool(
                'changePackagePreview',
                'Preview a bounded package-change refactoring without executing it.',
                changePackageSchema(true)
            ),
            mutatingRawTool(
                'changePackageExecute',
                'High risk raw package migration. Executes one complete preview result without automatic reversal or retry.',
                changePackageSchema(false)
            )
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'extractMethodEvaluate':
                return this.handleExtractMethodEvaluate(args);
            case 'extractMethodPreview':
                return this.handleExtractMethodPreview(args);
            case 'extractMethodExecute':
                return this.handleExtractMethodExecute(args);
            case 'changePackagePreview':
                return this.executeClientCall(
                    'Package change preview',
                    () => this.readDomain.changePackagePreview(args.refactoring, args.transport)
                );
            case 'changePackageExecute':
                return this.executeClientCall(
                    'Package change execution',
                    () => this.adtclient.changePackageExecute(args.refactoring)
                );
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown refactor tool: ${toolName}`);
        }
    }

    // Schemas declare these params as JSON strings, but the abap-adt-api methods
    // expect deserialized objects; also accept plain objects for forward compatibility
    private parseObjectArg<T>(value: unknown, name: string): T {
        if (typeof value !== 'string') return value as T;
        try {
            return JSON.parse(value) as T;
        } catch {
            throw new McpError(ErrorCode.InvalidParams, `Parameter '${name}' is not valid JSON`);
        }
    }

    async handleExtractMethodEvaluate(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const range = this.parseObjectArg<Range>(args.range, 'range');
            const result = await this.readDomain.extractMethodEvaluate(args.uri, range);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: serializeJsonText({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to evaluate extract method: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleExtractMethodPreview(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const proposal = this.parseObjectArg<ExtractMethodProposal>(args.proposal, 'proposal');
            const result = await this.readDomain.extractMethodPreview(proposal);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: serializeJsonText({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to preview extract method: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleExtractMethodExecute(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const refactoring = this.parseObjectArg<GenericRefactoring>(args.refactoring, 'refactoring');
            const result = await this.adtclient.extractMethodExecute(refactoring);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: serializeJsonText({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to execute extract method: ${error.message || 'Unknown error'}`
            );
        }
    }
}

function changePackageSchema(preview: boolean): ToolDefinition['inputSchema'] {
    const refactoring = {
        type: 'object',
        additionalProperties: false,
        properties: {
            oldPackage: { type: 'string', maxLength: 255 },
            newPackage: { type: 'string', maxLength: 255 },
            transport: { type: 'string', maxLength: 64, optional: true },
            title: { type: 'string', maxLength: 255, optional: true },
            rootUserContent: { type: 'string', maxLength: 8192, optional: true },
            ignoreSyntaxErrorsAllowed: { type: 'boolean' },
            ignoreSyntaxErrors: { type: 'boolean' },
            adtObjectUri: { type: 'string', maxLength: 2048 },
            affectedObjects: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    uri: { type: 'string', maxLength: 2048 }, type: { type: 'string', maxLength: 64 },
                    name: { type: 'string', maxLength: 255 }, oldPackage: { type: 'string', maxLength: 255 },
                    newPackage: { type: 'string', maxLength: 255 }, parentUri: { type: 'string', maxLength: 2048 }
                },
                required: ['uri', 'type', 'name', 'oldPackage', 'newPackage', 'parentUri']
            },
            userContent: { type: 'string', maxLength: 8192 }
        },
        required: ['oldPackage', 'newPackage', 'ignoreSyntaxErrorsAllowed', 'ignoreSyntaxErrors', 'adtObjectUri', 'affectedObjects', 'userContent']
    };
    return {
        type: 'object',
        properties: {
            refactoring,
            ...(preview ? { transport: { type: 'string', description: 'Existing transport or empty for local package', maxLength: 64 } } : {})
        },
        required: preview ? ['refactoring', 'transport'] : ['refactoring']
    };
}
