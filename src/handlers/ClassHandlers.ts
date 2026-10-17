import { McpError, ErrorCode } from "../lib/McpErrorCompat.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { ADTClient, isClassStructure } from '../adt/index.js';
import { serializeJsonText } from '../lib/jsonResponse';

export class ClassHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'classIncludes',
                description: 'Get class includes structure',
                inputSchema: {
                    type: 'object',
                    properties: {
                        clas: {
                            type: 'string',
                            description: 'The class name'
                        }
                    },
                    required: ['clas']
                }
            },
            {
                name: 'classComponents',
                description: 'List class components',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: {
                            type: 'string',
                            description: 'The URL of the class'
                        }
                    },
                    required: ['url']
                }
            }
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'classIncludes':
                return this.handleClassIncludes(args);
            case 'classComponents':
                return this.handleClassComponents(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown class tool: ${toolName}`);
        }
    }

    async handleClassIncludes(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            // 两步：先取类结构（includes 清单），再经静态工具转为 includeType→URL 映射。
            // 直接把类名字符串传给静态 classIncludes 会因缺 includes 数组而崩溃（战役缺陷 1）。
            const clasName = String(args.clas || '').trim().toUpperCase();
            if (!clasName) throw new McpError(ErrorCode.InvalidParams, 'classIncludes requires a class name (clas).');
            const structure = await this.adtclient.objectStructure(`/sap/bc/adt/oo/classes/${clasName.toLowerCase()}`);
            if (!isClassStructure(structure)) {
                throw new McpError(ErrorCode.InternalError, `Object ${clasName} is not a class or exposes no class structure.`);
            }
            const includesMap = ADTClient.classIncludes(structure);
            // Map 直接 JSON 序列化为 {}——转普通对象让 MCP 输出可读
            const result = Object.fromEntries(includesMap);
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
                `Failed to get class includes: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleClassComponents(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.classComponents(args.url);
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
                `Failed to get class components: ${error.message || 'Unknown error'}`
            );
        }
    }

}
