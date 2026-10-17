import { McpError, ErrorCode } from "../lib/McpErrorCompat.js";
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { ADTClient, PackageValueHelpType } from '../adt/index.js';
import { mutatingRawTool, readOnlyRawTool } from './rawToolMetadata.js';
import { serializeJsonText } from '../lib/jsonResponse';

export class DdicHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'annotationDefinitions',
                description: 'Retrieves annotation definitions.',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'ddicElement',
                description: 'Retrieves information about a DDIC element.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'The path to the DDIC element.'
                        },
                        getTargetForAssociation: {
                            type: 'boolean',
                            description: 'Whether to get the target for association.',
                            optional: true
                        },
                        getExtensionViews: {
                            type: 'boolean',
                            description: 'Whether to get extension views.',
                            optional: true
                        },
                        getSecondaryObjects: {
                            type: 'boolean',
                            description: 'Whether to get secondary objects.',
                            optional: true
                        }
                    },
                    required: ['path']
                }
            },
            {
                name: 'ddicRepositoryAccess',
                description: 'Accesses the DDIC repository.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'The path to the DDIC element.'
                        }
                    },
                    required: ['path']
                }
            },
            {
                name: 'packageSearchHelp',
                description: 'Performs a package search help.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        type: {
                            type: 'string',
                            description: 'The package value help type.'
                        },
                        name: {
                            type: 'string',
                            description: 'The package name.',
                            optional: true
                        }
                    },
                    required: ['type']
                }
            },
            readOnlyRawTool('getDomainProperties', 'Read DDIC domain properties and metadata.', versionedUrlSchema('domainUrl')),
            mutatingRawTool(
                'setDomainProperties',
                'High risk raw DDIC domain write. The caller must manage locking, transport, activation, and verification.',
                domainMutationSchema()
            ),
            readOnlyRawTool('getDataElementProperties', 'Read DDIC data element properties and metadata.', versionedUrlSchema('dataElementUrl')),
            mutatingRawTool(
                'setDataElementProperties',
                'High risk raw DDIC data element write. The caller must manage locking, transport, activation, and verification.',
                dataElementMutationSchema()
            ),
            readOnlyRawTool('getTextElements', 'Read bounded text elements for one ABAP object.', textElementsReadSchema()),
            mutatingRawTool(
                'setTextElements',
                'High risk raw text element write. The caller must manage locking, transport, activation, and verification.',
                textElementsMutationSchema()
            )
        ];
    }

    async handle(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'annotationDefinitions':
                return this.handleAnnotationDefinitions(args);
            case 'ddicElement':
                return this.handleDdicElement(args);
            case 'ddicRepositoryAccess':
                return this.handleDdicRepositoryAccess(args);
            case 'packageSearchHelp':
                return this.handlePackageSearchHelp(args);
            case 'getDomainProperties':
                return this.executeClientCall('Domain property read', () => this.readDomain.getDomainProperties(args.domainUrl, args.version));
            case 'setDomainProperties':
                return this.executeClientCall('Domain property write', () => this.adtclient.setDomainProperties(
                    args.domainUrl, args.properties, args.metaData, args.lockHandle, args.transport
                ));
            case 'getDataElementProperties':
                return this.executeClientCall('Data element property read', () => this.readDomain.getDataElementProperties(args.dataElementUrl, args.version));
            case 'setDataElementProperties':
                return this.executeClientCall('Data element property write', () => this.adtclient.setDataElementProperties(
                    args.dataElementUrl, args.properties, args.metaData, args.lockHandle, args.transport
                ));
            case 'getTextElements':
                return this.executeClientCall('Text element read', () => this.readDomain.getTextElements(args.url, args.category));
            case 'setTextElements':
                return this.executeClientCall('Text element write', () => this.adtclient.setTextElements(
                    args.url, args.category, args.elements, args.lockHandle, args.transport
                ));
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown DDIC tool: ${toolName}`);
        }
    }

    async handleAnnotationDefinitions(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.readDomain.annotationDefinitions();
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
                `Failed to get annotation definitions: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleDdicElement(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.readDomain.ddicElement(
                args.path,
                args.getTargetForAssociation,
                args.getExtensionViews,
                args.getSecondaryObjects
            );
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
                `Failed to get DDIC element: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleDdicRepositoryAccess(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.readDomain.ddicRepositoryAccess(args.path);
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
                `Failed to access DDIC repository: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handlePackageSearchHelp(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.readDomain.packageSearchHelp(args.type, args.name);
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
                `Failed to get package search help: ${error.message || 'Unknown error'}`
            );
        }
    }
}

function versionedUrlSchema(field: string): ToolDefinition['inputSchema'] {
    return {
        type: 'object',
        properties: {
            [field]: { type: 'string', description: 'Exact DDIC ADT object URL', maxLength: 2048 },
            version: { type: 'string', description: 'active, inactive, or workingArea', enum: ['active', 'inactive', 'workingArea'], optional: true }
        },
        required: [field]
    };
}

function metadataProperty() {
    return {
        type: 'object',
        additionalProperties: false,
        properties: {
            name: { type: 'string', maxLength: 255 },
            description: { type: 'string', maxLength: 255 },
            language: { type: 'string', maxLength: 10 },
            masterLanguage: { type: 'string', maxLength: 10 },
            masterSystem: { type: 'string', maxLength: 32 },
            responsible: { type: 'string', maxLength: 64 },
            packageName: { type: 'string', maxLength: 255 },
            packageDescription: { type: 'string', maxLength: 255, optional: true },
            packageUri: { type: 'string', maxLength: 2048, optional: true }
        },
        required: ['name', 'description', 'language', 'masterLanguage', 'masterSystem', 'responsible', 'packageName']
    };
}

function domainMutationSchema(): ToolDefinition['inputSchema'] {
    return {
        type: 'object',
        properties: {
            domainUrl: { type: 'string', description: 'Exact DDIC domain ADT URL', maxLength: 2048 },
            properties: {
                type: 'object', additionalProperties: false,
                properties: {
                    typeInformation: {
                        type: 'object', additionalProperties: false,
                        properties: {
                            datatype: { type: 'string', maxLength: 32 },
                            length: { type: 'number', minimum: 0, maximum: 100000 },
                            decimals: { type: 'number', minimum: 0, maximum: 100 }
                        }, required: ['datatype', 'length', 'decimals']
                    },
                    outputInformation: {
                        type: 'object', additionalProperties: false,
                        properties: {
                            length: { type: 'number', minimum: 0, maximum: 100000 },
                            style: { type: 'string', maxLength: 64, optional: true },
                            conversionExit: { type: 'string', maxLength: 64, optional: true },
                            signExists: { type: 'boolean' }, lowercase: { type: 'boolean' }, ampmFormat: { type: 'boolean' }
                        }, required: ['length', 'signExists', 'lowercase', 'ampmFormat']
                    },
                    valueInformation: {
                        type: 'object', additionalProperties: false, optional: true,
                        properties: {
                            valueTableRef: { type: 'string', maxLength: 255 }, appendExists: { type: 'boolean' },
                            fixValues: {
                                type: 'array', maxItems: 500, optional: true,
                                items: {
                                    type: 'object', additionalProperties: false,
                                    properties: {
                                        low: { type: 'string', maxLength: 1024 }, high: { type: 'string', maxLength: 1024, optional: true },
                                        text: { type: 'string', maxLength: 2048, optional: true }
                                    }, required: ['low']
                                }
                            }
                        }, required: ['valueTableRef', 'appendExists']
                    }
                }, required: ['typeInformation', 'outputInformation']
            },
            metaData: metadataProperty(),
            lockHandle: { type: 'string', maxLength: 512 },
            transport: { type: 'string', maxLength: 64, optional: true }
        },
        required: ['domainUrl', 'properties', 'metaData', 'lockHandle']
    };
}

function dataElementMutationSchema(): ToolDefinition['inputSchema'] {
    return {
        type: 'object',
        properties: {
            dataElementUrl: { type: 'string', description: 'Exact DDIC data element ADT URL', maxLength: 2048 },
            properties: {
                type: 'object', additionalProperties: false,
                properties: {
                    typeName: { type: 'string', maxLength: 255 }, dataType: { type: 'string', maxLength: 32 },
                    dataTypeLength: { type: 'number', minimum: 0, maximum: 100000 },
                    dataTypeDecimals: { type: 'number', minimum: 0, maximum: 100, optional: true },
                    fieldLabels: {
                        type: 'object', additionalProperties: false,
                        properties: {
                            shortFieldLabel: { type: 'string', maxLength: 255 }, shortFieldLength: { type: 'number', minimum: 0, maximum: 255, optional: true },
                            mediumFieldLabel: { type: 'string', maxLength: 255 }, mediumFieldLength: { type: 'number', minimum: 0, maximum: 255, optional: true },
                            longFieldLabel: { type: 'string', maxLength: 255 }, longFieldLength: { type: 'number', minimum: 0, maximum: 255, optional: true },
                            headingFieldLabel: { type: 'string', maxLength: 255 }, headingFieldLength: { type: 'number', minimum: 0, maximum: 255, optional: true }
                        }, required: ['shortFieldLabel', 'mediumFieldLabel', 'longFieldLabel', 'headingFieldLabel']
                    },
                    searchHelp: { type: 'string', maxLength: 255, optional: true }, searchHelpParameter: { type: 'string', maxLength: 255, optional: true },
                    setGetParameter: { type: 'string', maxLength: 255, optional: true }, defaultComponentName: { type: 'string', maxLength: 255, optional: true },
                    deactivateInputHistory: { type: 'boolean', optional: true }, changeDocument: { type: 'boolean', optional: true },
                    leftToRightDirection: { type: 'boolean', optional: true }, deactivateBIDIFiltering: { type: 'boolean', optional: true }
                }, required: ['typeName', 'dataType', 'dataTypeLength', 'fieldLabels']
            },
            metaData: metadataProperty(),
            lockHandle: { type: 'string', maxLength: 512 }, transport: { type: 'string', maxLength: 64, optional: true }
        },
        required: ['dataElementUrl', 'properties', 'metaData', 'lockHandle']
    };
}

function textElementsReadSchema(): ToolDefinition['inputSchema'] {
    return {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Text elements base ADT URL', maxLength: 2048 },
            category: { type: 'string', enum: ['symbols', 'selections', 'headings'], optional: true }
        }, required: ['url']
    };
}

function textElementsMutationSchema(): ToolDefinition['inputSchema'] {
    return {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Text elements base ADT URL', maxLength: 2048 },
            category: { type: 'string', enum: ['symbols', 'selections', 'headings'] },
            elements: {
                type: 'array', maxItems: 500,
                items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                        id: { type: 'string', maxLength: 255 }, text: { type: 'string', maxLength: 8192 },
                        maxLength: { type: 'number', minimum: 0, maximum: 100000, optional: true },
                        ddicReference: { type: 'string', maxLength: 255, optional: true }
                    }, required: ['id', 'text']
                }
            },
            lockHandle: { type: 'string', maxLength: 512 }, transport: { type: 'string', maxLength: 64, optional: true }
        }, required: ['url', 'category', 'elements', 'lockHandle']
    };
}
