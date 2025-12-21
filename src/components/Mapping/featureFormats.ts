// src/components/mapping/featureFormats.ts
export type DrawMode = 'point' | 'polyline' | 'polygon';

export type FeatureKey =
  | '默认'
  | '车站'
  | '站台'
  | '铁路'
  | '车站建筑'
  // 下面这些你如果要保留旧下拉项（“地标/栈道/航道/一般建筑/车站站体”）也可以放进来
  | '地标'
  | '栈道'
  | '航道'
  | '一般建筑'
  | '车站站体';

export type ImportFormat =
  | '点'
  | '线'
  | '面'
  | '车站'
  | '铁路'
  | '站台'
  | '车站建筑';

export type Coord2D = { x: number; z: number };

export type FieldType = 'text' | 'number' | 'select' | 'bool';

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  optional?: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: any }>;
};

export type GroupDef = {
  key: string;                 // groups[key] -> Array<Record<string, any>>
  label: string;
  addButtonText?: string;
  fields: FieldDef[];
};

export type FormatDef = {
  key: FeatureKey;
  label: string;
  modes: DrawMode[];           // 允许在哪个 drawMode 下出现
  hideTempOutput?: boolean;    // 非“默认”时隐藏临时输出（按你之前要求）
  fields: FieldDef[];
  groups?: GroupDef[];

  // 把 values/groups + coords 注入成最终可导出的 featureInfo（只要改这里即可改变 JSON 结构）
  buildFeatureInfo: (args: {
    mode: DrawMode;
    coords: Coord2D[];
    values: Record<string, any>;
    groups: Record<string, any[]>;
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

// ---------- 通用工具 ----------
const isFiniteNum = (v: any) => Number.isFinite(Number(v));
const pickByFields = (values: Record<string, any>, fields: FieldDef[]) => {
  const out: Record<string, any> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (v === undefined || v === '' || v === null) {
      if (!f.optional) out[f.key] = v; // 保留空值以便你导出时能看见缺啥
      continue;
    }
    if (f.type === 'number') out[f.key] = Number(v);
    else if (f.type === 'bool') out[f.key] = Boolean(v);
    else out[f.key] = v;
  }
  return out;
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
      // 你现在“固定图层输出要 JSON”，这里给一个最小通用结构
      return {
        type: mode,
        coords: coords.map(p => ({ x: p.x, z: p.z })),
      };
    },
    hydrate: (_featureInfo) => ({
      values: {},
      groups: {},
    }),
    coordsFromFeatureInfo: (featureInfo) => {
      const arr = featureInfo?.coords;
      if (!Array.isArray(arr)) return [];
      return arr.map((p: any) => ({ x: Number(p.x), z: Number(p.z) })).filter((p: any) => isFiniteNum(p.x) && isFiniteNum(p.z));
    },
  },

  // ===== 车站 Station =====
  车站: {
    key: '车站',
    label: '车站',
    modes: ['point'],
    hideTempOutput: true,
    fields: [
      { key: 'stationID', label: '车站ID', type: 'text' },
      { key: 'stationName', label: '车站名', type: 'text' },
      { key: 'height', label: '高度(y)', type: 'number', optional: true },
      { key: 'labelL1', label: '标识1', type: 'number', optional: true },
      { key: 'labelL2', label: '标识2', type: 'number', optional: true },
      { key: 'labelL3', label: '标识3', type: 'number', optional: true },
    ],
    groups: [
      {
        key: 'platforms',
        label: '包含站台 platforms',
        addButtonText: '添加站台条目',
        fields: [
          { key: 'ID', label: '站台ID', type: 'text' },
          { key: 'condistance', label: '合并比例', type: 'number' },
        ],
      },
    ],
    buildFeatureInfo: ({ coords, values, groups }) => {
      const base = pickByFields(values, FORMAT_REGISTRY['车站'].fields);
      const p0 = coords[0];
      return {
        ...base,
        coordinate: { x: p0?.x ?? 0, z: p0?.z ?? 0 },
        platforms: Array.isArray(groups.platforms) ? groups.platforms.map(it => ({
          ID: it.ID ?? '',
          condistance: it.condistance === '' || it.condistance === undefined ? undefined : Number(it.condistance),
        })) : [],
      };
    },
    hydrate: (featureInfo) => ({
      values: {
        stationID: featureInfo?.stationID ?? '',
        stationName: featureInfo?.stationName ?? '',
        height: featureInfo?.height ?? '',
        labelL1: featureInfo?.labelL1 ?? '',
        labelL2: featureInfo?.labelL2 ?? '',
        labelL3: featureInfo?.labelL3 ?? '',
      },
      groups: {
        platforms: Array.isArray(featureInfo?.platforms) ? featureInfo.platforms.map((p: any) => ({
          ID: p?.ID ?? '',
          condistance: p?.condistance ?? '',
        })) : [],
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
      if (item.platforms && !Array.isArray(item.platforms)) return 'platforms 必须是数组';
      return;
    },
  },

  // ===== 站台 Platform =====
  站台: {
    key: '站台',
    label: '站台',
    modes: ['point'],
    hideTempOutput: true,
    fields: [
      { key: 'platformID', label: '站台ID', type: 'text' },
      { key: 'platformName', label: '站台名称', type: 'text' },
      { key: 'height', label: '高度(y)', type: 'number', optional: true },
      { key: 'labelL1', label: '标识1', type: 'number', optional: true },
      { key: 'labelL2', label: '标识2', type: 'number', optional: true },
      { key: 'labelL3', label: '标识3', type: 'number', optional: true },
    ],
    groups: [
      {
        key: 'lines',
        label: '经停线路 lines',
        addButtonText: '添加线路条目',
        fields: [
          { key: 'ID', label: '线路ID', type: 'text' },
          { key: 'stationCode', label: '车站编号(可选)', type: 'number', optional: true },
          { key: 'distance', label: '距离(可选)', type: 'number', optional: true },
          { key: 'NotAvaliable', label: '可使用性', type: 'select', options: [{ label: 'true', value: true }, { label: 'false', value: false }] },
          { key: 'Overtaking', label: '越行', type: 'select', options: [{ label: 'true', value: true }, { label: 'false', value: false }] },
        ],
      },
    ],
    buildFeatureInfo: ({ coords, values, groups }) => {
      const base = pickByFields(values, FORMAT_REGISTRY['站台'].fields);
      const p0 = coords[0];
      const lines = Array.isArray(groups.lines) ? groups.lines.map((it: any) => ({
        ID: it.ID ?? '',
        stationCode: it.stationCode === '' || it.stationCode === undefined ? undefined : Number(it.stationCode),
        distance: it.distance === '' || it.distance === undefined ? undefined : Number(it.distance),
        NotAvaliable: it.NotAvaliable === true || it.NotAvaliable === 'true',
        Overtaking: it.Overtaking === true || it.Overtaking === 'true',
      })) : [];
      return {
        ...base,
        coordinate: { x: p0?.x ?? 0, z: p0?.z ?? 0 },
        lines,
      };
    },
    hydrate: (featureInfo) => ({
      values: {
        platformID: featureInfo?.platformID ?? '',
        platformName: featureInfo?.platformName ?? '',
        height: featureInfo?.height ?? '',
        labelL1: featureInfo?.labelL1 ?? '',
        labelL2: featureInfo?.labelL2 ?? '',
        labelL3: featureInfo?.labelL3 ?? '',
      },
      groups: {
        lines: Array.isArray(featureInfo?.lines) ? featureInfo.lines.map((l: any) => ({
          ID: l?.ID ?? '',
          stationCode: l?.stationCode ?? '',
          distance: l?.distance ?? '',
          NotAvaliable: l?.NotAvaliable ?? true,
          Overtaking: l?.Overtaking ?? false,
        })) : [],
      },
    }),
    coordsFromFeatureInfo: (featureInfo) => {
      const c = featureInfo?.coordinate;
      if (!c) return [];
      return [{ x: Number(c.x), z: Number(c.z) }].filter(p => isFiniteNum(p.x) && isFiniteNum(p.z));
    },
    validateImportItem: (item) => {
      if (!item || typeof item !== 'object') return '不是对象';
      if (!item.platformID && !item.platformName) return '缺少 platformID / platformName（至少一个）';
      if (!item.coordinate || !isFiniteNum(item.coordinate.x) || !isFiniteNum(item.coordinate.z)) return '缺少合法 coordinate.x / coordinate.z';
      if (item.lines && !Array.isArray(item.lines)) return 'lines 必须是数组';
      return;
    },
  },

  // ===== 铁路 Line（你新增 Kind 字段就在这里加）=====
  铁路: {
    key: '铁路',
    label: '铁路',
    modes: ['polyline'],
    hideTempOutput: true,
    fields: [
      { key: 'LineID', label: '线路ID', type: 'text' },
      { key: 'LineName', label: '线路名', type: 'text' },
      { key: 'Kind', label: '等级Kind', type: 'number', optional: true }, // ← 你要的新字段
      { key: 'bureau', label: '路局代码', type: 'text', optional: true },
      { key: 'line', label: '线路编号', type: 'text', optional: true },
      { key: 'direction', label: '方向', type: 'select', options: [0,1,2,3].map(v => ({ label: String(v), value: v })) },
      { key: 'startplf', label: '起点站台ID', type: 'text', optional: true },
      { key: 'endplf', label: '终点站台ID', type: 'text', optional: true },
      { key: 'labelL1', label: '标识1', type: 'number', optional: true },
      { key: 'labelL2', label: '标识2', type: 'number', optional: true },
      { key: 'labelL3', label: '标识3', type: 'number', optional: true },
      { key: 'test', label: '测试', type: 'number', optional: true },
    ],
    groups: [],
    buildFeatureInfo: ({ coords, values }) => {
      const base = pickByFields(values, FORMAT_REGISTRY['铁路'].fields);
      // y 固定 -63（按你旧逻辑 :contentReference[oaicite:2]{index=2}）
      const PLpoints = coords.map(p => [p.x, -63, p.z] as [number, number, number]);
      return {
        ...base,
        PLpoints,
      };
    },
    hydrate: (featureInfo) => ({
      values: {
        LineID: featureInfo?.LineID ?? '',
        LineName: featureInfo?.LineName ?? '',
        Kind: featureInfo?.Kind ?? '',
        bureau: featureInfo?.bureau ?? '',
        line: featureInfo?.line ?? '',
        direction: featureInfo?.direction ?? 2,
        startplf: featureInfo?.startplf ?? '',
        endplf: featureInfo?.endplf ?? '',
        labelL1: featureInfo?.labelL1 ?? '',
        labelL2: featureInfo?.labelL2 ?? '',
        labelL3: featureInfo?.labelL3 ?? '',
        test: featureInfo?.test ?? '',
      },
      groups: {},
    }),
    coordsFromFeatureInfo: (featureInfo) => {
      const pts = featureInfo?.PLpoints;
      if (!Array.isArray(pts)) return [];
      return pts
        .map((p: any) => ({ x: Number(p?.[0]), z: Number(p?.[2]) }))
        .filter((p: any) => isFiniteNum(p.x) && isFiniteNum(p.z));
    },
    validateImportItem: (item) => {
      if (!item || typeof item !== 'object') return '不是对象';
      if (!item.LineID) return '缺少 LineID';
      if (!item.LineName) return '缺少 LineName';
      if (!Array.isArray(item.PLpoints) || item.PLpoints.length < 2) return 'PLpoints 必须是数组且至少 2 点';
      return;
    },
  },

  // ===== 车站建筑（Station Building）=====
  车站建筑: {
    key: '车站建筑',
    label: '车站建筑',
    modes: ['polygon'],
    hideTempOutput: true,
    fields: [
      { key: 'staBuildingID', label: '车站建筑ID', type: 'text' },
      { key: 'staBuildingName', label: '车站建筑名', type: 'text' },
      { key: 'heightH', label: '高度(heightH)', type: 'number', optional: true },
      { key: 'labelL1', label: '标识1', type: 'number', optional: true },
      { key: 'labelL2', label: '标识2', type: 'number', optional: true },
      { key: 'labelL3', label: '标识3', type: 'number', optional: true },
    ],
    groups: [
      {
        key: 'platforms',
        label: '平台/楼层 platforms',
        addButtonText: '添加 platforms 条目',
        fields: [
          { key: 'condistance', label: '合并比例', type: 'number' },
          { key: 'BuildingLevelID', label: '建筑楼层ID', type: 'text' },
        ],
      },
    ],
    buildFeatureInfo: ({ coords, values, groups }) => {
      const base = pickByFields(values, FORMAT_REGISTRY['车站建筑'].fields);
      // Conpoints: [x,y,z]，y 默认 0
      const Conpoints = coords.map(p => [p.x, 0, p.z] as [number, number, number]);
      return {
        ...base,
        Conpoints,
        platforms: Array.isArray(groups.platforms) ? groups.platforms.map((it: any) => ({
          condistance: it.condistance === '' || it.condistance === undefined ? undefined : Number(it.condistance),
          BuildingLevelID: it.BuildingLevelID ?? '',
        })) : [],
      };
    },
    hydrate: (featureInfo) => ({
      values: {
        staBuildingID: featureInfo?.staBuildingID ?? '',
        staBuildingName: featureInfo?.staBuildingName ?? '',
        heightH: featureInfo?.heightH ?? '',
        labelL1: featureInfo?.labelL1 ?? '',
        labelL2: featureInfo?.labelL2 ?? '',
        labelL3: featureInfo?.labelL3 ?? '',
      },
      groups: {
        platforms: Array.isArray(featureInfo?.platforms) ? featureInfo.platforms.map((p: any) => ({
          condistance: p?.condistance ?? '',
          BuildingLevelID: p?.BuildingLevelID ?? '',
        })) : [],
      },
    }),
    coordsFromFeatureInfo: (featureInfo) => {
      const pts = featureInfo?.Conpoints;
      if (!Array.isArray(pts)) return [];
      return pts
        .map((p: any) => ({ x: Number(p?.[0]), z: Number(p?.[2]) }))
        .filter((p: any) => isFiniteNum(p.x) && isFiniteNum(p.z));
    },
    validateImportItem: (item) => {
      if (!item || typeof item !== 'object') return '不是对象';
      if (!item.staBuildingID) return '缺少 staBuildingID';
      if (!item.staBuildingName) return '缺少 staBuildingName';
      if (!Array.isArray(item.Conpoints) || item.Conpoints.length < 3) return 'Conpoints 必须是数组且至少 3 点';
      return;
    },
  },

  // ===== 其余“占位型 subtype”（按默认处理，但让下拉里可选）=====
  地标: {
    key: '地标', label: '地标', modes: ['point'], hideTempOutput: true,
    fields: [], groups: [],
    buildFeatureInfo: ({ mode, coords }) => ({ subType: '地标', type: mode, coords }),
    hydrate: () => ({ values: {}, groups: {} }),
    coordsFromFeatureInfo: (fi) => (Array.isArray(fi?.coords) ? fi.coords : []),
  },
  栈道: {
    key: '栈道', label: '栈道', modes: ['polyline'], hideTempOutput: true,
    fields: [], groups: [],
    buildFeatureInfo: ({ mode, coords }) => ({ subType: '栈道', type: mode, coords }),
    hydrate: () => ({ values: {}, groups: {} }),
    coordsFromFeatureInfo: (fi) => (Array.isArray(fi?.coords) ? fi.coords : []),
  },
  航道: {
    key: '航道', label: '航道', modes: ['polyline'], hideTempOutput: true,
    fields: [], groups: [],
    buildFeatureInfo: ({ mode, coords }) => ({ subType: '航道', type: mode, coords }),
    hydrate: () => ({ values: {}, groups: {} }),
    coordsFromFeatureInfo: (fi) => (Array.isArray(fi?.coords) ? fi.coords : []),
  },
  一般建筑: {
    key: '一般建筑', label: '一般建筑', modes: ['polygon'], hideTempOutput: true,
    fields: [], groups: [],
    buildFeatureInfo: ({ mode, coords }) => ({ subType: '一般建筑', type: mode, coords }),
    hydrate: () => ({ values: {}, groups: {} }),
    coordsFromFeatureInfo: (fi) => (Array.isArray(fi?.coords) ? fi.coords : []),
  },
  车站站体: {
    key: '车站站体', label: '车站站体', modes: ['polygon'], hideTempOutput: true,
    fields: [], groups: [],
    buildFeatureInfo: ({ mode, coords }) => ({ subType: '车站站体', type: mode, coords }),
    hydrate: () => ({ values: {}, groups: {} }),
    coordsFromFeatureInfo: (fi) => (Array.isArray(fi?.coords) ? fi.coords : []),
  },
};

// 供 MeasuringModule 使用：按 drawMode 获取可选 subtype
export const getSubTypeOptions = (mode: DrawMode): FeatureKey[] => {
  return (Object.keys(FORMAT_REGISTRY) as FeatureKey[])
    .filter(k => FORMAT_REGISTRY[k].modes.includes(mode));
};

// 导出时坐标统一整数化（不影响内存中编辑精度，仅影响输出）
const roundXZDeep = (v: any): any => {
  if (Array.isArray(v)) return v.map(roundXZDeep);

  if (v && typeof v === 'object') {
    // 常见 {x,z} 坐标对象
    if (typeof v.x === 'number' && typeof v.z === 'number') {
      const out: any = { ...v };
      out.x = Math.round(v.x);
      out.z = Math.round(v.z);
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
    const x = Number(nums[0]);
    const z = nums.length === 2 ? Number(nums[1]) : Number(nums[2]);
    const yOk = nums.length === 3 ? Number.isFinite(Number(nums[1])) : true;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !yOk) return null;
    out.push({ x, z });
  }
  return out;
};
