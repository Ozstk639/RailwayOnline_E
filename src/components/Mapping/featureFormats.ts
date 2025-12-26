// src/components/mapping/featureFormats.ts


export type DrawMode = 'point' | 'polyline' | 'polygon';
export type BuildOp = 'create' | 'edit' | 'import';

export type FeatureKey =
  | '默认'
  | '车站'
  | '站台'
  | '铁路'
  | '站台轮廓'
  | '车站建筑'
  | '车站建筑点'
  | '车站建筑楼层'
  // 下面这些是旧/占位 subtype（保留可选项，但不参与新 JSON 规范的必填校验）
  | '地标'
  | '栈道'
  | '航道'
  | '一般建筑'
  | '车站站体';

export type ImportFormat =
  | '点'
  | '线'
  | '面'
  | '批量'
  | '车站'
  | '铁路'
  | '站台'
  | '站台轮廓'
  | '车站建筑'
  | '车站建筑点'
  | '车站建筑楼层';


export type Coord2D = { x: number; z: number; y?: number };

export type FieldType = 'text' | 'number' | 'select' | 'bool';

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  /**
   * 对应新 JSON 规范中的 [非必填]：optional=true
   * 对应新 JSON 规范中的 [必填]：optional=false/undefined
   */
  optional?: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: any }>;
  /**
   * 用于组条目新增时的默认值（尤其是 bool 的 True/False 默认）
   */
  defaultValue?: any;
};

export type GroupDef = {
  key: string;                 // groups[key] -> Array<Record<string, any>>
  label: string;
  addButtonText?: string;
  /**
   * 对应新 JSON 规范中的 [非必填]：optional=true
   * 对应新 JSON 规范中的 [必填]：optional=false/undefined
   */
  optional?: boolean;
  /**
   * 当 group 为必填时，通常需要至少 1 条；默认 1
   * - optional=true 时该值不会生效
   */
  minItems?: number;
  fields: FieldDef[];
};

export type FormatDef = {
  key: FeatureKey;
  label: string;
  modes: DrawMode[];           // 允许在哪个 drawMode 下出现
  hideTempOutput?: boolean;    // 非“默认”时隐藏临时输出（按你之前要求）
  /**
   * 新 JSON 规范的 Class（索引表对照）。
   * - “默认/占位 subtype”可以不填。
   */
  classCode?: string;
  fields: FieldDef[];
  groups?: GroupDef[];

  // 把 values/groups + coords 注入成最终可导出的 featureInfo（只要改这里即可改变 JSON 结构）
  buildFeatureInfo: (args: {
    op: BuildOp;
    mode: DrawMode;
    coords: Coord2D[];
    values: Record<string, any>;
    groups: Record<string, any[]>;
    worldId?: string;
    editorId?: string;
    prevFeatureInfo?: any;
    now?: Date;
  }) => any;

  // 从 featureInfo 回填 values/groups（编辑时用）
  hydrate: (featureInfo: any) => {
    values: Record<string, any>;
    groups: Record<string, any[]>;
  };

  // 导入 JSON 时：从 item 得到 coords（用于画图）
  coordsFromFeatureInfo: (featureInfo: any) => Coord2D[];

  // 导入 JSON 时：校验 item，返回错误信息（undefined=通过）
  validateImportItem?: (item: any) => string | undefined;
};

// ---------- 新规范：系统字段（自动填充） ----------
const TYPE_NAME_BY_MODE: Record<DrawMode, 'Points' | 'Polyline' | 'Polygon'> = {
  point: 'Points',
  polyline: 'Polyline',
  polygon: 'Polygon',
};

// 索引表（来自你上传的“索引表.md”）
// 若后续要扩展，仅在此处增补即可。
const CLASS_CODE_BY_FEATURE: Partial<Record<FeatureKey, string>> = {
  车站: 'STA',
  站台: 'PLF',
  铁路: 'RLE',
  车站建筑: 'STB',
  车站建筑楼层: 'STF',
  站台轮廓:'PFB',
  车站建筑点: 'SBP',
};

// World：按 MapContainer 的 currentWorld id 映射到新规范的整数
const WORLD_CODE_BY_WORLD_ID: Record<string, number> = {
  zth: 0,
  naraku: 1,
  houtu: 2,
  eden: 3,
  laputa: 4,
  yunduan: 5,
};

const formatYYYYMMDD = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
};

const resolveWorldCode = (worldId?: string, fallback?: any) => {
  if (worldId && Number.isFinite(WORLD_CODE_BY_WORLD_ID[worldId])) return WORLD_CODE_BY_WORLD_ID[worldId];
  if (fallback && Number.isFinite(Number(fallback))) return Number(fallback);
  return WORLD_CODE_BY_WORLD_ID.zth;
};

const withSystemFields = (def: FormatDef, base: any, args: {
  op: BuildOp;
  mode: DrawMode;
  worldId?: string;
  editorId?: string;
  prevFeatureInfo?: any;
  now?: Date;
}) => {
  const now = args.now ?? new Date();
  const prev = args.prevFeatureInfo ?? {};
  const editor = (args.editorId ?? '').trim();

  const Type = TYPE_NAME_BY_MODE[args.mode];
  const Class = def.classCode ?? CLASS_CODE_BY_FEATURE[def.key] ?? prev?.Class;
  const World = resolveWorldCode(args.worldId, prev?.World);

  // import：尽量保留原有系统字段，不强行写入 Create/Modifity
  if (args.op === 'import') {
    return {
      ...base,
      Type: prev?.Type ?? Type,
      Class: prev?.Class ?? Class,
      World: prev?.World ?? World,
      CreateTime: prev?.CreateTime,
      CreateBy: prev?.CreateBy,
      ModifityTime: prev?.ModifityTime,
      ModifityBy: prev?.ModifityBy,
    };
  }

  // create：写入 Create*，不写入 Modifity*
  if (args.op === 'create') {
    return {
      ...base,
      Type,
      Class,
      World,
      CreateTime: formatYYYYMMDD(now),
      ...(editor ? { CreateBy: editor } : {}),
    };
  }

  // edit：保留 Create*，写入 Modifity*
  return {
    ...base,
    Type: prev?.Type ?? Type,
    Class: prev?.Class ?? Class,
    World: prev?.World ?? World,
    CreateTime: prev?.CreateTime ?? formatYYYYMMDD(now),
    ...(prev?.CreateBy ? { CreateBy: prev.CreateBy } : (editor ? { CreateBy: editor } : {})),
    ModifityTime: formatYYYYMMDD(now),
    ...(editor ? { ModifityBy: editor } : (prev?.ModifityBy ? { ModifityBy: prev.ModifityBy } : {})),
  };
};

// ---------- 通用工具 ----------
const isFiniteNum = (v: any) => Number.isFinite(Number(v));

const pickByFields = (values: Record<string, any>, fields: FieldDef[]) => {
  const out: Record<string, any> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (v === undefined || v === '' || v === null) {
      if (!f.optional) out[f.key] = v; // 保留空值以便导出时能看见缺啥
      continue;
    }
    if (f.type === 'number') out[f.key] = Number(v);
    else if (f.type === 'bool') out[f.key] = Boolean(v);
    else out[f.key] = v;
  }
  return out;
};

const isEmptyRequired = (field: FieldDef, v: any) => {
  if (field.optional) return false;
  if (v === undefined || v === null) return true;
  if (field.type === 'text') return String(v).trim().length === 0;
  if (field.type === 'number') return String(v).trim().length === 0 || !Number.isFinite(Number(v));
  if (field.type === 'select') return String(v).trim().length === 0;
  // bool：通常都有默认值；不因 false 判空
  return false;
};

/**
 * 保存时必填校验：
 * - 若缺少必填字段，返回 false
 * - 否则返回 true
 */
export const validateRequiredOnSave = (
  def: FormatDef,
  values: Record<string, any>,
  groups: Record<string, any[]>
): boolean => {
  // 默认/占位 subtype：不做校验
  if (def.key === '默认' || !def.classCode) return true;

  // 1) 顶层 fields
  for (const f of def.fields ?? []) {
    if (isEmptyRequired(f, values?.[f.key])) return false;
  }

  // 2) groups
  for (const g of def.groups ?? []) {
    const items = (groups?.[g.key] ?? []) as any[];
    const min = g.optional ? 0 : (g.minItems ?? 1);
    if (items.length < min) return false;

    for (const it of items) {
      for (const f of g.fields ?? []) {
        if (isEmptyRequired(f, it?.[f.key])) return false;
      }
    }
  }

  return true;
};

// ============================
// 必填校验（详细结果）
// ============================

export type MissingEntry =
  | { kind: 'field'; key: string; label: string }
  | { kind: 'group'; groupKey: string; groupLabel: string; minItems: number }
  | { kind: 'groupItemField'; groupKey: string; groupLabel: string; index: number; key: string; label: string }
  | { kind: 'geometry'; detail: string };

export type DetailedValidationResult = { ok: boolean; missing: MissingEntry[] };

/**
 * 返回“缺失项清单”，用于 UI 在保存/导入失败时指明缺少的字段及分组条目。
 */
export const validateRequiredDetailed = (
  def: FormatDef,
  values: Record<string, any>,
  groups: Record<string, any[]>
): DetailedValidationResult => {
  // 默认/占位 subtype：不做校验
  if (def.key === '默认' || !def.classCode) return { ok: true, missing: [] };

  const missing: MissingEntry[] = [];

  // fields
  for (const f of def.fields ?? []) {
    if (isEmptyRequired(f, values?.[f.key])) {
      missing.push({ kind: 'field', key: f.key, label: f.label });
    }
  }

  // groups
  for (const g of def.groups ?? []) {
    const items = (groups?.[g.key] ?? []) as any[];
    const min = g.optional ? 0 : (g.minItems ?? 1);

    if (items.length < min) {
      missing.push({ kind: 'group', groupKey: g.key, groupLabel: g.label, minItems: min });
      // group 不满足 minItems 时不强制终止；仍检查已有条目
    }

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      for (const f of g.fields ?? []) {
        if (isEmptyRequired(f, it?.[f.key])) {
          missing.push({
            kind: 'groupItemField',
            groupKey: g.key,
            groupLabel: g.label,
            index: idx,
            key: f.key,
            label: f.label,
          });
        }
      }
    }
  }

  return { ok: missing.length === 0, missing };
};

export const formatMissingEntries = (missing: MissingEntry[]): string => {
  const lines: string[] = [];
  for (const m of missing) {
    if (m.kind === 'field') lines.push(`- 字段：${m.label}（${m.key}）`);
    else if (m.kind === 'group') lines.push(`- 分组：${m.groupLabel}（${m.groupKey}）至少需要 ${m.minItems} 条`);
    else if (m.kind === 'groupItemField') lines.push(`- 分组 ${m.groupLabel}（${m.groupKey}）第 ${m.index + 1} 条：${m.label}（${m.key}）`);
    else if (m.kind === 'geometry') lines.push(`- 几何：${m.detail}`);
  }
  return lines.join('\n');
};

// ============================
// 导入校验（结构 + 必填 + 几何）
// ============================

export type ImportValidationContext = {
  worldId?: string;
  /**
   * true：导入 JSON 必须显式包含 Type/Class/World，且不允许为空
   * false：允许缺省（由系统生成/覆盖），但若提供且不一致仍可报错（见下方逻辑）
   */
  strictSystemFields?: boolean;
};

export type ImportValidationResult = {
  ok: boolean;
  missing: MissingEntry[];
  structuralErrors: string[];
  mode: DrawMode;
  coords: Coord2D[];
  hydrated: { values: Record<string, any>; groups: Record<string, any[]> } | null;
};


const validateGeometryForMode = (mode: DrawMode, coords: Coord2D[]): MissingEntry[] => {
  if (mode === 'point' && coords.length !== 1) {
    return [{ kind: 'geometry', detail: '点模式需要 1 个点（coordinate.x / coordinate.z）' }];
  }
  if (mode === 'polyline' && coords.length < 2) {
    return [{ kind: 'geometry', detail: '线模式至少需要 2 个点（coordinates[]）' }];
  }
  if (mode === 'polygon' && coords.length < 3) {
    return [{ kind: 'geometry', detail: '面模式至少需要 3 个点（coordinates[]）' }];
  }
  return [];
};

/**
 * JSON 导入使用的“统一校验器”：
 * - def.validateImportItem：结构/类型检查
 * - validateRequiredDetailed：必填字段/分组条目检查
 * - validateGeometryForMode：几何点数量检查
 */
export const validateImportItemDetailed = (
  def: FormatDef,
  item: any,
  ctx: ImportValidationContext = {}
): ImportValidationResult => {
  const structuralErrors: string[] = [];

  const err = def.validateImportItem?.(item);
  if (err) structuralErrors.push(err);

  const mode = (def.modes?.[0] ?? 'point') as DrawMode;
  const coords = def.coordsFromFeatureInfo(item);

  const missing: MissingEntry[] = [];

  // 几何校验
  missing.push(...validateGeometryForMode(mode, coords));

  // ---- 系统字段校验：World / Type / Class（仅新规范启用）----
  if (def.key !== '默认' && def.classCode) {
    const strict = Boolean(ctx.strictSystemFields);

    // worldId 映射必须存在：避免默默回落到 zth
    if (ctx.worldId && WORLD_CODE_BY_WORLD_ID[ctx.worldId] === undefined) {
      structuralErrors.push(`World 映射表缺少 worldId="${ctx.worldId}"（请补充 WORLD_CODE_BY_WORLD_ID）`);
    }

    const expectedType = TYPE_NAME_BY_MODE[mode];
    const expectedClass = def.classCode;
    const expectedWorld = resolveWorldCode(ctx.worldId); // 只根据当前页面 worldId 取期望值

    const hasNonEmpty = (v: any) => v !== null && v !== undefined && String(v).trim() !== '';

    // strict 模式：必须显式提供且不为空
    if (strict) {
      if (!hasNonEmpty(item?.Type)) missing.push({ kind: 'field', key: 'Type', label: '要素类型(Type)' });
      if (!hasNonEmpty(item?.Class)) missing.push({ kind: 'field', key: 'Class', label: '要素种类(Class)' });
      if (!isFiniteNum(item?.World)) missing.push({ kind: 'field', key: 'World', label: '所属时间(World)' });
    }

    // 若提供了值，则必须与期望一致（不管 strict 与否）
    if (hasNonEmpty(item?.Type) && String(item.Type).trim() !== expectedType) {
      structuralErrors.push(`Type 不匹配：期望 "${expectedType}"，输入 "${String(item.Type).trim()}"`);
    }

    if (hasNonEmpty(item?.Class) && String(item.Class).trim() !== expectedClass) {
      structuralErrors.push(`Class 不匹配：期望 "${expectedClass}"，输入 "${String(item.Class).trim()}"`);
    }

    if (hasNonEmpty(item?.World)) {
      const n = Number(item.World);
      if (!Number.isFinite(n)) {
        structuralErrors.push(`World 不是有效数字：输入 "${String(item.World).trim()}"`);
      } else if (expectedWorld !== undefined && n !== expectedWorld) {
        structuralErrors.push(`World 与当前页面不一致：期望 ${expectedWorld}（来自 currentWorldId="${ctx.worldId ?? 'zth'}"），输入 ${n}`);
      }
    }
  }

  // ---- 附加信息（fields/groups）必填校验 ----
  let hydrated: { values: Record<string, any>; groups: Record<string, any[]> } | null = null;
  try {
    hydrated = def.hydrate(item);
    const req = validateRequiredDetailed(def, hydrated.values ?? {}, hydrated.groups ?? {});
    missing.push(...req.missing);
  } catch {
    hydrated = null;
    structuralErrors.push('hydrate 失败：无法解析附加信息结构');
  }

  const ok = structuralErrors.length === 0 && missing.length === 0;
  return { ok, missing, structuralErrors, mode, coords, hydrated };
};



export const FORMAT_REGISTRY: Record<FeatureKey, FormatDef> = {
  // ===== 默认（点/线/面）=====
  默认: {
    key: '默认',
    label: '默认',
    modes: ['point', 'polyline', 'polygon'],
    hideTempOutput: false,
    fields: [],
    groups: [],
    buildFeatureInfo: ({ mode, coords }) => {
      // 最小通用结构（不参与新 JSON 规范）
      return {
        type: mode,
        coords: coords.map(p => (p.y === undefined ? ({ x: p.x, z: p.z }) : ({ x: p.x, z: p.z, y: p.y }))),
      };
    },
    hydrate: (_featureInfo) => ({ values: {}, groups: {} }),
    coordsFromFeatureInfo: (featureInfo) => {
      const arr = featureInfo?.coords;
      if (!Array.isArray(arr)) return [];
      return arr
        .map((p: any) => {
          const x = Number(p?.x);
          const z = Number(p?.z);
          const y = Number(p?.y);
          return Number.isFinite(y) ? ({ x, z, y }) : ({ x, z });
        })
        .filter((p: any) => isFiniteNum(p.x) && isFiniteNum(p.z));
    },
  },


  // ===== 车站 Station =====
  车站: {
    key: '车站',
    label: '车站',
    modes: ['point'],
    hideTempOutput: true,
    classCode: CLASS_CODE_BY_FEATURE['车站'],
    fields: [
      { key: 'stationID', label: '车站ID', type: 'text' },                // [必填]
      { key: 'stationName', label: '车站名', type: 'text' },              // [必填]
      { key: 'elevation', label: '高度(y)', type: 'number', optional: true }, // [非必填]
    ],
    groups: [
      {
        key: 'platforms',
        label: '包含站台 platforms',
        addButtonText: '添加站台条目',
        optional: false,          // [必填]
        minItems: 1,
        fields: [
          { key: 'ID', label: '站台ID', type: 'text' }, // [必填]
        ],
      },
    ],
    buildFeatureInfo: ({ op, mode, coords, values, groups, worldId, editorId, prevFeatureInfo, now }) => {
      const base = pickByFields(values, FORMAT_REGISTRY['车站'].fields);
      const p0 = coords[0];

      const platforms = Array.isArray(groups.platforms)
        ? groups.platforms.map((it: any) => ({
            ID: String(it?.ID ?? '').trim(),
          }))
        : [];

      const out = {
        ...base,
        coordinate: { x: p0?.x ?? 0, z: p0?.z ?? 0 },
        platforms,
      };

      return withSystemFields(FORMAT_REGISTRY['车站'], out, { op, mode, worldId, editorId, prevFeatureInfo, now });
    },
    hydrate: (featureInfo) => ({
      values: {
        stationID: featureInfo?.stationID ?? '',
        stationName: featureInfo?.stationName ?? '',
        elevation: featureInfo?.elevation ?? '',
      },
      groups: {
        platforms: Array.isArray(featureInfo?.platforms)
          ? featureInfo.platforms.map((p: any) => ({ ID: p?.ID ?? '' }))
          : [],
      },
    }),
    coordsFromFeatureInfo: (featureInfo) => {
      const c = featureInfo?.coordinate;
      if (!c) return [];
      return [{ x: Number(c.x), z: Number(c.z) }].filter(p => isFiniteNum(p.x) && isFiniteNum(p.z));
    },
    validateImportItem: (item) => {
      if (!item || typeof item !== 'object') return '不是对象';
      if (!item.stationID) return '缺少 stationID';
      if (!item.stationName) return '缺少 stationName';
      if (!item.coordinate || !isFiniteNum(item.coordinate.x) || !isFiniteNum(item.coordinate.z)) return '缺少合法 coordinate.x / coordinate.z';
      if (!Array.isArray(item.platforms)) return 'platforms 必须是数组';
      return;
    },
  },

  // ===== 站台 Platform =====
  站台: {
    key: '站台',
    label: '站台',
    modes: ['point'],
    hideTempOutput: true,
    classCode: CLASS_CODE_BY_FEATURE['站台'],
    fields: [
      { key: 'platformID', label: '站台ID', type: 'text' },                 // [必填]
      { key: 'platformName', label: '站台名称', type: 'text' },             // [必填]
      { key: 'elevation', label: '高度(y)', type: 'number', optional: true },  // [非必填]

      // === 新增：站台状态字段（顶层 fields）===
      { key: 'Situation', label: '站台是否启用(Situation)', type: 'bool', defaultValue: true }, // [必填] 默认 true
      { key: 'Connect', label: '外部连接功能(Connect)', type: 'bool', defaultValue: true },    // [必填] 默认 true
    ],
    groups: [
      {
        key: 'lines',
        label: '经行线路 lines',
        addButtonText: '添加线路条目',
        optional: false,          // [必填]
        minItems: 1,
        fields: [
          { key: 'ID', label: '线路ID', type: 'text' },
          { key: 'stationCode', label: '站台编号(可选)', type: 'number', optional: true },
          { key: 'stationDistance', label: '线路距离(可选)', type: 'number', optional: true },
          { key: 'Avaliable', label: '可使用性(Avaliable)', type: 'bool', defaultValue: true },
          { key: 'Overtaking', label: '越行(Overtaking)', type: 'bool', defaultValue: false },
          { key: 'getin', label: '可上车(getin)', type: 'bool', defaultValue: true },
          { key: 'getout', label: '可下车(getout)', type: 'bool', defaultValue: true },
          { key: 'NextOT', label: '下一站越行(NextOT)', type: 'bool', defaultValue: false },
        ],
      },
    ],
    buildFeatureInfo: ({ op, mode, coords, values, groups, worldId, editorId, prevFeatureInfo, now }) => {
      // pickByFields 会自动把 bool 转成 boolean 并输出
      const base = pickByFields(values, FORMAT_REGISTRY['站台'].fields);
      const p0 = coords[0];

      const lines = Array.isArray(groups.lines)
        ? groups.lines.map((it: any) => ({
            ID: String(it?.ID ?? '').trim(),
            stationCode: it?.stationCode === '' || it?.stationCode === undefined ? undefined : Number(it.stationCode),
            stationDistance: it?.stationDistance === '' || it?.stationDistance === undefined ? undefined : Number(it.stationDistance),
            Avaliable: it?.Avaliable === undefined ? true : Boolean(it.Avaliable),
            Overtaking: it?.Overtaking === undefined ? false : Boolean(it.Overtaking),
            getin: it?.getin === undefined ? true : Boolean(it.getin),
            getout: it?.getout === undefined ? true : Boolean(it.getout),
            NextOT: it?.NextOT === undefined ? false : Boolean(it.NextOT),
          }))
        : [];

      const out = {
        ...base,
        coordinate: { x: p0?.x ?? 0, z: p0?.z ?? 0 },
        lines,
      };

      return withSystemFields(FORMAT_REGISTRY['站台'], out, { op, mode, worldId, editorId, prevFeatureInfo, now });
    },
    hydrate: (featureInfo) => ({
      values: {
        platformID: featureInfo?.platformID ?? '',
        platformName: featureInfo?.platformName ?? '',
        elevation: featureInfo?.elevation ?? '',

        // === 新增：默认 true（保证新建时直接满足“必填 bool”）===
        Situation: featureInfo?.Situation ?? true,
        Connect: featureInfo?.Connect ?? true,
      },
      groups: {
        lines: Array.isArray(featureInfo?.lines)
          ? featureInfo.lines.map((l: any) => ({
              ID: l?.ID ?? '',
              stationCode: l?.stationCode ?? '',
              stationDistance: l?.stationDistance ?? '',
              Avaliable: l?.Avaliable ?? true,
              Overtaking: l?.Overtaking ?? false,
              getin: l?.getin ?? true,
              getout: l?.getout ?? true,
              NextOT: l?.NextOT ?? false,
            }))
          : [],
      },
    }),
    coordsFromFeatureInfo: (featureInfo) => {
      const c = featureInfo?.coordinate;
      if (!c) return [];
      return [{ x: Number(c.x), z: Number(c.z) }].filter(p => isFiniteNum(p.x) && isFiniteNum(p.z));
    },
    validateImportItem: (item) => {
      if (!item || typeof item !== 'object') return '不是对象';
      if (!item.platformID) return '缺少 platformID';
      if (!item.platformName) return '缺少 platformName';
      if (!item.coordinate || !isFiniteNum(item.coordinate.x) || !isFiniteNum(item.coordinate.z)) return '缺少合法 coordinate.x / coordinate.z';
      if (!Array.isArray(item.lines)) return 'lines 必须是数组';
if (typeof item.Situation !== 'boolean') return '缺少或非法 Situation（boolean）';
if (typeof item.Connect !== 'boolean') return '缺少或非法 Connect（boolean）';

      return;
    },
  },

  // ===== 铁路 Line =====
  铁路: {
    key: '铁路',
    label: '铁路',
    modes: ['polyline'],
    hideTempOutput: true,
    classCode: CLASS_CODE_BY_FEATURE['铁路'],
    fields: [
      { key: 'LineID', label: '线路ID', type: 'text' },             // [必填]
      { key: 'LineName', label: '线路名', type: 'text' },           // [必填]
      { key: 'bureau', label: '路局代码', type: 'text', optional: true }, // [非必填]
      { key: 'line', label: '线路编号', type: 'text', optional: true },   // [非必填]
      { key: 'color', label: '标准色号(color)', type: 'text' },     // [必填]
      {
        key: 'direction',
        label: '方向(direction)',
        type: 'select',
        options: [0, 1, 2, 3, 4].map(v => ({ label: String(v), value: v })),
      },
      { key: 'startplf', label: '起点站台名(startplf)', type: 'text' }, // [必填]
      { key: 'endplf', label: '终点站台名(endplf)', type: 'text' },     // [必填]
    ],
    groups: [],
    buildFeatureInfo: ({ op, mode, coords, values, worldId, editorId, prevFeatureInfo, now }) => {
      const base = pickByFields(values, FORMAT_REGISTRY['铁路'].fields);
      // 新规范：y 默认 -64（若 coords 内已有 y，则保留）
      const PLpoints = coords.map(p => [p.x, (Number.isFinite(p.y as any) ? (p.y as number) : -64), p.z] as [number, number, number]);
      const out = { ...base, PLpoints };
      return withSystemFields(FORMAT_REGISTRY['铁路'], out, { op, mode, worldId, editorId, prevFeatureInfo, now });
    },
    hydrate: (featureInfo) => ({
      values: {
        LineID: featureInfo?.LineID ?? '',
        LineName: featureInfo?.LineName ?? '',
        bureau: featureInfo?.bureau ?? '',
        line: featureInfo?.line ?? '',
        color: featureInfo?.color ?? '',
        direction: featureInfo?.direction ?? 2,
        startplf: featureInfo?.startplf ?? '',
        endplf: featureInfo?.endplf ?? '',
      },
      groups: {},
    }),
    coordsFromFeatureInfo: (featureInfo) => {
      const pts = featureInfo?.PLpoints;
      if (!Array.isArray(pts)) return [];
      return pts
        .map((p: any) => {
          const x = Number(p?.[0]);
          const y = Number(p?.[1]);
          const z = Number(p?.[2]);
          return Number.isFinite(y) ? ({ x, z, y }) : ({ x, z });
        })
        .filter((p: any) => isFiniteNum(p.x) && isFiniteNum(p.z));
    },
    validateImportItem: (item) => {
      if (!item || typeof item !== 'object') return '不是对象';
      if (!item.LineID) return '缺少 LineID';
      if (!item.LineName) return '缺少 LineName';
      if (!item.color) return '缺少 color';
      if (!Array.isArray(item.PLpoints) || item.PLpoints.length < 2) return 'PLpoints 必须是数组且至少 2 点';
      return;
    },
  },

 // ===== 站台轮廓 Platform Round =====
  站台轮廓: {
    key: '站台轮廓',
    label: '站台轮廓',
    modes: ['polygon'],
    hideTempOutput: true,
    // 新 JSON：Class 建议填写“站台轮廓”（与该 subtype 名称一致）
    classCode: CLASS_CODE_BY_FEATURE['站台轮廓'],
    fields: [
      { key: 'plfRoundID', label: '站台轮廓ID(plfRoundID)', type: 'text' },          // [必填]
      { key: 'plfRoundName', label: '站台轮廓名(plfRoundName)', type: 'text' },      // [必填]
      { key: 'LineID', label: '线路ID(LineID)', type: 'text' },                     // [必填]
      { key: 'elevation', label: '高度(y)', type: 'number', optional: true },       // [非必填]
      { key: 'height', label: '高度(height)', type: 'number', optional: true },     // [非必填]
    ],
    groups: [],
    buildFeatureInfo: ({ op, mode, coords, values, worldId, editorId, prevFeatureInfo, now }) => {
      const base = pickByFields(values, FORMAT_REGISTRY['站台轮廓'].fields);

      // Flrpoints: [x,y,z]；y 若缺失按 -63
      const Flrpoints = coords.map((p) => [
        p.x,
        (Number.isFinite(p.y as any) ? (p.y as number) : -63),
        p.z,
      ] as [number, number, number]);

      const out = { ...base, Flrpoints };
      return withSystemFields(FORMAT_REGISTRY['站台轮廓'], out, { op, mode, worldId, editorId, prevFeatureInfo, now });
    },
    hydrate: (featureInfo) => ({
      values: {
        plfRoundID: featureInfo?.plfRoundID ?? '',
        plfRoundName: featureInfo?.plfRoundName ?? '',
        LineID: featureInfo?.LineID ?? '',
        elevation: featureInfo?.elevation ?? '',
        height: featureInfo?.height ?? '',
      },
      groups: {},
    }),
    coordsFromFeatureInfo: (featureInfo) => {
  const pts = featureInfo?.Flrpoints;
  if (!Array.isArray(pts)) return [];

  const out: Coord2D[] = [];
  for (const p of pts) {
    const x = Number(p?.[0]);
    const y = Number(p?.[1]);
    const z = Number(p?.[2]);

    if (!isFiniteNum(x) || !isFiniteNum(z)) continue;

    out.push({
      x,
      z,
      // y 缺失时按你规范默认 -63
      y: Number.isFinite(y) ? y : -63,
    });
  }
  return out;
},
    validateImportItem: (item) => {
      if (!item || typeof item !== 'object') return '不是对象';
      if (!item.plfRoundID) return '缺少 plfRoundID';
      if (!item.plfRoundName) return '缺少 plfRoundName';
      if (!item.LineID) return '缺少 LineID';
      if (!Array.isArray(item.Flrpoints) || item.Flrpoints.length < 3) return 'Flrpoints 必须是数组且至少 3 点';
      return;
    },
  },

  // ===== 车站建筑 Station Building =====
  车站建筑: {
    key: '车站建筑',
    label: '车站建筑',
    modes: ['polygon'],
    hideTempOutput: true,
    classCode: CLASS_CODE_BY_FEATURE['车站建筑'],
    fields: [
      { key: 'staBuildingID', label: '车站建筑ID', type: 'text' },
      { key: 'staBuildingName', label: '车站建筑名', type: 'text' },
      { key: 'elevation', label: '高度(y)', type: 'number', optional: true },
      { key: 'height', label: '建筑高度(height)', type: 'number', optional: true },
    ],
    groups: [
      {
        key: 'Floors',
        label: '包含楼层 Floors',
        addButtonText: '添加楼层条目',
        optional: true, // 新规范为 [非必填]
        fields: [
          { key: 'ID', label: '楼层ID', type: 'text', optional: true },
        ],
      },

      {
        key: 'Stations',
        label: '包含车站 Stations',
        addButtonText: '添加车站条目',
        fields: [
          { key: 'ID', label: '车站ID', type: 'text' }, 
        ],
      },
    ],
    buildFeatureInfo: ({ op, mode, coords, values, groups, worldId, editorId, prevFeatureInfo, now }) => {
      const base = pickByFields(values, FORMAT_REGISTRY['车站建筑'].fields);
      // 新规范：y 默认 -63（若 coords 内已有 y，则保留）
      const Conpoints = coords.map(p => [p.x, (Number.isFinite(p.y as any) ? (p.y as number) : -63), p.z] as [number, number, number]);

      const Floors = Array.isArray(groups.Floors)
        ? groups.Floors.map((it: any) => ({ ID: it?.ID ?? '' }))
        : [];

      const Stations = Array.isArray(groups.Stations)
        ? groups.Stations.map((it: any) => ({ ID: it?.ID ?? '' }))
        : [];

      const out = { ...base, Conpoints, Floors, Stations };
      return withSystemFields(FORMAT_REGISTRY['车站建筑'], out, { op, mode, worldId, editorId, prevFeatureInfo, now });
    },
    hydrate: (featureInfo) => ({
      values: {
        staBuildingID: featureInfo?.staBuildingID ?? '',
        staBuildingName: featureInfo?.staBuildingName ?? '',
        elevation: featureInfo?.elevation ?? '',
        height: featureInfo?.height ?? '',
      },
      groups: {
        Floors: Array.isArray(featureInfo?.Floors)
          ? featureInfo.Floors.map((f: any) => ({ ID: f?.ID ?? '' }))
          : [],

        Stations: Array.isArray(featureInfo?.Stations)
          ? featureInfo.Stations.map((s: any) => ({ ID: s?.ID ?? '' }))
          : [],
      },
    }),
    coordsFromFeatureInfo: (featureInfo) => {
      const pts = featureInfo?.Conpoints;
      if (!Array.isArray(pts)) return [];
      return pts
        .map((p: any) => {
          const x = Number(p?.[0]);
          const y = Number(p?.[1]);
          const z = Number(p?.[2]);
          return Number.isFinite(y) ? ({ x, z, y }) : ({ x, z });
        })
        .filter((p: any) => isFiniteNum(p.x) && isFiniteNum(p.z));
    },
    validateImportItem: (item) => {
      if (!item || typeof item !== 'object') return '不是对象';
      if (!item.staBuildingID) return '缺少 staBuildingID';
      if (!item.staBuildingName) return '缺少 staBuildingName';
      if (!Array.isArray(item.Conpoints) || item.Conpoints.length < 3) return 'Conpoints 必须是数组且至少 3 点';

      // Stations 可选：若提供则必须为数组
      if (item.Stations !== undefined && !Array.isArray(item.Stations)) return 'Stations 必须是数组';

      return;
    },
  },

  // ===== 车站建筑点 Station Building Point =====
  车站建筑点: {
    key: '车站建筑点',
    label: '车站建筑点',
    modes: ['point'],
    hideTempOutput: true,
    classCode: CLASS_CODE_BY_FEATURE['车站建筑点'], // SBP
    fields: [
      { key: 'stationID', label: '车站建筑点ID(stationID)', type: 'text' },   // [必填]
      { key: 'stationName', label: '车站建筑名(stationName)', type: 'text' }, // [必填]
      { key: 'elevation', label: '高度(y)', type: 'number', optional: true }, // [非必填]
    ],
    groups: [
      {
        key: 'stations',
        label: '包含站台 stations',
        addButtonText: '添加站台条目',
        optional: false, // [必填]
        minItems: 1,
        fields: [
          { key: 'ID', label: '站台ID', type: 'text' }, // [必填]
        ],
      },
    ],
    buildFeatureInfo: ({ op, mode, coords, values, groups, worldId, editorId, prevFeatureInfo, now }) => {
      const base = pickByFields(values, FORMAT_REGISTRY['车站建筑点'].fields);
      const p0 = coords[0];

      const stations = Array.isArray(groups.stations)
        ? groups.stations.map((it: any) => ({
            ID: String(it?.ID ?? '').trim(),
          }))
        : [];

      const out = {
        ...base,
        coordinate: { x: p0?.x ?? 0, z: p0?.z ?? 0 },
        stations,
      };

      return withSystemFields(FORMAT_REGISTRY['车站建筑点'], out, { op, mode, worldId, editorId, prevFeatureInfo, now });
    },
    hydrate: (featureInfo) => ({
      values: {
        stationID: featureInfo?.stationID ?? '',
        stationName: featureInfo?.stationName ?? '',
        elevation: featureInfo?.elevation ?? '',
      },
      groups: {
        stations: Array.isArray(featureInfo?.stations)
          ? featureInfo.stations.map((s: any) => ({ ID: s?.ID ?? '' }))
          : [],
      },
    }),
    coordsFromFeatureInfo: (featureInfo) => {
      const c = featureInfo?.coordinate;
      if (!c) return [];
      return [{ x: Number(c.x), z: Number(c.z) }].filter(p => isFiniteNum(p.x) && isFiniteNum(p.z));
    },
    validateImportItem: (item) => {
      if (!item || typeof item !== 'object') return '不是对象';
      if (!item.stationID) return '缺少 stationID';
      if (!item.stationName) return '缺少 stationName';
      if (!item.coordinate || !isFiniteNum(item.coordinate.x) || !isFiniteNum(item.coordinate.z)) return '缺少合法 coordinate.x / coordinate.z';
      if (!Array.isArray(item.stations)) return 'stations 必须是数组';
      return;
    },
  },

  

  // ===== 车站建筑楼层 Station Building Floor =====
  车站建筑楼层: {
    key: '车站建筑楼层',
    label: '车站建筑楼层',
    modes: ['polygon'],
    hideTempOutput: true,
    classCode: CLASS_CODE_BY_FEATURE['车站建筑楼层'],
    fields: [
      { key: 'staBFloorID', label: '楼层ID(staBFloorID)', type: 'text' },
      { key: 'staBFloorName', label: '楼层名(staBFloorName)', type: 'text' },
      { key: 'NofFloor', label: '楼层名(NofFloor)', type: 'text' },
      { key: 'elevation', label: '高度(y)', type: 'number', optional: true },
      { key: 'height', label: '层高(height)', type: 'number', optional: true },
    ],
    groups: [],
    buildFeatureInfo: ({ op, mode, coords, values, worldId, editorId, prevFeatureInfo, now }) => {
      const base = pickByFields(values, FORMAT_REGISTRY['车站建筑楼层'].fields);
      // 新规范：y 默认 -63（若 coords 内已有 y，则保留）
      const Flrpoints = coords.map(p => [p.x, (Number.isFinite(p.y as any) ? (p.y as number) : -63), p.z] as [number, number, number]);
      const out = { ...base, Flrpoints };
      return withSystemFields(FORMAT_REGISTRY['车站建筑楼层'], out, { op, mode, worldId, editorId, prevFeatureInfo, now });
    },
    hydrate: (featureInfo) => ({
      values: {
        staBFloorID: featureInfo?.staBFloorID ?? '',
        staBFloorName: featureInfo?.staBFloorName ?? '',
        NofFloor: featureInfo?.NofFloor ?? '',
        elevation: featureInfo?.elevation ?? '',
        height: featureInfo?.height ?? '',
      },
      groups: {},
    }),
    coordsFromFeatureInfo: (featureInfo) => {
      const pts = featureInfo?.Flrpoints;
      if (!Array.isArray(pts)) return [];
      return pts
        .map((p: any) => {
          const x = Number(p?.[0]);
          const y = Number(p?.[1]);
          const z = Number(p?.[2]);
          return Number.isFinite(y) ? ({ x, z, y }) : ({ x, z });
        })
        .filter((p: any) => isFiniteNum(p.x) && isFiniteNum(p.z));
    },
    validateImportItem: (item) => {
      if (!item || typeof item !== 'object') return '不是对象';
      if (!item.staBFloorID) return '缺少 staBFloorID';
      if (!item.staBFloorName) return '缺少 staBFloorName';
      if (!item.NofFloor) return '缺少 NofFloor';
      if (!Array.isArray(item.Flrpoints) || item.Flrpoints.length < 3) return 'Flrpoints 必须是数组且至少 3 点';
      return;
    },
  },


  // ===== 其余“占位型 subtype”（按默认处理，但让下拉里可选）=====
  地标: {
    key: '地标',
    label: '地标',
    modes: ['point'],
    hideTempOutput: true,
    fields: [],
    groups: [],
    buildFeatureInfo: ({ mode, coords }) => ({ subType: '地标', type: mode, coords }),
    hydrate: () => ({ values: {}, groups: {} }),
    coordsFromFeatureInfo: (fi) => (Array.isArray(fi?.coords) ? fi.coords : []),
  },
  栈道: {
    key: '栈道',
    label: '栈道',
    modes: ['polyline'],
    hideTempOutput: true,
    fields: [],
    groups: [],
    buildFeatureInfo: ({ mode, coords }) => ({ subType: '栈道', type: mode, coords }),
    hydrate: () => ({ values: {}, groups: {} }),
    coordsFromFeatureInfo: (fi) => (Array.isArray(fi?.coords) ? fi.coords : []),
  },
  航道: {
    key: '航道',
    label: '航道',
    modes: ['polyline'],
    hideTempOutput: true,
    fields: [],
    groups: [],
    buildFeatureInfo: ({ mode, coords }) => ({ subType: '航道', type: mode, coords }),
    hydrate: () => ({ values: {}, groups: {} }),
    coordsFromFeatureInfo: (fi) => (Array.isArray(fi?.coords) ? fi.coords : []),
  },
  一般建筑: {
    key: '一般建筑',
    label: '一般建筑',
    modes: ['polygon'],
    hideTempOutput: true,
    fields: [],
    groups: [],
    buildFeatureInfo: ({ mode, coords }) => ({ subType: '一般建筑', type: mode, coords }),
    hydrate: () => ({ values: {}, groups: {} }),
    coordsFromFeatureInfo: (fi) => (Array.isArray(fi?.coords) ? fi.coords : []),
  },
  车站站体: {
    key: '车站站体',
    label: '车站站体',
    modes: ['polygon'],
    hideTempOutput: true,
    fields: [],
    groups: [],
    buildFeatureInfo: ({ mode, coords }) => ({ subType: '车站站体', type: mode, coords }),
    hydrate: () => ({ values: {}, groups: {} }),
    coordsFromFeatureInfo: (fi) => (Array.isArray(fi?.coords) ? fi.coords : []),
  },
};

export const getFormatDef = (key: FeatureKey): FormatDef => {
  // FeatureKey 理论上都在 FORMAT_REGISTRY 内，但这里做兜底更稳
  return (FORMAT_REGISTRY as any)[key] ?? FORMAT_REGISTRY['默认'];
};


// 供 MeasuringModule 使用：按 drawMode 获取可选 subtype
export const getSubTypeOptions = (mode: DrawMode): FeatureKey[] => {
  return (Object.keys(FORMAT_REGISTRY) as FeatureKey[]).filter(k => FORMAT_REGISTRY[k].modes.includes(mode));
};

// 导出时坐标统一四舍五入到 0.5（不影响内存中编辑精度，仅影响输出）
const round05 = (n: number) => {
  if (!Number.isFinite(n)) return n;
  const s = n < 0 ? -1 : 1;
  const a = Math.abs(n);
  return s * (Math.round((a + Number.EPSILON) * 2) / 2);
};

const roundXZDeep = (v: any): any => {
  if (Array.isArray(v)) {
    // 常见 [x,y,z]
    if (v.length === 3 && v.every((n) => typeof n === 'number')) {
      return [round05(v[0]), v[1], round05(v[2])];
    }
    return v.map(roundXZDeep);
  }

  if (v && typeof v === 'object') {
    // 常见 {x,z}
    if (typeof v.x === 'number' && typeof v.z === 'number') {
      const out: any = { ...v };
      out.x = round05(v.x);
      out.z = round05(v.z);
      return out;
    }

    const out: any = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = roundXZDeep(val);
    }
    return out;
  }

  return v;
};


// 导出单图层 JSON（统一出口）
export const layerToJsonText = (layer: { jsonInfo?: { featureInfo: any } }): string => {
  const fi = layer.jsonInfo?.featureInfo;
  if (!fi) return '';
  return JSON.stringify([roundXZDeep(fi)], null, 2);
};

// 点线面文本坐标解析（用于导入）
export const parseCoordListFlexible = (raw: string): Coord2D[] | null => {
  const text = raw.trim();
  if (!text) return null;
  const parts = text.split(';').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;

  const out: Coord2D[] = [];
  for (const p of parts) {
    const nums = p.split(',').map(s => s.trim()).filter(Boolean);
    if (nums.length !== 2 && nums.length !== 3) return null;

    // 支持 "x,z" 或 "x,y,z"
    const x = Number(nums[0]);
    const z = nums.length === 2 ? Number(nums[1]) : Number(nums[2]);

    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;

    if (nums.length === 3) {
      const y = Number(nums[1]);
      if (!Number.isFinite(y)) return null;
      out.push({ x, z, y });
    } else {
      out.push({ x, z });
    }
  }
  return out;
};

