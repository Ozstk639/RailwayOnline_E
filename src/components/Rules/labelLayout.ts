import * as L from 'leaflet';

/**
 * LabelLayout 引擎（屏幕空间去重/避让）
 *
 * 设计目标：
 * - 将 label 的“显示/隐藏/摆放位置选择”从具体渲染逻辑中抽离为独立模块
 * - 基于屏幕像素（containerPoint）做碰撞检测与候选位置选择
 * - 通过规则（LabelPlan.declutter）提供可维护的外部接口
 *
 * 说明：
 * - 本模块不创建 Leaflet 图层；它只产出每个 label 的最终像素偏移（dx/dy）与是否显示。
 * - 你可以在 RuleDrivenLayer 中，将 dx/dy 叠加到 anchor 的 containerPoint，再转回 latlng，
 *   继续复用你现有的 makeLabelMarker（从而不改变原 label 的 CSS 风格）。
 */

// ---------------------------- 可调参数接口（预留） ----------------------------

export type LabelLayoutParams = {
  /** 视口边缘留白（px）。label bbox 超出该范围则视为“不可放置” */
  viewportPaddingPx: number;
  /** 碰撞检测的最小间距（px），会对 bbox 做 inflate */
  minSpacingPx: number;
  /** label 候选点与 anchor 的额外“间隙”（px） */
  gapPx: number;
  /** 用于空间索引的网格大小（px），越大越快但粗糙，越小越准但更慢 */
  gridCellPx: number;
  /** 单次布局最多尝试的候选数（防止写太多 candidates 导致卡顿） */
  maxCandidatesPerLabel: number;
  /** 是否允许 label 放到视口之外（一般不允许） */
  allowOutsideViewport: boolean;
};

export const DEFAULT_LABEL_LAYOUT_PARAMS: LabelLayoutParams = {
  viewportPaddingPx: 6,
  minSpacingPx: 3,
  gapPx: 6,
  gridCellPx: 80,
  maxCandidatesPerLabel: 10,
  allowOutsideViewport: false,
};

let _runtimeParams: LabelLayoutParams = { ...DEFAULT_LABEL_LAYOUT_PARAMS };

/**
 * 外部可调用：覆盖默认参数（例如你希望提高性能/更宽松/更严格）
 * - 建议在应用启动或 RuleDrivenLayer 初始化时调用一次即可
 */
export function setLabelLayoutParams(patch: Partial<LabelLayoutParams>) {
  _runtimeParams = { ..._runtimeParams, ...patch };
}

export function getLabelLayoutParams(): LabelLayoutParams {
  return { ..._runtimeParams };
}

// ---------------------------- 外部接口（规则层） ----------------------------

export type LabelCandidateName = 'C' | 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export type LabelCandidate = {
  /** 候选位置名称。若 dx/dy 不给，则由引擎按名称自动计算 */
  name: LabelCandidateName;
  /** 可选：自定义像素偏移（相对 anchor 的 containerPoint） */
  dx?: number;
  dy?: number;
  /**
   * 候选评分偏移（越大越优先）。
   * 默认按 candidates 顺序 + score 排序。
   */
  score?: number;
};

export type LabelDeclutterStrategy = 'greedy';

export type LabelDeclutterConfig = {
  /** 布局策略（预留，当前实现 greedy） */
  strategy?: LabelDeclutterStrategy;

  /** 候选位置列表。不给则按 placement 自动生成 */
  candidates?: Array<LabelCandidate | LabelCandidateName>;

  /** 优先级：越大越先放（同优先级再看更靠近屏幕中心） */
  priority?: number;

  /** label 碰撞间距（覆盖全局 minSpacingPx） */
  minSpacingPx?: number;

  /** 同组控制：每组最多显示多少个（可用于避免同类 label 太密） */
  groupKey?: string;
  maxPerScreen?: number;

  /** 若放不下，是否允许隐藏（默认 true） */
  allowHide?: boolean;

  /** 若放不下，是否允许使用缩略文本（需要提供 abbrev） */
  allowAbbrev?: boolean;
  abbrev?: (text: string) => string;

  /** 覆盖全局视口留白（px） */
  viewportPaddingPx?: number;
};

export type LabelRequest = {
  /** 唯一 id（建议：`${uid}#label`） */
  id: string;
  /** 对应 Feature uid（便于回写到 bundle.label） */
  featureUid?: string;

  /** label anchor（世界坐标） */
  anchorLatLng: L.LatLng;

  /** label 文本 */
  text: string;

  /** 复用现有 makeLabelMarker 的 placement（决定 CSS transform 参考点） */
  placement: 'center' | 'near';

  /** 你现有规则字段：点位 label 垂直偏移（px） */
  offsetY?: number;

  /** 是否带中心点（影响 bbox 宽度估计） */
  withDot?: boolean;

  /** 规则层传入的避让配置 */
  declutter: LabelDeclutterConfig;

  /**
   * 可选：用于测量文字尺寸的 font（越接近你 CSS 的字体越准）
   * - 不给则用默认字体估计
   */
  font?: string;
};

export type PlacedLabel = {
  id: string;
  featureUid?: string;
  text: string;
  /** 相对 anchor 的像素偏移（containerPoint 坐标系） */
  dx: number;
  dy: number;
  hidden: boolean;
};

export type AvoidRectPx = {
  x: number;
  y: number;
  w: number;
  h: number;
  inflatePx?: number;
  /** 该障碍矩形的归属要素 uid，用于“忽略自己” */
  ownerUid?: string;
};



// ---------------------------- 核心实现 ----------------------------

type Rect = { x: number; y: number; w: number; h: number };

function rectIntersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function inflateRect(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

type IndexedRect = Rect & { ownerUid?: string };

class GridIndex {
  private cell: number;
  private buckets: Map<string, IndexedRect[]> = new Map();

  constructor(cellPx: number) {
    this.cell = Math.max(24, Math.floor(cellPx));
  }

  private key(ix: number, iy: number) {
    return `${ix},${iy}`;
  }

  private cellsForRect(r: Rect) {
    const minX = Math.floor(r.x / this.cell);
    const maxX = Math.floor((r.x + r.w) / this.cell);
    const minY = Math.floor(r.y / this.cell);
    const maxY = Math.floor((r.y + r.h) / this.cell);
    const out: Array<[number, number]> = [];
    for (let ix = minX; ix <= maxX; ix++) for (let iy = minY; iy <= maxY; iy++) out.push([ix, iy]);
    return out;
  }

  query(r: Rect): IndexedRect[] {
    const seen = new Set<IndexedRect>();
    for (const [ix, iy] of this.cellsForRect(r)) {
      const bucket = this.buckets.get(this.key(ix, iy));
      if (!bucket) continue;
      for (const it of bucket) seen.add(it);
    }
    return Array.from(seen);
  }

  add(r: IndexedRect) {
    for (const [ix, iy] of this.cellsForRect(r)) {
      const k = this.key(ix, iy);
      const bucket = this.buckets.get(k) ?? [];
      bucket.push(r);
      this.buckets.set(k, bucket);
    }
  }
}


type Measured = { w: number; h: number };
const _measureCache = new Map<string, Measured>();

function getFontSizePx(font: string): number {
  const m = font.match(/(\d+)\s*px/i);
  return m ? Math.max(8, Number(m[1])) : 12;
}

function measureText(text: string, font: string, withDot: boolean): Measured {
  const key = `${font}|${withDot ? 1 : 0}|${text}`;
  const hit = _measureCache.get(key);
  if (hit) return hit;

  // SSR/构建环境兜底：用近似估计，避免 document 未定义导致 build 报错
  if (typeof document === 'undefined') {
    const fontSize = getFontSizePx(font);
    const approx = {
      w: Math.ceil(text.length * fontSize * 0.62) + 12 + (withDot ? 14 : 0),
      h: Math.ceil(fontSize * 1.35) + 8,
    };
    _measureCache.set(key, approx);
    return approx;
  }

  // canvas measureText
  const canvas = (measureText as any).__canvas || ((measureText as any).__canvas = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const fontSize = getFontSizePx(font);
    const approx = {
      w: Math.ceil(text.length * fontSize * 0.62) + 12 + (withDot ? 14 : 0),
      h: Math.ceil(fontSize * 1.35) + 8,
    };
    _measureCache.set(key, approx);
    return approx;
  }

  ctx.font = font;
  const metrics = ctx.measureText(text);
  const fontSize = getFontSizePx(font);

  // 你的 label HTML 有 padding + border；这里按经验值加入余量
  const w = Math.ceil(metrics.width) + 12 + (withDot ? 14 : 0);
  const h = Math.ceil(fontSize * 1.35) + 8;

  const measured = { w, h };
  _measureCache.set(key, measured);

  // 简单上限，防止缓存无限增长
  if (_measureCache.size > 5000) {
    const it = _measureCache.keys().next();
    if (!it.done) _measureCache.delete(it.value);
  }

  return measured;
}

/**
 * 根据 placement + offsetY 计算 label bbox（屏幕像素）
 * - 这里要与 makeLabelMarker 的 CSS transform 逻辑保持一致
 */
function computeLabelRect(anchor: L.Point, size: Measured, placement: 'center' | 'near', offsetY: number): Rect {
  if (placement === 'center') {
    const x = anchor.x - size.w / 2;
    const y = anchor.y - size.h / 2;
    return { x, y, w: size.w, h: size.h };
  }

  // placement === 'near' => transform: translate(-50%, -120%)，再加 margin-top:-offsetY
  const x = anchor.x - size.w / 2;
  const y = anchor.y - size.h * 1.2 - offsetY;
  return { x, y, w: size.w, h: size.h };
}

function normalizeCandidates(
  req: LabelRequest,
  size: Measured,
  params: LabelLayoutParams,
): LabelCandidate[] {
  const raw = req.declutter.candidates;

  const asCandidate = (c: LabelCandidate | LabelCandidateName): LabelCandidate => {
    if (typeof c === 'string') return { name: c };
    return c;
  };

  const list = (raw && raw.length ? raw.map(asCandidate) : defaultCandidates(req.placement)).slice(
    0,
    Math.max(1, params.maxCandidatesPerLabel),
  );

  // 将 name 转为 dx/dy（若用户未给 dx/dy）
  return list.map((c, idx) => {
    if (typeof c.dx === 'number' && typeof c.dy === 'number') return c;

    const { dx, dy } = candidateShift(c.name, req.placement, size, params.gapPx);
    return { ...c, dx, dy, score: (c.score ?? 0) + (list.length - idx) * 0.01 };
  });
}

function defaultCandidates(placement: 'center' | 'near'): LabelCandidate[] {
  if (placement === 'center') return [{ name: 'C' }, { name: 'N' }, { name: 'S' }, { name: 'E' }, { name: 'W' }];
  // near：优先在点上方（与你现有 near 样式一致），然后尝试斜上/左右/斜下等
  return [{ name: 'N' }, { name: 'NE' }, { name: 'NW' }, { name: 'E' }, { name: 'W' }, { name: 'SE' }, { name: 'SW' }, { name: 'S' }];
}

/**
 * 候选位置 -> anchor 的像素偏移
 * 注意：我们偏移的是“anchor 点”（marker latlng 对应的 containerPoint），而非 bbox 左上角。
 */
function candidateShift(
  name: LabelCandidateName,
  placement: 'center' | 'near',
  size: Measured,
  gap: number,
): { dx: number; dy: number } {
  const halfW = size.w / 2;
  const halfH = size.h / 2;

  // 经验偏移：尽量让 bbox 远离 anchor
  if (placement === 'center') {
    switch (name) {
      case 'C':
        return { dx: 0, dy: 0 };
      case 'N':
        return { dx: 0, dy: -(halfH + gap) };
      case 'S':
        return { dx: 0, dy: halfH + gap };
      case 'E':
        return { dx: halfW + gap, dy: 0 };
      case 'W':
        return { dx: -(halfW + gap), dy: 0 };
      case 'NE':
        return { dx: halfW + gap, dy: -(halfH + gap) };
      case 'NW':
        return { dx: -(halfW + gap), dy: -(halfH + gap) };
      case 'SE':
        return { dx: halfW + gap, dy: halfH + gap };
      case 'SW':
        return { dx: -(halfW + gap), dy: halfH + gap };
    }
  }

  // placement === 'near'：默认 bbox 已在 anchor 上方；因此更多用“水平”错开
  switch (name) {
    case 'N':
      return { dx: 0, dy: 0 };
    case 'NE':
      return { dx: halfW + gap, dy: 0 };
    case 'NW':
      return { dx: -(halfW + gap), dy: 0 };
    case 'E':
      return { dx: halfW + gap, dy: Math.max(0, size.h * 0.25) };
    case 'W':
      return { dx: -(halfW + gap), dy: Math.max(0, size.h * 0.25) };
    case 'SE':
      return { dx: halfW + gap, dy: size.h + gap };
    case 'SW':
      return { dx: -(halfW + gap), dy: size.h + gap };
    case 'S':
      return { dx: 0, dy: size.h + gap };
    case 'C':
      return { dx: 0, dy: 0 };
  }
}

function inViewport(rect: Rect, size: L.Point, pad: number): boolean {
  const left = pad;
  const top = pad;
  const right = size.x - pad;
  const bottom = size.y - pad;
  return rect.x >= left && rect.y >= top && rect.x + rect.w <= right && rect.y + rect.h <= bottom;
}

type LayoutItem = {
  req: LabelRequest;
  anchorPx: L.Point;
  size: Measured;
  candidates: LabelCandidate[];
  priority: number;
  allowHide: boolean;
  allowAbbrev: boolean;
  abbrev?: (s: string) => string;
  groupKey?: string;
  maxPerScreen?: number;
  minSpacingPx: number;
  viewportPaddingPx: number;
  centerDist2: number;
};

/**
 * 执行一次布局（建议在 moveend/zoomend 时调用，不要在 mousemove/drag 时高频调用）
 */
export function layoutLabelsOnMap(
  map: L.Map,
  requests: LabelRequest[],
  opts?: {
    /** 同优先级时：更靠近屏幕中心的 label 更优先（默认 true） */
    preferNearCenter?: boolean;

    /** 新增：需要避让的屏幕矩形（点图标/其它遮挡物） */
    avoidRectsPx?: AvoidRectPx[];

    /** 新增：对 avoidRects 额外膨胀（px），用于给图标留出更大缓冲区 */
    avoidSpacingPx?: number;
  },
): PlacedLabel[] {

  const params = _runtimeParams;
  const size = map.getSize();
  const center = L.point(size.x / 2, size.y / 2);

  const items: LayoutItem[] = [];

  for (const req of requests) {
    const decl = req.declutter ?? {};
    const font = req.font ?? '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    const measured = measureText(req.text, font, !!req.withDot);

    const anchorPx = map.latLngToContainerPoint(req.anchorLatLng);
    const candidates = normalizeCandidates(req, measured, {
      ...params,
      viewportPaddingPx: decl.viewportPaddingPx ?? params.viewportPaddingPx,
    });

    const dx = anchorPx.x - center.x;
    const dy = anchorPx.y - center.y;

    items.push({
      req,
      anchorPx,
      size: measured,
      candidates,
      priority: decl.priority ?? 0,
      allowHide: decl.allowHide !== false,
      allowAbbrev: !!decl.allowAbbrev && typeof decl.abbrev === 'function',
      abbrev: decl.abbrev,
      groupKey: decl.groupKey,
      maxPerScreen: decl.maxPerScreen,
      minSpacingPx: decl.minSpacingPx ?? params.minSpacingPx,
      viewportPaddingPx: decl.viewportPaddingPx ?? params.viewportPaddingPx,
      centerDist2: dx * dx + dy * dy,
    });
  }

  // 排序：priority desc；同级按“离屏幕中心更近”优先（可关）；再按文本短优先（更易放）
  items.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (opts?.preferNearCenter !== false) {
      if (a.centerDist2 !== b.centerDist2) return a.centerDist2 - b.centerDist2;
    }
    return a.req.text.length - b.req.text.length;
  });

  const placed: PlacedLabel[] = [];
  const index = new GridIndex(params.gridCellPx);

  // 新增：把点图标等“硬占用区”提前写入索引，label 将自动避开
const avoidPadExtra = opts?.avoidSpacingPx ?? 0;
const avoidRects = opts?.avoidRectsPx ?? [];
for (const ar of avoidRects) {
  const pad = (ar.inflatePx ?? 0) + avoidPadExtra + params.minSpacingPx;
  const inflated = inflateRect({ x: ar.x, y: ar.y, w: ar.w, h: ar.h }, pad);
  index.add({ ...inflated, ownerUid: ar.ownerUid });
}


  const groupCount = new Map<string, number>();

  const tryPlace = (item: LayoutItem, text: string): PlacedLabel | null => {
    const baseReq = item.req;
    const font = baseReq.font ?? '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    const measured = measureText(text, font, !!baseReq.withDot);

    const candidates = normalizeCandidates(
      { ...baseReq, text },
      measured,
      { ...params, viewportPaddingPx: item.viewportPaddingPx },
    )
      .slice(0, params.maxCandidatesPerLabel)
      .sort((c1, c2) => (c2.score ?? 0) - (c1.score ?? 0));

    for (const c of candidates) {
      const dx = c.dx ?? 0;
      const dy = c.dy ?? 0;

      const anchor = L.point(item.anchorPx.x + dx, item.anchorPx.y + dy);
      const rect = computeLabelRect(anchor, measured, baseReq.placement, Number(baseReq.offsetY ?? 0));

      if (!params.allowOutsideViewport && !inViewport(rect, size, item.viewportPaddingPx)) {
        continue;
      }

      const expanded = inflateRect(rect, item.minSpacingPx);
        const hits = index.query(expanded);
        let ok = true;
        for (const h of hits) {
        // 忽略“自己的点图标占用区”，否则 near label 会必然撞到自己
            if (h.ownerUid && h.ownerUid === baseReq.featureUid) continue;

            if (rectIntersects(expanded, h)) {
                ok = false;
                break;
            }
        }

      if (!ok) continue;

      // group 限制
      if (item.groupKey && typeof item.maxPerScreen === 'number') {
        const cur = groupCount.get(item.groupKey) ?? 0;
        if (cur >= item.maxPerScreen) {
          continue;
        }
      }

      index.add(expanded);

      if (item.groupKey && typeof item.maxPerScreen === 'number') {
        groupCount.set(item.groupKey, (groupCount.get(item.groupKey) ?? 0) + 1);
      }

      return {
        id: baseReq.id,
        featureUid: baseReq.featureUid,
        text,
        dx,
        dy,
        hidden: false,
      };
    }

    return null;
  };

  for (const item of items) {
    // 先尝试原文
    let p = tryPlace(item, item.req.text);

    // 再尝试缩略
    if (!p && item.allowAbbrev && item.abbrev) {
      const short = item.abbrev(item.req.text);
      if (short && short !== item.req.text) {
        p = tryPlace(item, short);
      }
    }

    if (p) {
      placed.push(p);
      continue;
    }

    // 放不下
    placed.push({
      id: item.req.id,
      featureUid: item.req.featureUid,
      text: item.req.text,
      dx: 0,
      dy: 0,
      hidden: item.allowHide,
    });
  }

  return placed;
}
