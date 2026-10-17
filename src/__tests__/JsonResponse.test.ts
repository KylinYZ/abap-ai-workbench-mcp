/**
 * 响应文本序列化出口(serializeJsonText)契约测试。
 *
 * 锁定三条语义:
 *   1. 默认压缩(SAP_MCP_JSON_PRETTY 未设置),开关开启时 2 空格缩进;
 *   2. 开关解析与 SessionResilienceConfig 同语义(true/1/yes、false/0/no,
 *      非法值抛错 fail-closed),且支持 env 注入以便测试不污染 process.env;
 *   3. bigint 统一序列化为字符串(JSON.stringify 原生对 bigint 抛错)。
 * 同时锁定边界:canonical 哈希与字节计量等场景不在本出口,不受开关影响。
 */
import { isJsonPrettyEnabled, serializeJsonText } from '../lib/jsonResponse';

describe('SAP_MCP_JSON_PRETTY 开关解析', () => {
    it('未设置/空串时默认压缩(false)', () => {
        expect(isJsonPrettyEnabled({})).toBe(false);
        expect(isJsonPrettyEnabled({ SAP_MCP_JSON_PRETTY: '' })).toBe(false);
        expect(isJsonPrettyEnabled({ SAP_MCP_JSON_PRETTY: '  ' })).toBe(false);
    });

    it('true/1/yes(含大小写与首尾空白)开启缩进', () => {
        for (const raw of ['true', 'TRUE', '1', 'yes', ' Yes ']) {
            expect(isJsonPrettyEnabled({ SAP_MCP_JSON_PRETTY: raw })).toBe(true);
        }
    });

    it('false/0/no 关闭缩进', () => {
        for (const raw of ['false', '0', 'no', 'NO']) {
            expect(isJsonPrettyEnabled({ SAP_MCP_JSON_PRETTY: raw })).toBe(false);
        }
    });

    it('非法值抛错(fail-closed,与运行时守卫同语义)', () => {
        expect(() => isJsonPrettyEnabled({ SAP_MCP_JSON_PRETTY: 'pretty' })).toThrow('SAP_MCP_JSON_PRETTY');
    });
});

describe('serializeJsonText 缩进与 bigint 语义', () => {
    const sample = { status: 'success', result: { rows: [1, 2], name: 'T000' } };

    it('默认(压缩)输出单行无缩进', () => {
        expect(serializeJsonText(sample, {})).toBe('{"status":"success","result":{"rows":[1,2],"name":"T000"}}');
    });

    it('开关开启时输出 2 空格缩进(人读/VSP 同款形态)', () => {
        const text = serializeJsonText(sample, { SAP_MCP_JSON_PRETTY: 'true' });
        expect(text).toBe('{\n  "status": "success",\n  "result": {\n    "rows": [\n      1,\n      2\n    ],\n    "name": "T000"\n  }\n}');
    });

    it('bigint 序列化为字符串而非抛错(两种缩进口径一致)', () => {
        const value = { count: BigInt('9007199254740993') }; // 目标低于 ES2020,不能用 bigint 字面量
        expect(serializeJsonText(value, {})).toBe('{"count":"9007199254740993"}');
        expect(JSON.parse(serializeJsonText(value, { SAP_MCP_JSON_PRETTY: 'true' })).count).toBe('9007199254740993');
    });
});
