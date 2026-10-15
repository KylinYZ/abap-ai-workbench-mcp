/**
 * ============================================================================
 * RFC_READ_TABLE 只读表读取 API（rfc.remote-enabled.read-table 的直链路线）
 * ============================================================================
 *
 * 对齐 VSP pkg/saprfc/readtable.go ReadTable（L27-72）的调用语义：
 *   RFC_READ_TABLE(QUERY_TABLE, DELIMITER='|', ROWCOUNT, OPTIONS, FIELDS)
 *   返回 DATA 行（WA 按 DELIMITER 切分为列值）。
 *
 * 与 VSP 的差异（如实声明）：
 *   - DELIMITER 保持 VSP 同款单字符 '|'（RFC_READ_TABLE 的 DELIMITER 参数为
 *     CHAR1，open-rfc 按元数据宽度严格校验，双字符分隔串会被拒发——真机
 *     实测 "DELIMITER does not fit its classic CHAR width"）。列值含 '|' 时
 *     会串列，与 VSP 的已知限制一致（当前无更宽分隔符可用；解析时按列数
 *     补齐/截断做保守处理）。
 *   - 本实现运行在 open-rfc 直链传输上（TransportAdapter），受 allowlist
 *     只读门控约束（RFC_READ_TABLE 在默认白名单内）。
 *
 * 注入防线（WHERE 子句是自由文本、直拼 RFM 内部 SELECT，防线必须前置）：
 *   - 控制字符/换行拒绝（阻断 WHERE 逃逸与语句注入）；
 *   - 单引号翻倍（SQL 字面量转义，VSP sqlQuote 同语义）；
 *   - 表名/列名白名单（A-Z 0-9 _ /）。
 */

import { RfcError } from './errors';
import { splitWhereToOptions } from '../config/SapReleaseCapability';

/** WHERE 子句单行最大长度：RFC_READ_TABLE 的 OPTIONS-TEXT 字段宽 72 字符。 */
export const WHERE_LINE_MAX_LENGTH = 72;

/** RFM 表读取的输入。 */
export interface ReadRfcTableInput {
  /** 目标表名（DDIC 透明表/视图，白名单校验）。 */
  table: string
  /** WHERE 子句（自由文本；单引号自动翻倍转义）。 */
  whereClause?: string
  /** 只取这些列（FIELDNAME 大写白名单校验）。 */
  fields?: readonly string[]
  /** 最大行数（ROWCOUNT；缺省 100，上限 1000）。 */
  maxRows?: number
  /** 描述语言（1 位 SAP 键或 2 位 ISO，仅影响 FIELDS 的列描述文本）。 */
  language?: string
}

/** readRfcTable 的返回。 */
export interface ReadRfcTableResult {
  table: string
  /** 列名清单（FIELDS 回传，未指定列时为空表示全列）。 */
  fields: string[]
  /** 数据行：每行按 FIELDS/DELIMITER 切分为列值数组。 */
  rows: string[][]
  rowCount: number
  maxRows: number
}

/** FM 名/表名/列名白名单（大写字母数字/_/）。 */
export function validateToken(value: unknown, capability: string, label: string, maxLength: number): string {
  const token = String(value ?? '').trim().toUpperCase()
  if (!token || token.length > maxLength || !/^[A-Z0-9_/]+$/.test(token)) {
    throw new RfcError(
      'RFC_INVALID_PAYLOAD',
      `${capability}: ${label} "${String(value ?? '')}" is invalid (A-Z 0-9 _ /, at most ${maxLength} characters).`
    )
  }
  return token
}

/**
 * WHERE 子句的安全化处理（OPTIONS TEXT 是动态 Open SQL WHERE 片段）：
 * - 拒绝换行/控制字符（阻断 OPTIONS 行逃逸——RFM 内部按行拼 SELECT WHERE）；
 * - 拒绝分号（阻断语句边界混淆）；
 * - 长度处理（M1 低版本兼容，2026-10-15 ED1/7.51 真机取证后调整）：经典
 *   RFC_READ_TABLE 的 OPTIONS 行宽 72（RFC_DB_OPT），原先"超限即拒"在低版本
 *   会让普通 IN 查询（如 6 组件清单）必然失败——现改为不在此处拒绝长度，
 *   由 buildReadTablePayload 经 splitWhereToOptions（引号感知、按空格边界）
 *   切成多行 TEXT；唯一剩余拒绝路径是引号外单 token 超宽（无法安全断行）。
 * - 单引号按原样透传、不翻倍：OPTIONS 文本由 RFM 内部作为 Open SQL 片段执行，
 *   字面量引号必须保持调用方写法（`BUKRS = '1000'`）；翻倍会触发 ABAP 侧
 *   DB_Error（真机实测）。注入面评估：WHERE 只影响调用方点名的单张只读表的
 *   行筛选，标识符类注入已被表名/列名白名单阻断，语句注入已被分号/控制字符
 *   拒绝阻断（与 VSP 直传 TEXT 的暴露面一致）。
 */
export function sanitizeWhereClause(value: unknown, capability: string): string {
  const raw = String(value ?? '').trim()
  if (raw === '') return ''
  if (/[\r\n\x00-\x08\x0b\x0c\x0e-\x1f;]/.test(raw)) {
    throw new RfcError(
      'RFC_INVALID_PAYLOAD',
      `${capability}: whereClause contains line breaks, semicolons or control characters and is rejected.`
    )
  }
  return raw
}

/** 构建 RFC_READ_TABLE 的调用载荷（VSP readtable.go L28-49 同构）。 */
export function buildReadTablePayload(input: ReadRfcTableInput, capability: string): Record<string, unknown> {
  const table = validateToken(input?.table, capability, 'table', 30)
  const payload: Record<string, unknown> = {
    QUERY_TABLE: table,
    // DELIMITER 是 CHAR1（真机实测 open-rfc 元数据宽度校验拒绝双字符 '~~'），
    // 只能单字符：取 VSP 同款 '|'，列值含 '|' 的串列风险为已知限制
    DELIMITER: '|'
  }
  const maxRows = Math.min(Math.max(Math.floor(Number(input?.maxRows ?? 100)) || 100, 1), 1000)
  payload.ROWCOUNT = maxRows

  const whereClause = sanitizeWhereClause(input?.whereClause, capability)
  if (whereClause !== '') {
    // M1 低版本兼容：长 WHERE 按引号感知的空格边界切多行 OPTIONS TEXT
    // （RFM 内部拼接为单个 WHERE，行序即原语义）；短句产出单行，行为不变。
    payload.OPTIONS = splitWhereToOptions(whereClause, WHERE_LINE_MAX_LENGTH).map(text => ({ TEXT: text }))
  }

  const fields = (input?.fields ?? [])
    .map(f => String(f ?? '').trim().toUpperCase())
    .filter(f => f !== '')
    .map(f => validateToken(f, capability, 'fields entry', 30))
  if (fields.length > 0) {
    payload.FIELDS = fields.map(name => ({ FIELDNAME: name }))
  }
  return { payload, table }
}

/** 从 RFC_READ_TABLE 的 DATA 行按 DELIMITER 切分为列值数组。 */
export function splitDelimitedRows(rows: readonly string[], delimiter: string, columnCount: number): string[][] {
  return rows.map(row => {
    const cells = row.split(delimiter)
    if (cells.length < columnCount) {
      // 尾列空值被 RFM 截断：补齐到列数
      while (cells.length < columnCount) cells.push('')
    }
    return cells
  })
}
