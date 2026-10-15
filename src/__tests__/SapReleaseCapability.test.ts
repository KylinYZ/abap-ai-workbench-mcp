import {
  DEFAULT_MIN_BASIS_RELEASE,
  LOW_RELEASE_TARGET_BASIS,
  REPOSITORY_CREATION_KIND_MIN_RELEASE,
  TOOL_KIND_MIN_BASIS_RELEASE,
  TOOL_MIN_BASIS_RELEASE,
  assertCreationKindsAvailableForBasisRelease,
  detectBasisReleaseFromSystemInfo,
  filterToolsForBasisRelease,
  isRepositoryCreationKindAvailableForBasisRelease,
  isToolAvailableForBasisRelease,
  isToolKindAvailableForBasisRelease,
  normalizeReleaseNumber,
  parseSapReleaseFingerprint,
  resolveConfiguredBasisRelease,
  splitWhereToOptions,
  unavailableCreationKindsForBasisRelease,
  unavailableToolsForBasisRelease,
  type CversRow
} from '../config/SapReleaseCapability.js';
import { RfcError } from '../rfc/errors';
import { REPOSITORY_OBJECT_KINDS } from '../safe/repositoryCreationTypes.js';
import {
  BUSINESS_READONLY_TOOL_NAMES,
  DEVELOPMENT_WORKBENCH_TOOL_NAMES,
  OPERATIONS_READONLY_TOOL_NAMES,
  READ_ONLY_LEGACY_TOOL_NAMES,
  selectProfileTools
} from '../config/ToolProfiles.js';
import {
  CONTROLLED_ADVANCED_MUTATION_TOOL_NAMES,
  RAW_ADVANCED_MUTATION_TOOL_NAMES
} from '../config/ToolOperationPolicy.js';

/** CVERS 行构造助手：只填必需两字段。 */
function cvers(component: string, release: string, spLevel?: string): CversRow {
  return { component, release, spLevel };
}

describe('normalizeReleaseNumber', () => {
  it.each([
    ['750', 750],
    ['751', 751],
    ['7.50', 750],
    ['7.52', 752],
    [' 755 ', 755]
  ])('归一 %s → %i', (raw, expected) => {
    expect(normalizeReleaseNumber(raw)).toBe(expected);
  });

  it.each([undefined, null, '', '7.5', '7500', 'S/4', '750.1'])('非法输入 %s 返回 undefined', raw => {
    expect(normalizeReleaseNumber(raw as string | undefined)).toBeUndefined();
  });
});

describe('parseSapReleaseFingerprint', () => {
  const fixedNow = new Date('2026-10-15T00:00:00Z');

  it('S/4 1511：SAP_BASIS 750 + S4CORE 100', () => {
    const fp = parseSapReleaseFingerprint(
      [cvers('SAP_BASIS', '750', '0013'), cvers('S4CORE', '100'), cvers('SAP_ABA', '750')],
      fixedNow
    );
    expect(fp).toEqual({
      basisRelease: 750,
      basisSpLevel: 13,
      s4coreRelease: '100',
      detectedAt: fixedNow.toISOString(),
      source: 'cvers+system-info'
    });
  });

  it('S/4 1610：SAP_BASIS 7.50 点号形态 + S4CORE 101', () => {
    const fp = parseSapReleaseFingerprint(
      [cvers('S4CORE', '101'), cvers('SAP_BASIS', '7.51')],
      fixedNow
    );
    expect(fp?.basisRelease).toBe(751);
    expect(fp?.s4coreRelease).toBe('101');
  });

  it('S4CORE 缺失不阻断（精简系统退化，s4coreRelease 仅展示用）', () => {
    const fp = parseSapReleaseFingerprint([cvers('SAP_BASIS', '750')], fixedNow);
    expect(fp?.basisRelease).toBe(750);
    expect(fp?.s4coreRelease).toBeUndefined();
  });

  it('SAP_BASIS 缺失 → undefined（fail-closed，不得猜测裁剪）', () => {
    expect(parseSapReleaseFingerprint([cvers('S4CORE', '101')], fixedNow)).toBeUndefined();
    expect(parseSapReleaseFingerprint([], fixedNow)).toBeUndefined();
  });

  it('SAP_BASIS release 不可解析 → undefined（fail-closed）', () => {
    expect(parseSapReleaseFingerprint([cvers('SAP_BASIS', 'UNKNOWN')], fixedNow)).toBeUndefined();
  });

  it('真机 fixture：ED1 = S/4HANA 1610 SP2（2026-10-15 收集报告，docs/evidence/low-release-ed1-751-baseline.md）', () => {
    // 关键形态：SAP_ABA 用字母后缀版本号 '75B'（非数字三位），指纹主键只认
    // SAP_BASIS 数字 release，SAP_ABA 行不参与解析也不得导致失败。
    const fp = parseSapReleaseFingerprint(
      [
        cvers('S4CORE', '101'),
        cvers('SAP_ABA', '75B'),
        cvers('SAP_BASIS', '751'),
        cvers('SAP_GWFND', '751'),
        cvers('SAP_UI', '751')
      ],
      fixedNow
    );
    expect(fp?.basisRelease).toBe(751);
    expect(fp?.s4coreRelease).toBe('101');
    // 裁剪行为：751 上 RAP 面（755）隐藏、AMDP kind（753）拒绝、其余放行
    expect(isToolAvailableForBasisRelease('rapGenPreview', fp?.basisRelease)).toBe(false);
    expect(isToolAvailableForBasisRelease('getObjectSource', fp?.basisRelease)).toBe(true);
    expect(isToolKindAvailableForBasisRelease('previewDebugOperation', 'AMDP_START', fp?.basisRelease)).toBe(false);
    // RFC_SYSTEM_INFO 的 S4_HANA 参数在 ED1 返回空值——真机事实固化为设计约束：
    // S/4 代次判定只认 CVERS S4CORE，绝不依赖 S4_HANA 导出参数。
    expect(fp && 's4coreRelease' in fp).toBe(true);
  });
});

describe('isToolAvailableForBasisRelease / filterToolsForBasisRelease', () => {
  it('basisRelease undefined（指纹未接入）→ 恒放行，行为零变化', () => {
    expect(isToolAvailableForBasisRelease('rapGenPreview', undefined)).toBe(true);
    expect(filterToolsForBasisRelease(['a', 'b', 'rapGenPreview'], undefined)).toEqual(['a', 'b', 'rapGenPreview']);
  });

  it('未登记工具全版本支持（默认 700）', () => {
    expect(isToolAvailableForBasisRelease('getObjectSource', LOW_RELEASE_TARGET_BASIS)).toBe(true);
    expect(TOOL_MIN_BASIS_RELEASE['getObjectSource']).toBeUndefined();
    expect(DEFAULT_MIN_BASIS_RELEASE).toBe(700);
  });

  it('RAP 面（登记 755）在 750/751/752 被拒、755+ 放行', () => {
    expect(isToolAvailableForBasisRelease('rapGenPreview', 750)).toBe(false);
    expect(isToolAvailableForBasisRelease('rapGenPreview', 751)).toBe(false);
    expect(isToolAvailableForBasisRelease('rapGenPreview', 752)).toBe(false);
    expect(isToolAvailableForBasisRelease('rapGenPreview', 755)).toBe(true);
    expect(isToolAvailableForBasisRelease('previewRapOperation', 754)).toBe(false);
  });

  it('批量过滤保持输入顺序，且可稳定计算被裁剪清单', () => {
    const names = ['getObjectSource', 'rapGenGetSchema', 'previewRapOperation', 'tableContents'];
    expect(filterToolsForBasisRelease(names, 751)).toEqual(['getObjectSource', 'tableContents']);
    expect(unavailableToolsForBasisRelease(names, 751)).toEqual([
      { tool: 'previewRapOperation', minBasisRelease: 755 },
      { tool: 'rapGenGetSchema', minBasisRelease: 755 }
    ]);
    // undefined 指纹 → 空裁剪清单（healthcheck report 不输出 release 段）
    expect(unavailableToolsForBasisRelease(names, undefined)).toEqual([]);
  });

  it('kind 级判定：AMDP kind 7.53+，普通调试 kind 与其他工具不限版本', () => {
    expect(isToolKindAvailableForBasisRelease('previewDebugOperation', 'AMDP_START', 751)).toBe(false);
    expect(isToolKindAvailableForBasisRelease('previewDebugOperation', 'AMDP_START', 753)).toBe(true);
    expect(isToolKindAvailableForBasisRelease('previewDebugOperation', 'ATTACH', 750)).toBe(true);
    expect(isToolKindAvailableForBasisRelease('previewDebugOperation', 'SET_BREAKPOINTS', 750)).toBe(true);
    expect(isToolKindAvailableForBasisRelease('previewQualityCheck', 'ATC', 750)).toBe(true);
    expect(isToolKindAvailableForBasisRelease('previewDebugOperation', 'AMDP_START', undefined)).toBe(true);
    expect(TOOL_KIND_MIN_BASIS_RELEASE['previewDebugOperation']).toBeDefined();
  });
});

describe('release matrix drift guard（防漂移：登记键必须是真实目录中的工具名）', () => {
  // 全目录工具名并集：profile 显式集合 + 受控/RAP 面集合。登记表出现
  // 不在并集中的键（工具改名/删除后忘改）即测试失败——与 ToolCatalogIntegrity 同思路。
  const catalogNames: ReadonlySet<string> = new Set([
    ...READ_ONLY_LEGACY_TOOL_NAMES,
    ...DEVELOPMENT_WORKBENCH_TOOL_NAMES,
    ...BUSINESS_READONLY_TOOL_NAMES,
    ...OPERATIONS_READONLY_TOOL_NAMES,
    ...RAW_ADVANCED_MUTATION_TOOL_NAMES,
    ...CONTROLLED_ADVANCED_MUTATION_TOOL_NAMES
  ]);

  it('TOOL_MIN_BASIS_RELEASE 的每个键都存在于目录并集', () => {
    const unknown = Object.keys(TOOL_MIN_BASIS_RELEASE).filter(name => !catalogNames.has(name));
    expect(unknown).toEqual([]);
  });

  it('TOOL_KIND_MIN_BASIS_RELEASE 的每个键都存在于目录并集，且登记值递增合理', () => {
    const unknown = Object.keys(TOOL_KIND_MIN_BASIS_RELEASE).filter(name => !catalogNames.has(name));
    expect(unknown).toEqual([]);
    for (const kinds of Object.values(TOOL_KIND_MIN_BASIS_RELEASE)) {
      for (const min of Object.values(kinds)) {
        expect(min).toBeGreaterThanOrEqual(700);
        expect(min).toBeLessThanOrEqual(799);
      }
    }
  });
});

describe('detectBasisReleaseFromSystemInfo（RFC_SYSTEM_INFO → BASIS release）', () => {
  it('ED1 真机形态：嵌套 RFCSI_EXPORT.RFCSAPRL', () => {
    const info = {
      RFCSI_EXPORT: {
        RFCDEST: 'ERPDEV1_ED1_00', RFCSYSID: 'ED1', RFCSAPRL: '751',
        RFCDBSYS: 'HDB', RFCKERNRL: '749', RFCCHARTYP: '4103'
      },
      S4_HANA: ''
    };
    expect(detectBasisReleaseFromSystemInfo(info)).toBe(751);
  });

  it('扁平形态：顶层 RFCSAPRL（部分调用路径直出 RFCSI 字段）', () => {
    expect(detectBasisReleaseFromSystemInfo({ RFCSAPRL: '7.50' })).toBe(750);
  });

  it('缺 RFCSAPRL / 非法输入 → undefined（fail-closed：不裁剪）', () => {
    expect(detectBasisReleaseFromSystemInfo({ RFCSI_EXPORT: { RFCSYSID: 'ED1' } })).toBeUndefined();
    expect(detectBasisReleaseFromSystemInfo({})).toBeUndefined();
    expect(detectBasisReleaseFromSystemInfo(null)).toBeUndefined();
    expect(detectBasisReleaseFromSystemInfo('not-an-object')).toBeUndefined();
    // S4_HANA 参数（ED1 实测为空值）刻意不参与判定
    expect(detectBasisReleaseFromSystemInfo({ S4_HANA: 'X' })).toBeUndefined();
  });
});

describe('resolveConfiguredBasisRelease（env SAP_MCP_BASIS_RELEASE 显式配置）', () => {
  it.each([
    ['751', 751],
    ['7.51', 751],
    [' 750 ', 750]
  ])('合法配置 %s → %i', (raw, expected) => {
    expect(resolveConfiguredBasisRelease(raw)).toBe(expected);
  });

  it.each([undefined, null, '', 'high', '75.1'])('非法/未配置 %s → undefined（不改目录行为）', raw => {
    expect(resolveConfiguredBasisRelease(raw as string | undefined)).toBeUndefined();
  });
});

describe('splitWhereToOptions（RFC_READ_TABLE OPTIONS 72 字符行切分，M1 低版本兼容）', () => {
  it('短句单行透传，行为与旧实现一致', () => {
    expect(splitWhereToOptions("BUKRS = '1000'")).toEqual(["BUKRS = '1000'"]);
    expect(splitWhereToOptions("COMPONENT = 'SAP_BASIS'")).toEqual(["COMPONENT = 'SAP_BASIS'"]);
  });

  it('ED1 真机场景：6 组件 IN 超长查询切成多行 ≤72，拼回语义不变', () => {
    // 真机原始失败查询（whereClause exceeds 72 characters）等价形态
    const where = "COMPONENT IN ('SAP_BASIS', 'SAP_ABA', 'S4CORE', 'SAP_GWFND', 'SAP_UI', 'SAP_APPL')";
    expect(where.length).toBeGreaterThan(72);
    const lines = splitWhereToOptions(where);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(72);
    }
    // 拼回 = 原语义（空格规范化后比较：多行间插入的换行/空格在 ABAP SQL 中不敏感）
    expect(lines.join(' ').replace(/\s+/g, ' ').trim()).toBe(where.replace(/\s+/g, ' ').trim());
  });

  it('引号内空格是字面量，绝不在其内部断行', () => {
    // 字面量 'AB CD EF GH ...' 内含大量空格，断点只能在引号外
    const where = "MSGTX = 'AB CD EF GH IJ KL MN OP QR ST UV WX YZ AB CD EF GH IJ KL MN' AND MANDT = '100'";
    const lines = splitWhereToOptions(where);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(72);
    }
    // 每行引号必须配对（没有在字面量中间断开）
    for (const line of lines) {
      expect((line.match(/'/g) ?? []).length % 2).toBe(0);
    }
    expect(lines.join(' ')).toContain("MSGTX = 'AB CD EF GH IJ KL MN OP QR ST UV WX YZ AB CD EF GH IJ KL MN'");
  });

  it('引号外单 token 超宽无法安全断行 → 拒绝（唯一剩余拒绝路径）', () => {
    const hugeToken = 'X'.repeat(80);
    expect(() => splitWhereToOptions(`FOO = ${hugeToken}`)).toThrow(RfcError);
    expect(() => splitWhereToOptions(`FOO = ${hugeToken}`)).toThrow(/token exceeds 72/);
  });

  it('空串返回空数组（调用方据此省略 OPTIONS）', () => {
    expect(splitWhereToOptions('')).toEqual([]);
  });

  it('多行切分在所有行都满足宽度时仍保持行序（RFM 拼接即原语义）', () => {
    const where = 'A = 1 AND B = 2 AND C = 3 AND D = 4 AND E = 5 AND F = 6 AND G = 7 AND H = 8 AND I = 9 AND J = 10';
    const lines = splitWhereToOptions(where, 20);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join(' ')).toBe(where);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(20);
    }
  });
});

describe('selectProfileTools 级联（M0/M1 接线防遗忘：basisRelease 参数真实生效）', () => {
  // 最小工具集：一个普通只读工具 + 一个 RAP 面工具，走 development-workbench 名单形态
  const fakeTool = (name: string): ToolDefinitionLike => ({
    name,
    description: `fake ${name}`,
    inputSchema: { type: 'object' as const, properties: {} }
  });
  type ToolDefinitionLike = { name: string; description: string; inputSchema: { type: 'object'; properties: Record<string, never> } };

  const tools = [fakeTool('healthcheck'), fakeTool('rapGenPreview')];

  it('basisRelease=751：rapGenPreview（755）被裁剪、healthcheck 保留', () => {
    const filtered = selectProfileTools('legacy-full', [], tools, [], [], 'DEV', [], [], [], [], [], [], [], 751);
    expect(filtered.map(t => t.name)).toEqual(['healthcheck']);
  });

  it('basisRelease 缺省（指纹未接入）：目录零变化（RAP 工具仍在）', () => {
    const filtered = selectProfileTools('legacy-full', [], tools, [], [], 'DEV');
    expect(filtered.map(t => t.name)).toContain('rapGenPreview');
  });
});

describe('repository creation kind matrix（M2-A：31 类能力目录的版本收窄）', () => {
  it('防漂移：kind 表的每个键都存在于受控创建 31 类全集', () => {
    const unknown = Object.keys(REPOSITORY_CREATION_KIND_MIN_RELEASE)
      .filter(kind => !(REPOSITORY_OBJECT_KINDS as readonly string[]).includes(kind));
    expect(unknown).toEqual([]);
  });

  it('751（ED1 真机）：RAP 时代 kind 拒、CDS_METADATA_EXTENSION 过', () => {
    expect(isRepositoryCreationKindAvailableForBasisRelease('BEHAVIOR_DEFINITION', 751)).toBe(false);
    expect(isRepositoryCreationKindAvailableForBasisRelease('SERVICE_DEFINITION', 751)).toBe(false);
    expect(isRepositoryCreationKindAvailableForBasisRelease('SERVICE_BINDING', 751)).toBe(false);
    expect(isRepositoryCreationKindAvailableForBasisRelease('CDS_TYPE', 751)).toBe(false);
    expect(isRepositoryCreationKindAvailableForBasisRelease('CDS_ASPECT', 751)).toBe(false);
    expect(isRepositoryCreationKindAvailableForBasisRelease('CDS_METADATA_EXTENSION', 751)).toBe(true);
    // DDIC/工作台古董类不受影响
    expect(isRepositoryCreationKindAvailableForBasisRelease('DATABASE_TABLE', 751)).toBe(true);
    expect(isRepositoryCreationKindAvailableForBasisRelease('MESSAGE_CLASS', 751)).toBe(true);
  });

  it('750：CDS_METADATA_EXTENSION 也拒（7.50 无 metadata extensions）', () => {
    expect(isRepositoryCreationKindAvailableForBasisRelease('CDS_METADATA_EXTENSION', 750)).toBe(false);
    expect(isRepositoryCreationKindAvailableForBasisRelease('CDS_METADATA_EXTENSION', 751)).toBe(true);
  });

  it('undefined（指纹未接入）恒放行', () => {
    expect(isRepositoryCreationKindAvailableForBasisRelease('BEHAVIOR_DEFINITION', undefined)).toBe(true);
  });

  it('汇总清单按 kind 名排序，healthcheck 可 diff', () => {
    const kinds = Object.keys(REPOSITORY_CREATION_KIND_MIN_RELEASE);
    const gated = unavailableCreationKindsForBasisRelease(kinds, 751);
    expect(gated.map(g => g.objectKind)).toEqual(
      [...gated.map(g => g.objectKind)].sort((a, b) => a.localeCompare(b))
    );
    expect(gated).toContainEqual({ objectKind: 'BEHAVIOR_DEFINITION', minBasisRelease: 755 });
    expect(gated).toContainEqual({ objectKind: 'CDS_ENTITY_BUFFER', minBasisRelease: 757 });
    expect(unavailableCreationKindsForBasisRelease(kinds, undefined)).toEqual([]);
  });

  it('preview 逐对象门禁：命中抛错带版本、无 objectKind 跳过、undefined 不校验', () => {
    expect(() => assertCreationKindsAvailableForBasisRelease(
      [{ objectKind: 'MESSAGE_CLASS' }, { objectKind: 'BEHAVIOR_DEFINITION' }], 751
    )).toThrow(/BEHAVIOR_DEFINITION[\s\S]*755[\s\S]*BASIS 751/);
    expect(() => assertCreationKindsAvailableForBasisRelease([{ objectKind: '' }], 751)).not.toThrow();
    expect(() => assertCreationKindsAvailableForBasisRelease(
      [{ objectKind: 'BEHAVIOR_DEFINITION' }], undefined
    )).not.toThrow();
    expect(() => assertCreationKindsAvailableForBasisRelease(undefined, 751)).not.toThrow();
  });
});
