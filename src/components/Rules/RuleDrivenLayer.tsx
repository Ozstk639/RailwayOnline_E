import { useEffect, useMemo, useRef, useState } from 'react';



import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { DynmapProjection } from '@/lib/DynmapProjection';

import { RULE_DATA_SOURCES } from './ruleDataSources';
import { FeatureStore } from './featureStore';
import { DEFAULT_FLOOR_VIEW, buildFeatureMeta, findFirstRule, toZoomLevel, type FeatureRecord, type GeoType, type RenderContext } from './renderRules';
import { layoutLabelsOnMap, type LabelRequest, type AvoidRectPx } from './labelLayout';


const FLOOR_VIEW_MIN_LEVEL = Math.max(0, DEFAULT_FLOOR_VIEW.minLevel);



type Props = {
  mapReady: boolean;
  map: L.Map;
  projection: DynmapProjection;
  worldId: string;
  visible: boolean;
};

const Y_FOR_DISPLAY = 64;

type LayerBundle = {
  main: L.Layer;
  label?: L.Layer;

  /** 新增：用于 declutter label 复用，避免 refresh 每次重建 marker */
  labelKey?: string;

  kind: 'marker' | 'circleMarker' | 'path';
  iconUrl?: string;
  pane?: string;
};


function toP3(v: any): { x: number; y: number; z: number } | null {
  if (!v) return null;
  if (Array.isArray(v)) {
    const x = Number(v[0]);
    const y = Number(v[1]);
    const z = Number(v[2]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return { x, y, z };
    if (Number.isFinite(x) && Number.isFinite(z)) return { x, y: Y_FOR_DISPLAY, z };
    return null;
  }
  if (typeof v === 'object') {
    const x = Number((v as any).x);
    const y = Number((v as any).y ?? Y_FOR_DISPLAY);
    const z = Number((v as any).z);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return { x, y, z };
  }
  return null;
}

function toP3Array(v: any): Array<{ x: number; y: number; z: number }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (const item of v) {
    const p = toP3(item);
    if (p) out.push(p);
  }
  return out;
}

function pointInPolygonXZ(p: { x: number; z: number }, poly: Array<{ x: number; z: number }>) {
  // ray-casting
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const zi = poly[i].z;
    const xj = poly[j].x;
    const zj = poly[j].z;

    const intersect = (zi > p.z) !== (zj > p.z) && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonCentroidXZ(poly: Array<{ x: number; z: number }>): { x: number; z: number } | null {
  if (poly.length < 3) return null;
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
  if (Math.abs(area) < 1e-9) return null;
  area *= 0.5;
  cx /= 6 * area;
  cz /= 6 * area;
  if (!Number.isFinite(cx) || !Number.isFinite(cz)) return null;
  return { x: cx, z: cz };
}




// ======================= 楼层激活/保持：中心范围阈值（可调） =======================
const FLOOR_PICK_ACTIVATE_PX = 70; // “接近中心即可激活”的半径（像素）
const FLOOR_PICK_KEEP_PX = 120;    // “保持楼层菜单”的半径（像素，建议 > ACTIVATE）
const FLOOR_PICK_VIEW_PAD = 0.25;  // 预筛选：视野 bounds 的 padding，减少遍历成本


// ======================= 楼层关联：向上索引 + 向下补全（可拆卸） =======================
const FLOOR_BUILDING_CLASSES = ['STB', 'SBP', 'BUD'] as const;
const FLOOR_FLOOR_CLASSES = ['STF', 'FLR'] as const;

type FloorBuildingClass = (typeof FLOOR_BUILDING_CLASSES)[number];
type FloorClass = (typeof FLOOR_FLOOR_CLASSES)[number];

function getBuildingIdCandidatesForFloorView(b: FeatureRecord): Set<string> {
  const fi: any = b.featureInfo;
  const cls = String(b.meta?.Class ?? '').trim() as FloorBuildingClass;
  const vals: string[] = [];

  if (cls === 'STB') {
    vals.push(fi?.staBuildingID, fi?.ID);
  } else if (cls === 'SBP') {
    vals.push(fi?.staBuildingPointID, fi?.staBuildingPointId, fi?.staBuildingID, fi?.ID);
  } else if (cls === 'BUD') {
    vals.push(fi?.BuildingID, fi?.ID);
  } else {
    vals.push(fi?.ID);
  }

  const out = new Set<string>();
  for (const v of vals) {
    const s = String(v ?? '').trim();
    if (s) out.add(s);
  }
  return out;
}

function getFloorIdForFloorView(f: FeatureRecord): string {
  const fi: any = f.featureInfo;
  const cls = String(f.meta?.Class ?? '').trim() as FloorClass;
  if (cls === 'STF') return String(fi?.staBFloorID ?? fi?.ID ?? '').trim();
  if (cls === 'FLR') return String(fi?.FloorID ?? fi?.ID ?? '').trim();
  return String(fi?.ID ?? '').trim();
}

function getFloorParentIdForFloorView(f: FeatureRecord): string {
  const fi: any = f.featureInfo;
  const cls = String(f.meta?.Class ?? '').trim() as FloorClass;
  if (cls === 'STF') return String(fi?.staBuildingID ?? '').trim();
  if (cls === 'FLR') return String(fi?.BuildingID ?? '').trim();
  return '';
}

function extractDownwardFloorRefsFromBuilding(b: FeatureRecord): string[] {
  const fi: any = b.featureInfo;
  const arr = Array.isArray(fi?.Floors) ? fi.Floors : [];
  const out: string[] = [];
  for (const it of arr) {
    const ref = String((it as any)?.[DEFAULT_FLOOR_VIEW.buildingFloorRefField] ?? '').trim();
    if (ref) out.push(ref);
  }
  return out;
}

function supplementFloorIdsByDownwardRefs(
  b: FeatureRecord,
  floorsById: Map<string, FeatureRecord>,
  floorIdSet: Set<string>
) {
  // 模块化：后续若要性能优化，可直接跳过该补全步骤
  const refs = extractDownwardFloorRefsFromBuilding(b);
  for (const ref of refs) {
    if (floorIdSet.has(ref)) continue;
    if (floorsById.has(ref)) floorIdSet.add(ref);
  }
}

function distanceFromViewportCenterToBoundsPx(map: L.Map, bounds: L.LatLngBounds): number {
  const size = map.getSize();
  const c = L.point(size.x / 2, size.y / 2);

  const nw = map.latLngToContainerPoint(bounds.getNorthWest());
  const se = map.latLngToContainerPoint(bounds.getSouthEast());

  const minX = Math.min(nw.x, se.x);
  const maxX = Math.max(nw.x, se.x);
  const minY = Math.min(nw.y, se.y);
  const maxY = Math.max(nw.y, se.y);

  const dx = c.x < minX ? (minX - c.x) : c.x > maxX ? (c.x - maxX) : 0;
  const dy = c.y < minY ? (minY - c.y) : c.y > maxY ? (c.y - maxY) : 0;

  return Math.hypot(dx, dy);
}

function getFeatureBoundsLatLng(
  projection: any,
  coords3: Array<{ x: number; z: number }>,
  y: number
): L.LatLngBounds | null {
  if (!coords3?.length) return null;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const pt of coords3) {
    minX = Math.min(minX, pt.x);
    maxX = Math.max(maxX, pt.x);
    minZ = Math.min(minZ, pt.z);
    maxZ = Math.max(maxZ, pt.z);
  }

  const ll1 = projection.locationToLatLng(minX, y, minZ);
  const ll2 = projection.locationToLatLng(minX, y, maxZ);
  const ll3 = projection.locationToLatLng(maxX, y, minZ);
  const ll4 = projection.locationToLatLng(maxX, y, maxZ);

  const minLat = Math.min(ll1.lat, ll2.lat, ll3.lat, ll4.lat);
  const maxLat = Math.max(ll1.lat, ll2.lat, ll3.lat, ll4.lat);
  const minLng = Math.min(ll1.lng, ll2.lng, ll3.lng, ll4.lng);
  const maxLng = Math.max(ll1.lng, ll2.lng, ll3.lng, ll4.lng);

  return L.latLngBounds(L.latLng(minLat, minLng), L.latLng(maxLat, maxLng));
}


function makeLabelMarker(
  latlng: L.LatLng,
  text: string,
  placement: 'center' | 'near',
  withDot?: boolean,
  offsetY?: number, // ✅ 新增：第5个参数，放最后，避免改其他调用点
) {
  const safe = String(text ?? '').replace(/[<>&]/g, (m) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' } as any)[m]);

  // 原本的位移逻辑保持不变
  const transform = placement === 'near' ? 'translate(-50%, -120%)' : 'translate(-50%, -50%)';

  // ✅ 只对 near 再额外上移（px）。center 不动，避免影响面要素中心标注。
  const extraMarginTop = placement === 'near' ? -(Number(offsetY ?? 0)) : 0;

  const dotHtml = withDot
    ? `<span style="
         display:inline-block;
         width:8px;height:8px;
         border-radius:999px;
         background:#fff;
         margin-right:6px;
         box-shadow:0 0 0 2px rgba(0,0,0,0.35);
       "></span>`
    : '';

  const html = `
    <div style="
      background: rgba(0,0,0,0.65);
      color: #fff;
      padding: 2px 6px;
      border-radius: 6px;
      font-size: 12px;
      white-space: nowrap;
      transform: ${transform};
      margin-top: ${extraMarginTop}px;   /* ✅ 新增 */
      pointer-events: none;
      display: inline-flex;
      align-items: center;
    ">${dotHtml}${safe}</div>
  `;

  return L.marker(latlng, {
    interactive: false,
    pane: 'ria-label',
    icon: L.divIcon({ className: '', html, iconSize: [0, 0] }),
  });
}



async function fetchJsonArray(url: string): Promise<any[]> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  const data = await resp.json();
  if (!Array.isArray(data)) return [];
  return data;
}

function detectGeoType(featureInfo: any): GeoType | null {
  const t = String((featureInfo as any)?.Type ?? '').trim();
  if (t === 'Points' || t === 'Polyline' || t === 'Polygon') return t as GeoType;
  // 兜底：按字段猜
  if ((featureInfo as any)?.coordinate) return 'Points';
  if (Array.isArray((featureInfo as any)?.PLpoints) || Array.isArray((featureInfo as any)?.Linepoints)) return 'Polyline';
  if (Array.isArray((featureInfo as any)?.Conpoints) || Array.isArray((featureInfo as any)?.Flrpoints)) return 'Polygon';
  return null;
}

function buildRecordsFromJson(items: any[], sourceFile: string): FeatureRecord[] {
  const out: FeatureRecord[] = [];
  let uidSeq = 1;

  for (const item of items) {
    const cls = String((item as any)?.Class ?? '').trim();
    if (!cls) continue;
    const type = detectGeoType(item);
    if (!type) continue;

    const uid = `${sourceFile}#${uidSeq++}`;
    const meta = buildFeatureMeta(item, cls, type, sourceFile);

    const r: FeatureRecord = {
      uid,
      meta,
      featureInfo: item,
      type,
    };

    if (type === 'Points') {
      const p = toP3((item as any).coordinate ?? (item as any).Conpoints?.[0] ?? null);
      if (!p) continue;
      r.p3 = p;
    } else if (type === 'Polyline') {
      const arr = toP3Array((item as any).PLpoints ?? (item as any).Linepoints);
      if (arr.length < 2) continue;
      r.coords3 = arr;
    } else if (type === 'Polygon') {
      const pts = (item as any).Conpoints ?? (item as any).Flrpoints ?? null;
      const arr = toP3Array(pts);
      if (arr.length < 3) continue;
      r.coords3 = arr;
    }

    out.push(r);
  }
  return out;
}

export default function RuleDrivenLayer(props: Props) {
  const { mapReady, map, projection, worldId, visible } = props;

  const rootRef = useRef<L.LayerGroup | null>(null);
  const cacheRef = useRef<Map<string, LayerBundle>>(new Map());
  const recordsRef = useRef<FeatureRecord[]>([]);
  const storeRef = useRef<FeatureStore | null>(null);

  // floor UI
  const [floorOptions, setFloorOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [activeFloorIndex, setActiveFloorIndex] = useState<number>(0);
  const [activeBuildingUid, setActiveBuildingUid] = useState<string | null>(null);
  const [activeBuildingFloorRefSet, setActiveBuildingFloorRefSet] = useState<Set<string> | null>(null);
  const [activeBuildingName, setActiveBuildingName] = useState<string>('');

  // 让 React 能感知 Leaflet 的 zoom/move（否则 ctx/showFloorUI 可能停留在旧值）
const [leafletZoomState, setLeafletZoomState] = useState<number>(() => map.getZoom());

const [dataVersion, setDataVersion] = useState(0);


useEffect(() => {
  if (!mapReady) return;

  const sync = () => setLeafletZoomState(map.getZoom());
  sync();

  map.on('zoomend', sync);
  map.on('moveend', sync);
  return () => {
    map.off('zoomend', sync);
    map.off('moveend', sync);
  };
}, [mapReady, map]);


// (1) 加载数据（worldId + dataSources）
useEffect(() => {
  let cancelled = false;

  async function load() {
    if (!mapReady) return;
    const ds = RULE_DATA_SOURCES[worldId];
    if (!ds || ds.files.length === 0) {
      recordsRef.current = [];
      storeRef.current = new FeatureStore([]);
      setFloorOptions([]);
      setActiveBuildingUid(null);
      setActiveBuildingFloorRefSet(null);
      setActiveBuildingName('');
      return;
    }

    const all: FeatureRecord[] = [];
    for (const file of ds.files) {
      const url = `${ds.baseUrl.replace(/\/$/, '')}/${file}`;
      try {
        const items = await fetchJsonArray(url);
        all.push(...buildRecordsFromJson(items, file));
      } catch (e) {
        // 单文件失败不阻塞其余文件
        console.warn(`[RuleDrivenLayer] failed to load ${url}`, e);
      }
    }

    if (cancelled) return;
    recordsRef.current = all;
    const store = new FeatureStore(all);
    storeRef.current = store;

    // (2) 重复 key 排查：Class|idField=idValue
    const dups = store.buildDuplicateKeyReport();
    if (dups.length) {
      console.warn('[RuleDrivenLayer] duplicate Class+ID keys detected:', dups.map(d => d.dupKey));
      for (const d of dups) console.warn('[RuleDrivenLayer] dupKey detail:', d);
    }

    // 新数据 → 清空缓存，让渲染逻辑重新建 layer（避免旧 layer 残留）
    cacheRef.current.clear();
    rootRef.current?.clearLayers();

    // 重置楼层态
    setFloorOptions([]);
    setActiveBuildingUid(null);
    setActiveBuildingFloorRefSet(null);
    setActiveBuildingName('');
    setActiveFloorIndex(0);

    // ✅ 关键：用 state 告诉 React “数据已就绪”
    // ref 写入不会触发 (4)/(5) 重新跑；重启服务后常出现“数据读到但楼层/图层不刷新”
    setDataVersion(v => v + 1);
  }

  load();
  return () => {
    cancelled = true;
  };
}, [mapReady, worldId]);


  // (3) 总开关：挂载/卸载 root layerGroup
  useEffect(() => {
    if (!mapReady) return;
    if (!rootRef.current) rootRef.current = L.layerGroup();

    if (!visible) {
      if (map.hasLayer(rootRef.current)) map.removeLayer(rootRef.current);
      return;
    }
    if (!map.hasLayer(rootRef.current)) rootRef.current.addTo(map);

    return () => {
      if (rootRef.current && map.hasLayer(rootRef.current)) map.removeLayer(rootRef.current);
    };
  }, [mapReady, map, visible]);

  const ctx: RenderContext = useMemo(() => {
  const leafletZoom = leafletZoomState;
  const zoomLevel = toZoomLevel(leafletZoom);
  return {
    worldId,
    leafletZoom,
    zoomLevel,
    //inFloorView: zoomLevel >= DEFAULT_FLOOR_VIEW.minLevel,
    inFloorView: zoomLevel >= FLOOR_VIEW_MIN_LEVEL,
    activeBuildingUid,
    activeFloorSelector: floorOptions[activeFloorIndex]?.value ?? null,
    activeBuildingFloorRefSet,
  };
}, [worldId, leafletZoomState, activeBuildingUid, activeBuildingFloorRefSet, floorOptions, activeFloorIndex]);

  // (3.5) 初始化自定义 panes：用于稳定控制遮挡顺序（避免“读入顺序导致覆盖”）
  useEffect(() => {
    if (!mapReady) return;

    const ensurePane = (name: string, z: number) => {
      let p = map.getPane(name);
      if (!p) p = map.createPane(name);
      p.style.zIndex = String(z);
    };

    // 线/面默认层（接近 Leaflet overlayPane 的 400）
    ensurePane('ria-overlay', 410);

    // 点层：永远在面/线之上
    ensurePane('ria-point', 650);

    // 更“顶”的点层（你可以在规则里指定把某些点强制压到最上）
    ensurePane('ria-point-top', 660);

    // label 层：比点再高一点
    ensurePane('ria-label', 670);
  }, [mapReady, map]);


  // (4) 选择“当前激活建筑” + 生成楼层 options
  useEffect(() => {
    if (!mapReady) return;
    const store = storeRef.current;
    if (!store) return;

    const updateActiveBuilding = () => {
      const leafletZoom = map.getZoom();
      const zoomLevel = toZoomLevel(leafletZoom);
      //const inFloorView = zoomLevel >= DEFAULT_FLOOR_VIEW.minLevel;
      const inFloorView = zoomLevel >= FLOOR_VIEW_MIN_LEVEL;


      if (!inFloorView) {
        setActiveBuildingUid(null);
        setActiveBuildingFloorRefSet(null);
        setActiveBuildingName('');
        setFloorOptions([]);
        setActiveFloorIndex(0);
        return;
      }

      const center = map.getCenter();
      const loc = (projection as any).latLngToLocation?.(center, Y_FOR_DISPLAY);
      if (!loc) return;
      const p = { x: Number(loc.x), z: Number(loc.z) };



      // 以“中心点命中/接近建筑”为激活建筑（支持 STB/SBP/BUD）
      const buildings: FeatureRecord[] = (FLOOR_BUILDING_CLASSES as readonly string[]).flatMap((c) => store.byClass[c] ?? []);
      let picked: FeatureRecord | null = null;

      // (1) 严格命中：中心点落入建筑面（Polygon）
      for (const b of buildings) {
        if (b.type !== 'Polygon' || !b.coords3 || b.coords3.length < 3) continue;
        const poly = b.coords3.map((pt) => ({ x: pt.x, z: pt.z }));
        if (pointInPolygonXZ(p, poly)) {
          picked = b;
          break;
        }
      }

      // (2) 非严格命中：中心点在一定像素范围内“接近”建筑（Polygon 用 bounds；Point 用点距）
      if (!picked) {
        const paddedView = map.getBounds().pad(FLOOR_PICK_VIEW_PAD);
        let best: { b: FeatureRecord; dist: number } | null = null;

        const size = map.getSize();
        const centerPx = L.point(size.x / 2, size.y / 2);

        for (const b of buildings) {
          // Point building（SBP 等）
          if (b.type === 'Points' && b.p3) {
            const ll = projection.locationToLatLng(b.p3.x, b.p3.y, b.p3.z);
            if (!paddedView.contains(ll)) continue;
            const pt = map.latLngToContainerPoint(ll);
            const d = Math.hypot(pt.x - centerPx.x, pt.y - centerPx.y);
            if (d <= FLOOR_PICK_ACTIVATE_PX && (!best || d < best.dist)) {
              best = { b, dist: d };
            }
            continue;
          }

          // Polygon building（STB/BUD 等）
          if (!b.coords3?.length) continue;
          const bBounds = getFeatureBoundsLatLng(projection, b.coords3 as any, Y_FOR_DISPLAY);
          if (!bBounds) continue;
          if (!paddedView.intersects(bBounds)) continue;

          const d = distanceFromViewportCenterToBoundsPx(map, bBounds);
          if (d <= FLOOR_PICK_ACTIVATE_PX && (!best || d < best.dist)) {
            best = { b, dist: d };
          }
        }

        picked = best?.b ?? null;
      }

      const newUid = picked?.uid ?? null;

      // picked == null：只有当“上一次激活建筑”离开中心一定范围时才清空（避免闪烁）
      if (!picked) {
        if (activeBuildingUid) {
          const prev = buildings.find((b) => b.uid === activeBuildingUid);
          if (prev) {
            // Polygon：用 bounds
            if (prev.type === 'Polygon' && prev.coords3?.length) {
              const prevBounds = getFeatureBoundsLatLng(projection, prev.coords3 as any, Y_FOR_DISPLAY);
              if (prevBounds) {
                const d = distanceFromViewportCenterToBoundsPx(map, prevBounds);
                if (d <= FLOOR_PICK_KEEP_PX) return;
              }
            }
            // Point：用点距
            if (prev.type === 'Points' && prev.p3) {
              const size = map.getSize();
              const centerPx = L.point(size.x / 2, size.y / 2);
              const ll = projection.locationToLatLng(prev.p3.x, prev.p3.y, prev.p3.z);
              const pt = map.latLngToContainerPoint(ll);
              const d = Math.hypot(pt.x - centerPx.x, pt.y - centerPx.y);
              if (d <= FLOOR_PICK_KEEP_PX) return;
            }
          }
        }

        setActiveBuildingUid(null);
        setActiveBuildingFloorRefSet(null);
        setActiveBuildingName('');
        setFloorOptions([]);
        setActiveFloorIndex(0);
        return;
      }

      // picked 有值：如果还是同一栋建筑，可提前 return（减少重复算）
      if (newUid === activeBuildingUid) return;

      // 切换到新的建筑
      setActiveBuildingUid(newUid);

      // 建筑名兼容：STB/SBP/BUD
      const bfi: any = picked.featureInfo;
      const bName = String(
        bfi?.staBuildingName ?? bfi?.staBuildingPointName ?? bfi?.BuildingName ?? bfi?.name ?? ''
      ).trim();
      setActiveBuildingName(bName);

      // 楼层关联：优先 STF/FLR 向上索引建筑；再用建筑 Floors[] 向下补全
      const floors: FeatureRecord[] = (FLOOR_FLOOR_CLASSES as readonly string[]).flatMap((c) => store.byClass[c] ?? []);

      const floorsById = new Map<string, FeatureRecord>();
      for (const f of floors) {
        const fid = getFloorIdForFloorView(f);
        if (fid) floorsById.set(fid, f);
      }

      const buildingIds = getBuildingIdCandidatesForFloorView(picked);
      const floorIdSet = new Set<string>();

      // (A) STF/FLR 向上索引（parentId → buildingId）
      if (buildingIds.size) {
        for (const f of floors) {
          const parent = getFloorParentIdForFloorView(f);
          if (!parent || !buildingIds.has(parent)) continue;
          const fid = getFloorIdForFloorView(f);
          if (fid) floorIdSet.add(fid);
        }
      }

      // (B) 兼容：STB/SBP/BUD.Floors[] 向下补全（可拆卸）
      supplementFloorIdsByDownwardRefs(picked, floorsById, floorIdSet);

      // 若仍无任何楼层，则不进入楼层视角（避免“任何建筑都出楼层条”）
      if (floorIdSet.size === 0) {
        setActiveBuildingUid(null);
        setActiveBuildingFloorRefSet(null);
        setActiveBuildingName('');
        setFloorOptions([]);
        setActiveFloorIndex(0);
        return;
      }

      setActiveBuildingFloorRefSet(floorIdSet);

      // 生成 floorOptions：从 STF/FLR 中筛选属于该建筑的楼层，按 NofFloor 去重排序
      const selectorSet = new Set<string>();
      for (const fid of floorIdSet) {
        const f = floorsById.get(fid);
        if (!f) continue;
        const selector = String((f.featureInfo as any)?.[DEFAULT_FLOOR_VIEW.floorSelectorField] ?? '').trim();
        if (selector) selectorSet.add(selector);
      }

      const values = Array.from(selectorSet);
      // 排序：数值优先；默认“上到下”显示（大到小）
      values.sort((a, b) => {
        const na = Number(a);
        const nb = Number(b);
        if (Number.isFinite(na) && Number.isFinite(nb)) return nb - na;
        return String(b).localeCompare(String(a));
      });

      const opts = values.map((v) => {
        const n = Number(v);
        const label = Number.isFinite(n) ? (n >= 0 ? `L${n}` : `B${Math.abs(n)}`) : v;
        return { value: v, label };
      });

      setFloorOptions(opts);
      setActiveFloorIndex(0);

    };

    updateActiveBuilding();
    map.on('moveend', updateActiveBuilding);
    map.on('zoomend', updateActiveBuilding);
    return () => {
      map.off('moveend', updateActiveBuilding);
      map.off('zoomend', updateActiveBuilding);
    };
}, [mapReady, map, projection, activeBuildingUid, dataVersion]);


  // (5) 渲染：根据规则 + zoom + bounds + floor context 进行增量 add/remove
  useEffect(() => {
    if (!mapReady) return;
    if (!visible) return;
    const root = rootRef.current;
    if (!root) return;
    const store = storeRef.current;
    if (!store) return;

const refresh = () => {
  const leafletZoom = map.getZoom();
  const zoomLevel = toZoomLevel(leafletZoom);
  const inFloorView = zoomLevel >= DEFAULT_FLOOR_VIEW.minLevel;

  const context: RenderContext = {
    worldId,
    leafletZoom,
    zoomLevel,
    inFloorView,
    activeBuildingUid,
    activeFloorSelector: floorOptions[activeFloorIndex]?.value ?? null,
    activeBuildingFloorRefSet,
  };

  const bounds = map.getBounds();
  const records = recordsRef.current;

  // declutter labels：先收集 request，后统一跑布局，再回写到各个 bundle.label
  const declutterLabelRequests: LabelRequest[] = [];

  // ✅ 新增：点图标避让矩形（屏幕像素）
const avoidRectsPx: AvoidRectPx[] = [];

  const shouldShow = new Set<string>();

  for (const r of records) {
    const rule = findFirstRule(r);
    if (!rule) continue;

    if (rule.zoom) {
      const [min, max] = rule.zoom;
      if (zoomLevel < min || zoomLevel > max) continue;
    }

    // 可见性条件（楼层选择/存在性等）
    // 声明式：若同 idValue 的目标 Class 存在，则隐藏当前要素（用于“若存在则不渲染”）
    if (rule.hideIfSameIdExistsInClasses && r.meta.idValue) {
      let blocked = false;
      for (const c of rule.hideIfSameIdExistsInClasses) {
        if (store.hasSameIdInClass(c, r.meta.idValue)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
    }
    if (rule.visible && !rule.visible(r, context, store)) continue;

    // 屏幕范围裁剪（点/线/面统一做 bounds.contains）
    let pointLatLng: L.LatLng | undefined;
    if (r.type === 'Points' && r.p3) {
      pointLatLng = projection.locationToLatLng(r.p3.x, r.p3.y, r.p3.z);
      if (!bounds.contains(pointLatLng)) continue;
    } else if (r.coords3 && r.coords3.length) {
      // 用 bbox 做快速裁剪（可读性优先）
      let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
      for (const p of r.coords3) {
        const ll = projection.locationToLatLng(p.x, p.y, p.z);
        minLat = Math.min(minLat, ll.lat);
        minLng = Math.min(minLng, ll.lng);
        maxLat = Math.max(maxLat, ll.lat);
        maxLng = Math.max(maxLng, ll.lng);
      }
      const b = L.latLngBounds(L.latLng(minLat, minLng), L.latLng(maxLat, maxLng));
      if (!bounds.intersects(b)) continue;
    }

// ✅ 新增：把点符号当作“硬占用区”，用于 label 避让
if (r.type === 'Points' && pointLatLng) {
  const pt = map.latLngToContainerPoint(pointLatLng);

  const sym = rule.symbol;
  const pointPlan = typeof sym?.point === 'function' ? sym.point(r, context, store) : sym?.point;

  // 默认占用尺寸（可按视觉调）
  let w = 28;
  let h = 28;

  // circleMarker：radius 是 CircleMarkerOptions 才有，类型上用 any 取值即可（不改类型定义）
  if (pointPlan?.kind === 'circle') {
    const radius = Number((pointPlan as any)?.radius ?? (pointPlan as any)?.style?.radius ?? 6);
    const weight = Number((pointPlan as any)?.style?.weight ?? 0);
    const half = Math.max(4, radius + weight + 2);
    w = half * 2;
    h = half * 2;
  }

  // icon marker：avoidSizePx 不是你现有类型字段，用 any 读取；没有就退回 iconSize
  if (pointPlan?.kind === 'icon') {
    const sz = (pointPlan as any)?.avoidSizePx ?? (pointPlan as any)?.iconSize;
    if (Array.isArray(sz) && sz.length >= 2) {
      w = Math.max(4, Number(sz[0]));
      h = Math.max(4, Number(sz[1]));
    } else {
      w = 32;
      h = 32;
    }
  }

  avoidRectsPx.push({ x: pt.x - w / 2, y: pt.y - h / 2, w, h, ownerUid: r.uid });

}



    shouldShow.add(r.uid);

    // 确保 layer 存在
    const existing = cacheRef.current.get(r.uid);
    if (!existing) {
      const bundle = createLayerBundle(r, rule.symbol, context, store, projection);
      if (!bundle) continue;
      cacheRef.current.set(r.uid, bundle);
      root.addLayer(bundle.main);
      if (bundle.label) root.addLayer(bundle.label);
    } else {
      // 更新样式（动态色/透明度/楼层淡化）
      updateLayerBundle(existing, r, rule.symbol, context, store, projection, root);
      if (!root.hasLayer(existing.main)) root.addLayer(existing.main);
      if (existing.label && !root.hasLayer(existing.label)) root.addLayer(existing.label);
    }

    // LabelLayout：仅对声明了 labelPlan.declutter 的规则生效；其余 label 走旧逻辑
    const labelPlan = rule.symbol?.label;
    if (labelPlan?.enabled && labelPlan.declutter) {
      const req = buildLabelRequest(r, labelPlan, context, store, projection, pointLatLng);
      if (req) {
        declutterLabelRequests.push(req);
      } else {
        // 该要素当前不应显示 label（minLevel/text 空等）→ 移除旧 label
        const b = cacheRef.current.get(r.uid);
        if (b?.label) {
          if (root.hasLayer(b.label)) root.removeLayer(b.label);
          b.label = undefined;
          b.labelKey = undefined;
        }
      }
    }
  }

  // 统一计算 declutter label 的摆放（避免重叠）
  if (declutterLabelRequests.length) {
    const placed = layoutLabelsOnMap(map, declutterLabelRequests, {
      preferNearCenter: true,
      avoidRectsPx,
      // 可选：给点图标再留一圈缓冲（像素）
      avoidSpacingPx: 1,
    });

    const placedById = new Map<string, typeof placed[number]>();
    for (const p of placed) placedById.set(p.id, p);

    for (const req of declutterLabelRequests) {
      const p = placedById.get(req.id);
      const b = cacheRef.current.get(req.featureUid ?? '');
      if (!b) continue;

      // 不可放置/被隐藏 → 移除
      if (!p || p.hidden) {
        if (b.label) {
          if (root.hasLayer(b.label)) root.removeLayer(b.label);
          b.label = undefined;
          b.labelKey = undefined;
        }
        continue;
      }

      // 计算“偏移后的 latlng”，保持 makeLabelMarker 的样式不变
      const anchorPx = map.latLngToContainerPoint(req.anchorLatLng);
      const shifted = L.point(anchorPx.x + p.dx, anchorPx.y + p.dy);
      const ll = map.containerPointToLatLng(shifted);

      const labelKey = `${p.text}|${req.placement}|${req.withDot ? 1 : 0}|${Number(req.offsetY ?? 0)}`;

      // 尽量复用 marker，避免每次 refresh 都重建
      if (b.label && b.label instanceof L.Marker && b.labelKey === labelKey) {
        b.label.setLatLng(ll);
      } else {
        if (b.label && root.hasLayer(b.label)) root.removeLayer(b.label);
        b.label = makeLabelMarker(ll, p.text, req.placement, !!req.withDot, req.offsetY);
        b.labelKey = labelKey;
      }

      if (b.label && !root.hasLayer(b.label)) root.addLayer(b.label);
    }
  }

  // 移除不应显示的
  for (const [uid, bundle] of cacheRef.current.entries()) {
    if (shouldShow.has(uid)) continue;
    if (root.hasLayer(bundle.main)) root.removeLayer(bundle.main);
    if (bundle.label && root.hasLayer(bundle.label)) root.removeLayer(bundle.label);
  }
};


    refresh();
    map.on('moveend', refresh);
    map.on('zoomend', refresh);
    return () => {
      map.off('moveend', refresh);
      map.off('zoomend', refresh);
    };
  }, [mapReady, visible, map, projection, worldId, activeBuildingUid, activeBuildingFloorRefSet, floorOptions, activeFloorIndex, dataVersion]);


  const showFloorUI = ctx.inFloorView && !!activeBuildingUid && floorOptions.length > 0 && visible;


const floorUiRootRef = useRef<HTMLDivElement | null>(null);

useEffect(() => {
  const el = document.createElement('div');
  el.id = 'floor-ui-root';
  el.style.position = 'fixed';
  el.style.top = '0';
  el.style.left = '0';
  el.style.width = '0';
  el.style.height = '0';
  el.style.zIndex = '2147483647';
  document.body.appendChild(el);
  floorUiRootRef.current = el;

  return () => {
    document.body.removeChild(el);
    floorUiRootRef.current = null;
  };
}, []);

console.log('[FloorUI]', {
  showFloorUI,
  inFloorView: ctx?.inFloorView,
  zoomLevel: ctx?.zoomLevel,
  activeBuildingUid,
  floorOptionsLen: floorOptions?.length,
  activeFloorIndex,
  visible,
});


  return (
    <>
      {showFloorUI && (
        <div
  style={{ position: 'fixed', top: 80, right: 16, zIndex: 2147483647, pointerEvents: 'auto' }}
  className="bg-white/90 rounded-lg shadow-lg border border-gray-200 p-2 w-28"
  onMouseDown={(e) => e.stopPropagation()}
  onDoubleClick={(e) => e.stopPropagation()}
  onWheel={(e) => e.stopPropagation()}
>


          <div className="text-xs font-semibold text-gray-800 mb-1">楼层视角</div>
          <div className="text-[11px] text-gray-600 mb-2 truncate" title={activeBuildingName}>
            {activeBuildingName || '（未命名建筑）'}
          </div>

          {/* 楼层按钮列表（“滑条”简化为可维护的按钮列表；如需真正 range slider，你可在此替换） */}
          <div className="flex flex-col gap-1 max-h-[60vh] overflow-auto">
            {floorOptions.map((opt, idx) => {
              const on = idx === activeFloorIndex;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setActiveFloorIndex(idx)}
                  className={`w-full text-left px-2 py-1 rounded text-xs border transition-colors ${
                    on ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function createLayerBundle(
  r: FeatureRecord,
  symbol: any,
  ctx: RenderContext,
  store: FeatureStore,
  projection: DynmapProjection,
): LayerBundle | null {


  // 点
  if (r.type === 'Points' && r.p3) {
    const latlng = projection.locationToLatLng(r.p3.x, r.p3.y, r.p3.z);

    const plan = typeof symbol.point === 'function' ? symbol.point(r, ctx, store) : symbol.point;

    // ✅ pane 解析优先级：pointPlan.pane > symbol.pane > 默认 ria-point
    const mainPane = (plan as any)?.pane ?? symbol?.pane ?? 'ria-point';

    let main: L.Layer;
    let kind: LayerBundle['kind'] = 'marker';
    let iconUrl: string | undefined;

    if (plan && plan.kind === 'icon') {
      iconUrl = plan.iconUrl ?? (plan.iconUrlFrom ? String((r.featureInfo as any)?.[plan.iconUrlFrom] ?? '').trim() : undefined);
      if (!iconUrl) {
        // fallback circle
        const cm = L.circleMarker(latlng, {
          pane: mainPane,
          radius: 5,
          weight: 2,
          opacity: 0.9,
          fillOpacity: 0.6,
        });
        main = cm;
        kind = 'circleMarker';
      } else {
        const icon = L.icon({
          iconUrl,
          iconSize: plan.iconSize ?? [24, 24],
          iconAnchor: plan.iconAnchor ?? [12, 12],
        });
        main = L.marker(latlng, {
          pane: mainPane,
          icon,
          interactive: false,
          zIndexOffset: (plan as any)?.zIndexOffset ?? 0,
        });
        kind = 'marker';
      }
    } else {
      const cm = L.circleMarker(latlng, {
        pane: mainPane,
        radius: plan?.radius ?? 5,
        ...(plan?.style ?? { color: '#111827', weight: 2, opacity: 0.9, fillOpacity: 0.6, fillColor: '#f97316' }),
      });
      main = cm;
      kind = 'circleMarker';
    }

    // label
    const labelLayer = buildLabelLayer(r, symbol.label, ctx, store, projection, latlng);
    return { main, label: labelLayer ?? undefined, kind, iconUrl, pane: mainPane };
  }


  // 线/面
  if (r.coords3 && r.coords3.length) {
    const latlngs = r.coords3.map(p => projection.locationToLatLng(p.x, p.y, p.z));

    const style: L.PathOptions = typeof symbol.pathStyle === 'function' ? symbol.pathStyle(r, ctx, store) : symbol.pathStyle;

    // pane：symbol.pane > 默认 ria-overlay
    const mainPane = symbol?.pane ?? 'ria-overlay';

    const main =
      r.type === 'Polyline'
        ? L.polyline(latlngs, { ...(style ?? {}), pane: mainPane })
        : L.polygon(latlngs, { ...(style ?? {}), pane: mainPane });

    const labelLayer = buildLabelLayer(r, symbol.label, ctx, store, projection);
    return { main, label: labelLayer ?? undefined, kind: 'path', pane: mainPane };
  }


  return null;
}

function updateLayerBundle(
  bundle: LayerBundle,
  r: FeatureRecord,
  symbol: any,
  ctx: RenderContext,
  store: FeatureStore,
  projection: DynmapProjection,
  root: L.LayerGroup,
) {
  // 点：若 iconUrl 变化，重建
  if (r.type === 'Points' && r.p3) {
    const latlng = projection.locationToLatLng(r.p3.x, r.p3.y, r.p3.z);
    const plan = typeof symbol.point === 'function' ? symbol.point(r, ctx, store) : symbol.point;
    let nextKind: LayerBundle['kind'] = bundle.kind;
    let nextIconUrl = bundle.iconUrl;

    if (plan && plan.kind === 'icon') {
      const url = plan.iconUrl ?? (plan.iconUrlFrom ? String((r.featureInfo as any)?.[plan.iconUrlFrom] ?? '').trim() : undefined);
      nextIconUrl = url || undefined;
      nextKind = url ? 'marker' : 'circleMarker';
    } else {
      nextKind = 'circleMarker';
      nextIconUrl = undefined;
    }

    if (nextKind !== bundle.kind || nextIconUrl !== bundle.iconUrl) {
      // remove old
      if (root.hasLayer(bundle.main)) root.removeLayer(bundle.main);
      if (bundle.label && root.hasLayer(bundle.label)) root.removeLayer(bundle.label);

      const newBundle = createLayerBundle(r, symbol, ctx, store, projection);
      if (!newBundle) return;
      bundle.main = newBundle.main;
      bundle.label = newBundle.label;
      bundle.kind = newBundle.kind;
      bundle.iconUrl = newBundle.iconUrl;
      return;
    }

    // circleMarker style refresh
    if (bundle.kind === 'circleMarker' && bundle.main instanceof L.CircleMarker) {
      const style = plan?.kind === 'circle' ? (plan.style ?? {}) : {};
      if (style) bundle.main.setStyle(style);
      bundle.main.setLatLng(latlng);
    }

    if (bundle.kind === 'marker' && bundle.main instanceof L.Marker) {
      bundle.main.setLatLng(latlng);
    }

    // label refresh
    // - 若使用 declutter：不在这里动 label，交由 refresh() 的统一布局阶段处理（避免闪烁/卡顿）
    if (symbol.label?.declutter) return;
    if (bundle.label) {
      if (root.hasLayer(bundle.label)) root.removeLayer(bundle.label);
      bundle.label = undefined;
      bundle.labelKey = undefined;
    }
    const labelLayer = buildLabelLayer(r, symbol.label, ctx, store, projection, latlng);
    if (labelLayer) bundle.label = labelLayer;
    return;
  }

  // 线/面：更新 style
  if (bundle.main instanceof L.Path) {
    const style: L.PathOptions = typeof symbol.pathStyle === 'function' ? symbol.pathStyle(r, ctx, store) : symbol.pathStyle;
    if (style) bundle.main.setStyle(style);
  }

  // label refresh
  // - 若使用 declutter：不在这里动 label，交由 refresh() 的统一布局阶段处理
  if (!symbol.label?.declutter) {
    if (bundle.label) {
      if (root.hasLayer(bundle.label)) root.removeLayer(bundle.label);
      bundle.label = undefined;
      bundle.labelKey = undefined;
    }
    const labelLayer = buildLabelLayer(r, symbol.label, ctx, store, projection);
    if (labelLayer) bundle.label = labelLayer;
  }
}

// ======================= LabelLayout：从单要素提取 LabelRequest =======================
function buildLabelRequest(
  r: FeatureRecord,
  labelPlan: any,
  ctx: RenderContext,
  store: FeatureStore,
  projection: DynmapProjection,
  pointLatLng?: L.LatLng,
): LabelRequest | null {
  if (!labelPlan || !labelPlan.enabled) return null;
  if (!labelPlan.declutter) return null;
  if (labelPlan.minLevel !== undefined && ctx.zoomLevel < labelPlan.minLevel) return null;

  let text = '';
  if (typeof labelPlan.textFrom === 'function') {
    text = String(labelPlan.textFrom(r, ctx, store) ?? '').trim();
  } else if (typeof labelPlan.textFrom === 'string') {
    text = String((r.featureInfo as any)?.[labelPlan.textFrom] ?? '').trim();
  }
  if (!text) return null;

  // anchor 计算与 buildLabelLayer 保持一致
  if (r.type === 'Points') {
    const ll = pointLatLng ?? (r.p3 ? projection.locationToLatLng(r.p3.x, r.p3.y, r.p3.z) : null);
    if (!ll) return null;
    const effectivePlacement = labelPlan.placement === 'center' ? 'near' : (labelPlan.placement ?? 'near');
    return {
      id: `${r.uid}#label`,
      featureUid: r.uid,
      anchorLatLng: ll,
      text,
      placement: effectivePlacement,
      withDot: !!labelPlan.withDot,
      offsetY: Number(labelPlan.offsetY ?? 0),
      declutter: labelPlan.declutter,
    };
  }

  if (!r.coords3 || r.coords3.length < 2) return null;

  // Polyline：取“累计长度的中点”（更像沿线附着）
  if (r.type === 'Polyline') {
    let total = 0;
    for (let i = 1; i < r.coords3.length; i++) {
      const a = r.coords3[i - 1];
      const b = r.coords3[i];
      total += Math.hypot(b.x - a.x, b.z - a.z);
    }
    let ll: L.LatLng;
    if (total <= 1e-9) {
      const mid = r.coords3[Math.floor(r.coords3.length / 2)];
      ll = projection.locationToLatLng(mid.x, Y_FOR_DISPLAY, mid.z);
    } else {
      const half = total / 2;
      let acc = 0;
      let found: { x: number; z: number } | null = null;
      for (let i = 1; i < r.coords3.length; i++) {
        const a = r.coords3[i - 1];
        const b = r.coords3[i];
        const seg = Math.hypot(b.x - a.x, b.z - a.z);
        if (acc + seg >= half) {
          const t = (half - acc) / (seg || 1);
          found = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
          break;
        }
        acc += seg;
      }
      const p = found ?? { x: r.coords3[r.coords3.length - 1].x, z: r.coords3[r.coords3.length - 1].z };
      ll = projection.locationToLatLng(p.x, Y_FOR_DISPLAY, p.z);
    }

    return {
      id: `${r.uid}#label`,
      featureUid: r.uid,
      anchorLatLng: ll,
      text,
      placement: 'center',
      withDot: !!labelPlan.withDot,
      offsetY: Number(labelPlan.offsetY ?? 0),
      declutter: labelPlan.declutter,
    };
  }

  // Polygon：几何中心 / bbox 中心兜底
  if (r.coords3.length < 3) return null;
  const polyXZ = r.coords3.map(p => ({ x: p.x, z: p.z }));
  const c =
    polygonCentroidXZ(polyXZ) ?? {
      x: (Math.min(...polyXZ.map(p => p.x)) + Math.max(...polyXZ.map(p => p.x))) / 2,
      z: (Math.min(...polyXZ.map(p => p.z)) + Math.max(...polyXZ.map(p => p.z))) / 2,
    };
  const ll = projection.locationToLatLng(c.x, Y_FOR_DISPLAY, c.z);
  return {
    id: `${r.uid}#label`,
    featureUid: r.uid,
    anchorLatLng: ll,
    text,
    placement: (labelPlan.placement ?? 'center'),
    withDot: !!labelPlan.withDot,
    offsetY: Number(labelPlan.offsetY ?? 0),
    declutter: labelPlan.declutter,
  };
}


function buildLabelLayer(
  r: FeatureRecord,
  labelPlan: any,
  ctx: RenderContext,
  store: FeatureStore,
  projection: DynmapProjection,
  pointLatLng?: L.LatLng,
): L.Layer | null {
  if (!labelPlan || !labelPlan.enabled) return null;

  if (labelPlan.declutter) return null;
  if (labelPlan.minLevel !== undefined && ctx.zoomLevel < labelPlan.minLevel) return null;

  let text = '';
  if (typeof labelPlan.textFrom === 'function') {
    text = String(labelPlan.textFrom(r, ctx, store) ?? '').trim();
  } else if (typeof labelPlan.textFrom === 'string') {
    text = String((r.featureInfo as any)?.[labelPlan.textFrom] ?? '').trim();
  }
  if (!text) return null;

  const placement = labelPlan.placement ?? 'center';
  const withDot = !!labelPlan.withDot;

  // Points
  if (r.type === 'Points') {
    const ll = pointLatLng ?? (r.p3 ? projection.locationToLatLng(r.p3.x, r.p3.y, r.p3.z) : null);
    if (!ll) return null;
    return makeLabelMarker(
  ll,
  text,
  placement === 'center' ? 'near' : placement,
  withDot,
  labelPlan.offsetY, 
);

  }

  if (!r.coords3 || r.coords3.length < 2) return null;

  // Polyline：取“累计长度的中点”（更像沿线附着）
  if (r.type === 'Polyline') {
    let total = 0;
    for (let i = 1; i < r.coords3.length; i++) {
      const a = r.coords3[i - 1];
      const b = r.coords3[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      total += Math.hypot(dx, dz);
    }
    if (total <= 1e-9) {
      const mid = r.coords3[Math.floor(r.coords3.length / 2)];
      const ll = projection.locationToLatLng(mid.x, Y_FOR_DISPLAY, mid.z);
      return makeLabelMarker(ll, text, 'center', withDot);
    }
    const half = total / 2;
    let acc = 0;
    for (let i = 1; i < r.coords3.length; i++) {
      const a = r.coords3[i - 1];
      const b = r.coords3[i];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (acc + seg >= half) {
        const t = (half - acc) / (seg || 1);
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const ll = projection.locationToLatLng(x, Y_FOR_DISPLAY, z);
        return makeLabelMarker(ll, text, 'center', withDot);
      }
      acc += seg;
    }
    const last = r.coords3[r.coords3.length - 1];
    return makeLabelMarker(projection.locationToLatLng(last.x, Y_FOR_DISPLAY, last.z), text, 'center', withDot);
  }

  // Polygon：几何中心 / bbox 中心兜底
  if (r.coords3.length < 3) return null;
  const polyXZ = r.coords3.map(p => ({ x: p.x, z: p.z }));
  const c = polygonCentroidXZ(polyXZ) ?? {
    x: (Math.min(...polyXZ.map(p => p.x)) + Math.max(...polyXZ.map(p => p.x))) / 2,
    z: (Math.min(...polyXZ.map(p => p.z)) + Math.max(...polyXZ.map(p => p.z))) / 2,
  };
  const ll = projection.locationToLatLng(c.x, Y_FOR_DISPLAY, c.z);
  return makeLabelMarker(ll, text, placement, withDot);
}

