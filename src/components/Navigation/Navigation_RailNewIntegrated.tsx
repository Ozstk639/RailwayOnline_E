/**
 * Navigation_RailNewIntegrated.tsx
 *
 * 模块职责（严格按你要求拆分）：
 * - 仅负责：在“已确定的起始/终点车站建筑（STB/SBP）”之间计算铁路最优方案（最短时间/最少换乘/最短距离）。
 * - 不负责：起终点“从输入点/玩家/地标”到最近车站建筑的查找（这由 Navigation_Start.ts 完成）。
 *
 * 关键约束（按你最新口径已固化）：
 * 1) 节点识别规则：仅 `PLF.Connect === false` 视为连接节点（junction）。
 *    - 连接节点：可用于线路并入/引出/直通，但默认不显示换乘说明、不计换乘。
 * 2) SBP 与 STB 一致：Stations group（车站ID，对照 STA.stationID）；Rail 内部也会做“字段兼容兜底”，避免过渡期字段名导致全失效。
 * 3) 线路严格单向：所有 RLE 都只允许沿 PLpoints 点集“从前到后”运行，不做任何反向补边。
 *
 * 输出（供 NavigationPanel 截图式 UI + RouteHighlightLayer 分段高亮使用）：
 * - segments: rail/transfer（每个 rail 段右侧可折叠 viaStations）
 * - overlay: 分段 polyline（rail 按 line.color；transfer 虚线；后续 access 段由 Panel 追加）
 *
 * 可调接口（你要求新增的 4 个）：
 * - transferWalkSpeed：站内换乘步行速度（blocks/s）
 * - railSpeed：铁路乘坐速度（blocks/s，用于时间估算）
 * - stationTransferCostDivisor：站内换乘成本阈值（对站内步行 cost 进行折扣；默认 10 等价于你之前的 /10）
 * - normalSamePlatformTransferCost：正常站台“同台换乘”成本（秒；用于让 Connect=false 的零成本切线更优）
 *
 * 换乘方式输出（你要求的 5 类）：
 * - 站内换乘：同 STB/SBP 内、不同 STA 的 PLF 之间
 * - 同台换乘：同一 PLF 上不同线路（非直通）
 * - 直通运行：同台且 bureau+line 组合一致（不计换乘、成本 0）
 * - 并入主线：direction=4 -> 0/1
 * - 离开主线：direction=0/1 -> 4
 *
 * 重要说明：
 * - 本模块不依赖你的 UI/React；为纯 TS 计算模块。
 * - 若你的项目路径别名不是 "@/..."，只需把下面 import 改为相对路径即可。
 */

import type { Coordinate } from '@/types';
import { RULE_DATA_SOURCES, type WorldRuleDataSource } from '@/components/Rules/ruleDataSources';

// ------------------------------
// 公共输出类型：供 NavigationPanel / RouteHighlightLayer 使用
// ------------------------------

export type RailSearchMode = 'time' | 'transfers' | 'distance';

export type RouteOverlaySegment =
  | {
      kind: 'rail';
      coords: Coordinate[];
      color: string;
      lineName: string;
      lineId: string;
      dashed?: false;
    }
  | {
      kind: 'transfer';
      coords: Coordinate[];
      color: string; // 默认灰
      dashed: true;
      transferType: TransferType;
    };

export type RouteOverlay = {
  segments: RouteOverlaySegment[];
  /** 便于 fitBounds：所有点的集合 */
  allCoords: Coordinate[];
};

export type TransferType =
  | 'stationTransfer'
  | 'samePlatformTransfer'
  | 'throughRun'
  | 'mergeMainline'
  | 'leaveMainline'
  | 'enterConnector';

export type RailNewStaBuildingSearchItem = {
  id: string;
  name: string;
  kind: 'STB' | 'SBP';
  coord: Coordinate; // STB centroid / SBP point
  stationIds: string[];
};

export async function listRailNewStaBuildingsForSearch(opt: {
  worldId: string;
  dataSourceOverride?: Partial<WorldRuleDataSource>;
  filesOverride?: string[];
  fetcher?: (url: string) => Promise<any[]>;
}): Promise<RailNewStaBuildingSearchItem[]> {
  const all = await loadRuleItems(opt.worldId, {
    dataSourceOverride: opt.dataSourceOverride,
    filesOverride: opt.filesOverride,
    fetcher: opt.fetcher,
    strict: true,
  });

  const buildings = parseBuildings(all);

  const out: RailNewStaBuildingSearchItem[] = [];
  for (const b of buildings.values()) {
    out.push({
      id: b.id,
      name: b.name,
      kind: b.kind,
      coord: b.representativePoint,
      stationIds: b.stationIds.slice(),
    });
  }
  return out;
}


export type NavRailSegmentRail = {
  kind: 'rail';
  /** 该段可能由多条联络线子段拼接（xxx/xxx/xxx）；UI 可以展示多 chip */
  lines: Array<{
    lineId: string;
    lineName: string;
    color: string;
    direction: number;
    bureau?: string;
    line?: string;
  }>;
  fromStation: string;
  toStation: string;
  viaStations: string[]; // 可折叠列表（按 Connect=true 的 STA）
  distance: number; // blocks
  timeSeconds: number;
};

export type NavRailSegmentTransfer = {
  kind: 'transfer';
  transferType: TransferType;

  /** 出/入站点（用于截图式“进入车站/离开车站/站内换乘”描述） */
  atStation: string; // 发生换乘的车站名（尽量取 STA.stationName；缺失则用 building 名）
  fromLineName?: string;
  toLineName?: string;

  /** 站内换乘距离/时间（若适用） */
  distance: number;
  timeSeconds: number;

  /** 是否计入换乘数（Connect=false / 直通运行 / 同 STA 步行均不计） */
  countsAsTransfer: boolean;
};

export type NavRailPlan = {
  ok: boolean;
  reason?: string;

  mode: RailSearchMode;

  totalDistance: number;
  totalTimeSeconds: number;
  transferCount: number;

  segments: Array<NavRailSegmentRail | NavRailSegmentTransfer>;
  overlay: RouteOverlay;

  /** 便于 UI 顶部总览 */
  usedLineChips: Array<{ lineName: string; color: string }>;
};

// ------------------------------
// 输入参数与可调接口
// ------------------------------

export type NavigationRailComputeOptions = {
  worldId: string;

  startBuildingId: string;
  endBuildingId: string;

  mode?: RailSearchMode;

  /** 站内换乘步行速度（blocks/s） */
  transferWalkSpeed?: number;

  /** 铁路乘坐速度（blocks/s） */
  railSpeed?: number;

  /**
   * 站内换乘成本阈值（折扣系数）
   * - Dijkstra 评估时：effectiveCost = physicalCost / stationTransferCostDivisor
   * - 目的：让站内步行不至于压过“合理的铁路乘坐距离”
   */
  stationTransferCostDivisor?: number;

  /**
   * 正常站台同台换乘成本（秒）
   * - 目的：让“Connect=false 连接节点”的 0 成本切线在计算中更具优势
   * - 同台换乘（Connect=true）：使用该成本
   * - 连接节点（Connect=false）：同台切线成本始终 0 且不计换乘
   */
  normalSamePlatformTransferCost?: number;

  /**
   * 计算用文件范畴接口：覆盖 RULE_DATA_SOURCES
   * - 不传则使用 RULE_DATA_SOURCES[worldId]
   */
  dataSourceOverride?: Partial<WorldRuleDataSource>;

  /**
   * 可选：只加载特定文件（进一步缩小读取范围）
   * - 若提供则优先于 dataSourceOverride.files
   */
  filesOverride?: string[];

  /**
   * 可选：自定义 fetch（便于缓存/镜像）
   */
  fetcher?: (url: string) => Promise<any[]>;
};

// ------------------------------
// Rule 数据结构（宽容解析）
// ------------------------------

type RawItem = any;

type Sta = {
  stationID: string;
  stationName: string;
  coordinate: Coordinate;
  platformIds: string[];
};

type PlfLineRef = {
  ID: string;
  Avaliable?: boolean;
  Available?: boolean;
  NotAvaliable?: boolean;
  Overtaking?: boolean;
  getin?: boolean;
  getout?: boolean;
  NextOT?: boolean;
  stationDistance?: number; // 若存在可作为投影里程的强提示（可选）
  bureau?: string;
  line?: string;
};

type Plf = {
  platformID: string;
  platformName?: string;
  coordinate: Coordinate;
  Situation: boolean;
  Connect: boolean;
  lines: PlfLineRef[];
};

type Building = {
  id: string; // staBuildingID
  name: string;
  kind: 'STB' | 'SBP';
  representativePoint: Coordinate; // STB 取 centroid；SBP 取 coordinate
  polygon?: Coordinate[]; // STB 的 Conpoints（用于“点在面内=>距离=0”与更准确的最近站体判定）
  stationIds: string[]; // stationsgroup
};

type Rle = {
  lineId: string;
  lineName: string;
  bureau?: string;
  line?: string;
  color: string;
  direction: number; // 你约定 0/1 主线；4 联络线（用于并入/离开判定）
  points: Coordinate[]; // PLpoints
  cumlen: number[]; // 与 points 等长，cumlen[0]=0
  totalLen: number;
};

function num(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: any): string {
  const s = String(v ?? '').trim();
  return s;
}

function asBool(v: any, fallback = false): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === 'true' || t === '1' || t === 'yes') return true;
    if (t === 'false' || t === '0' || t === 'no') return false;
  }
  return fallback;
}

function toCoord(v: any): Coordinate | null {
  if (!v) return null;
  if (Array.isArray(v)) {
    const x = num(v[0], NaN);
    const z = num(v[2] ?? v[1], NaN);
    const y = num(v[1] ?? 64, 64);
    if (Number.isFinite(x) && Number.isFinite(z)) return { x, y: Number.isFinite(y) ? y : 64, z };
    return null;
  }
  if (typeof v === 'object') {
    const x = num(v.x, NaN);
    const z = num(v.z, NaN);
    const y = num(v.y ?? 64, 64);
    if (Number.isFinite(x) && Number.isFinite(z)) return { x, y: Number.isFinite(y) ? y : 64, z };
  }
  return null;
}

function coordArray(v: any): Coordinate[] {
  if (!Array.isArray(v)) return [];
  const out: Coordinate[] = [];
  for (const p of v) {
    const c = toCoord(p);
    if (c) out.push(c);
  }
  return out;
}

function distXZ(a: Coordinate, b: Coordinate): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * 点在面内 => 距离=0（用于 STB 多边形）
 * - 仅在 XZ 平面判断
 */
function pointInPolygonXZ(p: Coordinate, poly: Coordinate[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z;
    const xj = poly[j].x, zj = poly[j].z;
    const intersect = (zi > p.z) !== (zj > p.z) && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distPointToSegmentXZ(p: Coordinate, a: Coordinate, b: Coordinate): number {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const wx = p.x - a.x;
  const wz = p.z - a.z;

  const vv = vx * vx + vz * vz;
  if (vv <= 1e-12) return Math.hypot(wx, wz);

  let t = (wx * vx + wz * vz) / vv;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * vx;
  const pz = a.z + t * vz;
  return Math.hypot(p.x - px, p.z - pz);
}

function distPointToPolygonXZ(p: Coordinate, poly: Coordinate[]): number {
  if (poly.length < 3) return Number.POSITIVE_INFINITY;
  if (pointInPolygonXZ(p, poly)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    best = Math.min(best, distPointToSegmentXZ(p, a, b));
  }
  return best;
}

function nearestBuildingForCoord(buildings: Map<string, Building>, p: Coordinate): Building | null {
  let best: Building | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const b of buildings.values()) {
    const d = b.polygon?.length ? distPointToPolygonXZ(p, b.polygon) : distXZ(p, b.representativePoint);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function centroidPolygonXZ(poly: Coordinate[]): Coordinate {
  if (poly.length < 3) return poly[0] ?? { x: 0, y: 64, z: 0 };
  let area = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const x0 = poly[j].x;
    const z0 = poly[j].z;
    const x1 = poly[i].x;
    const z1 = poly[i].z;
    const a = x0 * z1 - x1 * z0;
    area += a;
    cx += (x0 + x1) * a;
    cz += (z0 + z1) * a;
  }
  if (Math.abs(area) < 1e-9) return poly[0];
  area *= 0.5;
  cx /= 6 * area;
  cz /= 6 * area;
  if (!Number.isFinite(cx) || !Number.isFinite(cz)) return poly[0];
  return { x: cx, y: poly[0].y ?? 64, z: cz };
}

// ------------------------------
// Polyline 投影与切片（用于“相邻站真实铁路里程 + 高亮走形”）
// ------------------------------

function buildCumLen(points: Coordinate[]): number[] {
  const cum: number[] = [];
  let acc = 0;
  cum.push(0);
  for (let i = 1; i < points.length; i++) {
    acc += distXZ(points[i - 1], points[i]);
    cum.push(acc);
  }
  return cum;
}

function projectPointToPolylineMeasure(p: Coordinate, line: Rle): { m: number; nearest: Coordinate } {
  // 返回：最近投影点 + 沿线里程 m（0..totalLen）
  let bestD = Infinity;
  let bestM = 0;
  let bestPt = line.points[0];

  for (let i = 0; i < line.points.length - 1; i++) {
    const a = line.points[i];
    const b = line.points[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const apx = p.x - a.x;
    const apz = p.z - a.z;
    const ab2 = abx * abx + abz * abz;

    let t = 0;
    if (ab2 > 1e-12) t = (apx * abx + apz * abz) / ab2;
    t = Math.max(0, Math.min(1, t));

    const x = a.x + t * abx;
    const z = a.z + t * abz;
    const d = Math.hypot(p.x - x, p.z - z);

    if (d < bestD) {
      bestD = d;
      bestPt = { x, y: p.y ?? 64, z };
      const segLen = distXZ(a, b);
      const base = line.cumlen[i];
      bestM = base + t * segLen;
    }
  }

  bestM = Math.max(0, Math.min(line.totalLen, bestM));
  return { m: bestM, nearest: bestPt };
}

function pointAtMeasure(line: Rle, m: number): Coordinate {
  if (m <= 0) return line.points[0];
  if (m >= line.totalLen) return line.points[line.points.length - 1];

  // 找 cumlen 区间
  let idx = 0;
  while (idx < line.cumlen.length - 1 && line.cumlen[idx + 1] < m) idx++;

  const a = line.points[idx];
  const b = line.points[idx + 1];
  const segStart = line.cumlen[idx];
  const segLen = Math.max(1e-9, distXZ(a, b));
  const t = (m - segStart) / segLen;

  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y ?? 64,
    z: a.z + (b.z - a.z) * t,
  };
}

function slicePolylineByMeasure(line: Rle, m1: number, m2: number): Coordinate[] {
  const a = Math.max(0, Math.min(line.totalLen, m1));
  const b = Math.max(0, Math.min(line.totalLen, m2));
  if (b <= a + 1e-9) return [pointAtMeasure(line, a), pointAtMeasure(line, b)];

  const out: Coordinate[] = [];
  const pA = pointAtMeasure(line, a);
  const pB = pointAtMeasure(line, b);
  out.push(pA);

  // 插入中间原始点
  // 找 a 所在段 indexA，b 所在段 indexB
  const idxOf = (m: number): number => {
    let idx = 0;
    while (idx < line.cumlen.length - 1 && line.cumlen[idx + 1] < m) idx++;
    return idx;
  };
  const ia = idxOf(a);
  const ib = idxOf(b);

  for (let i = ia + 1; i <= ib; i++) {
    // line.points[i] 可能正好在终点段之后，需要限制
    const mm = line.cumlen[i];
    if (mm > a + 1e-9 && mm < b - 1e-9) out.push(line.points[i]);
  }

  out.push(pB);
  return out;
}

function concatCoordsSafe(a: Coordinate[], b: Coordinate[]): Coordinate[] {
  if (a.length === 0) return b.slice();
  if (b.length === 0) return a.slice();
  const last = a[a.length - 1];
  const first = b[0];
  if (distXZ(last, first) < 1e-6) return a.concat(b.slice(1));
  return a.concat(b);
}

// ------------------------------
// 加载 Rule JSON（只读 STA/PLF/STB/SBP/RLE）
// ------------------------------

async function defaultFetcher(url: string): Promise<any[]> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  const data = await resp.json();
  return Array.isArray(data) ? data : [];
}

function normalizeWorldId(worldId: string): string {
  const wid = String(worldId ?? '').trim();

  // 1) 已经是内部 key（zth/eden/naraku/houtu）直接返回
  if (wid && (RULE_DATA_SOURCES as any)[wid]) return wid;

  // 2) 兼容数字世界：0..5（你 JSON 规范里 World 是 integer）
  if (/^\d+$/.test(wid)) {
    const n = parseInt(wid, 10);
    if (n === 0) return 'zth';
    if (n === 1) return 'naraku';
    if (n === 2) return 'houtu';
    if (n === 3) return 'eden';
    // 4/5 你后续可补：laputa / yunduan 等
    return wid;
  }

  // 3) 兼容中文世界名（如果 UI 传的是中文）
  const map: Record<string, string> = {
    零洲: 'zth',
    奈落: 'naraku',
    后土: 'houtu',
    伊甸: 'eden',
  };
  return map[wid] ?? wid;
}

type RuleLoadOptions = Pick<NavigationRailComputeOptions, 'dataSourceOverride' | 'filesOverride' | 'fetcher'> & {
  /** strict=true：若完全加载不到任何数据则抛错（用于候选列表/调试） */
  strict?: boolean;
};

async function loadRuleItems(worldId: string, opt: RuleLoadOptions): Promise<any[]> {
  const wid = normalizeWorldId(worldId);
  const base = RULE_DATA_SOURCES[wid];

  const merged: WorldRuleDataSource = {
    baseUrl: opt.dataSourceOverride?.baseUrl ?? base?.baseUrl ?? '/data/JSON',
    files: opt.filesOverride ?? opt.dataSourceOverride?.files ?? base?.files ?? [],
  };

  if (opt.strict && merged.files.length === 0) {
    throw new Error(`RULE_DATA_SOURCES[${wid}] 未配置 files（worldId=${worldId} -> ${wid}），无法加载 STB/STA/PLF/RLE`);
  }

  const fetcher = opt.fetcher ?? defaultFetcher;
  const items: RawItem[] = [];

  let loadedAnyFile = false;

  for (const file of merged.files) {
    const url = `${merged.baseUrl.replace(/\/$/, '')}/${file}`;
    try {
      const arr = await fetcher(url);
      if (arr.length > 0) loadedAnyFile = true;
      for (const it of arr) items.push(it);
    } catch {
      // 允许单文件失败不中断（与 RuleLayer 行为一致）
      continue;
    }
  }

  if (opt.strict && !loadedAnyFile) {
    throw new Error(
      `未能从任何文件加载到 Rule JSON（worldId=${worldId} -> ${wid}）。` +
        `请检查 baseUrl=${merged.baseUrl} 与 files 是否 404/路径不一致。`
    );
  }

  return items;
}


function parseSta(all: RawItem[]): Map<string, Sta> {
  const out = new Map<string, Sta>();
  for (const it of all) {
    if (str(it?.Class) !== 'STA') continue;
    const stationID = str(it.stationID ?? it.stationId ?? it.ID ?? it.id);
    if (!stationID) continue;
    const stationName = str(it.stationName ?? it.name ?? stationID);
    const c = toCoord(it.coordinate);
    if (!c) continue;

    const platformsArr = it.platforms ?? it.Platforms ?? it.PLFS ?? [];
    const platformIds: string[] = [];
    if (Array.isArray(platformsArr)) {
      for (const p of platformsArr) {
        const pid = str(p?.ID ?? p?.platformID ?? p?.platformId ?? p);
        if (pid) platformIds.push(pid);
      }
    }

    out.set(stationID, { stationID, stationName, coordinate: c, platformIds });
  }
  return out;
}

function parsePlf(all: RawItem[]): Map<string, Plf> {
  const out = new Map<string, Plf>();
  for (const it of all) {
    if (str(it?.Class) !== 'PLF') continue;
    const platformID = str(it.platformID ?? it.platformId ?? it.ID ?? it.id);
    if (!platformID) continue;

    const c = toCoord(it.coordinate);
    if (!c) continue;

    const Situation = asBool(it.Situation, true);
    const Connect = asBool(it.Connect, true);

    const linesRaw = it.lines ?? it.Lines ?? [];
    const lines: PlfLineRef[] = [];
    if (Array.isArray(linesRaw)) {
      for (const lr of linesRaw) {
        const ID = str(lr?.ID ?? lr?.LineID ?? lr?.lineID ?? lr?.id);
        if (!ID) continue;
        lines.push({
          ID,
          Avaliable: lr?.Avaliable,
          Available: lr?.Available,
          NotAvaliable: lr?.NotAvaliable,
          Overtaking: asBool(lr?.Overtaking, false),
          getin: asBool(lr?.getin, true),
          getout: asBool(lr?.getout, true),
          NextOT: asBool(lr?.NextOT, false),
          stationDistance: Number.isFinite(Number(lr?.stationDistance)) ? Number(lr.stationDistance) : undefined,
          bureau: lr?.bureau ? str(lr.bureau) : undefined,
          line: lr?.line ? str(lr.line) : undefined,
        });
      }
    }

    out.set(platformID, {
      platformID,
      platformName: str(it.platformName ?? it.name ?? ''),
      coordinate: c,
      Situation,
      Connect,
      lines,
    });
  }
  return out;
}

function normalizeCssColor(input: string | undefined, fallback = '#3b82f6'): string {
  const s = (input ?? '').trim();
  if (!s) return fallback;

  // #RRGGBB / #RRGGBBAA
  if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return s;

  // RRGGBB / RRGGBBAA  ->  #RRGGBB / #RRGGBBAA
  if (/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return `#${s}`;

  // 0xRRGGBB / 0xRRGGBBAA -> #RRGGBB / #RRGGBBAA
  if (/^0x[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return `#${s.slice(2)}`;

  // rgb()/rgba()/hsl()/hsla() 或命名色，直接放行
  if (/^(rgb|rgba|hsl|hsla)\(/i.test(s)) return s;

  return fallback;
}


function parseRle(all: RawItem[]): Map<string, Rle> {
  const out = new Map<string, Rle>();
  for (const it of all) {
    if (str(it?.Class) !== 'RLE') continue;
    const lineId = str(it.LineID ?? it.lineID ?? it.lineId ?? it.ID ?? it.id);
    if (!lineId) continue;
    const lineName = str(it.LineName ?? it.lineName ?? it.name ?? lineId);
    const color = normalizeCssColor(str(it.color), '#3b82f6');
    const direction = Number.isFinite(Number(it.direction)) ? Number(it.direction) : 0;
    const bureau = it.bureau ? str(it.bureau) : undefined;
    const line = it.line ? str(it.line) : undefined;

    const points = coordArray(it.PLpoints ?? it.plpoints ?? it.points);
    if (points.length < 2) continue;

    const cumlen = buildCumLen(points);
    const totalLen = cumlen[cumlen.length - 1];

    out.set(lineId, { lineId, lineName, bureau, line, color, direction, points, cumlen, totalLen });
  }
  return out;
}

function parseBuildings(all: RawItem[]): Map<string, Building> {
  const out = new Map<string, Building>();

  const parseStationsGroup = (it: any): string[] => {
    // 兼容：Stations / stations / stationsgroup / stationsGroup / StationsGroup
    const g =
      it?.Stations ??
      it?.stations ??
      it?.stationsgroup ??
      it?.stationsGroup ??
      it?.StationsGroup ??
      it?.Stationsgroup ??
      [];
    const ids: string[] = [];
    if (Array.isArray(g)) {
      for (const x of g) {
        const id = str(x?.ID ?? x?.id ?? x?.stationID ?? x?.stationId ?? x);
        if (id) ids.push(id);
      }
    }
    return ids;
  };

  for (const it of all) {
    const cls = str(it?.Class);
    if (cls !== 'STB' && cls !== 'SBP') continue;

    const id =
      cls === 'SBP'
        ? str(
            it.staBuildingPointID ??
              it.staBuildingPointId ??
              it.stationID ??
              it.stationId ??
              // 过渡期兜底：部分旧数据可能仍使用 staBuildingID
              it.staBuildingID ??
              it.staBuildingId ??
              it.ID ??
              it.id
          )
        : str(
            it.staBuildingID ??
              it.staBuildingId ??
              it.buildingID ??
              it.BuildingID ??
              it.buildingId ??
              it.ID ??
              it.id
          );
    if (!id) continue;

    const name =
      cls === 'SBP'
        ? str(
            it.staBuildingPointName ??
              it.stationName ??
              it.staBuildingName ??
              it.buildingName ??
              it.BuildingName ??
              it.name ??
              it.Name ??
              id
          )
        : str(
            it.staBuildingName ??
              it.buildingName ??
              it.BuildingName ??
              it.name ??
              it.Name ??
              id
          );

          
let representativePoint: Coordinate | null = null;
let polygon: Coordinate[] | undefined = undefined;

// 允许直接给中心点（STB 也兼容）
const coordPoint =
  toCoord(it.coordinate ?? it.center ?? it.Coord ?? it.coord) ?? null;

if (cls === 'SBP') {
  representativePoint = coordPoint;
} else {
  // STB：优先多边形中心，其次退化到 coordinate/center
  const con = coordArray(
    it.Conpoints ??
      it.conpoints ??
      it.Flrpoints ??
      it.flrpoints ??
      it.points ??
      it.Points
  );

  if (con.length >= 3) {
    polygon = con;
    representativePoint = centroidPolygonXZ(con) ?? coordPoint;
  } else {
    representativePoint = coordPoint;
  }
}

if (!representativePoint) continue;


    const stationIds = parseStationsGroup(it);

    out.set(id, {
      id,
      name,
      kind: cls as 'STB' | 'SBP',
      representativePoint,
      polygon,
      stationIds,
    });
  }

  return out;
}

// ------------------------------
// 图构建：平台/线路状态节点 + Dijkstra
// ------------------------------

type NodeKey = string;

type EdgeKind = 'ride' | 'walk' | 'switch' | 'board' | 'alight';

type Edge = {
  from: NodeKey;
  to: NodeKey;
  kind: EdgeKind;

  /** 用于 Dijkstra 的权重分解 */
  distance: number; // blocks
  timeSeconds: number; // effective time (含折扣)
  physicalTimeSeconds: number; // 真实时间（用于展示）
  transferInc: number; // 本边是否计换乘

  /** 展示/语义元数据 */
  lineId?: string;
  lineName?: string;
  color?: string;
  direction?: number;
  bureau?: string;
  line?: string;

  transferType?: TransferType;
  hidden?: boolean; // 默认不展示（Connect=false 或 同 STA 步行等）

  /** overlay 片段（ride/transfer） */
  overlayCoords?: Coordinate[];
};

type Prev = {
  prev: NodeKey | null;
  edge: Edge | null;
};

class MinHeap<T> {
  private a: Array<{ k: number; v: T }> = [];
  push(k: number, v: T) {
    this.a.push({ k, v });
    this.up(this.a.length - 1);
  }
  pop(): { k: number; v: T } | null {
    if (this.a.length === 0) return null;
    const top = this.a[0];
    const last = this.a.pop()!;
    if (this.a.length > 0) {
      this.a[0] = last;
      this.down(0);
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
  private up(i: number) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p].k <= this.a[i].k) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
      i = p;
    }
  }
  private down(i: number) {
    const n = this.a.length;
    while (true) {
      let m = i;
      const l = i * 2 + 1;
      const r = l + 1;
      if (l < n && this.a[l].k < this.a[m].k) m = l;
      if (r < n && this.a[r].k < this.a[m].k) m = r;
      if (m === i) break;
      [this.a[m], this.a[i]] = [this.a[i], this.a[m]];
      i = m;
    }
  }
}

function platformNode(pid: string): NodeKey {
  return `P:${pid}`;
}
function rideNode(pid: string, lineId: string): NodeKey {
  return `R:${pid}@@${lineId}`;
}

type Occ = {
  platformId: string;
  stationId?: string; // 从 STA 反查
  platform: Plf;
  lineId: string;
  line: Rle;
  ref: PlfLineRef;

  m: number; // 沿线里程
  stopAllowed: boolean;
  isJunction: boolean; // Connect=false
};

type RideNodeInfo = {
  platformId: string;
  stationId?: string;
  platform: Plf;
  line: Rle;
  ref: PlfLineRef;
  m: number;
  stopAllowed: boolean;
  isJunction: boolean;
};

type Graph = {
  nodes: Set<NodeKey>;
  edgesFrom: Map<NodeKey, Edge[]>;
};

function addEdge(g: Graph, e: Edge) {
  if (!g.edgesFrom.has(e.from)) g.edgesFrom.set(e.from, []);
  g.edgesFrom.get(e.from)!.push(e);
  g.nodes.add(e.from);
  g.nodes.add(e.to);
}

function bureauLineKey(line: Rle): string {
  const b = (line.bureau ?? '').trim();
  const l = (line.line ?? '').trim();
  return `${b}::${l}`;
}

function isMainlineDir(d: number): boolean {
  return d === 0 || d === 1;
}

function computeScalarWeight(mode: RailSearchMode, transferCount: number, timeSeconds: number, distance: number): number {
  if (mode === 'distance') return distance;
  if (mode === 'time') return timeSeconds;
  // transfers 优先：用极大常数确保字典序
  const BIG = 1e9;
  return transferCount * BIG + timeSeconds;
}

// ------------------------------
// 生成 rail/transfer edges
// ------------------------------

function makeOccs(
  plfs: Map<string, Plf>,
  stas: Map<string, Sta>,
  rles: Map<string, Rle>
): { occsByLine: Map<string, Occ[]>; platformToStation: Map<string, string> } {
  // platform -> station（按 STA.platforms 反查）
  const platformToStation = new Map<string, string>();
  for (const sta of stas.values()) {
    for (const pid of sta.platformIds) {
      if (!platformToStation.has(pid)) platformToStation.set(pid, sta.stationID);
    }
  }

  const occsByLine = new Map<string, Occ[]>();

  for (const plf of plfs.values()) {
    for (const ref of plf.lines) {
      const lineId = str(ref.ID);
      if (!lineId) continue;

      const line = rles.get(lineId);
      if (!line) continue;

      // Avaliable/Available/NotAvaliable 规则：
      // - 若 Available/Avaliable 显式 false，则该平台上的该线不可用于计算（平台仍可用于其他线）
      // - 若 NotAvaliable true，也视为不可用
      const avail =
        ref.Available !== undefined
          ? asBool(ref.Available, true)
          : ref.Avaliable !== undefined
          ? asBool(ref.Avaliable, true)
          : true;
      const notAvail = asBool(ref.NotAvaliable, false);
      if (!avail || notAvail) continue;

      // 站台整体启用开关
      if (!plf.Situation) continue;

      // 投影里程：优先 stationDistance（若你后续保证该字段是沿线里程，可提升稳定性）
      let m = Number.isFinite(ref.stationDistance as any) ? Number(ref.stationDistance) : NaN;
      if (!Number.isFinite(m)) {
        const proj = projectPointToPolylineMeasure(plf.coordinate, line);
        m = proj.m;
      } else {
        // clamp
        m = Math.max(0, Math.min(line.totalLen, m));
      }

      const isJunction = plf.Connect === false;
      const stationId = platformToStation.get(plf.platformID);

      // stopAllowed 需结合 NextOT：在“按里程排序后”才能最终决定
      // 这里先占位，后续 per-line 再计算
      const occ: Occ = {
        platformId: plf.platformID,
        stationId,
        platform: plf,
        lineId,
        line,
        ref,
        m,
        stopAllowed: false,
        isJunction,
      };

      if (!occsByLine.has(lineId)) occsByLine.set(lineId, []);
      occsByLine.get(lineId)!.push(occ);
    }
  }

  // 对每条线：按 m 排序并应用 NextOT 规则，计算 stopAllowed/event 节点
  for (const [lineId, occs] of occsByLine.entries()) {
    occs.sort((a, b) => a.m - b.m);

    let forcedPass = false; // 来自前一站的 NextOT
    for (let i = 0; i < occs.length; i++) {
      const o = occs[i];
      const overtaking = asBool(o.ref.Overtaking, false);

      // 连接节点（Connect=false）永远不是“停站点”，但必须作为 event 节点参与连通
      // 乘客不可在连接节点上下车（后续 board/alight 将禁止）
      o.stopAllowed = !o.isJunction && !forcedPass && !overtaking;

      // 当前点的 NextOT 作用到下一个点：优先级高于下一个点自身 Overtaking
      forcedPass = asBool(o.ref.NextOT, false);
    }

    // 去重：同一 platformId 在线上可能重复（数据异常），保留最靠前的
    const seen = new Set<string>();
    const dedup: Occ[] = [];
    for (const o of occs) {
      const k = `${o.platformId}@@${o.lineId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      dedup.push(o);
    }
    occsByLine.set(lineId, dedup);
  }

  return { occsByLine, platformToStation };
}

function buildGraph(
  occsByLine: Map<string, Occ[]>,
  plfs: Map<string, Plf>,
  stas: Map<string, Sta>,
  buildings: Map<string, Building>,
  platformToStation: Map<string, string>,
  options: Required<Pick<
    NavigationRailComputeOptions,
    'transferWalkSpeed' | 'railSpeed' | 'stationTransferCostDivisor' | 'normalSamePlatformTransferCost'
  >>
): {
  graph: Graph;
  rideInfo: Map<NodeKey, RideNodeInfo>;
  buildingPlatforms: Map<string, string[]>; // buildingId -> platformIds (Connect=true)
  platformBuildings: Map<string, Set<string>>; // platformId -> buildingId(s)
} {
  const g: Graph = { nodes: new Set(), edgesFrom: new Map() };
  const rideInfo = new Map<NodeKey, RideNodeInfo>();

  // building -> station -> platforms
  const stationToBuildings = new Map<string, Set<string>>();
  for (const b of buildings.values()) {
    for (const sid of b.stationIds) {
      if (!stationToBuildings.has(sid)) stationToBuildings.set(sid, new Set());
      stationToBuildings.get(sid)!.add(b.id);
    }
  }

  const platformBuildings = new Map<string, Set<string>>();
  const buildingPlatforms = new Map<string, string[]>();

  for (const [pid, sid] of platformToStation.entries()) {
    const bs = stationToBuildings.get(sid);
    if (!bs) continue;
    for (const bid of bs) {
      if (!platformBuildings.has(pid)) platformBuildings.set(pid, new Set());
      platformBuildings.get(pid)!.add(bid);
    }
  }

  // 为每个 building 聚合其包含的 Connect=true 平台（用于起终点候选与 walk edges）
  for (const b of buildings.values()) {
    const pids: string[] = [];
    for (const sid of b.stationIds) {
      const sta = stas.get(sid);
      if (!sta) continue;
      for (const pid of sta.platformIds) {
        const plf = plfs.get(pid);
        if (!plf) continue;
        if (!plf.Situation) continue;
        if (plf.Connect === false) continue; // 连接节点不作为乘客平台
        pids.push(pid);
      }
    }
    // 去重
    buildingPlatforms.set(b.id, Array.from(new Set(pids)));
  }

  // 1) 生成 ride nodes + ride edges（按线前向）
  for (const occs of occsByLine.values()) {
    // event 节点：stopAllowed 或 junction
    const event = occs.filter(o => o.stopAllowed || o.isJunction);
    if (event.length < 2) {
      // 仍然要注册 ride node（某些线只有一个 junction 用于并入/引出）
      for (const o of event) {
        const rk = rideNode(o.platformId, o.lineId);
        rideInfo.set(rk, {
          platformId: o.platformId,
          stationId: o.stationId,
          platform: o.platform,
          line: o.line,
          ref: o.ref,
          m: o.m,
          stopAllowed: o.stopAllowed,
          isJunction: o.isJunction,
        });
        g.nodes.add(rk);
      }
      continue;
    }

    // 注册 ride nodes
    for (const o of event) {
      const rk = rideNode(o.platformId, o.lineId);
      rideInfo.set(rk, {
        platformId: o.platformId,
        stationId: o.stationId,
        platform: o.platform,
        line: o.line,
        ref: o.ref,
        m: o.m,
        stopAllowed: o.stopAllowed,
        isJunction: o.isJunction,
      });
      g.nodes.add(rk);
    }

    // 前向 ride edges
    for (let i = 0; i < event.length - 1; i++) {
      const a = event[i];
      const b = event[i + 1];
      const from = rideNode(a.platformId, a.lineId);
      const to = rideNode(b.platformId, b.lineId);

      const dist = Math.max(0, b.m - a.m); // 单向：m 必须递增（若数据异常则 clamp）
      const physicalTime = dist / Math.max(1e-6, options.railSpeed);
      const coords = slicePolylineByMeasure(a.line, a.m, b.m);

      addEdge(g, {
        from,
        to,
        kind: 'ride',
        distance: dist,
        timeSeconds: physicalTime,
        physicalTimeSeconds: physicalTime,
        transferInc: 0,
        lineId: a.line.lineId,
        lineName: a.line.lineName,
        color: a.line.color,
        direction: a.line.direction,
        bureau: a.line.bureau,
        line: a.line.line,
        overlayCoords: coords,
      });
    }
  }

  // 2) platform nodes + board/alight edges
  for (const plf of plfs.values()) {
    if (!plf.Situation) continue;
    if (plf.Connect === false) continue; // 连接节点不建 passenger 平台节点
    const pk = platformNode(plf.platformID);
    g.nodes.add(pk);
  }

  // board/alight：连接 passenger platform node 与 ride node（仅 stopAllowed 且允许上下车）
  for (const [rk, info] of rideInfo.entries()) {
    if (info.isJunction) continue; // 连接节点不可上下车
    if (!info.stopAllowed) continue;

    const pk = platformNode(info.platformId);
    const plf = info.platform;
    if (!plf.Situation || plf.Connect === false) continue;

    const canIn = asBool(info.ref.getin, true);
    const canOut = asBool(info.ref.getout, true);

    if (canIn) {
      addEdge(g, {
        from: pk,
        to: rk,
        kind: 'board',
        distance: 0,
        timeSeconds: 0,
        physicalTimeSeconds: 0,
        transferInc: 0,
        lineId: info.line.lineId,
        lineName: info.line.lineName,
        color: info.line.color,
        direction: info.line.direction,
        bureau: info.line.bureau,
        line: info.line.line,
      });
    }

    if (canOut) {
      addEdge(g, {
        from: rk,
        to: pk,
        kind: 'alight',
        distance: 0,
        timeSeconds: 0,
        physicalTimeSeconds: 0,
        transferInc: 0,
        lineId: info.line.lineId,
        lineName: info.line.lineName,
        color: info.line.color,
        direction: info.line.direction,
        bureau: info.line.bureau,
        line: info.line.line,
      });
    }
  }

  // 3) 站内 walk edges（在同 building 内的 passenger platform 之间）
  // 规则：
  // - 同 STA：cost=0、hidden、transferInc=0（不显示）
  // - 不同 STA：站内换乘（countsAsTransfer=1）
  // - 换乘距离按 STA.coordinate 距离（无 STA 坐标则回退平台坐标）
  const buildingToStaCoord = (pid: string): Coordinate | null => {
    const sid = platformToStation.get(pid);
    const sta = sid ? stas.get(sid) : undefined;
    if (sta?.coordinate) return sta.coordinate;
    const plf = plfs.get(pid);
    return plf?.coordinate ?? null;
  };

  for (const [, pids] of buildingPlatforms.entries()) {
    // 全连接（规模通常不大；若未来很大可换为“同 STA 分组 + 相邻近邻”）
    for (let i = 0; i < pids.length; i++) {
      for (let j = 0; j < pids.length; j++) {
        if (i === j) continue;
        const a = pids[i];
        const b = pids[j];

        const sidA = platformToStation.get(a);
        const sidB = platformToStation.get(b);

        const from = platformNode(a);
        const to = platformNode(b);

        if (sidA && sidB && sidA === sidB) {
          // 同车站同站台组：不计换乘不显示
          addEdge(g, {
            from,
            to,
            kind: 'walk',
            distance: 0,
            timeSeconds: 0,
            physicalTimeSeconds: 0,
            transferInc: 0,
            transferType: 'stationTransfer',
            hidden: true,
            overlayCoords: [plfs.get(a)!.coordinate, plfs.get(b)!.coordinate],
          });
          continue;
        }

        const ca = buildingToStaCoord(a);
        const cb = buildingToStaCoord(b);
        if (!ca || !cb) continue;

        const d = distXZ(ca, cb);
        const physicalTime = d / Math.max(1e-6, options.transferWalkSpeed);

        // 站内换乘 cost 折扣（对 time 和 distance 都折扣，保持一致性）
        const effTime = physicalTime / Math.max(1e-6, options.stationTransferCostDivisor);
        const effDist = d / Math.max(1e-6, options.stationTransferCostDivisor);

        addEdge(g, {
          from,
          to,
          kind: 'walk',
          distance: effDist,
          timeSeconds: effTime,
          physicalTimeSeconds: physicalTime,
          transferInc: 1,
          transferType: 'stationTransfer',
          hidden: false,
          overlayCoords: [plfs.get(a)!.coordinate, plfs.get(b)!.coordinate],
        });
      }
    }
  }

  // 4) 同台切线（ride->ride）：
  // - Connect=false（连接节点）：0 成本、0 换乘；默认 hidden，但 merge/leave 仍输出
  // - Connect=true（正常站台）：同台换乘 cost=normalSamePlatformTransferCost（秒）、+1 换乘
  // - bureau+line 相同：直通运行（0 成本、0 换乘，显示为 throughRun）
  //
  // 允许性：
  // - 正常站台：必须能下车（from getout）且能上车（to getin），且两侧都是 stopAllowed
  // - 连接节点：允许（视为轨道连接）
  const rideByPlatform = new Map<string, NodeKey[]>();
  for (const rk of rideInfo.keys()) {
    const info = rideInfo.get(rk)!;
    if (!rideByPlatform.has(info.platformId)) rideByPlatform.set(info.platformId, []);
    rideByPlatform.get(info.platformId)!.push(rk);
  }

  for (const [pid, nodes] of rideByPlatform.entries()) {
    if (nodes.length < 2) continue;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const from = nodes[i];
        const to = nodes[j];

        const A = rideInfo.get(from)!;
        const B = rideInfo.get(to)!;

        const aJ = A.isJunction;
        const bJ = B.isJunction;
        const isJunction = aJ || bJ || (plfs.get(pid)?.Connect === false);

        // 正常站台：可用性检查
        if (!isJunction) {
          if (!A.stopAllowed || !B.stopAllowed) continue;
          const canOut = asBool(A.ref.getout, true);
          const canIn = asBool(B.ref.getin, true);
          if (!canOut || !canIn) continue;
        }

        const keyA = bureauLineKey(A.line);
        const keyB = bureauLineKey(B.line);

        let transferType: TransferType = 'samePlatformTransfer';
        let countsAsTransfer = 1;
        let time = options.normalSamePlatformTransferCost;
        let physTime = time;
        let dist = 0;
        let hidden = false;

        // 直通运行：同台且 bureau+line 一致
        if (keyA === keyB && keyA !== '::') {
          transferType = 'throughRun';
          countsAsTransfer = 0;
          time = 0;
          physTime = 0;
        }

// 并入/离开主线（direction=4 与 0/1 切换）
const aDir = A.line.direction;
const bDir = B.line.direction;

if (aDir === 4 && isMainlineDir(bDir)) {
  transferType = 'mergeMainline';
} else if (isMainlineDir(aDir) && bDir === 4) {
  transferType = isJunction ? 'leaveMainline' : 'enterConnector';
}

        // 连接节点：默认隐藏且不计换乘
        if (isJunction) {
          countsAsTransfer = 0;
          time = 0;
          physTime = 0;
          hidden = true;

          // 但并入/离开主线必须输出（即便连接节点）
          if (transferType === 'mergeMainline' || transferType === 'leaveMainline' || transferType === 'enterConnector') {
            hidden = false;
          }
        } else {
          // 正常站台：throughRun 仍显示（用于截图式说明），但不计换乘
          // samePlatformTransfer 显示并计换乘
        }

        addEdge(g, {
          from,
          to,
          kind: 'switch',
          distance: dist,
          timeSeconds: time,
          physicalTimeSeconds: physTime,
          transferInc: countsAsTransfer,
          transferType,
          hidden,
          lineId: B.line.lineId,
          lineName: B.line.lineName,
          color: B.line.color,
          direction: B.line.direction,
          bureau: B.line.bureau,
          line: B.line.line,
        });
      }
    }
  }

  return { graph: g, rideInfo, buildingPlatforms, platformBuildings };
}

// ------------------------------
// Dijkstra（多源 -> 任一终点平台）
// ------------------------------

type DistState = {
  scalar: number;
  time: number;
  distance: number;
  transfers: number;
};

function dijkstra(
  graph: Graph,
  startNodes: NodeKey[],
  isGoal: (n: NodeKey) => boolean,
  mode: RailSearchMode
): { goal: NodeKey | null; prev: Map<NodeKey, Prev>; dist: Map<NodeKey, DistState> } {
  const prev = new Map<NodeKey, Prev>();
  const dist = new Map<NodeKey, DistState>();
  const heap = new MinHeap<NodeKey>();

  const init: DistState = { scalar: 0, time: 0, distance: 0, transfers: 0 };

  for (const s of startNodes) {
    dist.set(s, { ...init });
    prev.set(s, { prev: null, edge: null });
    heap.push(0, s);
  }

  let goal: NodeKey | null = null;

  while (heap.size > 0) {
    const top = heap.pop()!;
    const u = top.v;
    const du = dist.get(u);
    if (!du) continue;

    // heap 里可能存在旧条目
    if (top.k !== du.scalar) continue;

    if (isGoal(u)) {
      goal = u;
      break;
    }

    const outs = graph.edgesFrom.get(u) ?? [];
    for (const e of outs) {
      const v = e.to;
      const dv = dist.get(v);

      const time = du.time + e.timeSeconds;
      const distance = du.distance + e.distance;
      const transfers = du.transfers + (e.transferInc ?? 0);
      const scalar = computeScalarWeight(mode, transfers, time, distance);

      if (!dv || scalar < dv.scalar - 1e-12) {
        dist.set(v, { scalar, time, distance, transfers });
        prev.set(v, { prev: u, edge: e });
        heap.push(scalar, v);
      }
    }
  }

  return { goal, prev, dist };
}

// ------------------------------
// 路径重建与分段输出（segments + overlay）
// ------------------------------

function reconstructEdges(prev: Map<NodeKey, Prev>, goal: NodeKey): Edge[] {
  const edges: Edge[] = [];
  let cur: NodeKey | null = goal;
  while (cur) {
    const p = prev.get(cur);
    if (!p || !p.prev || !p.edge) break;
    edges.push(p.edge);
    cur = p.prev;
  }
  edges.reverse();
  return edges;
}

function stationNameOfPlatform(platformId: string, stas: Map<string, Sta>, platformToStation: Map<string, string>): string {
  const sid = platformToStation.get(platformId);
  if (!sid) return '';
  return stas.get(sid)?.stationName ?? '';
}

function buildRailPlanOutput(args: {
  edges: Edge[];
  rideInfo: Map<NodeKey, RideNodeInfo>;
  stas: Map<string, Sta>;
  platformToStation: Map<string, string>;
}): { segments: NavRailPlan['segments']; overlay: RouteOverlay; usedLineChips: NavRailPlan['usedLineChips'] } {
  const { edges, rideInfo, stas, platformToStation } = args;

  const segments: Array<NavRailSegmentRail | NavRailSegmentTransfer> = [];
  const overlaySegments: RouteOverlaySegment[] = [];
  const allCoords: Coordinate[] = [];
  const usedLineChips: Array<{ lineName: string; color: string }> = [];
  const chipSet = new Set<string>();

  // 归并 rail 段：连续 ride edges（同一条 lineId）合并
  let i = 0;
  while (i < edges.length) {
    const e = edges[i];

    // 过滤 hidden transfer（不输出也不绘制）
    if ((e.kind === 'walk' || e.kind === 'switch') && e.hidden) {
      i++;
      continue;
    }

    if (e.kind === 'ride') {
      // 合并连续 ride edges（同 lineId）
      const lines: NavRailSegmentRail['lines'] = [];
      const railEdges: Edge[] = [];

      // 支持联络线多段拼接：若连续 ride 的 lineId 不同但都 direction=4 且中间没有可见 transfer，
      // 则允许合并到同一 rail 段里，以便 UI 显示 xxx/xxx/xxx。这里用 lines[] 保留各自颜色。
      // 合并策略：一直吃到遇到非 ride 或遇到可见 transfer 为止；若都是 ride 则全部归并到一个 rail 段
      let j = i;
      while (j < edges.length && edges[j].kind === 'ride') {
        railEdges.push(edges[j]);
        j++;
      }

      // lines[] 生成：按 lineId 分组去重并保持顺序
      const seenLine = new Set<string>();
      for (const re of railEdges) {
        const lid = re.lineId!;
        if (seenLine.has(lid)) continue;
        seenLine.add(lid);
        lines.push({
          lineId: lid,
          lineName: re.lineName ?? lid,
          color: re.color ?? '#3b82f6',
          direction: re.direction ?? 0,
          bureau: re.bureau,
          line: re.line,
        });
      }

      // 站名：用第一个 ride edge 的 from 平台、最后一个 ride edge 的 to 平台
      const firstRide = railEdges[0];
      const lastRide = railEdges[railEdges.length - 1];

      const fromRideInfo = rideInfo.get(firstRide.from);
      const toRideInfo = rideInfo.get(lastRide.to);
      const fromStation = fromRideInfo ? stationNameOfPlatform(fromRideInfo.platformId, stas, platformToStation) : '';
      const toStation = toRideInfo ? stationNameOfPlatform(toRideInfo.platformId, stas, platformToStation) : '';

      // viaStations：扫描 railEdges 的端点 ride nodes，取 stopAllowed 且 Connect=true 的 STA 名称（去重）
      const via: string[] = [];
      const viaSet = new Set<string>();
      const pushStation = (rk: NodeKey) => {
        const info = rideInfo.get(rk);
        if (!info) return;
        if (info.isJunction) return;
        if (!info.stopAllowed) return;
        const n = stationNameOfPlatform(info.platformId, stas, platformToStation);
        if (!n) return;
        if (viaSet.has(n)) return;
        viaSet.add(n);
        via.push(n);
      };
      pushStation(firstRide.from);
      for (const re of railEdges) pushStation(re.to);

      // distance/time 与 overlay coords
      let dist = 0;
      let time = 0;

      let coords: Coordinate[] = [];
      for (const re of railEdges) {
        dist += re.distance;
        time += re.physicalTimeSeconds; // rail 段时间无需折扣
        if (re.overlayCoords && re.overlayCoords.length > 0) {
          coords = concatCoordsSafe(coords, re.overlayCoords);
        }
      }

      // overlay：rail 段用“主导颜色”（若多条联络线则仍按第一条显示；后续 UI 可用 lines[] 做多 chip）
      const mainColor = lines[0]?.color ?? '#3b82f6';
      const mainName =
        lines.length === 1 ? lines[0].lineName : lines.map(x => x.lineName).join('/');

      if (coords.length >= 2) {
        overlaySegments.push({
          kind: 'rail',
          coords,
          color: mainColor,
          lineName: mainName,
          lineId: lines.map(x => x.lineId).join('/'),
        });
        for (const c of coords) allCoords.push(c);
      }

      // chips：按 lines[] 去重
      for (const ln of lines) {
        const c = normalizeCssColor(ln.color, '#3b82f6');
      const k = `${ln.lineName}@@${c}`;
      if (!chipSet.has(k)) {
        chipSet.add(k);
        usedLineChips.push({ lineName: ln.lineName, color: c });
      }

      }

      segments.push({
        kind: 'rail',
        lines,
        fromStation: fromStation || '(未知车站)',
        toStation: toStation || '(未知车站)',
        viaStations: via,
        distance: dist,
        timeSeconds: time,
      });

      i = j;
      continue;
    }

    // transfer 输出（walk/switch）
    if (e.kind === 'walk' || e.kind === 'switch') {
      const transferType = e.transferType ?? (e.kind === 'walk' ? 'stationTransfer' : 'samePlatformTransfer');
      const countsAsTransfer = (e.transferInc ?? 0) > 0;

      // 发生地点 stationName（尽量取 from 平台的 STA）
      let atStation = '';
      if (e.kind === 'walk') {
        // from 是平台节点 P:pid
        const pid = e.from.startsWith('P:') ? e.from.slice(2) : '';
        atStation = stationNameOfPlatform(pid, stas, platformToStation);
      } else if (e.kind === 'switch') {
        // from 是 ride 节点 R:pid@@line
        const m = /^R:(.+?)@@/.exec(e.from);
        const pid = m?.[1] ?? '';
        atStation = stationNameOfPlatform(pid, stas, platformToStation);
      }
      atStation = atStation || '(未知车站)';

      // overlay：transfer 段虚线（灰）
      if (e.overlayCoords && e.overlayCoords.length >= 2) {
        overlaySegments.push({
          kind: 'transfer',
          coords: e.overlayCoords,
          color: '#9ca3af',
          dashed: true,
          transferType,
        });
        for (const c of e.overlayCoords) allCoords.push(c);
      }

      // 文本：from/to lineName（若 switch）
      const fromLineName = e.kind === 'switch' ? (e.lineName ?? '') : undefined;
      const toLineName = e.kind === 'switch' ? (e.lineName ?? '') : undefined;

      segments.push({
        kind: 'transfer',
        transferType,
        atStation,
        fromLineName,
        toLineName,
        distance: e.distance,
        timeSeconds: e.physicalTimeSeconds,
        countsAsTransfer,
      });

      i++;
      continue;
    }

    // board/alight 不直接输出为段（UI 可在后续细化“进入车站”）
    i++;
  }

  return {
    segments,
    overlay: { segments: overlaySegments, allCoords },
    usedLineChips,
  };
}

// ------------------------------
// 主入口：计算两车站建筑之间铁路方案
// ------------------------------

export async function computeRailPlanBetweenBuildings(opt: NavigationRailComputeOptions): Promise<NavRailPlan> {
  const mode: RailSearchMode = opt.mode ?? 'time';

  // 默认参数（可随时由 UI 调整）
  const transferWalkSpeed = opt.transferWalkSpeed ?? 1.2; // blocks/s
  const railSpeed = opt.railSpeed ?? 16; // blocks/s（按你的实际 Minecraft 设定可调）
  const stationTransferCostDivisor = opt.stationTransferCostDivisor ?? 10;
  const normalSamePlatformTransferCost = opt.normalSamePlatformTransferCost ?? 30; // seconds

  const all = await loadRuleItems(opt.worldId, opt);

  const stas = parseSta(all);
  const plfs = parsePlf(all);
  const rles = parseRle(all);
  const buildings = parseBuildings(all);

  const startBuilding = buildings.get(opt.startBuildingId);
  const endBuilding = buildings.get(opt.endBuildingId);

  if (!startBuilding || !endBuilding) {
    return {
      ok: false,
      reason: `未找到起点/终点车站建筑：start=${opt.startBuildingId} end=${opt.endBuildingId}`,
      mode,
      totalDistance: 0,
      totalTimeSeconds: 0,
      transferCount: 0,
      segments: [],
      overlay: { segments: [], allCoords: [] },
      usedLineChips: [],
    };
  }

  const { occsByLine, platformToStation } = makeOccs(plfs, stas, rles);

  const { graph, rideInfo, buildingPlatforms } = buildGraph(
    occsByLine,
    plfs,
    stas,
    buildings,
    platformToStation,
    { transferWalkSpeed, railSpeed, stationTransferCostDivisor, normalSamePlatformTransferCost }
  );

  const startPlatforms = buildingPlatforms.get(startBuilding.id) ?? [];
  const endPlatforms = new Set(buildingPlatforms.get(endBuilding.id) ?? []);

  if (startPlatforms.length === 0 || endPlatforms.size === 0) {
    return {
      ok: false,
      reason: `起点或终点车站建筑下未找到可用站台（请检查 StationsGroup -> STA.platforms -> PLF.Situation/Connect）`,
      mode,
      totalDistance: 0,
      totalTimeSeconds: 0,
      transferCount: 0,
      segments: [],
      overlay: { segments: [], allCoords: [] },
      usedLineChips: [],
    };
  }

  // 多源起点：从 start building 的 passenger 平台节点开始
  const startNodes = startPlatforms.map(platformNode);

  // 终点：到达 end building 的任一 passenger 平台节点即可
  const isGoal = (n: NodeKey) => n.startsWith('P:') && endPlatforms.has(n.slice(2));

  const { goal, prev, dist } = dijkstra(graph, startNodes, isGoal, mode);

  if (!goal) {
    return {
      ok: false,
      reason: `未找到可行路线（请检查：PLF.Situation/Available、线路单向、换乘归属 STB/SBP 的 StationsGroup 链路、getin/getout/Overtaking/NextOT）`,
      mode,
      totalDistance: 0,
      totalTimeSeconds: 0,
      transferCount: 0,
      segments: [],
      overlay: { segments: [], allCoords: [] },
      usedLineChips: [],
    };
  }

  const edges = reconstructEdges(prev, goal);
  const ds = dist.get(goal)!;

  const built = buildRailPlanOutput({
    edges,
    rideInfo,
    stas,
    platformToStation,
  });

  return {
    ok: true,
    mode,
    totalDistance: ds.distance,
    totalTimeSeconds: ds.time,
    transferCount: ds.transfers,
    segments: built.segments,
    overlay: built.overlay,
    usedLineChips: built.usedLineChips,
  };
}

/**
 * 供 NavigationPanel 使用的辅助：把起终 buildingId 校验并给出展示名称/代表点
 */
export function getBuildingDisplayInfo(worldBuildings: Map<string, Building>, id: string): { name: string; point: Coordinate } | null {
  const b = worldBuildings.get(id);
  if (!b) return null;
  return { name: b.name, point: b.representativePoint };
}


// ------------------------------
// 新增：从“任意起终点坐标”直接计算（集成 Start + Rail）
// ------------------------------

export type NavigationRailNewIntegratedComputeOptions = Omit<
  NavigationRailComputeOptions,
  'startBuildingId' | 'endBuildingId'
> & {
  /** 起点坐标（来自旧面板选点/玩家/地标等最终落点） */
  startCoord: Coordinate;
  /** 终点坐标 */
  endCoord: Coordinate;

  /**
   * 可选：若你已知起终点就是某个 STB/SBP，可直接给 ID，避免最近搜索
   * - startBuildingId / endBuildingId 的优先级高于最近搜索
   */
  startBuildingId?: string;
  endBuildingId?: string;
};

export type NavRailNewIntegratedPlan = NavRailPlan & {
  /** 解析到的起终车站建筑（STB/SBP） */
  startResolvedBuilding?: { id: string; name: string; point: Coordinate; distanceToInput: number };
  endResolvedBuilding?: { id: string; name: string; point: Coordinate; distanceToInput: number };

  /** 便于 UI 追加“鞘翅/步行”段（若点就在站体内 distance=0） */
  access?: {
    startToBuildingDistance: number;
    endToBuildingDistance: number;
  };
};


/**
 * 集成版入口：不再依赖 Navigation_Start.ts。
 * - 先用 STB/SBP 的 StationsGroup 做“站体解析”
 * - 起终点若不在站体内，则先走到最近站体代表点（STB centroid / SBP coordinate）
 * - 之后在 PLF+RLE 有向图上运行最短路（与 Navigation_Rail.ts 保持一致）
 */
export async function computeRailPlanFromCoords(opt: NavigationRailNewIntegratedComputeOptions): Promise<NavRailNewIntegratedPlan> {
  const mode: RailSearchMode = opt.mode ?? 'time';

  // 默认参数（可随时由 UI 调整）
  const transferWalkSpeed = opt.transferWalkSpeed ?? 1.2; // blocks/s
  const railSpeed = opt.railSpeed ?? 16; // blocks/s
  const stationTransferCostDivisor = opt.stationTransferCostDivisor ?? 10;
  const normalSamePlatformTransferCost = opt.normalSamePlatformTransferCost ?? 30; // seconds

  const all = await loadRuleItems(opt.worldId, opt);
  const stas = parseSta(all);
  const plfs = parsePlf(all);
  const rles = parseRle(all);
  const buildings = parseBuildings(all);

  const startBuilding =
    (opt.startBuildingId ? buildings.get(opt.startBuildingId) : null) ?? nearestBuildingForCoord(buildings, opt.startCoord);
  const endBuilding =
    (opt.endBuildingId ? buildings.get(opt.endBuildingId) : null) ?? nearestBuildingForCoord(buildings, opt.endCoord);

  if (!startBuilding || !endBuilding) {
    return {
      ok: false,
      reason: '未找到可用车站建筑（STB/SBP）用于起点或终点，请检查规则数据是否已加载/StationsGroup 是否存在。',
      mode,
      totalDistance: 0,
      totalTimeSeconds: 0,
      transferCount: 0,
      segments: [],
      overlay: { segments: [], allCoords: [] },
      usedLineChips: [],
    };
  }

  // 计算输入点到站体代表点距离：若点在 STB 多边形内则距离=0
  const startD = startBuilding.polygon?.length ? distPointToPolygonXZ(opt.startCoord, startBuilding.polygon) : distXZ(opt.startCoord, startBuilding.representativePoint);
  const endD = endBuilding.polygon?.length ? distPointToPolygonXZ(opt.endCoord, endBuilding.polygon) : distXZ(opt.endCoord, endBuilding.representativePoint);

  // ---- 以下核心逻辑与 computeRailPlanBetweenBuildings 保持一致 ----

  const { occsByLine, platformToStation } = makeOccs(plfs, stas, rles);

  const { graph, rideInfo, buildingPlatforms } = buildGraph(
    occsByLine,
    plfs,
    stas,
    buildings,
    platformToStation,
    { transferWalkSpeed, railSpeed, stationTransferCostDivisor, normalSamePlatformTransferCost }
  );

  const startPlatforms = buildingPlatforms.get(startBuilding.id) ?? [];
  const endPlatforms = new Set(buildingPlatforms.get(endBuilding.id) ?? []);

  if (startPlatforms.length === 0 || endPlatforms.size === 0) {
    return {
      ok: false,
      reason: '起点或终点车站建筑下未找到可用站台（请检查 StationsGroup -> STA.platforms -> PLF.Situation/Connect）。',
      mode,
      totalDistance: 0,
      totalTimeSeconds: 0,
      transferCount: 0,
      segments: [],
      overlay: { segments: [], allCoords: [] },
      usedLineChips: [],
      startResolvedBuilding: { id: startBuilding.id, name: startBuilding.name, point: startBuilding.representativePoint, distanceToInput: startD },
      endResolvedBuilding: { id: endBuilding.id, name: endBuilding.name, point: endBuilding.representativePoint, distanceToInput: endD },
      access: { startToBuildingDistance: startD, endToBuildingDistance: endD },
    };
  }

  // 多源起点：从 start building 的 passenger 平台节点开始
  const startNodes = startPlatforms.map(platformNode);

  // 终点：到达 end building 的任一 passenger 平台节点即可
  const isGoal = (n: NodeKey) => n.startsWith('P:') && endPlatforms.has(n.slice(2));

  const { goal, prev, dist } = dijkstra(graph, startNodes, isGoal, mode);

  if (!goal) {
    return {
      ok: false,
      reason:
        '未找到可行路线（请检查：PLF.Situation/Available、线路单向、换乘归属 STB/SBP 的 StationsGroup 链路、getin/getout/Overtaking/NextOT）。',
      mode,
      totalDistance: 0,
      totalTimeSeconds: 0,
      transferCount: 0,
      segments: [],
      overlay: { segments: [], allCoords: [] },
      usedLineChips: [],
      startResolvedBuilding: { id: startBuilding.id, name: startBuilding.name, point: startBuilding.representativePoint, distanceToInput: startD },
      endResolvedBuilding: { id: endBuilding.id, name: endBuilding.name, point: endBuilding.representativePoint, distanceToInput: endD },
      access: { startToBuildingDistance: startD, endToBuildingDistance: endD },
    };
  }

  const edges = reconstructEdges(prev, goal);
  const ds = dist.get(goal)!;

  const built = buildRailPlanOutput({
    edges,
    rideInfo,
    stas,
    platformToStation,
  });

  return {
    ok: true,
    mode,
    totalDistance: ds.distance,
    totalTimeSeconds: ds.time,
    transferCount: ds.transfers,
    segments: built.segments,
    overlay: built.overlay,
    usedLineChips: built.usedLineChips,
    startResolvedBuilding: { id: startBuilding.id, name: startBuilding.name, point: startBuilding.representativePoint, distanceToInput: startD },
    endResolvedBuilding: { id: endBuilding.id, name: endBuilding.name, point: endBuilding.representativePoint, distanceToInput: endD },
    access: { startToBuildingDistance: startD, endToBuildingDistance: endD },
  };
}
