import type * as L from 'leaflet';
import type { FeatureStore } from './featureStore';

// ------------------------------
// 基础类型
// ------------------------------

export type GeoType = 'Points' | 'Polyline' | 'Polygon';

export type ZoomLevel = number;

export type FloorViewConfig = {
  minLevel: ZoomLevel;
  buildingClass: string;
  floorClass: string;
  buildingFloorRefField: string;
  /** STF 上的唯一引用字段，用于与 STB.Floors[] 的引用值匹配（通常是 staBFloorID） */
  floorRefTargetField: string;
  /** UI / 规则选择用的楼层字段（你需要 NofFloor 就填 NofFloor） */
  floorSelectorField: string;
};

/** 楼层视角配置（UI 逻辑仍需要：何时出现楼层条/要识别哪些 Class） */
export const DEFAULT_FLOOR_VIEW: FloorViewConfig = {
  minLevel: 5,
  buildingClass: 'STB',
  floorClass: 'STF',
  buildingFloorRefField: 'ID',
  floorRefTargetField: 'staBFloorID',
  floorSelectorField: 'NofFloor',
};

export type RenderContext = {
  worldId: string;
  leafletZoom: number;
  zoomLevel: ZoomLevel;
  inFloorView: boolean;

  /** 当前激活建筑 uid（楼层视角使用） */
  activeBuildingUid: string | null;

  /** 当前选中楼层（使用 floorSelectorField，例如 NofFloor 值） */
  activeFloorSelector: string | null;

  /** 当前激活建筑的楼层引用集合（以 floorRefTargetField 的值匹配） */
  activeBuildingFloorRefSet: Set<string> | null;
};

export type LabelPlan = {
  enabled: boolean;
  textFrom?: string | ((r: FeatureRecord, ctx: RenderContext, store: FeatureStore) => string);
  placement: 'center' | 'near';
  minLevel?: ZoomLevel;

  /** 可选：label 垂直上移（px），用于点位 label 更靠上 */
  offsetY?: number;

  /** 如果你已实现“中心点+label”，这里可保留 */
  withDot?: boolean;
};



export type PointSymbolPlan =
  | {
      kind: 'circle';
      radius?: number;
      style?: L.PathOptions;
    }
  | {
      kind: 'icon';
      iconUrl?: string;
      iconUrlFrom?: string;
      iconSize?: [number, number];
      iconAnchor?: [number, number];
    };

export type SymbolPlan = {
  /** Path（线/面）样式 */
  pathStyle?: L.PathOptions | ((r: FeatureRecord, ctx: RenderContext, store: FeatureStore) => L.PathOptions);
  /** 点样式 */
  point?: PointSymbolPlan | ((r: FeatureRecord, ctx: RenderContext, store: FeatureStore) => PointSymbolPlan);
  /** label */
  label?: LabelPlan;
};

export type RuleMatch = {
  Class?: string;
  Type?: GeoType;
};

export type RenderRule = {
  /** 规则名（仅用于你维护阅读） */
  name: string;
  match: RuleMatch;
  /** zoomLevel 范围（包含） */
  zoom?: [ZoomLevel, ZoomLevel];

  /**
   * 可读性优先：声明式存在性条件
   * - 若同 idValue 的目标类存在，则隐藏当前要素（用于“若存在则不渲染”）
   */
  hideIfSameIdExistsInClasses?: string[];

  /** 自定义可见性（满足你复杂逻辑时使用） */
  visible?: (r: FeatureRecord, ctx: RenderContext, store: FeatureStore) => boolean;

  /** 输出符号方案 */
  symbol: SymbolPlan;
};

// ------------------------------
// signature/meta
// ------------------------------

export type SignatureEntry = {
  uid: string;
  signatureKey: string;
  sig: Record<string, any>;
  groups: Record<string, any>;
  source?: string;
};

export type FeatureMeta = {
  Class: string;
  Type: GeoType;
  World?: number | string;

  /** 用于“Class+xxxID 重复排查”的 id 字段 */
  idField: string;
  idValue: string;

  /** signature：除坐标以外的属性（可读性优先） */
  sig: Record<string, any>;
  signatureKey: string;

  /** groupinformation：把数组/对象类字段放这里（例如 Lines/Stations/Floors） */
  groups: Record<string, any>;

  /** 调试：来自哪个文件 */
  source?: string;
};

export type FeatureRecord = {
  /** 稳定唯一 uid：用于渲染缓存 key（避免因为 Class+ID 重复导致覆盖） */
  uid: string;

  meta: FeatureMeta;
  featureInfo: any;

  /** 几何类型 */
  type: GeoType;

  /** world 坐标（用于点） */
  p3?: { x: number; y: number; z: number };

  /** world 坐标数组（用于线/面） */
  coords3?: Array<{ x: number; y: number; z: number }>;
};

function isPlainObject(x: any): x is Record<string, any> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function stableStringify(obj: any): string {
  const seen = new WeakSet();
  const rec = (o: any): any => {
    if (o === null || o === undefined) return o;
    if (typeof o !== 'object') return o;
    if (seen.has(o)) return '[Circular]';
    seen.add(o);
    if (Array.isArray(o)) return o.map(rec);
    const keys = Object.keys(o).sort();
    const out: Record<string, any> = {};
    for (const k of keys) out[k] = rec(o[k]);
    return out;
  };
  return JSON.stringify(rec(obj));
}

function pickIdFieldValue(featureInfo: any, cls: string): { idField: string; idValue: string } {
  const tryField = (field: string): string | null => {
    const v = (featureInfo as any)?.[field];
    const s = String(v ?? '').trim();
    return s ? s : null;
  };

  const candidates: string[] = [];

  // 常见约定优先
  if (cls === 'STB') candidates.push('staBuildingID');
  if (cls === 'STF') candidates.push('staBFloorID');
  if (cls === 'PLF') candidates.push('platformID');
  if (cls === 'PFB') candidates.push('plfRoundID', 'platformID');
  if (cls === 'STA') candidates.push('stationID');
  if (cls === 'RLE') candidates.push('LineID', 'lineID');

  // 再兜底
  candidates.push('ID', `${cls}ID`, `${cls.toLowerCase()}ID`, 'name', 'staName');

  for (const f of candidates) {
    const v = tryField(f);
    if (v) return { idField: f, idValue: v };
  }
  return { idField: 'UNKNOWN', idValue: '' };
}

export function buildFeatureMeta(featureInfo: any, cls: string, type: GeoType, source?: string): FeatureMeta {
  const { idField, idValue } = pickIdFieldValue(featureInfo, cls);

  const sig: Record<string, any> = {};
  const groups: Record<string, any> = {};

  // 你所说的“除了坐标以外的所有属性信息” → sig；数组/对象 → groups
  for (const [k, v] of Object.entries(featureInfo ?? {})) {
    // 坐标字段排除
    if (k === 'Conpoints' || k === 'Flrpoints' || k === 'PLpoints' || k === 'coordinate') continue;

    if (Array.isArray(v) || isPlainObject(v)) {
      groups[k] = v;
    } else {
      sig[k] = v;
    }
  }

  // 保证关键字段存在于 sig（便于你调试）
  sig.Class = cls;
  sig.Type = type;
  if ((featureInfo as any)?.World !== undefined) sig.World = (featureInfo as any)?.World;

  const signatureKey = stableStringify(sig);

  return {
    Class: cls,
    Type: type,
    World: (featureInfo as any)?.World,
    idField,
    idValue,
    sig,
    signatureKey,
    groups,
    source,
  };
}

// ------------------------------
// zoom 映射（与你现有“leafletZoom(-3..5) ↔ level(0..8)”接口兼容）
// ------------------------------

/**
 * 将 Leaflet zoom（允许负数）映射到整数 ZoomLevel。
 *
 * 说明：
 * - 这里按你的“9 级整数缩放：level(0..8) ↔ leafletZoom(-3..5)”约定。
 * - 若你后续改映射，只需要改这里一处。
 */
export function toZoomLevel(leafletZoom: number): ZoomLevel {
  // level = leafletZoom + 3, clamp to 0..8
  const lvl = Math.round(leafletZoom + 3);
  return Math.max(0, Math.min(8, lvl));
}

function fmtFloorLabel(n: any): string {
  const nn = Number(n);
  if (!Number.isFinite(nn)) return String(n ?? '').trim();
  return nn >= 0 ? `L${nn}` : `B${Math.abs(nn)}`;
}

function normalizeColor(c: any): string | null {
  const s = String(c ?? '').trim();
  if (!s) return null;
  if (s.startsWith('#')) return s;
  // 6位HEX：补 #
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`;
  return s; // 其他情况原样返回（例如 'red' / 'rgba(...)'）
}

function getFirstLineIdFromPlatformFi(fi: any): string | null {
  const arr = (fi as any)?.lines;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const id = String(arr[0]?.ID ?? arr[0]?.LineID ?? arr[0]?.id ?? '').trim();
  return id || null;
}

function getLineColorByLineId(lineId: string, store: FeatureStore): string | null {
  const id = String(lineId ?? '').trim();
  if (!id) return null;

  // 1) 优先：FeatureStore 若有 lineColorIndex（你 v3 方案里是 public 字段）
  const idx = (store as any)?.lineColorIndex as Record<string, string> | undefined;
  const c1 = idx?.[id];
  const n1 = normalizeColor(c1);
  if (n1) return n1;

  // 2) 兜底：若 store 有 all（v3 里有），线性扫 RLE 找 LineID/ID 对应的 color
  const all = (store as any)?.all as any[] | undefined;
  if (Array.isArray(all)) {
    for (const r of all) {
      const fid = String((r?.featureInfo as any)?.LineID ?? (r?.featureInfo as any)?.ID ?? '').trim();
      if (fid !== id) continue;
      const cc = String((r?.featureInfo as any)?.color ?? (r?.featureInfo as any)?.Color ?? '').trim();
      const nn = normalizeColor(cc);
      if (nn) return nn;
    }
  }

  return null;
}

function getPlatformPointColor(r: FeatureRecord, store: FeatureStore): string | null {
  const lineId = getFirstLineIdFromPlatformFi(r.featureInfo);
  if (!lineId) return null;
  return getLineColorByLineId(lineId, store);
}

function getStationPointColorFromPlatforms(sta: FeatureRecord, store: FeatureStore): string | null {
  const pArr = (sta.featureInfo as any)?.platforms;
  if (!Array.isArray(pArr) || pArr.length === 0) return null;

  const pid = String(pArr[0]?.ID ?? pArr[0]?.platformID ?? '').trim();
  if (!pid) return null;

  // 1) 优先：store.byClassId['PLF'][pid][0]
  const byClassId = (store as any)?.byClassId as Record<string, Record<string, FeatureRecord[]>> | undefined;
  const hit = byClassId?.['PLF']?.[pid]?.[0];
  if (hit) return getPlatformPointColor(hit, store);

  // 2) 兜底：线性扫找平台
  const all = (store as any)?.all as FeatureRecord[] | undefined;
  if (Array.isArray(all)) {
    for (const r of all) {
      if (r?.meta?.Class !== 'PLF') continue;
      if (String(r?.meta?.idValue ?? '').trim() !== pid) continue;
      return getPlatformPointColor(r, store);
    }
  }

  return null;
}



export const RENDER_RULES: RenderRule[] = [
  // ------------------------------------------------------------------
  // (1) 铁路 RLE：direction 缩放控制 + 沿线 label
  // - direction=3：zoomLevel 0..99 都显示
  // - direction=0/1/2/4：仅 zoomLevel>=5 显示
  // (2) label：附着在铁路线上（依赖 RuleDrivenLayer.tsx 的 Polyline label 补丁）
  // ------------------------------------------------------------------
  {
    name: '铁路 RLE：direction 缩放控制 + 沿线 label',
    match: { Class: 'RLE', Type: 'Polyline' },
    zoom: [0, 99],
    visible: (r, ctx) => {
      const raw = (r.featureInfo as any)?.direction;
      const dir = raw === '' || raw === null || raw === undefined ? NaN : Number(raw);

      if (dir === 3) return true;                 // 3：全缩放显示
      if ([0, 1, 2, 4].includes(dir)) return ctx.zoomLevel >= 5; // 0/1/2/4：>=5 才显示

      // 未知 direction：按“普通铁路”处理（>=5 才显示）
      return ctx.zoomLevel >= 5;
    },
    symbol: {
      pathStyle: (r) => {
        const c = normalizeColor((r.featureInfo as any)?.color) ?? '#111827';
        return {
          color: c,
          opacity: 0.9,
          weight: 3,
        };
      },
      //label: {
      //  enabled: true,
      //  placement: 'center', // “沿线”在当前实现中取折线的中点
      //  minLevel: 0,
      //  textFrom: (r) => {
      //    return (
      //      String((r.featureInfo as any)?.LineName ?? '').trim() ||
      //      String((r.featureInfo as any)?.LineID ?? '').trim()
      //    );
      //  },
      //},
    },
  },

  // ------------------------------------------------------------------
  // (3) 站台轮廓 PFB：按关联线路色渲染（补 #）
  // ------------------------------------------------------------------
  {
    name: '站台轮廓 PFB：按线路色渲染（补#）',
    match: { Class: 'PFB', Type: 'Polygon' },
    zoom: [3, 99],
    symbol: {
      pathStyle: (r, _ctx, store) => {
        const c = normalizeColor(store.findRelatedLineColor(r)) ?? '#2563eb';
        return {
          color: c,
          opacity: 0.95,
          weight: 0,
          fillColor: c,
          fillOpacity: 0.22,
        };
      },
    },
  },

  // ------------------------------------------------------------------
  // (4) 车站建筑 STB：
  // - zoomLevel<4：仅显示“中心点+label”（这里用 label 自带 dot 的方式实现）
  // - zoomLevel>=4：完全不显示（由于 findFirstRule 机制，直接用 zoom=[0,3] 即可）
  // - 且仅当 Stations.length>=2 才显示
  // ------------------------------------------------------------------
{
  name: '车站建筑 STB：zoom<4 中心点+label（Stations>=2）；zoom>=4 显示面；楼层视角激活建筑变淡',
  match: { Class: 'STB', Type: 'Polygon' },
  zoom: [0, 99],
  symbol: {
    pathStyle: (r, ctx) => {
      // zoom<4：不画面（只留 label+dot）
      if (ctx.zoomLevel < 4) return { opacity: 0, fillOpacity: 0, weight: 0 };

      const base: L.PathOptions = {
        color: '#111827',
        opacity: 0.2,
        weight: 2,
        fillColor: '#9ca3af',
        fillOpacity: 0.05,
      };

      // 楼层视角：激活建筑变淡
      if (ctx.inFloorView && ctx.activeBuildingUid && ctx.activeBuildingUid === r.uid) {
        return { ...base, opacity: 0.25, fillOpacity: 0.06 };
      }
      return base;
    },

    label: {
      enabled: true,
      placement: 'center',
      minLevel: 0,
      withDot: true,
      textFrom: (r, ctx) => {
        // zoom>=4：不显示中心点 label
        if (ctx.zoomLevel >= 4) return '';

        // zoom<4：仅 Stations>=2 才显示
        const stations = (r.featureInfo as any)?.Stations;
        const n = Array.isArray(stations) ? stations.length : 0;
        if (n < 2) return '';

        return String((r.featureInfo as any)?.staBuildingName ?? '').trim();
      },
    },
  },
},


  // ------------------------------------------------------------------
  // (5) 车站点 STA：
  // - zoomLevel<4：不显示
  // - zoomLevel 4..6：显示固定图标
  // - zoomLevel>6：不显示（由 findFirstRule + zoom 裁剪自然实现）
  // ------------------------------------------------------------------
{
  name: '车站点 STA：zoom 4-5 点颜色读取下属站台点颜色（平台首线路色）',
  match: { Class: 'STA', Type: 'Points' },
  zoom: [4, 7],
  symbol: {
    point: (r, ctx, store) => {
      void ctx;

      const c = getStationPointColorFromPlatforms(r, store) ?? '#0ea5e9';
      return {
        kind: 'circle',
        radius: 4,
        style: {
          color: '#111827',
          opacity: 0.9,
          weight: 2,
          fillColor: c,   
          fillOpacity: 0.85,
        },
      };
    },
    label: {
      enabled: true,
      placement: 'near',
      minLevel: 4,
      offsetY: 10,
      textFrom: (r) => String((r.featureInfo as any)?.stationName ?? '').trim(),
    },
  },
},


  // ------------------------------------------------------------------
  // (6) 站台点 PLF：
  // - zoomLevel<6：不显示
  // - zoomLevel>=6：显示固定图标
  // ------------------------------------------------------------------
{
  name: '站台点 PLF：zoom>=6 点颜色读取所属第一个线路 color',
  match: { Class: 'PLF', Type: 'Points' },
  zoom: [8, 99],
  symbol: {
    point: (r, ctx, store) => {
      void ctx;

      const c = getPlatformPointColor(r, store) ?? '#0ea5e9';
      return {
        kind: 'circle',
        radius: 4,
        style: {
          color: '#111827',
          opacity: 0.9,
          weight: 2,
          fillColor: c,     
          fillOpacity: 0.85,
        },
      };
    },
    label: {
      enabled: true,
      placement: 'near',
      minLevel: 6,
      offsetY: 10,
      textFrom: (r) => String((r.featureInfo as any)?.platformName ?? '').trim(),
    },
  },
},

  // ------------------------------
  // 楼层（STF）
  // ------------------------------
  {
    name: '楼层 STF：楼层视角下按 NofFloor 选择（同 NofFloor 允许多面同时显示）',
    match: { Class: DEFAULT_FLOOR_VIEW.floorClass, Type: 'Polygon' },
    zoom: [DEFAULT_FLOOR_VIEW.minLevel, 99],
    visible: (r, ctx) => {
      if (!ctx.inFloorView) return false;
      if (!ctx.activeFloorSelector) return false;

      // 必须属于当前激活建筑的 Floors 引用集合
      const ref = String((r.featureInfo as any)?.[DEFAULT_FLOOR_VIEW.floorRefTargetField] ?? '').trim();
      if (ctx.activeBuildingFloorRefSet && ref) {
        if (!ctx.activeBuildingFloorRefSet.has(ref)) return false;
      }

      // 使用 floorSelectorField（NofFloor）匹配
      const selector = String((r.featureInfo as any)?.[DEFAULT_FLOOR_VIEW.floorSelectorField] ?? '').trim();
      return selector === String(ctx.activeFloorSelector).trim();
    },
    symbol: {
      pathStyle: (r, ctx, store) => {
        void ctx;
        // 楼层用轻量颜色，支持关联线路色（如果有）
        const c = store.findRelatedLineColor(r) ?? '#4b5563';
        return {
          color: c,
          opacity: 0.85,
          weight: 2,
          fillColor: c,
          fillOpacity: 0.28,
        };
      },
      label: {
        enabled: true,
        placement: 'center',
        textFrom: (r) => {
          const name = String((r.featureInfo as any)?.staBFloorName ?? '').trim();
          if (name) return name;
          return fmtFloorLabel((r.featureInfo as any)?.[DEFAULT_FLOOR_VIEW.floorSelectorField]);
        },
        minLevel: DEFAULT_FLOOR_VIEW.minLevel,
      },
    },
  },



  // ------------------------------
  // 车站建筑点（示例：SBP）
  // - 展示外部图标
  // - 若同 idValue 的 STB 存在，则不渲染 SBP（示例：“若xxx存在则不渲染xxx”）
  // ------------------------------
  {
    name: '车站建筑点 SBP：外部图标 + 存在性隐藏（示例，可按需改写）',
    match: { Class: 'SBP', Type: 'Points' },
    zoom: [0, 99],
    hideIfSameIdExistsInClasses: ['STB'],
    symbol: {
      point: {
        kind: 'icon',
        iconUrlFrom: 'iconUrl',
        iconSize: [24, 24],
        iconAnchor: [12, 24],
      },
      label: {
        enabled: true,
        placement: 'near',
        minLevel: 6,
        textFrom: (r) => String((r.featureInfo as any)?.staBuildingName ?? '').trim(),
      },
    },
  },

  // ------------------------------
  // 点要素：外部图标 + label（示例）
  // ------------------------------
  {
    name: '点要素（示例）：若 featureInfo.iconUrl 存在则使用外部图标，并在附近显示 name label',
    match: { Type: 'Points' },
    zoom: [0, 99],
    symbol: {
      point: (r) => {
        const url = String((r.featureInfo as any)?.iconUrl ?? '').trim();
        if (url) {
          return {
            kind: 'icon',
            iconUrl: url,
            iconSize: [24, 24],
            iconAnchor: [12, 24],
          };
        }
        return {
          kind: 'circle',
          radius: 5,
          style: { color: '#111827', opacity: 0.9, weight: 2, fillColor: '#f97316', fillOpacity: 0.6 },
        };
      },
      label: {
        enabled: true,
        placement: 'near',
        minLevel: 6,
        textFrom: (r) => String((r.featureInfo as any)?.name ?? (r.featureInfo as any)?.staName ?? '').trim(),
      },
    },
  },

  // ------------------------------
  // 通用 fallback：线/面
  // ------------------------------
  {
    name: '通用：Polyline 默认样式',
    match: { Type: 'Polyline' },
    zoom: [0, 99],
    symbol: {
      pathStyle: { color: '#111827', opacity: 0.85, weight: 3 },
    },
  },
  {
    name: '通用：Polygon 默认样式',
    match: { Type: 'Polygon' },
    zoom: [0, 99],
    symbol: {
      pathStyle: { color: '#111827', opacity: 0.85, weight: 2, fillColor: '#60a5fa', fillOpacity: 0.08 },
    },
  },
];

export function findFirstRule(r: FeatureRecord): RenderRule | null {
  for (const rule of RENDER_RULES) {
    const mc = rule.match.Class;
    const mt = rule.match.Type;
    if (mc && mc !== r.meta.Class) continue;
    if (mt && mt !== r.type) continue;
    return rule;
  }
  return null;
}
