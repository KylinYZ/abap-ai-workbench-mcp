/**
 * datapreview rowNumber 上限语义测试(离线,零网络)。
 *
 * 背景:ADT datapreview 服务端对 rowNumber 存在 +1 口径(2026-10 ED1 真机
 * 实证:请求 rowNumber=5 返回 6 行)。修复方式为客户端在 parse 之后统一
 * 裁剪(limitQueryRows),保证"最多返回 rowNumber 行"的承诺语义。
 *
 * 本文件用 mock AdtHTTP 锁定三条契约:
 *   1. 服务端多返回一行时,tableContents / runQuery 均裁剪到请求行数;
 *   2. 服务端返回行数 ≤ rowNumber 时不裁剪(原样透传);
 *   3. rowNumber 非法(负数/NaN)时不裁剪——保守透传,不引入新异常路径。
 * 裁剪对 decode=true/false 同样生效,且作用于 decode 之前(省解码开销)。
 */
import { tableContents, runQuery } from '../adt/api/tablecontents';
import type { AdtHTTP } from '../adt/AdtHTTP';

/** 构造 N 行单列 tableData XML(形态对齐 DatapreviewClustdWireContract 的真机取证)。 */
function tableDataXml(rowCount: number): string {
    const dataTags = Array.from({ length: rowCount }, (_, i) => `      <data>ROW${i}</data>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<tableData xmlns="http://www.sap.com/adt/datapreview/tabledata">
  <columns>
    <metadata name="KEY" type="C" keyAttribute="true" length="10"/>
    <dataSet>
${dataTags}
    </dataSet>
  </columns>
</tableData>`;
}

/** mock AdtHTTP:只实现 request,返回预置 XML body;记录 qs 以便断言透传。 */
function mockHttp(xml: string) {
    const request = jest.fn().mockResolvedValue({ body: xml });
    return { request } as unknown as AdtHTTP & { request: jest.Mock };
}

describe('datapreview rowNumber 上限语义(服务端 +1 口径的客户端裁剪)', () => {
    it('tableContents:服务端返回 6 行而请求 5 行时,裁剪到 5 行', async () => {
        const h = mockHttp(tableDataXml(6));
        const result = await tableContents(h, 'T000', 5, false);
        expect(result.values).toHaveLength(5);
        expect(result.values.map(r => r.KEY)).toEqual(['ROW0', 'ROW1', 'ROW2', 'ROW3', 'ROW4']);
    });

    it('runQuery:同样受 rowNumber 上限约束(decode=true 时裁剪发生在解码前)', async () => {
        const h = mockHttp(tableDataXml(6));
        const result = await runQuery(h, 'SELECT KEY FROM T000', 5, true);
        expect(result.values).toHaveLength(5);
        expect(result.values[0].KEY).toBe('ROW0'); // CHAR 列 decode 后保持字符串
    });

    it('服务端返回行数等于 rowNumber 时不裁剪(原样透传)', async () => {
        const h = mockHttp(tableDataXml(5));
        const result = await tableContents(h, 'T000', 5, false);
        expect(result.values).toHaveLength(5);
    });

    it('服务端返回行数少于 rowNumber 时不裁剪', async () => {
        const h = mockHttp(tableDataXml(3));
        const result = await tableContents(h, 'T000', 100, false);
        expect(result.values).toHaveLength(3);
    });

    it('rowNumber 非法(负数/NaN)时保守透传,不裁剪也不抛异常', async () => {
        const h1 = mockHttp(tableDataXml(6));
        expect((await tableContents(h1, 'T000', -1, false)).values).toHaveLength(6);
        const h2 = mockHttp(tableDataXml(6));
        expect((await runQuery(h2, 'SELECT KEY FROM T000', NaN, false)).values).toHaveLength(6);
    });

    it('rowNumber 仍原样透传给服务端 qs(裁剪只是客户端兜底,不改变请求)', async () => {
        const h = mockHttp(tableDataXml(6));
        await tableContents(h, 'T000', 5, false);
        expect(h.request).toHaveBeenCalledTimes(1);
        const [, options] = h.request.mock.calls[0];
        expect(options.qs).toEqual({ rowNumber: 5, ddicEntityName: 'T000' });
    });
});
