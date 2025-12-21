import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { DynmapProjection } from '@/lib/DynmapProjection';
import { DraggablePanel } from '@/components/DraggablePanel/DraggablePanel';
import { Link, Pencil, Plus, Save, X } from 'lucide-react';

export type WorldPoint = { x: number; z: number };

export type MeasuringLayerLite = {
  id: number;
  mode: 'point' | 'polyline' | 'polygon';
  color: string;
  coords: WorldPoint[];
  visible: boolean;
  leafletGroup: L.LayerGroup;
};

export type ControlPointPatch = {
  layerId: number;
  newCoords: WorldPoint[];
};

export type ControlPointToolsHandle = {
  /**
   * 给父组件（MeasuringModule）使用：在落点进入 tempPoints 前进行“贴线修正/拦截”。
   */
  transformWorldPointForDraw: (p: WorldPoint) => { point: WorldPoint | null; blocked: boolean; reason?: string };
};

type ControlPointToolsProps = {
  mapReady: boolean;
  leafletMapRef: MutableRefObject<L.Map | null>;
  projectionRef: MutableRefObject<DynmapProjection | null>;

  /**
   * MeasuringModule 的固定图层 state（只读）。
   */
  measuringLayers: MeasuringLayerLite[];

  /**
   * 点击“保存”时回传 patch；由父组件负责写回 layers state 并重建 leafletGroup。
   */
  onCommit?: (patches: ControlPointPatch[]) => void;
};

const Y_FOR_DISPLAY = 64;
const SNAP_MAX_DIST = 20;

function clamp01(n: number) {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function samePoint(a: WorldPoint, b: WorldPoint, eps = 1e-9) {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.z - b.z) <= eps;
}

function dist2(a: WorldPoint, b: WorldPoint) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function closestPointOnSegment(p: WorldPoint, a: WorldPoint, b: WorldPoint) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apz = p.z - a.z;
  const denom = abx * abx + abz * abz;

  // a==b（退化段）
  if (!Number.isFinite(denom) || denom <= 1e-12) {
    return { point: { ...a }, t: 0, dist: Math.hypot(p.x - a.x, p.z - a.z) };
  }

  const t = clamp01((apx * abx + apz * abz) / denom);
  const q = { x: a.x + abx * t, z: a.z + abz * t };
  const d = Math.hypot(p.x - q.x, p.z - q.z);
  return { point: q, t, dist: d };
}

type GeometryRings = {
  rings: WorldPoint[][];
  closed: boolean[];
};

function normalizeRingsForPolygonLike(coords: WorldPoint[], isPolygon: boolean): GeometryRings {
  const ring = coords.slice();
  // 如果用户的数据里已经首尾闭合，则去掉尾部重复点
  if (ring.length >= 2 && samePoint(ring[0], ring[ring.length - 1])) {
    ring.pop();
  }
  return {
    rings: [ring],
    closed: [isPolygon],
  };
}

function closestPointOnRings(p: WorldPoint, geom: GeometryRings) {
  let best = {
    point: null as WorldPoint | null,
    dist: Number.POSITIVE_INFINITY,
    ringIndex: -1,
    segIndex: -1,
    t: 0,
  };

  for (let r = 0; r < geom.rings.length; r++) {
    const ring = geom.rings[r];
    const closed = geom.closed[r];
    if (!Array.isArray(ring) || ring.length < 2) continue;

    const n = ring.length;
    const lastSeg = closed ? n : n - 1;

    for (let i = 0; i < lastSeg; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      const cand = closestPointOnSegment(p, a, b);
      if (cand.dist < best.dist) {
        best = {
          point: cand.point,
          dist: cand.dist,
          ringIndex: r,
          segIndex: i,
          t: cand.t,
        };
      }
    }
  }

  return best;
}

function isLatLngLike(v: any): v is L.LatLng {
  return v && typeof v.lat === 'number' && typeof v.lng === 'number';
}

function collectLatLngArrays(input: any, out: L.LatLng[][]) {
  if (!Array.isArray(input)) return;
  if (input.length === 0) return;

  const first = input[0];
  if (isLatLngLike(first)) {
    out.push(input as L.LatLng[]);
    return;
  }

  for (const child of input) {
    collectLatLngArrays(child, out);
  }
}

function ringsFromLeafletPolyline(poly: L.Polyline): L.LatLng[][] {
  const raw = poly.getLatLngs() as any;
  const out: L.LatLng[][] = [];
  collectLatLngArrays(raw, out);
  return out;
}

export default forwardRef<ControlPointToolsHandle, ControlPointToolsProps>(function ControlPointTools(
  props,
  ref
) {
  const { mapReady, leafletMapRef, projectionRef, measuringLayers, onCommit } = props;

  const [snapEnabled, setSnapEnabled] = useState(false);
  const [editEnabled, setEditEnabled] = useState(false);
  const [addEnabled, setAddEnabled] = useState(false);

  const [snapPanelOpen, setSnapPanelOpen] = useState(false);
  const [snapPicking, setSnapPicking] = useState(false);

  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [addTargetLayerId, setAddTargetLayerId] = useState<number | null>(null);

  const [statusText, setStatusText] = useState<string>('');

  // layerId -> edited coords（未保存）
  const [pendingEdits, setPendingEdits] = useState<Record<number, WorldPoint[]>>({});

  // 当前被选中的控制点（修改模式）
  const [selectedVertex, setSelectedVertex] = useState<{ layerId: number; vertexIndex: number } | null>(null);

  // snap 目标：存 World rings（避免每次 transform 都解析 leaflet geometry）
  const [snapTarget, setSnapTarget] = useState<{
    source: 'leaflet' | 'measuring';
    label: string;
    geom: GeometryRings;
  } | null>(null);

  const vertexGroupRef = useRef<L.LayerGroup | null>(null);
  const overlayGroupRef = useRef<L.LayerGroup | null>(null);
  const targetHighlightGroupRef = useRef<L.LayerGroup | null>(null);

  // 选择模式：记录已绑定过 click handler 的 layer 列表，方便取消
  const pickLayersRef = useRef<L.Layer[]>([]);
  const pickHandlerRef = useRef<((e: any) => void) | null>(null);

  const toWorld = useCallback(
    (latlng: L.LatLng): WorldPoint | null => {
      const proj = projectionRef.current;
      if (!proj) return null;
      const loc = proj.latLngToLocation(latlng, Y_FOR_DISPLAY);
      return { x: loc.x, z: loc.z };
    },
    [projectionRef]
  );

  const toLatLng = useCallback(
    (p: WorldPoint): L.LatLng | null => {
      const proj = projectionRef.current;
      if (!proj) return null;
      return proj.locationToLatLng(p.x, Y_FOR_DISPLAY, p.z);
    },
    [projectionRef]
  );

  const fmt = useCallback((p: WorldPoint) => `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`, []);

  const getEffectiveCoords = useCallback(
    (layer: MeasuringLayerLite): WorldPoint[] => {
      const edited = pendingEdits[layer.id];
      return edited ?? layer.coords;
    },
    [pendingEdits]
  );

  // ---------- Leaflet 容器挂载/卸载 ----------
  useEffect(() => {
    if (!mapReady) return;
    const map = leafletMapRef.current;
    if (!map) return;

    if (!vertexGroupRef.current) vertexGroupRef.current = L.layerGroup();
    if (!overlayGroupRef.current) overlayGroupRef.current = L.layerGroup();
    if (!targetHighlightGroupRef.current) targetHighlightGroupRef.current = L.layerGroup();

    if (!map.hasLayer(vertexGroupRef.current)) vertexGroupRef.current.addTo(map);
    if (!map.hasLayer(overlayGroupRef.current)) overlayGroupRef.current.addTo(map);
    if (!map.hasLayer(targetHighlightGroupRef.current)) targetHighlightGroupRef.current.addTo(map);

    return () => {
      if (vertexGroupRef.current && map.hasLayer(vertexGroupRef.current)) map.removeLayer(vertexGroupRef.current);
      if (overlayGroupRef.current && map.hasLayer(overlayGroupRef.current)) map.removeLayer(overlayGroupRef.current);
      if (targetHighlightGroupRef.current && map.hasLayer(targetHighlightGroupRef.current))
        map.removeLayer(targetHighlightGroupRef.current);
    };
  }, [mapReady, leafletMapRef]);

  // ---------- cursor 控制 ----------
  const setMapCursor = useCallback(
    (cursor: string | null) => {
      const map = leafletMapRef.current;
      if (!map) return;
      map.getContainer().style.cursor = cursor ?? '';
    },
    [leafletMapRef]
  );

  // ---------- snap 计算（核心能力暴露给父组件） ----------
  const applySnap = useCallback(
    (p: WorldPoint): { point: WorldPoint | null; blocked: boolean; reason?: string } => {
      if (!snapEnabled) return { point: p, blocked: false };
      if (!snapTarget) return { point: p, blocked: false };

      const best = closestPointOnRings(p, snapTarget.geom);
      if (!best.point || !Number.isFinite(best.dist)) {
        return { point: p, blocked: false };
      }

      if (best.dist > SNAP_MAX_DIST) {
        return { point: null, blocked: true, reason: `未命中：距离目标要素超过 ${SNAP_MAX_DIST} 格` };
      }

      return { point: best.point, blocked: false };
    },
    [snapEnabled, snapTarget]
  );

  useImperativeHandle(ref, () => ({
    transformWorldPointForDraw: applySnap,
  }));

  // ---------- overlay：渲染“未保存的几何” ----------
  useEffect(() => {
    const map = leafletMapRef.current;
    const proj = projectionRef.current;
    const overlay = overlayGroupRef.current;
    if (!map || !proj || !overlay) return;

    overlay.clearLayers();

    const ids = Object.keys(pendingEdits);
    if (!ids.length) return;

    for (const idStr of ids) {
      const layerId = Number(idStr);
      if (!Number.isFinite(layerId)) continue;
      const base = measuringLayers.find((l) => l.id === layerId);
      if (!base) continue;

      const coords = pendingEdits[layerId];
      if (!Array.isArray(coords) || coords.length === 0) continue;

      const latlngs = coords.map((p) => proj.locationToLatLng(p.x, Y_FOR_DISPLAY, p.z));

      if (base.mode === 'polyline') {
        L.polyline(latlngs, {
          color: base.color,
          weight: 3,
          dashArray: '6 6',
          opacity: 0.9,
        }).addTo(overlay);
      } else if (base.mode === 'polygon') {
        L.polygon(latlngs, {
          color: base.color,
          weight: 3,
          dashArray: '6 6',
          fill: false,
          opacity: 0.9,
        }).addTo(overlay);
      }
    }
  }, [pendingEdits, measuringLayers, leafletMapRef, projectionRef]);

  // ---------- vertex：渲染控制点 ----------
  useEffect(() => {
    const map = leafletMapRef.current;
    const proj = projectionRef.current;
    const vg = vertexGroupRef.current;
    if (!map || !proj || !vg) return;

    vg.clearLayers();

    if (!editEnabled && !addEnabled) {
      setSelectedVertex(null);
      return;
    }

    // 修改/添加：都显示测绘图层的控制点（仅线/面）
    for (const layer of measuringLayers) {
      if (!layer.visible) continue;
      if (layer.mode !== 'polyline' && layer.mode !== 'polygon') continue;

      const coords = getEffectiveCoords(layer);
      if (!coords.length) continue;

      coords.forEach((p, idx) => {
        const ll = proj.locationToLatLng(p.x, Y_FOR_DISPLAY, p.z);
        const isSelected = selectedVertex?.layerId === layer.id && selectedVertex?.vertexIndex === idx;

        const marker = L.circleMarker(ll, {
          radius: isSelected ? 7 : 5,
          color: layer.color,
          fillColor: layer.color,
          fillOpacity: 0.7,
          weight: isSelected ? 3 : 2,
          opacity: 0.95,
        });

        marker.bindTooltip(fmt(p), {
          direction: 'top',
          offset: L.point(0, -6),
          opacity: 0.9,
        });

        marker.on('click', (e: any) => {
          // 只在“修改模式”允许选点
          if (!editEnabled) return;
          if (e?.originalEvent) {
            // 避免点击 marker 后立刻触发 map click（导致瞬间移动）
            e.originalEvent.stopPropagation?.();
            e.originalEvent.preventDefault?.();
          }
          setSelectedVertex({ layerId: layer.id, vertexIndex: idx });
          setStatusText(`已选择：Layer ${layer.id} 控制点 #${idx + 1}（再次点击地图设置新位置）`);
        });

        vg.addLayer(marker);
      });
    }
  }, [editEnabled, addEnabled, measuringLayers, getEffectiveCoords, fmt, selectedVertex, leafletMapRef, projectionRef]);

  // ---------- snap 目标高亮 ----------
  useEffect(() => {
    const map = leafletMapRef.current;
    const proj = projectionRef.current;
    const hg = targetHighlightGroupRef.current;
    if (!map || !proj || !hg) return;

    hg.clearLayers();
    if (!snapTarget) return;

    for (let r = 0; r < snapTarget.geom.rings.length; r++) {
      const ring = snapTarget.geom.rings[r];
      if (!ring || ring.length < 2) continue;

      const latlngs = ring
        .map((p) => proj.locationToLatLng(p.x, Y_FOR_DISPLAY, p.z))
        .filter(Boolean) as L.LatLng[];

      if (latlngs.length < 2) continue;

      L.polyline(latlngs, {
        color: '#ffffff',
        weight: 4,
        dashArray: '4 8',
        opacity: 0.85,
      }).addTo(hg);
    }
  }, [snapTarget, leafletMapRef, projectionRef]);

  // ---------- 修改：选中控制点后，下一次 map click 更新它 ----------
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;

    const onMapClick = (e: L.LeafletMouseEvent) => {
      if (!editEnabled) return;
      if (!selectedVertex) return;

      const w = toWorld(e.latlng);
      if (!w) return;

      const snapped = applySnap(w);
      if (snapped.blocked || !snapped.point) {
        setStatusText(snapped.reason ?? `落点无效：超出 ${SNAP_MAX_DIST} 格贴线阈值`);
        return;
      }

      const layer = measuringLayers.find((l) => l.id === selectedVertex.layerId);
      if (!layer) return;

      const baseCoords = getEffectiveCoords(layer);
      if (selectedVertex.vertexIndex < 0 || selectedVertex.vertexIndex >= baseCoords.length) return;

      const nextCoords = baseCoords.map((p, i) => (i === selectedVertex.vertexIndex ? snapped.point! : p));

      setPendingEdits((prev) => ({
        ...prev,
        [layer.id]: nextCoords,
      }));

      setStatusText(`已更新：Layer ${layer.id} 控制点 #${selectedVertex.vertexIndex + 1} -> ${fmt(snapped.point)}`);
    };

    map.on('click', onMapClick);
    return () => {
      map.off('click', onMapClick);
    };
  }, [editEnabled, selectedVertex, measuringLayers, toWorld, applySnap, getEffectiveCoords, fmt, leafletMapRef]);

  // ---------- 添加：选择目标层后，点击 map 插入新控制点 ----------
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;

    const onMapClick = (e: L.LeafletMouseEvent) => {
      if (!addEnabled) return;
      if (addTargetLayerId === null) return;

      const w = toWorld(e.latlng);
      if (!w) return;

      const layer = measuringLayers.find((l) => l.id === addTargetLayerId);
      if (!layer) return;
      if (layer.mode !== 'polyline' && layer.mode !== 'polygon') return;

      const geom = normalizeRingsForPolygonLike(getEffectiveCoords(layer), layer.mode === 'polygon');
      const best = closestPointOnRings(w, geom);
      if (!best.point || !Number.isFinite(best.dist)) return;

      if (best.dist > SNAP_MAX_DIST) {
        setStatusText(`未插入：距离目标要素超过 ${SNAP_MAX_DIST} 格`);
        return;
      }

      const coords = geom.rings[0];
      if (coords.length < 2) return;

      const segIndex = best.segIndex;
      const n = coords.length;

      const insertIndex = (() => {
        if (layer.mode === 'polygon') {
          // segIndex==n-1 表示闭合边（last->first），插到末尾即可
          if (segIndex >= n - 1) return n;
          return segIndex + 1;
        }
        // polyline
        if (segIndex < 0) return n;
        return Math.min(segIndex + 1, n);
      })();

      const nextCoords = coords.slice();
      nextCoords.splice(insertIndex, 0, best.point);

      setPendingEdits((prev) => ({
        ...prev,
        [layer.id]: nextCoords,
      }));

      setStatusText(`已插入：Layer ${layer.id} @ segment ${segIndex + 1}（新点 ${fmt(best.point)}）`);
    };

    map.on('click', onMapClick);
    return () => {
      map.off('click', onMapClick);
    };
  }, [addEnabled, addTargetLayerId, measuringLayers, toWorld, getEffectiveCoords, fmt, leafletMapRef]);

  // ---------- snap：进入/退出选择模式 ----------
  const cancelSnapPicking = useCallback(() => {
    setSnapPicking(false);
    setMapCursor(null);

    // 清理已绑定的 layer click
    const handler = pickHandlerRef.current;
    if (handler) {
      for (const lyr of pickLayersRef.current) {
        (lyr as any).off?.('click', handler);
      }
    }
    pickLayersRef.current = [];
    pickHandlerRef.current = null;

    setStatusText('');
  }, [setMapCursor]);

  const beginSnapPicking = useCallback(() => {
    if (!mapReady) return;
    const map = leafletMapRef.current;
    const proj = projectionRef.current;
    if (!map || !proj) return;

    cancelSnapPicking();

    setSnapPicking(true);
    setMapCursor('crosshair');
    setStatusText('贴线目标选择中：请点击任意线/面要素');

    const candidates: L.Layer[] = [];
    map.eachLayer((layer: any) => {
      // Polygon 也属于 Polyline
      if (layer instanceof L.Polyline) {
        const opt = layer.options ?? {};
        if (opt.interactive === false) return;
        candidates.push(layer);
      }
    });

    const handler = (e: any) => {
      const layer = e?.target;
      if (!layer || !(layer instanceof L.Polyline)) return;

      const llRings = ringsFromLeafletPolyline(layer);
      const wRings: WorldPoint[][] = [];
      for (const rr of llRings) {
        const wr: WorldPoint[] = [];
        for (const ll of rr) {
          const w = toWorld(ll);
          if (w) wr.push(w);
        }
        if (wr.length >= 2) wRings.push(wr);
      }

      const isPolygon = layer instanceof L.Polygon;
      const closed = wRings.map(() => Boolean(isPolygon));

      const stamp = L.Util.stamp(layer);
      setSnapTarget({
        source: 'leaflet',
        label: `Leaflet#${stamp}（${isPolygon ? '面' : '线'}）`,
        geom: { rings: wRings, closed },
      });

      setStatusText(`已选择贴线目标：Leaflet#${stamp}`);
      cancelSnapPicking();
    };

    // 绑定一次性选择（用户点击后自动结束）
    for (const lyr of candidates) {
      (lyr as any).on?.('click', handler);
    }

    pickLayersRef.current = candidates;
    pickHandlerRef.current = handler;
  }, [mapReady, leafletMapRef, projectionRef, toWorld, cancelSnapPicking, setMapCursor]);

  // 当 snap 面板关闭/或 snapEnabled 关闭：结束选择模式
  useEffect(() => {
    if (!snapPanelOpen || !snapEnabled) {
      if (snapPicking) cancelSnapPicking();
    }
  }, [snapPanelOpen, snapEnabled, snapPicking, cancelSnapPicking]);

  // ---------- 互斥：修改 vs 添加 ----------
  const toggleEdit = useCallback(() => {
    setEditEnabled((v) => {
      const next = !v;
      if (next) {
        setAddEnabled(false);
        setAddPanelOpen(false);
        setAddTargetLayerId(null);
      } else {
        setSelectedVertex(null);
      }
      return next;
    });
  }, []);

  const toggleAdd = useCallback(() => {
    setAddEnabled((v) => {
      const next = !v;
      if (next) {
        setEditEnabled(false);
        setSelectedVertex(null);
        setAddPanelOpen(true);
      } else {
        setAddTargetLayerId(null);
        setAddPanelOpen(false);
      }
      return next;
    });
  }, []);

  // ---------- 保存 ----------
  const commitEdits = useCallback(() => {
    const ids = Object.keys(pendingEdits);
    if (!ids.length) {
      setStatusText('暂无未保存修改');
      return;
    }

    const patches: ControlPointPatch[] = [];
    for (const idStr of ids) {
      const layerId = Number(idStr);
      if (!Number.isFinite(layerId)) continue;
      const newCoords = pendingEdits[layerId];
      if (!Array.isArray(newCoords)) continue;
      patches.push({ layerId, newCoords });
    }

    if (!patches.length) {
      setStatusText('暂无有效修改');
      return;
    }

    onCommit?.(patches);

    setPendingEdits({});
    setSelectedVertex(null);
    setStatusText(`已提交 ${patches.length} 个图层的控制点修改（请以父组件写回为准）`);
  }, [pendingEdits, onCommit]);

  const polyOrPolyLayers = useMemo(
    () => measuringLayers.filter((l) => l.mode === 'polyline' || l.mode === 'polygon'),
    [measuringLayers]
  );

  return (
    <div className="mt-2">
      {/* 工具条 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`px-2 py-1 rounded text-xs border flex items-center gap-1 ${
            snapEnabled ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-800 border-gray-300'
          }`}
          onClick={() => {
            setSnapEnabled((v) => {
              const next = !v;
              if (next) setSnapPanelOpen(true);
              if (!next) setSnapTarget(null);
              return next;
            });
          }}
          title="控制点贴线"
        >
          <Link size={14} />
          控制点贴线
        </button>

        <button
          type="button"
          className={`px-2 py-1 rounded text-xs border flex items-center gap-1 ${
            editEnabled ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-800 border-gray-300'
          }`}
          onClick={toggleEdit}
          title="控制点修改"
        >
          <Pencil size={14} />
          控制点修改
        </button>

        <button
          type="button"
          className={`px-2 py-1 rounded text-xs border flex items-center gap-1 ${
            addEnabled ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-800 border-gray-300'
          }`}
          onClick={toggleAdd}
          title="控制点添加"
        >
          <Plus size={14} />
          控制点添加
        </button>

        <button
          type="button"
          className="px-2 py-1 rounded text-xs bg-green-600 text-white flex items-center gap-1"
          onClick={commitEdits}
          title="保存（提交到父组件）"
        >
          <Save size={14} />
          保存
        </button>

        <button
          type="button"
          className="px-2 py-1 rounded text-xs bg-gray-200 text-gray-900"
          onClick={() => {
            setPendingEdits({});
            setSelectedVertex(null);
            setStatusText('已清空未保存修改');
          }}
          title="清空未保存修改"
        >
          清空
        </button>

        {!!Object.keys(pendingEdits).length && (
          <div className="text-xs text-orange-700">未保存：{Object.keys(pendingEdits).length} 层</div>
        )}
      </div>

      {/* 状态文本 */}
      {statusText && <div className="mt-2 text-xs text-gray-700">{statusText}</div>}

      {/* Snap 选择面板（桌面端 DraggablePanel；移动端会由 DraggablePanel 返回 null） */}
      {snapEnabled && snapPanelOpen && (
        <DraggablePanel id="cp-snap-panel" defaultPosition={{ x: 16, y: 260 }}>
          <div className="bg-white border rounded shadow-md w-72">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <div className="text-sm font-semibold">控制点贴线</div>
              <button
                type="button"
                className="p-1 rounded hover:bg-gray-100"
                onClick={() => {
                  setSnapPanelOpen(false);
                  cancelSnapPicking();
                }}
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-3 space-y-2">
              <div className="text-xs text-gray-600">
                选择贴线目标后，绘制/编辑/添加落点会自动贴到该要素上（阈值 {SNAP_MAX_DIST} 格）。
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`px-2 py-1 rounded text-xs border ${
                    snapPicking ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-800 border-gray-300'
                  }`}
                  onClick={() => {
                    if (!projectionRef.current) {
                      setStatusText('投影尚未就绪，无法选择目标');
                      return;
                    }
                    beginSnapPicking();
                  }}
                >
                  选择图层
                </button>

                <button
                  type="button"
                  className="px-2 py-1 rounded text-xs bg-gray-200 text-gray-900"
                  onClick={() => {
                    setSnapTarget(null);
                    setStatusText('已清除贴线目标');
                  }}
                >
                  清除目标
                </button>

                <button
                  type="button"
                  className="px-2 py-1 rounded text-xs bg-gray-200 text-gray-900"
                  onClick={() => {
                    cancelSnapPicking();
                    setStatusText('已退出选择模式');
                  }}
                >
                  退出选择
                </button>
              </div>

              <div className="text-xs">
                当前目标：<span className="font-semibold">{snapTarget ? snapTarget.label : '（未选择）'}</span>
              </div>

              <div className="text-[11px] text-gray-500">
                说明：该选择会监听地图中可交互的 Polyline/Polygon（包含测绘层与其它展示层）。
              </div>
            </div>
          </div>
        </DraggablePanel>
      )}

      {/* Add 目标选择面板 */}
      {addEnabled && addPanelOpen && (
        <DraggablePanel id="cp-add-panel" defaultPosition={{ x: 16, y: 430 }}>
          <div className="bg-white border rounded shadow-md w-72">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <div className="text-sm font-semibold">控制点添加</div>
              <button
                type="button"
                className="p-1 rounded hover:bg-gray-100"
                onClick={() => {
                  setAddPanelOpen(false);
                  setAddEnabled(false);
                  setAddTargetLayerId(null);
                  setStatusText('');
                }}
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-3 space-y-2">
              <div className="text-xs text-gray-600">请选择要插入控制点的测绘图层（仅线/面）。</div>

              {polyOrPolyLayers.length === 0 ? (
                <div className="text-xs text-gray-500">当前没有可用的线/面测绘图层</div>
              ) : (
                <div className="max-h-48 overflow-auto border rounded">
                  {polyOrPolyLayers.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      className={`w-full text-left px-2 py-2 text-xs border-b last:border-b-0 ${
                        addTargetLayerId === l.id ? 'bg-blue-50' : 'bg-white'
                      }`}
                      onClick={() => {
                        setAddTargetLayerId(l.id);
                        setStatusText(`添加模式：已选择 Layer ${l.id}，请点击地图插入控制点（阈值 ${SNAP_MAX_DIST} 格）`);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">Layer {l.id}</span>
                        <span className="text-[11px] text-gray-500">{l.mode === 'polygon' ? '面' : '线'}</span>
                      </div>
                      <div className="text-[11px] text-gray-500">控制点数：{getEffectiveCoords(l).length}</div>
                    </button>
                  ))}
                </div>
              )}

              <div className="text-[11px] text-gray-500">
                点击地图后将自动选择最近线段并插入（落点会被修正到最近点；超出阈值则不插入）。
              </div>
            </div>
          </div>
        </DraggablePanel>
      )}

      {/* 轻量提示（不依赖面板） */}
      {(editEnabled || addEnabled) && (
        <div className="mt-2 text-[11px] text-gray-500">
          {editEnabled && '修改模式：先点击控制点，再点击地图设置新位置。'}
          {addEnabled && '添加模式：先在面板选择图层，再点击地图插入控制点。'}
        </div>
      )}
    </div>
  );
});
