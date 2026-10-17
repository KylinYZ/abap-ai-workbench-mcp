/**
 * 工具响应文本序列化的唯一出口。
 *
 * 背景:MCP 工具响应的 `content[].text` 由各 handler 用 JSON.stringify 构造,
 * 此前均为压缩形态(无缩进)。压缩对 LLM 消费更省 token(大响应 pretty 化会
 * 膨胀 30%~60% 字节),但人工在客户端日志里核对返回时不可读。本模块提供
 * 部署级开关 `SAP_MCP_JSON_PRETTY=true` 切换缩进格式(2 空格),默认保持
 * 压缩。开关为启动期配置:修改后须重启 MCP 服务(与 .env 其余字段一致),
 * 调用方无任何参数可影响此行为。
 *
 * 注意边界——只有"响应文本"走这里;以下场景必须保持压缩口径,不得替换:
 *   - MrtrElicitation 的 canonical 签名(哈希稳定性);
 *   - requestLimits 的字节计量(阈值语义按数据量,不随展示格式膨胀);
 *   - logger 的单行日志。
 */

/** 布尔环境变量解析:与 SessionResilienceConfig 的 booleanValue 同语义。 */
function booleanValue(environment: Record<string, string | undefined>, name: string, fallback: boolean): boolean {
  const raw = environment[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === '1' || value === 'yes') return true;
  if (value === 'false' || value === '0' || value === 'no') return false;
  throw new Error(`${name} received '${raw}'; expected true or false.`);
}

/** SAP_MCP_JSON_PRETTY 是否开启(默认 false = 压缩)。 */
export function isJsonPrettyEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return booleanValue(environment, 'SAP_MCP_JSON_PRETTY', false);
}

/**
 * 序列化工具响应文本:统一处理 bigint(JSON.stringify 原生抛
 * "Do not know how to serialize a BigInt"),并按部署开关决定缩进。
 * 所有 handler 的 `text:` 字段与本文件出口之外不宜再直接 stringify 响应。
 */
export function serializeJsonText(value: unknown, environment: Record<string, string | undefined> = process.env): string {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === 'bigint' ? v.toString() : v),
    isJsonPrettyEnabled(environment) ? 2 : 0
  );
}
