// src/components/mapping/featureFormats.ts

// ============================
// Tag Registry（软词典）
// - tags：轻量筛选/渲染差分（支持规则显式路径：tags.xxx）
// - extensions：仅记录信息（不参与规则/渲染差分）
//
// 设计约束（为大众贡献与维护简化）：
// 1) tags 的 value 仅允许 primitive（string/number/bool/null），避免深层结构带来导入与渲染复杂度。
// 2) registry 仅用于“推荐键/类型提示/导入轻校验”；未登记的键允许存在（通过 UI 的“其他”录入）。
// ============================

export type TagPrimitive = string | number | boolean | null;

export type TagRegistryEntry = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'bool' | 'select';
  options?: Array<{ label: string; value: string }>;
};

export const TAG_KEY_OTHER = '__other__';

export const EXT_VALUE_TYPE_TEXT = 'text' as const;
export const EXT_VALUE_TYPE_NUMBER = 'number' as const;
export const EXT_VALUE_TYPE_BOOL = 'bool' as const;
export const EXT_VALUE_TYPE_NULL = 'null' as const;

export type ExtValueType =
  | typeof EXT_VALUE_TYPE_TEXT
  | typeof EXT_VALUE_TYPE_NUMBER
  | typeof EXT_VALUE_TYPE_BOOL
  | typeof EXT_VALUE_TYPE_NULL;


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
  地物点: 'ISP',
  地物线: 'ISL',
  地物面: 'ISG',
  建筑: 'BUD',
  建筑楼层: 'FLR',
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


export const EXT_VALUE_TYPE_OPTIONS: Array<{ label: string; value: ExtValueType }> = [
  { label: '文本', value: EXT_VALUE_TYPE_TEXT },
  { label: '数字', value: EXT_VALUE_TYPE_NUMBER },
  { label: '布尔', value: EXT_VALUE_TYPE_BOOL },
  { label: '空(null)', value: EXT_VALUE_TYPE_NULL },
];

// ✅ 你可以在此处集中维护 tags 软词典（放在文件顶部便于修改）
// 说明：
// - key：tags 中的字段名
// - type：用于 UI 提示与导入轻校验（不会强制阻止未知 key）
// - options：仅当 type='select' 时使用
export const TAG_REGISTRY: Record<string, TagRegistryEntry> = {
  // 通用
  category: { key: 'category', label: '分类(category)', type: 'text' },
  level: { key: 'level', label: '等级(level)', type: 'number' },
  status: { key: 'status', label: '状态(status)', type: 'text' },
  source: { key: 'source', label: '来源(source)', type: 'text' },
};

export const TAG_KEY_OPTIONS: Array<{ label: string; value: string }> = (() => {
  const opts = Object.values(TAG_REGISTRY)
    .map((e) => ({ label: e.label, value: e.key }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));
  opts.push({ label: '其他（自定义）', value: TAG_KEY_OTHER });
  return opts;
})();

const isTagPrimitive = (v: any): v is TagPrimitive => {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
};

const coerceTagPrimitive = (key: string, raw: any): TagPrimitive | undefined => {
  if (raw === undefined) return undefined;

  // null 允许
  if (raw === null) return null;

  const def = TAG_REGISTRY[key];
  const t = def?.type;

  if (t === 'number') {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    const n = Number(String(raw).trim());
    return Number.isFinite(n) ? n : String(raw);
  }

  if (t === 'bool') {
    if (typeof raw === 'boolean') return raw;
    const s = String(raw).trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
    return String(raw);
  }

  // text/select：统一存 string（保持可读性）
  if (typeof raw === 'string') return raw;
  return String(raw);
};

const validateTagsObjectSoft = (tags: any): string | null => {
  if (tags === undefined || tags === null) return null;
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return 'tags 必须是对象';

  for (const [k, v] of Object.entries(tags)) {
    // 未登记键允许存在，但 value 必须是 primitive（避免嵌套结构）
    if (!isTagPrimitive(v)) return `tags.${k} 必须是 string/number/bool/null`;

    const def = TAG_REGISTRY[k];
    if (!def) continue;

    // 轻校验：类型不匹配时不直接阻断（仍返回错误信息以提示维护者）
    if (def.type === 'number' && typeof v !== 'number') {
      const n = Number(String(v).trim());
      if (!Number.isFinite(n)) return `tags.${k} 期望 number`;
    }
    if (def.type === 'bool' && typeof v !== 'boolean') {
      const s = String(v).trim().toLowerCase();
      if (s !== 'true' && s !== 'false') return `tags.${k} 期望 bool`;
    }
    if (def.type === 'select' && typeof v !== 'string') {
      return `tags.${k} 期望 string`;
    }
  }
  return null;
};


const validateExtensionsObjectSoft = (ext: any): string | null => {
  if (ext === undefined || ext === null) return null;
  if (!ext || typeof ext !== 'object' || Array.isArray(ext)) return 'extensions 必须是对象';

  // 允许两层：extensions.<group>.<key> = primitive
  for (const [g, v] of Object.entries(ext)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return `extensions.${g} 必须是对象`; 
    for (const [k, vv] of Object.entries(v as any)) {
      // 为了保持导入简单：仅允许 primitive（不做深层嵌套）
      if (!isTagPrimitive(vv)) return `extensions.${g}.${k} 必须是 string/number/bool/null`;
    }
  }
  return null;
};

const buildTagsFromGroupItems = (items: any[]): Record<string, TagPrimitive> => {
  const out: Record<string, TagPrimitive> = {};
  for (const it of items ?? []) {
    const keyRaw = String(it?.tagKey ?? '').trim();
    const key = keyRaw === TAG_KEY_OTHER ? String(it?.tagKeyOther ?? '').trim() : keyRaw;
    if (!key) continue;

    const rawVal = it?.tagValue;
    const sval = String(rawVal ?? '').trim();
    if (!sval && rawVal !== 0 && rawVal !== false) continue;

    const coerced = coerceTagPrimitive(key, rawVal);
    if (coerced === undefined) continue;
    out[key] = coerced;
  }
  return out;
};

const flattenTagsToGroupItems = (tags: any): any[] => {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return [];
  const out: any[] = [];
  for (const [k, v] of Object.entries(tags)) {
    if (!isTagPrimitive(v)) continue;
    // 若 tags key 不在 registry 中，为了让 UI 回显清晰：
    // - 字段名选择“其他”
    // - 其他字段名填写真实 key
    const known = Boolean(TAG_REGISTRY[k]);
    out.push({
      tagKey: known ? k : TAG_KEY_OTHER,
      tagKeyOther: known ? '' : k,
      tagValue: v === null ? 'null' : String(v),
    });
  }
  return out;
};

const buildExtensionsFromGroupItems = (items: any[]): Record<string, Record<string, TagPrimitive>> => {
  const out: Record<string, Record<string, TagPrimitive>> = {};
  for (const it of items ?? []) {
    const g = String(it?.extGroup ?? '').trim();
    const k = String(it?.extKey ?? '').trim();
    const t = (it?.extType ?? EXT_VALUE_TYPE_TEXT) as ExtValueType;
    const rawVal = it?.extValue;

    if (!g || !k) continue;

    // null 类型不要求填写值
    if (t === EXT_VALUE_TYPE_NULL) {
      (out[g] ??= {})[k] = null;
      continue;
    }

    const sval = String(rawVal ?? '').trim();
    if (!sval && rawVal !== 0 && rawVal !== false) continue;

    let coerced: TagPrimitive | undefined;
    if (t === EXT_VALUE_TYPE_NUMBER) {
      if (typeof rawVal === 'number' && Number.isFinite(rawVal)) coerced = rawVal;
      else {
        const n = Number(String(rawVal).trim());
        coerced = Number.isFinite(n) ? n : String(rawVal);
      }
    } else if (t === EXT_VALUE_TYPE_BOOL) {
      if (typeof rawVal === 'boolean') coerced = rawVal;
      else {
        const s = String(rawVal).trim().toLowerCase();
        if (s === 'true') coerced = true;
        else if (s === 'false') coerced = false;
        else coerced = String(rawVal);
      }
    } else {
      // text
      coerced = typeof rawVal === 'string' ? rawVal : String(rawVal);
    }

    if (coerced === undefined) continue;
    (out[g] ??= {})[k] = coerced;
  }
  return out;
};

const flattenExtensionsToGroupItems = (ext: any): any[] => {
  if (!ext || typeof ext !== 'object' || Array.isArray(ext)) return [];
  const out: any[] = [];
  for (const [g, v] of Object.entries(ext)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    for (const [k, vv] of Object.entries(v as any)) {
      if (!isTagPrimitive(vv)) continue;
      const extType: ExtValueType =
        vv === null ? EXT_VALUE_TYPE_NULL
        : typeof vv === 'number' ? EXT_VALUE_TYPE_NUMBER
        : typeof vv === 'boolean' ? EXT_VALUE_TYPE_BOOL
        : EXT_VALUE_TYPE_TEXT;
      out.push({
        extGroup: g,
        extKey: k,
        extType,
        // null 类型下，value 输入框可留空
        extValue: vv === null ? '' : String(vv),
      });
    }
  }
  return out;
};


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
  | '地物点'
  | '地物线'
  | '地物面'
  | '建筑'
  | '建筑楼层'


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
  | '车站建筑楼层'
  | '地物点'
  | '地物线'
  | '地物面'
  | '建筑'
  | '建筑楼层';


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

      // tags：当字段名选择“其他”时，要求填写 tagKeyOther（仅当该 group 具备对应字段时生效）
      if (g.key === 'tags' && it?.tagKey === TAG_KEY_OTHER) {
        const other = String(it?.tagKeyOther ?? '').trim();
        if (!other) return false;
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

      // tags：当字段名选择“其他”时，要求填写 tagKeyOther（仅当该 group 具备对应字段时生效）
      if (g.key === 'tags' && it?.tagKey === TAG_KEY_OTHER) {
        const other = String(it?.tagKeyOther ?? '').trim();
        if (!other) {
          missing.push({
            kind: 'groupItemField',
            groupKey: g.key,
            groupLabel: g.label,
            index: idx,
            key: 'tagKeyOther',
            label: '其他字段名(tagKeyOther)',
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

  // ---- 兼容旧规范：STA 允许缺省 STBuilding（但若显式提供且为空，则仍视为缺失）----
  const legacyAllowMissingSTBuilding =
    def.classCode === 'STA' &&
    item &&
    typeof item === 'object' &&
    !('STBuilding' in item) &&
    !('StBuilding' in item) &&
    !('stBuilding' in item) &&
    !('stationBuilding' in item) &&
    !('stationBuildingId' in item);

  if (legacyAllowMissingSTBuilding) {
    for (let i = missing.length - 1; i >= 0; i--) {
      const m = missing[i];
      if (m.kind === 'field' && m.key === 'STBuilding') missing.splice(i, 1);
    }
  }


  // ---- 兼容旧规范：STF 允许缺省 staBuildingID（但若显式提供且为空，则仍视为缺失）----
  const legacyAllowMissingStaBuildingID =
    def.classCode === 'STF' &&
    item &&
    typeof item === 'object' &&
    !('staBuildingID' in item) &&
    !('staBuildingId' in item) &&
    !('STBuilding' in item) &&
    !('BuildingID' in item);

  if (legacyAllowMissingStaBuildingID) {
    for (let i = missing.length - 1; i >= 0; i--) {
      const m = missing[i];
      if (m.kind === 'field' && m.key === 'staBuildingID') missing.splice(i, 1);
    }
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
      { key: 'STBuilding', label: '车站所属车站建体(STBuilding)', type: 'text' }, // [必填]（过渡期：导入允许缺省）
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
        // 新规范：车站归属车站建体（STB/SBP 的 ID）。兼容旧字段/缺失。
        STBuilding:
          featureInfo?.STBuilding ??
          featureInfo?.StBuilding ??
          featureInfo?.stBuilding ??
          featureInfo?.stationBuilding ??
          featureInfo?.stationBuildingId ??
          '',
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
          { key: 'Group', label: '分组(Group)', type: 'text', optional: true },
        ],
      },
    ],
    buildFeatureInfo: ({ op, mode, coords, values, groups, worldId, editorId, prevFeatureInfo, now }) => {
      const base = pickByFields(values, FORMAT_REGISTRY['车站建筑'].fields);
      // 新规范：y 默认 -63（若 coords 内已有 y，则保留）
      const Conpoints = coords.map(p => [p.x, (Number.isFinite(p.y as any) ? (p.y as number) : -63), p.z] as [number, number, number]);

      const Floors = Array.isArray(groups.Floors)
        ? groups.Floors.map((it: any) => {
            const ID = String(it?.ID ?? '').trim();
            const Group = String(it?.Group ?? '').trim();
            const o: any = { ID };
            if (Group) o.Group = Group;
            return o;
          })
        : [];

      // 注意：STB 不再包含 Stations 分组（STA -> STB 的归属已改为 STA.STBuilding 单向指向）
      const out = { ...base, Conpoints, Floors };
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
          ? featureInfo.Floors.map((f: any) => ({
              ID: f?.ID ?? '',
              Group: f?.Group ?? '',
            }))
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
      { key: 'staBuildingPointID', label: '车站建筑点ID(staBuildingPointID)', type: 'text' },   // [必填]
      { key: 'staBuildingPointName', label: '车站建筑名(staBuildingPointName)', type: 'text' }, // [必填]
      { key: 'elevation', label: '高度(y)', type: 'number', optional: true }, // [非必填]
    ],
    groups: [

{
  key: 'Floors',
  label: '包含楼层 Floors',
  addButtonText: '添加楼层条目',
  optional: true, // [非必填]
  fields: [
    { key: 'ID', label: '楼层ID', type: 'text' },
    { key: 'Group', label: '分组(Group)', type: 'text', optional: true },
  ],
},

      {
        key: 'stations',
        label: '包含站台 stations',
        addButtonText: '添加站台条目',
        optional: false, // [必填]
        minItems: 1,
        fields: [
          { key: 'ID', label: '车站ID', type: 'text' }, // [必填]
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

      const Floors = Array.isArray(groups.Floors)
        ? groups.Floors.map((it: any) => {
            const ID = String(it?.ID ?? '').trim();
            const Group = String(it?.Group ?? '').trim();
            const o: any = { ID };
            if (Group) o.Group = Group;
            return o;
          })
        : [];

      const out: any = {
        ...base,
        coordinate: { x: p0?.x ?? 0, z: p0?.z ?? 0 },
        stations,
      };

      // Floors 为可选：仅在存在条目时输出
      if (Floors.length) out.Floors = Floors;

      return withSystemFields(FORMAT_REGISTRY['车站建筑点'], out, { op, mode, worldId, editorId, prevFeatureInfo, now });
    },
    hydrate: (featureInfo) => ({
      values: {
        // 兼容过渡期字段名：stationID/stationName（旧）→ staBuildingPointID/staBuildingPointName（新）
        staBuildingPointID: featureInfo?.staBuildingPointID ?? featureInfo?.staBuildingPointId ?? featureInfo?.stationID ?? featureInfo?.stationId ?? featureInfo?.staBuildingID ?? featureInfo?.staBuildingId ?? '',
        staBuildingPointName: featureInfo?.staBuildingPointName ?? featureInfo?.stationName ?? featureInfo?.staBuildingName ?? '',
        elevation: featureInfo?.elevation ?? '',
      },
      groups: {
        Floors: Array.isArray(featureInfo?.Floors)
          ? featureInfo.Floors.map((f: any) => ({
              ID: f?.ID ?? '',
              Group: f?.Group ?? '',
            }))
          : (Array.isArray(featureInfo?.floors)
            ? featureInfo.floors.map((f: any) => ({
                ID: f?.ID ?? f?.id ?? '',
                Group: f?.Group ?? f?.group ?? '',
              }))
            : []),

        stations: Array.isArray(featureInfo?.stations)
          ? featureInfo.stations.map((s: any) => ({ ID: s?.ID ?? s?.id ?? '' }))
          : (Array.isArray(featureInfo?.Stations)
            ? featureInfo.Stations.map((s: any) => ({ ID: s?.ID ?? s?.id ?? '' }))
            : []),
      },
    }),
    coordsFromFeatureInfo: (featureInfo) => {
      const c = featureInfo?.coordinate;
      if (!c) return [];
      return [{ x: Number(c.x), z: Number(c.z) }].filter(p => isFiniteNum(p.x) && isFiniteNum(p.z));
    },
    validateImportItem: (item) => {
      if (!item || typeof item !== 'object') return '不是对象';
 
      const id = String((item as any).staBuildingPointID ?? (item as any).staBuildingPointId ?? (item as any).stationID ?? (item as any).stationId ?? (item as any).staBuildingID ?? (item as any).staBuildingId ?? '').trim();
      if (!id) return '缺少 staBuildingPointID';

      const name = String((item as any).staBuildingPointName ?? (item as any).stationName ?? (item as any).staBuildingName ?? '').trim();
      if (!name) return '缺少 staBuildingPointName';

      if (!item.coordinate || !isFiniteNum((item as any).coordinate.x) || !isFiniteNum((item as any).coordinate.z)) return '缺少合法 coordinate.x / coordinate.z';

      const sts = (item as any).stations ?? (item as any).Stations;
      if (!Array.isArray(sts)) return 'stations 必须是数组';

      const fls = (item as any).Floors ?? (item as any).floors;
      if (fls !== undefined && !Array.isArray(fls)) return 'Floors 必须是数组';
      
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
      { key: 'staBuildingID', label: '所属车站建筑(staBuildingID)', type: 'text' },
      { key: 'Situation', label: '状态(Situation)', type: 'text', optional: true },
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
        // 兼容旧字段：FloorID/FloorName 等
        staBFloorID: featureInfo?.staBFloorID ?? featureInfo?.FloorID ?? featureInfo?.floorID ?? '',
        staBFloorName: featureInfo?.staBFloorName ?? featureInfo?.FloorName ?? featureInfo?.floorName ?? '',
        NofFloor: featureInfo?.NofFloor ?? '',
        staBuildingID: featureInfo?.staBuildingID ?? featureInfo?.staBuildingId ?? featureInfo?.STBuilding ?? featureInfo?.BuildingID ?? '',
        Situation: featureInfo?.Situation ?? '',
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
      const id = String((item as any).staBFloorID ?? (item as any).FloorID ?? (item as any).floorID ?? '').trim();
      if (!id) return '缺少 staBFloorID';

      const name = String((item as any).staBFloorName ?? (item as any).FloorName ?? (item as any).floorName ?? '').trim();
      if (!name) return '缺少 staBFloorName';

      if (!String((item as any).NofFloor ?? '').trim()) return '缺少 NofFloor';

      // 兼容旧 STF：允许缺省 staBuildingID（新建/编辑会在必填校验中要求）
      if (!Array.isArray((item as any).Flrpoints) || (item as any).Flrpoints.length < 3) return 'Flrpoints 必须是数组且至少 3 点';
      return;
    },
  },

// ===== 地物点 / 线 / 面 & 建筑 / 建筑楼层（新增） =====
地物点: {
  key: '地物点',
  label: '地物点',
  modes: ['point'],
  hideTempOutput: true,
  classCode: CLASS_CODE_BY_FEATURE['地物点'], // ISP
  fields: [
    { key: 'PointID', label: '要素点ID(PointID)', type: 'text' },
    { key: 'PointName', label: '要素点名(PointName)', type: 'text' },

    // 仍保留为“硬字段”（便于大众贡献者理解）；同时会自动镜像到 tags 中，供 rules 使用
    { key: 'PointKind', label: '要素类型(PointKind)', type: 'text' },
    { key: 'PointSKind', label: '要素子类型(PointSKind)', type: 'text' },
    { key: 'PointSKind2', label: '要素三级子类型(PointSKind2)', type: 'text', optional: true },

    { key: 'Situation', label: '状态(Situation)', type: 'text', optional: true },
    { key: 'elevation', label: '高度(y)', type: 'number', optional: true },
  ],
  groups: [
    {
      key: 'tags',
      label: 'tags（可选：用于筛选/渲染差分）',
      optional: true,
      addButtonText: '添加 tag',
      fields: [
        { key: 'tagKey', label: '字段名', type: 'select', options: TAG_KEY_OPTIONS },
        { key: 'tagKeyOther', label: '其他字段名（当字段名=其他时填写）', type: 'text', optional: true },
        { key: 'tagValue', label: '值', type: 'text' },
      ],
    },
    {
      key: 'extensions',
      label: 'extensions（可选：仅记录信息，不参与规则）',
      optional: true,
      addButtonText: '添加扩展',
      fields: [
        { key: 'extGroup', label: '组/命名空间(extGroup)', type: 'text' },
        { key: 'extKey', label: '字段名(extKey)', type: 'text' },
        { key: 'extType', label: '值类型', type: 'select', options: EXT_VALUE_TYPE_OPTIONS, defaultValue: EXT_VALUE_TYPE_TEXT },
        { key: 'extValue', label: '值(extValue)', type: 'text' },
      ],
    },
  ],
  buildFeatureInfo: ({ op, mode, coords, values, groups, worldId, editorId, prevFeatureInfo, now }) => {
    const base = pickByFields(values, FORMAT_REGISTRY['地物点'].fields);
    const p0 = coords[0];

    // tags 仅记录“用户显式添加”的轻量字段；不自动把主干字段镜像到 tags
    // （避免出现用户删 registry 后仍被强行写入 tags 的情况，且保持导入/编辑语义清晰）
    const tags = buildTagsFromGroupItems(groups?.tags);

    const extensions = buildExtensionsFromGroupItems(groups?.extensions);

    const out: any = {
      ...base,
      coordinate: { x: p0?.x ?? 0, z: p0?.z ?? 0 },
    };
    if (Object.keys(tags).length > 0) out.tags = tags;
    if (Object.keys(extensions).length > 0) out.extensions = extensions;

    return withSystemFields(FORMAT_REGISTRY['地物点'], out, { op, mode, worldId, editorId, prevFeatureInfo, now });
  },
  hydrate: (featureInfo) => ({
    values: {
      PointID: featureInfo?.PointID ?? '',
      PointName: featureInfo?.PointName ?? '',
      PointKind: featureInfo?.PointKind ?? featureInfo?.tags?.PointKind ?? '',
      PointSKind: featureInfo?.PointSKind ?? featureInfo?.tags?.PointSKind ?? '',
      PointSKind2: featureInfo?.PointSKind2 ?? featureInfo?.tags?.PointSKind2 ?? '',
      Situation: featureInfo?.Situation ?? featureInfo?.tags?.Situation ?? '',
      elevation: featureInfo?.elevation ?? '',
    },
    groups: {
      tags: flattenTagsToGroupItems(featureInfo?.tags),
      extensions: flattenExtensionsToGroupItems(featureInfo?.extensions),
    },
  }),
  coordsFromFeatureInfo: (featureInfo) => {
    const c = featureInfo?.coordinate;
    if (!c) return [];
    return [{ x: Number(c.x), z: Number(c.z) }].filter(p => isFiniteNum(p.x) && isFiniteNum(p.z));
  },
  validateImportItem: (item) => {
    if (!item || typeof item !== 'object') return '不是对象';
    if (!String((item as any).PointID ?? '').trim()) return '缺少 PointID';
    if (!String((item as any).PointName ?? '').trim()) return '缺少 PointName';
    if (!String((item as any).PointKind ?? '').trim() && !String((item as any)?.tags?.PointKind ?? '').trim()) return '缺少 PointKind（或 tags.PointKind）';
    if (!String((item as any).PointSKind ?? '').trim() && !String((item as any)?.tags?.PointSKind ?? '').trim()) return '缺少 PointSKind（或 tags.PointSKind）';
    if (!item.coordinate || !isFiniteNum((item as any).coordinate.x) || !isFiniteNum((item as any).coordinate.z)) return '缺少合法 coordinate.x / coordinate.z';

    const terr = validateTagsObjectSoft((item as any).tags);
    if (terr) return terr;
    const eerr = validateExtensionsObjectSoft((item as any).extensions);
    if (eerr) return eerr;
    return;
  },
},

地物线: {
  key: '地物线',
  label: '地物线',
  modes: ['polyline'],
  hideTempOutput: true,
  classCode: CLASS_CODE_BY_FEATURE['地物线'], // ISL
  fields: [
    { key: 'PLineID', label: '线要素ID(PLineID)', type: 'text' },
    { key: 'PLineName', label: '线要素名(PLineName)', type: 'text' },

    { key: 'PLineKind', label: '线要素类型(PLineKind)', type: 'text' },
    { key: 'PLineSKind', label: '线要素子类型(PLineSKind)', type: 'text' },
    { key: 'PLineSKind2', label: '线要素三级子类型(PLineSKind2)', type: 'text', optional: true },

    { key: 'Situation', label: '状态(Situation)', type: 'text', optional: true },
  ],
  groups: [
    {
      key: 'tags',
      label: 'tags（可选：用于筛选/渲染差分）',
      optional: true,
      addButtonText: '添加 tag',
      fields: [
        { key: 'tagKey', label: '字段名', type: 'select', options: TAG_KEY_OPTIONS },
        { key: 'tagKeyOther', label: '其他字段名（当字段名=其他时填写）', type: 'text', optional: true },
        { key: 'tagValue', label: '值', type: 'text' },
      ],
    },
    {
      key: 'extensions',
      label: 'extensions（可选：仅记录信息，不参与规则）',
      optional: true,
      addButtonText: '添加扩展',
      fields: [
        { key: 'extGroup', label: '组/命名空间(extGroup)', type: 'text' },
        { key: 'extKey', label: '字段名(extKey)', type: 'text' },
        { key: 'extType', label: '值类型', type: 'select', options: EXT_VALUE_TYPE_OPTIONS, defaultValue: EXT_VALUE_TYPE_TEXT },
        { key: 'extValue', label: '值(extValue)', type: 'text' },
      ],
    },
  ],
  buildFeatureInfo: ({ op, mode, coords, values, groups, worldId, editorId, prevFeatureInfo, now }) => {
    const base = pickByFields(values, FORMAT_REGISTRY['地物线'].fields);
    const Linepoints = coords.map(p => [p.x, (Number.isFinite(p.y as any) ? (p.y as number) : -64), p.z] as [number, number, number]);

    // tags 仅记录“用户显式添加”的轻量字段；不自动把主干字段镜像到 tags
    const tags = buildTagsFromGroupItems(groups?.tags);
    const extensions = buildExtensionsFromGroupItems(groups?.extensions);

    const out: any = { ...base, Linepoints };
    if (Object.keys(tags).length > 0) out.tags = tags;
    if (Object.keys(extensions).length > 0) out.extensions = extensions;

    return withSystemFields(FORMAT_REGISTRY['地物线'], out, { op, mode, worldId, editorId, prevFeatureInfo, now });
  },
  hydrate: (featureInfo) => ({
    values: {
      PLineID: featureInfo?.PLineID ?? '',
      PLineName: featureInfo?.PLineName ?? '',
      PLineKind: featureInfo?.PLineKind ?? featureInfo?.tags?.PLineKind ?? '',
      PLineSKind: featureInfo?.PLineSKind ?? featureInfo?.tags?.PLineSKind ?? '',
      PLineSKind2: featureInfo?.PLineSKind2 ?? featureInfo?.tags?.PLineSKind2 ?? '',
      Situation: featureInfo?.Situation ?? featureInfo?.tags?.Situation ?? '',
    },
    groups: {
      tags: flattenTagsToGroupItems(featureInfo?.tags),
      extensions: flattenExtensionsToGroupItems(featureInfo?.extensions),
    },
  }),
  coordsFromFeatureInfo: (featureInfo) => {
    const pts = featureInfo?.Linepoints;
    if (!Array.isArray(pts)) return [];
    const out: Coord2D[] = [];
    for (const p of pts) {
      const x = Number(p?.[0]);
      const y = Number(p?.[1]);
      const z = Number(p?.[2]);
      if (!isFiniteNum(x) || !isFiniteNum(z)) continue;
      out.push({ x, z, y: Number.isFinite(y) ? y : -64 });
    }
    return out;
  },
  validateImportItem: (item) => {
    if (!item || typeof item !== 'object') return '不是对象';
    if (!String((item as any).PLineID ?? '').trim()) return '缺少 PLineID';
    if (!String((item as any).PLineName ?? '').trim()) return '缺少 PLineName';
    if (!String((item as any).PLineKind ?? '').trim() && !String((item as any)?.tags?.PLineKind ?? '').trim()) return '缺少 PLineKind（或 tags.PLineKind）';
    if (!String((item as any).PLineSKind ?? '').trim() && !String((item as any)?.tags?.PLineSKind ?? '').trim()) return '缺少 PLineSKind（或 tags.PLineSKind）';
    if (!Array.isArray((item as any).Linepoints) || (item as any).Linepoints.length < 2) return 'Linepoints 必须是数组且至少 2 点';

    const terr = validateTagsObjectSoft((item as any).tags);
    if (terr) return terr;
    const eerr = validateExtensionsObjectSoft((item as any).extensions);
    if (eerr) return eerr;
    return;
  },
},

地物面: {
  key: '地物面',
  label: '地物面',
  modes: ['polygon'],
  hideTempOutput: true,
  classCode: CLASS_CODE_BY_FEATURE['地物面'], // ISG
  fields: [
    { key: 'PGonID', label: '地物面ID(PGonID)', type: 'text' },
    { key: 'PGonName', label: '地物面名(PGonName)', type: 'text' },

    { key: 'PGonKind', label: '地物面类型(PGonKind)', type: 'text' },
    { key: 'PGonSKind', label: '地物面子类型(PGonSKind)', type: 'text' },
    { key: 'PGonSKind2', label: '地物面三级子类型(PGonSKind2)', type: 'text', optional: true },

    { key: 'Situation', label: '状态(Situation)', type: 'text', optional: true },
  ],
  groups: [
    {
      key: 'tags',
      label: 'tags（可选：用于筛选/渲染差分）',
      optional: true,
      addButtonText: '添加 tag',
      fields: [
        { key: 'tagKey', label: '字段名', type: 'select', options: TAG_KEY_OPTIONS },
        { key: 'tagKeyOther', label: '其他字段名（当字段名=其他时填写）', type: 'text', optional: true },
        { key: 'tagValue', label: '值', type: 'text' },
      ],
    },
    {
      key: 'extensions',
      label: 'extensions（可选：仅记录信息，不参与规则）',
      optional: true,
      addButtonText: '添加扩展',
      fields: [
        { key: 'extGroup', label: '组/命名空间(extGroup)', type: 'text' },
        { key: 'extKey', label: '字段名(extKey)', type: 'text' },
        { key: 'extType', label: '值类型', type: 'select', options: EXT_VALUE_TYPE_OPTIONS, defaultValue: EXT_VALUE_TYPE_TEXT },
        { key: 'extValue', label: '值(extValue)', type: 'text' },
      ],
    },
  ],
  buildFeatureInfo: ({ op, mode, coords, values, groups, worldId, editorId, prevFeatureInfo, now }) => {
    const base = pickByFields(values, FORMAT_REGISTRY['地物面'].fields);
    const Conpoints = coords.map(p => [p.x, (Number.isFinite(p.y as any) ? (p.y as number) : -63), p.z] as [number, number, number]);

    // tags 仅记录“用户显式添加”的轻量字段；不自动把主干字段镜像到 tags
    const tags = buildTagsFromGroupItems(groups?.tags);
    const extensions = buildExtensionsFromGroupItems(groups?.extensions);

    const out: any = { ...base, Conpoints };
    if (Object.keys(tags).length > 0) out.tags = tags;
    if (Object.keys(extensions).length > 0) out.extensions = extensions;

    return withSystemFields(FORMAT_REGISTRY['地物面'], out, { op, mode, worldId, editorId, prevFeatureInfo, now });
  },
  hydrate: (featureInfo) => ({
    values: {
      PGonID: featureInfo?.PGonID ?? '',
      PGonName: featureInfo?.PGonName ?? '',
      PGonKind: featureInfo?.PGonKind ?? featureInfo?.tags?.PGonKind ?? '',
      PGonSKind: featureInfo?.PGonSKind ?? featureInfo?.tags?.PGonSKind ?? '',
      PGonSKind2: featureInfo?.PGonSKind2 ?? featureInfo?.tags?.PGonSKind2 ?? '',
      Situation: featureInfo?.Situation ?? featureInfo?.tags?.Situation ?? '',
    },
    groups: {
      tags: flattenTagsToGroupItems(featureInfo?.tags),
      extensions: flattenExtensionsToGroupItems(featureInfo?.extensions),
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
    if (!String((item as any).PGonID ?? '').trim()) return '缺少 PGonID';
    if (!String((item as any).PGonName ?? '').trim()) return '缺少 PGonName';
    if (!String((item as any).PGonKind ?? '').trim() && !String((item as any)?.tags?.PGonKind ?? '').trim()) return '缺少 PGonKind（或 tags.PGonKind）';
    if (!String((item as any).PGonSKind ?? '').trim() && !String((item as any)?.tags?.PGonSKind ?? '').trim()) return '缺少 PGonSKind（或 tags.PGonSKind）';
    if (!Array.isArray((item as any).Conpoints) || (item as any).Conpoints.length < 3) return 'Conpoints 必须是数组且至少 3 点';

    const terr = validateTagsObjectSoft((item as any).tags);
    if (terr) return terr;
    const eerr = validateExtensionsObjectSoft((item as any).extensions);
    if (eerr) return eerr;
    return;
  },
},

建筑: {
  key: '建筑',
  label: '建筑',
  modes: ['polygon'],
  hideTempOutput: true,
  classCode: CLASS_CODE_BY_FEATURE['建筑'], // BUD
  fields: [
    { key: 'BuildingID', label: '建筑ID(BuildingID)', type: 'text' },
    { key: 'BuildingName', label: '建筑名(BuildingName)', type: 'text' },
    { key: 'BuildingKind', label: '建筑类型(BuildingKind)', type: 'text' },
    { key: 'BuildingSKind', label: '建筑子类型(BuildingSKind)', type: 'text' },
    { key: 'Situation', label: '状态(Situation)', type: 'text', optional: true },
    { key: 'elevation', label: '高度(y)', type: 'number', optional: true },
    { key: 'height', label: '高度(height)', type: 'number', optional: true },
  ],
  groups: [],
  buildFeatureInfo: ({ op, mode, coords, values, worldId, editorId, prevFeatureInfo, now }) => {
    const base = pickByFields(values, FORMAT_REGISTRY['建筑'].fields);
    const Conpoints = coords.map(p => [p.x, (Number.isFinite(p.y as any) ? (p.y as number) : -63), p.z] as [number, number, number]);
    const out = { ...base, Conpoints };
    return withSystemFields(FORMAT_REGISTRY['建筑'], out, { op, mode, worldId, editorId, prevFeatureInfo, now });
  },
  hydrate: (featureInfo) => ({
    values: {
      BuildingID: featureInfo?.BuildingID ?? '',
      BuildingName: featureInfo?.BuildingName ?? '',
      BuildingKind: featureInfo?.BuildingKind ?? '',
      BuildingSKind: featureInfo?.BuildingSKind ?? '',
      Situation: featureInfo?.Situation ?? '',
      elevation: featureInfo?.elevation ?? '',
      height: featureInfo?.height ?? '',
    },
    groups: {},
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
    if (!String((item as any).BuildingID ?? '').trim()) return '缺少 BuildingID';
    if (!String((item as any).BuildingName ?? '').trim()) return '缺少 BuildingName';
    if (!String((item as any).BuildingKind ?? '').trim()) return '缺少 BuildingKind';
    if (!String((item as any).BuildingSKind ?? '').trim()) return '缺少 BuildingSKind';
    if (!Array.isArray((item as any).Conpoints) || (item as any).Conpoints.length < 3) return 'Conpoints 必须是数组且至少 3 点';
    return;
  },
},

建筑楼层: {
  key: '建筑楼层',
  label: '建筑楼层',
  modes: ['polygon'],
  hideTempOutput: true,
  classCode: CLASS_CODE_BY_FEATURE['建筑楼层'], // FLR
  fields: [
    { key: 'FloorID', label: '楼层ID(FloorID)', type: 'text' },
    { key: 'FloorName', label: '楼层名(FloorName)', type: 'text' },
    { key: 'NofFloor', label: '楼层名(NofFloor)', type: 'text' },
    { key: 'FloorKind', label: '楼层类型(FloorKind)', type: 'text' },
    { key: 'FloorSKind', label: '楼层子类型(FloorSKind)', type: 'text' },
    { key: 'BuildingID', label: '所属建筑(BuildingID)', type: 'text' },
    { key: 'Situation', label: '状态(Situation)', type: 'text', optional: true },
    { key: 'elevation', label: '高度(y)', type: 'number', optional: true },
    { key: 'height', label: '高度(height)', type: 'number', optional: true },
  ],
  groups: [],
  buildFeatureInfo: ({ op, mode, coords, values, worldId, editorId, prevFeatureInfo, now }) => {
    const base = pickByFields(values, FORMAT_REGISTRY['建筑楼层'].fields);
    const Flrpoints = coords.map(p => [p.x, (Number.isFinite(p.y as any) ? (p.y as number) : -63), p.z] as [number, number, number]);
    const out = { ...base, Flrpoints };
    return withSystemFields(FORMAT_REGISTRY['建筑楼层'], out, { op, mode, worldId, editorId, prevFeatureInfo, now });
  },
  hydrate: (featureInfo) => ({
    values: {
      FloorID: featureInfo?.FloorID ?? '',
      FloorName: featureInfo?.FloorName ?? '',
      NofFloor: featureInfo?.NofFloor ?? '',
      FloorKind: featureInfo?.FloorKind ?? '',
      FloorSKind: featureInfo?.FloorSKind ?? '',
      BuildingID: featureInfo?.BuildingID ?? '',
      Situation: featureInfo?.Situation ?? '',
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
    if (!String((item as any).FloorID ?? '').trim()) return '缺少 FloorID';
    if (!String((item as any).FloorName ?? '').trim()) return '缺少 FloorName';
    if (!String((item as any).NofFloor ?? '').trim()) return '缺少 NofFloor';
    if (!String((item as any).FloorKind ?? '').trim()) return '缺少 FloorKind';
    if (!String((item as any).FloorSKind ?? '').trim()) return '缺少 FloorSKind';
    if (!String((item as any).BuildingID ?? '').trim()) return '缺少 BuildingID';
    if (!Array.isArray((item as any).Flrpoints) || (item as any).Flrpoints.length < 3) return 'Flrpoints 必须是数组且至少 3 点';
    return;
  },
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

