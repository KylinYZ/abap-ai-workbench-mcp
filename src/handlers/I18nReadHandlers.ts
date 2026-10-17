import { ErrorCode, McpError } from '../lib/McpErrorCompat.js';
import type { ToolDefinition } from '../types/tools.js';
import type {
  I18nReadClient,
  I18nObjectKind
} from '../adt/I18nReadApi.js';
import { serializeJsonText } from '../lib/jsonResponse';

/**
 * ============================================================================
 * i18n 按语言只读四工具 MCP 处理器（关闭能力矩阵缺口 i18n.read）
 * ============================================================================
 *
 * 暴露四个只读工具，语义对齐 VSP vibing-steampunk focused GetObjectTextsIn-
 * Language / GetDataElementLabels / GetTextPoolInLanguage / CompareLanguages
 * （pkg/adt/i18n.go 只读方向；协议细节见 src/adt/I18nReadApi.ts 注释）：
 *   - getObjectContentInLanguage：按语言读取对象内容
 *   - getDataElementLabels：数据元素四段标签按语言
 *   - getTextPoolInLanguage：程序文本池（符号/选择文本/标题）按语言
 *   - compareObjectLanguages：两种语言的内容行级对比（差异/缺失）
 * 消息类文本的语言读取由 getMessages（read.message-class-texts）覆盖。
 *
 * 业务规则：
 *   - 全部只读；VSP 的文本写入方向（WriteMessageClassTexts 等）不暴露
 *     （矩阵 i18n.write 维持缺口）。
 *   - 语言键 1-2 位字母；对象源 URL 由 objectType+objectName 服务端解析，
 *     不接受任意 URL。
 *   - 底层异常统一脱敏为 InternalError。
 */

/** 与 CrossReferenceHandlers 一致的只读工具定义强类型。 */
type I18nToolDefinition = ToolDefinition & {
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
const I18N_TOOL_NAMES = new Set([
  'getObjectContentInLanguage',
  'getDataElementLabels',
  'getTextPoolInLanguage',
  'compareObjectLanguages'
]);

const SUPPORTED_KINDS: readonly I18nObjectKind[] = ['CLAS', 'INTF', 'FUNC', 'PROG'];
const NAME_MAX_LENGTH = 40;

export class I18nReadHandlers {
  /** @param i18nRead 只读 i18n 客户端（createI18nReadClient(readClient) 构造） */
  constructor(private readonly i18nRead: I18nReadClient) {}

  /** 该工具名是否由本处理器负责。 */
  supports(toolName: string): boolean {
    return I18N_TOOL_NAMES.has(toolName);
  }

  /** 四个只读工具定义。 */
  getTools(): I18nToolDefinition[] {
    const readOnly: Pick<I18nToolDefinition, 'annotations' | '_meta'> = {
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      },
      _meta: { operationClass: 'read-only tenant', approvalRequired: false }
    };
    const kindProp = {
      type: 'string' as const,
      description: 'Object type: CLAS, INTF, FUNC or PROG.',
      enum: [...SUPPORTED_KINDS]
    };
    const nameProp = {
      type: 'string' as const,
      description: 'Exact object name, e.g. ZCL_FOO or ZPROG.',
      minLength: 1,
      maxLength: NAME_MAX_LENGTH
    };
    const languageProp = (required: boolean) => ({
      type: 'string' as const,
      description: 'SAP language key (1-2 letters, e.g. EN, DE, ZH).',
      ...(required ? {} : { optional: true })
    });
    return [
      {
        name: 'getObjectContentInLanguage',
        description:
          'Read an ABAP object\'s content in a specific language (sap-language override on the source GET). Useful for language-dependent sources such as DDIC-dependent objects. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { objectType: kindProp, objectName: nameProp, language: languageProp(true) },
          required: ['objectType', 'objectName', 'language']
        },
        ...readOnly
      },
      {
        name: 'getDataElementLabels',
        description:
          'Read the four text labels (short/medium/long/heading) of a data element in a specific language. Note: ADT answers in the master language when the requested language has no translation. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            dataElement: { type: 'string', description: 'Exact data element name.', minLength: 1, maxLength: 30 },
            language: { ...languageProp(true) }
          },
          required: ['dataElement', 'language']
        },
        ...readOnly
      },
      {
        name: 'getTextPoolInLanguage',
        description:
          'Read a program\'s text pool in a specific language: text symbols (I), selection texts (S) and list headings (H). Missing sub-pools (e.g. no selection screen) are reported in `missing` instead of failing. Read-only.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            program: { type: 'string', description: 'Exact program name.', minLength: 1, maxLength: NAME_MAX_LENGTH },
            language: { ...languageProp(true) }
          },
          required: ['program', 'language']
        },
        ...readOnly
      },
      {
        name: 'compareObjectLanguages',
        description:
          'Compare an object\'s content between two languages line by line; only differing or missing lines are returned with line-N keys. Read-only; two content GETs under the hood.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            objectType: kindProp,
            objectName: nameProp,
            sourceLanguage: { ...languageProp(true) },
            targetLanguage: { ...languageProp(true) }
          },
          required: ['objectType', 'objectName', 'sourceLanguage', 'targetLanguage']
        },
        ...readOnly
      }
    ];
  }

  /** 分派；MCP 语义错误透传，底层异常脱敏为 InternalError。 */
  async handle(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, any>> {
    try {
      switch (toolName) {
        case 'getObjectContentInLanguage':
          return success(await this.i18nRead.getObjectContentInLanguage({
            objectType: this.kind(toolName, argumentsValue),
            objectName: this.name(toolName, argumentsValue),
            language: this.language(toolName, argumentsValue)
          }));
        case 'getDataElementLabels':
          return success(await this.i18nRead.getDataElementLabels({
            dataElement: this.name(toolName, argumentsValue, 'dataElement', 30),
            language: this.language(toolName, argumentsValue)
          }));
        case 'getTextPoolInLanguage':
          return success(await this.i18nRead.getTextPoolInLanguage({
            program: this.name(toolName, argumentsValue, 'program'),
            language: this.language(toolName, argumentsValue)
          }));
        case 'compareObjectLanguages':
          return success(await this.i18nRead.compareObjectLanguages({
            objectType: this.kind(toolName, argumentsValue),
            objectName: this.name(toolName, argumentsValue),
            sourceLanguage: this.language(toolName, argumentsValue, 'sourceLanguage'),
            targetLanguage: this.language(toolName, argumentsValue, 'targetLanguage')
          }));
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown i18n tool: ${toolName}`);
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, `${toolName} failed.`);
    }
  }

  /** objectType 枚举校验。 */
  private kind(toolName: string, argumentsValue: Record<string, unknown>): I18nObjectKind {
    const raw = typeof argumentsValue?.objectType === 'string' ? argumentsValue.objectType.trim().toUpperCase() : '';
    if (!SUPPORTED_KINDS.includes(raw as I18nObjectKind)) {
      throw invalid(`${toolName} requires objectType to be one of ${SUPPORTED_KINDS.join(', ')}.`);
    }
    return raw as I18nObjectKind;
  }

  /** 名字校验：非空、长度上限、仓库名字符白名单（API 层另有解析兜底）。 */
  private name(toolName: string, argumentsValue: Record<string, unknown>, field = 'objectName', max = NAME_MAX_LENGTH): string {
    const raw = typeof argumentsValue?.[field] === 'string' ? (argumentsValue[field] as string).trim() : '';
    if (!raw || raw.length > max || !/^[A-Z0-9_/$]+$/.test(raw.toUpperCase())) {
      throw invalid(
        `${toolName} requires ${field}: a non-empty repository name of at most ${max}`
        + ' characters matching [A-Z0-9_/$] (namespaces use leading slashes).'
      );
    }
    return raw.toUpperCase();
  }

  /** 语言键校验：1-2 位字母（API 层同口径复检）。 */
  private language(toolName: string, argumentsValue: Record<string, unknown>, field = 'language'): string {
    const raw = typeof argumentsValue?.[field] === 'string' ? (argumentsValue[field] as string).trim() : '';
    if (!/^[A-Za-z]{1,2}$/.test(raw)) {
      throw invalid(`${toolName} requires ${field} to be a 1-2 letter SAP language key.`);
    }
    return raw.toUpperCase();
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
