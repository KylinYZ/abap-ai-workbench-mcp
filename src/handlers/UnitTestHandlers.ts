import { McpError, ErrorCode } from "../lib/McpErrorCompat.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { ADTClient, UnitTestRunFlags } from '../adt/index.js';
import { serializeJsonText } from '../lib/jsonResponse';

export class UnitTestHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'unitTestRun',
                description: 'Runs unit tests.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: {
                            type: 'string',
                            description: 'The URL of the object to test.'
                        },
                        flags: {
                            type: 'string',
                            description: 'Flags for the unit test run.',
                            optional: true
                        }
                    },
                    required: ['url']
                }
            },
            {
                name: 'unitTestEvaluation',
                description: 'Evaluates unit test results.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        clas: {
                            type: 'string',
                            description: 'The class to evaluate.'
                        },
                        flags: {
                            type: 'string',
                            description: 'Flags for the unit test evaluation.',
                            optional: true
                        }
                    },
                    required: ['clas']
                }
            },
            {
                name: 'unitTestOccurrenceMarkers',
                description: 'Retrieves unit test occurrence markers.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: {
                            type: 'string',
                            description: 'The URL of the object.'
                        },
                        source: {
                            type: 'string',
                            description: 'The source code.'
                        }
                    },
                    required: ['url', 'source']
                }
            },
            {
                name: 'createTestInclude',
                description: 'Creates a test include for a class.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        clas: {
                            type: 'string',
                            description: 'The class name.'
                        },
                        lockHandle: {
                            type: 'string',
                            description: 'The lock handle.'
                        },
                        transport: {
                            type: 'string',
                            description: 'The transport.',
                            optional: true
                        }
                    },
                    required: ['clas', 'lockHandle']
                }
            }
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'unitTestRun':
                return this.handleUnitTestRun(args);
            case 'unitTestEvaluation':
                return this.handleUnitTestEvaluation(args);
            case 'unitTestOccurrenceMarkers':
                return this.handleUnitTestOccurrenceMarkers(args);
            case 'createTestInclude':
                return this.handleCreateTestInclude(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown unit test tool: ${toolName}`);
        }
    }

    async handleUnitTestRun(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.unitTestRun(args.url, args.flags);
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
                `Failed to run unit test: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleUnitTestEvaluation(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            // 底层 unitTestEvaluation 吃 runUnitTest 结果里的 UnitTestClass 对象
            //（含 testmethods 的 uri 清单），不是类名字符串——契约错位曾致
            // undefined.map 崩溃（战役缺陷 2）。修复：按类名先跑一次单元测试
            // 取测试类清单，再逐个评估汇总；无测试类时返回空数组而非崩溃。
            const className = String(args.clas || '').trim().toUpperCase();
            if (!className) {
                throw new McpError(ErrorCode.InvalidParams, 'unitTestEvaluation requires a class name (clas).');
            }
            const classUrl = `/sap/bc/adt/oo/classes/${className.toLowerCase()}`;
            const testClasses = await this.readDomain.unitTestRun(classUrl, args.flags ?? undefined) ?? [];
            if (!Array.isArray(testClasses) || testClasses.length === 0) {
                this.trackRequest(startTime, true);
                return {
                    content: [{
                        type: 'text',
                        text: serializeJsonText({ status: 'success', result: [], note: `No unit tests found for ${className}.` })
                    }]
                };
            }
            const result = [];
            for (const testClass of testClasses) {
                try {
                    const evaluated = await this.readDomain.unitTestEvaluation(testClass, args.flags ?? undefined);
                    result.push(...(Array.isArray(evaluated) ? evaluated : []));
                } catch (perClassError: any) {
                    // 单个测试类评估失败不拖垮整体：记录并继续
                    result.push({ testClass: String((testClass as unknown as Record<string, unknown>)['adtcore:name'] || 'unknown'), evaluationError: perClassError?.message || 'Unknown error' });
                }
            }
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
                `Failed to evaluate unit test: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleUnitTestOccurrenceMarkers(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const markers = await this.readDomain.unitTestOccurrenceMarkers(args.url, args.source);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: serializeJsonText({
                            status: 'success',
                            markers
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get unit test markers: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleCreateTestInclude(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.createTestInclude(args.clas, args.lockHandle, args.transport);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: serializeJsonText({
                            status: 'success',
                            result,
                            message: 'Test include created successfully'
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to create test include: ${error.message || 'Unknown error'}`
            );
        }
    }
}
