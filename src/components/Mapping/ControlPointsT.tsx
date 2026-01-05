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
import { formatGridNumber, snapWorldPointByMode } from '@/components/Mapping/GridSnapModeSwitch';
import type { DynmapProjection } from '@/lib/DynmapProjection';
import { DraggablePanel } from '@/components/DraggablePanel/DraggablePanel';
import { Pencil, Plus, Save, Undo2, Redo2, X, ArrowLeftRight } from 'lucide-react';
import AppButton from '@/components/ui/AppButton';
import AppCard from '@/components/ui/AppCard';

export type WorldPoint = { x: number; z: number; y?: number };

export type ControlPointsTHandle = {
  /** 主控件可用于判断是否需要屏蔽绘制区 click */
  isBusy: () => boolean;
  /** 当前工作模式 */
  getMode: () => 'none' | 'edit' | 'add';
};

type ControlPointsTProps = {
  mapReady: boolean;
  leafletMapRef: MutableRefObject<L.Map | null>;
  projectionRef: MutableRefObject<DynmapProjection | null>;

  /**
   * 当前正在绘制/编辑的要素上下文（仅处理当前要素）
   * - mode 为 point/none 时按钮应禁用
   * - coords 通常对接 MeasuringModule 的 tempPoints
   */
  activeMode: 'none' | 'point' | 'polyline' | 'polygon';
  activeColor: string;
  activeCoords: WorldPoint[];

  /**
   * 保存（应用）按钮：把 ControlPointsT 的“已保存结果”写回当前要素
   *（例如：setTempPoints(newCoords)）
   */
  onApplyActiveCoords?: (coords: WorldPoint[]) => void;

  /**
   * 当控制点修改/添加窗口开启时，主控件应当屏蔽“绘制区 click 加点”
   *（因为 Leaflet 多监听无法可靠 stop 其他监听器）
   */
  onSetDrawClickSuppressed?: (suppressed: boolean) => void;

  /**
   * “显示控制点”强制开启且不可关闭：对接 MeasuringModule 的开关
   * - 进入 edit/add：强制 enabled=true, locked=true
   * - 退出 edit/add：恢复进入前的状态
   */
  showControlPointsEnabled?: boolean;
  showControlPointsLocked?: boolean;
  setShowControlPointsEnabled?: (v: boolean) => void;
  setShowControlPointsLocked?: (v: boolean) => void;

  /**
   * 参考线（辅助线）过滤：修改模式下，map click 获取坐标后必须先经过参考线过滤
   * - 输入：世界坐标（x,z）
   * - 输出：过滤后的世界坐标（可能被阈值贴附，也可能不变）
   */
  filterWorldPointByAssistLine?: (p: WorldPoint) => WorldPoint;

  /**
   * 控制点添加模式：需要“先关闭当前参考线，再以当前要素为目标启用‘选择要素’模式，并阈值=50”
   * 由于 AssistLineTools 当前未必暴露编程接口，这里用回调交由主控件实现。
   * 若你暂时不接入，文件内部仍会用“当前要素最近点插入（阈值 50）”实现核心效果。
   */
  onEnterAddModeConfigureAssistLine?: () => void;
  onExitAddModeRestoreAssistLine?: () => void;
};

const Y_FOR_DISPLAY = 64;
const ADD_SNAP_MAX_DIST = 50;

function clamp01(n: number) {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function samePoint(a: WorldPoint, b: WorldPoint, eps = 1e-9) {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.z - b.z) <= eps;
}

function closestPointOnSegment(p: WorldPoint, a: WorldPoint, b: WorldPoint) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apz = p.z - a.z;
  const denom = abx * abx + abz * abz;

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
  if (ring.length >= 2 && samePoint(ring[0], ring[ring.length - 1])) {
    ring.pop();
  }
  return { rings: [ring], closed: [isPolygon] };
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

type EditAction =
  | {
      kind: 'move';
      index: number;
      from: WorldPoint;
      to: WorldPoint;
    }
  | {
      kind: 'insert';
      index: number;
      point: WorldPoint;
    };

export default forwardRef<ControlPointsTHandle, ControlPointsTProps>(function ControlPointsT(props, ref) {
  const {
    mapReady,
    leafletMapRef,
    projectionRef,
    activeMode,
    activeColor,
    activeCoords,
    onApplyActiveCoords,
    onSetDrawClickSuppressed,

    showControlPointsEnabled,
    showControlPointsLocked,
    setShowControlPointsEnabled,
    setShowControlPointsLocked,

    filterWorldPointByAssistLine,
    onEnterAddModeConfigureAssistLine,
    onExitAddModeRestoreAssistLine,
  } = props;

  const [editEnabled, setEditEnabled] = useState(false);
  const [addEnabled, setAddEnabled] = useState(false);

  const [editPanelOpen, setEditPanelOpen] = useState(false);
  const [addPanelOpen, setAddPanelOpen] = useState(false);

  const [statusText, setStatusText] = useState<string>('');

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // 当前会话的工作坐标（未保存）
  const [workingCoords, setWorkingCoords] = useState<WorldPoint[] | null>(null);

  // 撤回/恢复
  const [undoStack, setUndoStack] = useState<EditAction[]>([]);
  const [redoStack, setRedoStack] = useState<EditAction[]>([]);

  // 进入工具前的“显示控制点”状态，用于退出后恢复
  const prevShowStateRef = useRef<{ enabled: boolean; locked: boolean } | null>(null);

  // Leaflet overlay
  const vertexGroupRef = useRef<L.LayerGroup | null>(null);
  const overlayGroupRef = useRef<L.LayerGroup | null>(null);

  const projToWorld = useCallback(
    (latlng: L.LatLng): WorldPoint | null => {
      const proj = projectionRef.current;
      if (!proj) return null;
      const loc = proj.latLngToLocation(latlng, Y_FOR_DISPLAY);
      return { x: loc.x, z: loc.z };
    },
    [projectionRef]
  );

//  const worldToLatLng = useCallback(
//    (p: WorldPoint): L.LatLng | null => {
//      const proj = projectionRef.current;
//      if (!proj) return null;
//      return proj.locationToLatLng(p.x, Y_FOR_DISPLAY, p.z);
//    },
//    [projectionRef]
//  );

  const fmt = useCallback((p: WorldPoint) => `${formatGridNumber(p.x)}, ${formatGridNumber(p.z)}`, []);

  const modeOk = useMemo(() => activeMode === 'polyline' || activeMode === 'polygon', [activeMode]);

  const sessionCoords = useMemo<WorldPoint[]>(() => {
    // workingCoords 优先（用于预览与控制点渲染）
    return workingCoords ?? activeCoords;
  }, [workingCoords, activeCoords]);

  const dirty = useMemo(() => undoStack.length > 0, [undoStack.length]);

  const forceShowControlPointsOn = useCallback(() => {
    if (!setShowControlPointsEnabled || !setShowControlPointsLocked) return;

    // 记录进入前状态（只记录一次）
    if (!prevShowStateRef.current) {
      prevShowStateRef.current = {
        enabled: Boolean(showControlPointsEnabled),
        locked: Boolean(showControlPointsLocked),
      };
    }

    setShowControlPointsEnabled(true);
    setShowControlPointsLocked(true);
  }, [
    setShowControlPointsEnabled,
    setShowControlPointsLocked,
    showControlPointsEnabled,
    showControlPointsLocked,
  ]);

  const restoreShowControlPoints = useCallback(() => {
    if (!setShowControlPointsEnabled || !setShowControlPointsLocked) {
      prevShowStateRef.current = null;
      return;
    }
    const prev = prevShowStateRef.current;
    if (!prev) return;

    setShowControlPointsEnabled(prev.enabled);
    setShowControlPointsLocked(prev.locked);
    prevShowStateRef.current = null;
  }, [setShowControlPointsEnabled, setShowControlPointsLocked]);

  const clearSession = useCallback(() => {
    setSelectedIndex(null);
    setWorkingCoords(null);
    setUndoStack([]);
    setRedoStack([]);
    setStatusText('');
  }, []);

  const endAllModes = useCallback(
    (opts?: { restoreAssistLine?: boolean }) => {
      setEditEnabled(false);
      setAddEnabled(false);
      setEditPanelOpen(false);
      setAddPanelOpen(false);
      setSelectedIndex(null);
      setWorkingCoords(null);
      setUndoStack([]);
      setRedoStack([]);
      setStatusText('');

      onSetDrawClickSuppressed?.(false);
      restoreShowControlPoints();

      if (opts?.restoreAssistLine) {
        onExitAddModeRestoreAssistLine?.();
      }
    },
    [onSetDrawClickSuppressed, restoreShowControlPoints, onExitAddModeRestoreAssistLine]
  );

// -------- Leaflet 容器挂载/卸载 --------
useEffect(() => {
  if (!mapReady) return;
  const map = leafletMapRef.current;
  if (!map) return;

  // 专用 pane：保证控制点点/虚线预览总在更上层，避免被其它 overlay 吃点击
  const PANE = 'controlPointsT-pane';
  if (!map.getPane(PANE)) {
    const pane = map.createPane(PANE);
    // 650：高于默认 Path pane，确保可交互点在最上层（你也可按项目统一规范改）
    pane.style.zIndex = '650';
  }

  if (!vertexGroupRef.current) vertexGroupRef.current = L.layerGroup();
  if (!overlayGroupRef.current) overlayGroupRef.current = L.layerGroup();

  if (!map.hasLayer(vertexGroupRef.current)) vertexGroupRef.current.addTo(map);
  if (!map.hasLayer(overlayGroupRef.current)) overlayGroupRef.current.addTo(map);

  return () => {
    if (vertexGroupRef.current && map.hasLayer(vertexGroupRef.current)) map.removeLayer(vertexGroupRef.current);
    if (overlayGroupRef.current && map.hasLayer(overlayGroupRef.current)) map.removeLayer(overlayGroupRef.current);
  };
}, [mapReady, leafletMapRef]);


  // -------- overlay：预览未保存几何（虚线）--------
  useEffect(() => {
    const proj = projectionRef.current;
    const overlay = overlayGroupRef.current;
    if (!proj || !overlay) return;

    overlay.clearLayers();

    // 仅在 edit/add 启用且 dirty 时显示预览
    if (!(editEnabled || addEnabled)) return;
    if (!dirty) return;
    if (!modeOk) return;

    const latlngs = sessionCoords
      .map((p) => proj.locationToLatLng(p.x, Y_FOR_DISPLAY, p.z))
      .filter(Boolean) as L.LatLng[];

    if (latlngs.length < 1) return;

    if (activeMode === 'polyline') {
      if (latlngs.length < 2) return;
      L.polyline(latlngs, {
        color: activeColor,
        weight: 3,
        dashArray: '6 6',
        opacity: 0.9,
      }).addTo(overlay);
      return;
    }

    if (activeMode === 'polygon') {
      if (latlngs.length < 3) return;
      L.polygon(latlngs, {
        color: activeColor,
        weight: 3,
        dashArray: '6 6',
        fill: false,
        opacity: 0.9,
      }).addTo(overlay);
    }
  }, [editEnabled, addEnabled, dirty, modeOk, sessionCoords, activeMode, activeColor, projectionRef]);

  // -------- vertex：渲染控制点（仅当前要素）--------
  useEffect(() => {
    const proj = projectionRef.current;
    const vg = vertexGroupRef.current;
    if (!proj || !vg) return;

    vg.clearLayers();

    // 只有 edit/add 启动时才显示（符合你本次“强制显示控制点”需求）
    if (!(editEnabled || addEnabled)) {
      return;
    }

    if (!modeOk) {
      setSelectedIndex(null);
      return;
    }

    const coords = sessionCoords;
    if (!Array.isArray(coords) || coords.length === 0) return;

    coords.forEach((p, idx) => {
      const ll = proj.locationToLatLng(p.x, Y_FOR_DISPLAY, p.z);
      const isSelected = editEnabled && selectedIndex === idx;

const marker = L.circleMarker(ll, {
  pane: 'controlPointsT-pane',
  // 关键：阻止事件冒泡到 map（否则 map click 可能也执行）:contentReference[oaicite:3]{index=3}
  bubblingMouseEvents: false,

  radius: isSelected ? 7 : 5,
  color: activeColor,
  fillColor: activeColor,
  fillOpacity: 0.7,
  weight: isSelected ? 3 : 2,
  opacity: 0.95,
});

      // hover 显示坐标
      marker.bindTooltip(fmt(p), {
        direction: 'top',
        offset: L.point(0, -6),
        opacity: 0.9,
        sticky: true,
      });

marker.on('click', (e: any) => {
  // 兜底：阻止 DOM 事件继续冒泡 :contentReference[oaicite:4]{index=4}
  if (e?.originalEvent) {
    L.DomEvent.stop(e.originalEvent);
  }

  // 修改模式允许选择控制点；添加模式只作为展示
  if (!editEnabled) return;

  setSelectedIndex(idx);
  setStatusText(`已选择控制点 #${idx + 1}，请点击地图设置新位置（参考线过滤将先执行）`);
});

      vg.addLayer(marker);
    });
  }, [editEnabled, addEnabled, modeOk, sessionCoords, activeColor, selectedIndex, fmt, projectionRef]);

// -------- map click：修改模式“选点后下一次点击移动”--------
useEffect(() => {
  const map = leafletMapRef.current;
  if (!map) return;

  const onMapClick = (e: L.LeafletMouseEvent) => {
    if (!editEnabled) return;
    if (!editPanelOpen) return;
    if (!modeOk) return;
    if (selectedIndex === null) return;

    const w0 = projToWorld(e.latlng);
    if (!w0) return;

    // 参考线过滤（高优先级）
    const wFiltered = filterWorldPointByAssistLine ? filterWorldPointByAssistLine(w0) : w0;

    // 网格化（整数 / 0.5 / 强制中心）：在“参考线修正”之后对坐标做修正
    const wSnapped = snapWorldPointByMode(wFiltered);

    setWorkingCoords((prev) => {
      const base = (prev ?? activeCoords).slice();
      if (selectedIndex < 0 || selectedIndex >= base.length) return prev ?? activeCoords;

      const from = base[selectedIndex];
      const to: WorldPoint = { ...wSnapped, y: from?.y };
      base[selectedIndex] = to;

      // 记录动作
      setUndoStack((u) => [...u, { kind: 'move', index: selectedIndex, from, to }]);
      setRedoStack([]); // 新动作清空 redo

      setStatusText(`已修改控制点 #${selectedIndex + 1} -> ${fmt(to)}`);
      return base;
    });
  };

  map.on('click', onMapClick);
  return () => {
    map.off('click', onMapClick);
  };
}, [
  leafletMapRef,
  editEnabled,
  editPanelOpen,
  modeOk,
  selectedIndex,
  projToWorld,
  activeCoords,
  filterWorldPointByAssistLine,
  fmt,
]);


// -------- map click：添加模式“点击插入（阈值 50）”--------
useEffect(() => {
  const map = leafletMapRef.current;
  if (!map) return;

  const onMapClick = (e: L.LeafletMouseEvent) => {
    if (!addEnabled) return;
    if (!addPanelOpen) return;
    if (!modeOk) return;

    const w = projToWorld(e.latlng);
    if (!w) return;

    setWorkingCoords((prev) => {
      const baseRaw = prev ?? activeCoords;
      const isPolygon = activeMode === 'polygon';

      const geom = normalizeRingsForPolygonLike(baseRaw, isPolygon);
      const coords = geom.rings[0];

      if (coords.length < 2) {
        setStatusText('控制点添加：当前要素控制点不足 2 个，无法插入');
        return prev ?? activeCoords;
      }

      const best = closestPointOnRings(w, geom);
      if (!best.point || !Number.isFinite(best.dist)) return prev ?? activeCoords;

      if (best.dist > ADD_SNAP_MAX_DIST) {
        setStatusText(`未插入：距离当前要素超过 ${ADD_SNAP_MAX_DIST} 格`);
        return prev ?? activeCoords;
      }

      const segIndex = best.segIndex;
      const n = coords.length;

      const insertIndex = (() => {
        if (isPolygon) {
          if (segIndex >= n - 1) return n; // last->first
          return segIndex + 1;
        }
        // polyline
        if (segIndex < 0) return n;
        return Math.min(segIndex + 1, n);
      })();

      const next = coords.slice();

      const segA = coords[segIndex];
      const segB = coords[(segIndex + 1) % n];
      const yInterp =
        typeof segA?.y === 'number' && typeof segB?.y === 'number'
          ? segA.y + (segB.y - segA.y) * (best.t ?? 0)
          : undefined;

      // ① 最近点（落点修正到当前要素）
      // ② 网格化（整数 / 0.5 / 强制中心）：在“最近点修正”之后对坐标做修正
      const snapped = snapWorldPointByMode(best.point);
      const inserted: WorldPoint = { ...snapped, y: yInterp };

      next.splice(insertIndex, 0, inserted);

      // 记录动作：必须记录 inserted（而不是 best.point），否则撤回/恢复与“保存前显示”都会出现未网格化的问题
      setUndoStack((u) => [...u, { kind: 'insert', index: insertIndex, point: inserted }]);
      setRedoStack([]);

      setStatusText(`已插入控制点：${fmt(inserted)}（阈值 ${ADD_SNAP_MAX_DIST}）`);
      return next;
    });
  };

  map.on('click', onMapClick);
  return () => {
    map.off('click', onMapClick);
  };
}, [leafletMapRef, addEnabled, addPanelOpen, modeOk, projToWorld, activeCoords, activeMode, fmt]);

  // -------- 撤回/恢复 --------
  const doUndo = useCallback(() => {
    setUndoStack((u) => {
      if (!u.length) return u;
      const last = u[u.length - 1];

      setWorkingCoords((prev) => {
        const base = (prev ?? activeCoords).slice();

        if (last.kind === 'move') {
          if (last.index >= 0 && last.index < base.length) {
            base[last.index] = last.from;
          }
        } else if (last.kind === 'insert') {
          if (last.index >= 0 && last.index < base.length) {
            base.splice(last.index, 1);
          }
        }
        return base;
      });

      setRedoStack((r) => [...r, last]);
      return u.slice(0, u.length - 1);
    });
  }, [activeCoords]);

  const doRedo = useCallback(() => {
    setRedoStack((r) => {
      if (!r.length) return r;
      const last = r[r.length - 1];

      setWorkingCoords((prev) => {
        const base = (prev ?? activeCoords).slice();

        if (last.kind === 'move') {
          if (last.index >= 0 && last.index < base.length) {
            base[last.index] = last.to;
          }
        } else if (last.kind === 'insert') {
          const idx = Math.max(0, Math.min(last.index, base.length));
          base.splice(idx, 0, last.point);
        }

        return base;
      });

      setUndoStack((u) => [...u, last]);
      return r.slice(0, r.length - 1);
    });
  }, [activeCoords]);

  // -------- 保存（应用到当前要素，并关闭窗口）--------
  const commitAndClose = useCallback(
    (mode: 'edit' | 'add') => {
      const coords = (workingCoords ?? activeCoords).slice();

      // 应用结果
      onApplyActiveCoords?.(coords);

      // 退出模式
      if (mode === 'add') {
        endAllModes({ restoreAssistLine: true });
      } else {
        endAllModes({ restoreAssistLine: false });
      }
    },
    [workingCoords, activeCoords, onApplyActiveCoords, endAllModes]
  );

  const tryClosePanelDiscard = useCallback(
    (mode: 'edit' | 'add') => {
      // 未保存提醒：仅当“修改操作记录”非空（这里以 undoStack 非空为准）
      if (undoStack.length > 0) {
        const ok = window.confirm('修改未保存，确定关闭并丢弃本次修改吗？');
        if (!ok) return;
      }

      // 丢弃：清理会话并退出
      if (mode === 'add') {
        onExitAddModeRestoreAssistLine?.();
      }
      endAllModes({ restoreAssistLine: mode === 'add' });
    },
    [undoStack.length, endAllModes, onExitAddModeRestoreAssistLine]
  );

  // -------- 互斥开关：控制点修改 / 控制点添加 --------
  const toggleEdit = useCallback(() => {
    // 若正在添加，先关闭添加（按互斥逻辑）
    if (addEnabled || addPanelOpen) {
      // 有未保存修改时，由添加窗口自己的关闭逻辑负责提醒
      tryClosePanelDiscard('add');
    }

    setEditEnabled((v) => {
      const next = !v;
      if (next) {
        if (!modeOk) {
          setStatusText('控制点修改仅支持线/面要素');
          return false;
        }

        // 开启 edit
        setAddEnabled(false);
        setAddPanelOpen(false);

        setEditPanelOpen(true);
        setSelectedIndex(null);

        // 开启会话副本（未保存）
        setWorkingCoords(activeCoords.slice());
        setUndoStack([]);
        setRedoStack([]);

        // 强制显示控制点 + 锁定
        forceShowControlPointsOn();

        // 屏蔽绘制区 click 加点
        onSetDrawClickSuppressed?.(true);

        setStatusText('控制点修改已开启：点击控制点后，再点击地图设置新位置');
      } else {
        // 关闭 edit：若有修改，提醒丢弃
        tryClosePanelDiscard('edit');
      }
      return next;
    });
  }, [
    addEnabled,
    addPanelOpen,
    tryClosePanelDiscard,
    modeOk,
    activeCoords,
    forceShowControlPointsOn,
    onSetDrawClickSuppressed,
  ]);

  const toggleAdd = useCallback(() => {
    // 若正在修改，先关闭修改（按互斥逻辑）
    if (editEnabled || editPanelOpen) {
      tryClosePanelDiscard('edit');
    }

    setAddEnabled((v) => {
      const next = !v;
      if (next) {
        if (!modeOk) {
          setStatusText('控制点添加仅支持线/面要素');
          return false;
        }

        // 开启 add
        setEditEnabled(false);
        setEditPanelOpen(false);
        setSelectedIndex(null);

        setAddPanelOpen(true);

        // 开启会话副本（未保存）
        setWorkingCoords(activeCoords.slice());
        setUndoStack([]);
        setRedoStack([]);

        // 强制显示控制点 + 锁定
        forceShowControlPointsOn();

        // 屏蔽绘制区 click 加点
        onSetDrawClickSuppressed?.(true);

        // 按需求：重置并配置参考线为“选择要素=当前要素，阈值=50”
        onEnterAddModeConfigureAssistLine?.();

        setStatusText(`控制点添加已开启：点击地图将按最近点插入（阈值 ${ADD_SNAP_MAX_DIST}）`);
      } else {
        // 关闭 add：若有修改，提醒丢弃
        tryClosePanelDiscard('add');
      }
      return next;
    });
  }, [
    editEnabled,
    editPanelOpen,
    tryClosePanelDiscard,
    modeOk,
    activeCoords,
    forceShowControlPointsOn,
    onSetDrawClickSuppressed,
    onEnterAddModeConfigureAssistLine,
  ]);


  // -------- 关闭时清理 overlay/markers --------
  useEffect(() => {
    if (editEnabled || addEnabled) return;

    vertexGroupRef.current?.clearLayers();
    overlayGroupRef.current?.clearLayers();
    clearSession();
    // 退出后确保解除主控件 click 屏蔽
    onSetDrawClickSuppressed?.(false);
    restoreShowControlPoints();
  }, [editEnabled, addEnabled, clearSession, onSetDrawClickSuppressed, restoreShowControlPoints]);

  useImperativeHandle(
    ref,
    () => ({
      isBusy: () => Boolean(editEnabled || addEnabled),
      getMode: () => (editEnabled ? 'edit' : addEnabled ? 'add' : 'none'),
    }),
    [editEnabled, addEnabled]
  );

  const canEdit = useMemo(() => modeOk && activeCoords.length >= 1, [modeOk, activeCoords.length]);
  const canAdd = useMemo(() => modeOk && activeCoords.length >= 2, [modeOk, activeCoords.length]);

  // 控制点反转：线/面 且 控制点数 > 2 时可用；edit/add 启动时禁用避免冲突
  const busy = useMemo(() => Boolean(editEnabled || addEnabled), [editEnabled, addEnabled]);

  const canReverse = useMemo(() => {
    if (!modeOk) return false;
    if (activeCoords.length <= 1) return false; // “超过两个控制点”
    if (busy) return false; // edit/add 启动中禁用
    if (!onApplyActiveCoords) return false; // 没有回写通道则禁用
    return true;
  }, [modeOk, activeCoords.length, busy, onApplyActiveCoords]);

  const doReverse = useCallback(() => {
    if (!canReverse) return;

    // 关键：reverse() 会原地修改数组，因此必须先 copy 再 reverse :contentReference[oaicite:1]{index=1}
    const base = activeCoords.slice();

    // 兼容：若 polygon 意外包含闭合点（首尾相同），先去掉末尾闭合点再处理
    if (activeMode === 'polygon' && base.length >= 2 && samePoint(base[0], base[base.length - 1])) {
      base.pop();
    }

    const reversed = base.slice().reverse();

    onApplyActiveCoords?.(reversed);
    setStatusText('已执行：控制点顺序反转');
  }, [canReverse, activeCoords, activeMode, onApplyActiveCoords]);


  return (
    <div className="mt-2">
      {/* 主按钮行：在参考线按钮下面，仅 3 个按键 */}
      <div className="flex flex-wrap items-center gap-2">
        <AppButton
          type="button"
          className={`px-2 py-1 rounded text-xs border flex items-center gap-1 ${
            editEnabled ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-800 border-gray-300'
          } ${canEdit ? '' : 'opacity-50 cursor-not-allowed'}`}
          onClick={() => {
            if (!canEdit) {
              setStatusText('控制点修改：需要线/面要素且至少 1 个控制点');
              return;
            }
            toggleEdit();
          }}
          title="控制点修改"
        >
          <Pencil size={14} />
          控制点修改
        </AppButton>

        <AppButton
          type="button"
          className={`px-2 py-1 rounded text-xs border flex items-center gap-1 ${
            addEnabled ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-800 border-gray-300'
          } ${canAdd ? '' : 'opacity-50 cursor-not-allowed'}`}
          onClick={() => {
            if (!canAdd) {
              setStatusText('控制点添加：需要线/面要素且至少 2 个控制点');
              return;
            }
            toggleAdd();
          }}
          title="控制点添加"
        >
          <Plus size={14} />
          控制点添加
        </AppButton>

        <AppButton
          type="button"
          className={`px-2 py-1 rounded text-xs border flex items-center gap-1 ${
            canReverse ? 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50' : 'opacity-50 cursor-not-allowed bg-white text-gray-800 border-gray-300'
          }`}
          onClick={() => {
            if (!canReverse) {
              if (busy) {
                setStatusText('控制点反转：控制点修改/添加启动中，为避免冲突已禁用');
                return;
              }
              setStatusText('控制点反转：需要线/面要素且控制点数 > 2');
              return;
            }
            doReverse();
          }}
          disabled={!canReverse}
          title="控制点反转"
        >
          <ArrowLeftRight size={14} />
          控制点反转
        </AppButton>


        {(editEnabled || addEnabled) && dirty && <div className="text-xs text-orange-700">未保存修改</div>}
      </div>

      {statusText && <div className="mt-2 text-xs text-gray-700">{statusText}</div>}

      {/* 控制点修改窗口 */}
      {editEnabled && editPanelOpen && (
        <DraggablePanel id="cpT-edit-panel" defaultPosition={{ x: 16, y: 320 }} zIndex={1850}>
          <AppCard className="w-80 overflow-hidden border">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-bold text-gray-800">控制点修改</h3>
              <AppButton
                onClick={() => tryClosePanelDiscard('edit')}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                aria-label="关闭"
                title="关闭"
                type="button"
              >
                <X className="w-4 h-4" />
              </AppButton>
            </div>

            <div className="p-3 space-y-2">
              <div className="text-xs text-gray-600">
                点击任意控制点进入选择状态，然后点击地图设置新坐标。
                <div className="mt-1">该坐标会先经过“参考线(辅助线)”过滤后再应用。</div>
              </div>

              <div className="flex gap-2">
                <AppButton
                  className={`flex-1 px-2 py-2 rounded-lg text-sm bg-yellow-400 text-white flex items-center justify-center gap-2 ${
                    undoStack.length ? '' : 'opacity-50 cursor-not-allowed'
                  }`}
                  onClick={doUndo}
                  disabled={!undoStack.length}
                  type="button"
                >
                  <Undo2 className="w-4 h-4" />
                  撤回
                </AppButton>

                <AppButton
                  className={`flex-1 px-2 py-2 rounded-lg text-sm bg-orange-400 text-white flex items-center justify-center gap-2 ${
                    redoStack.length ? '' : 'opacity-50 cursor-not-allowed'
                  }`}
                  onClick={doRedo}
                  disabled={!redoStack.length}
                  type="button"
                >
                  <Redo2 className="w-4 h-4" />
                  恢复
                </AppButton>

                <AppButton
                  className="flex-1 px-2 py-2 rounded-lg text-sm bg-green-600 text-white flex items-center justify-center gap-2"
                  onClick={() => commitAndClose('edit')}
                  type="button"
                >
                  <Save className="w-4 h-4" />
                  保存
                </AppButton>
              </div>

              <div className="text-[11px] text-gray-500">
                当前控制点数：{sessionCoords.length}；{selectedIndex === null ? '未选择控制点' : `已选 #${selectedIndex + 1}`}
              </div>
            </div>
          </AppCard>
        </DraggablePanel>
      )}

      {/* 控制点添加窗口 */}
      {addEnabled && addPanelOpen && (
        <DraggablePanel id="cpT-add-panel" defaultPosition={{ x: 16, y: 320 }} zIndex={1850}>
          <AppCard className="w-80 overflow-hidden border">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-bold text-gray-800">控制点添加</h3>
              <AppButton
                onClick={() => tryClosePanelDiscard('add')}
                className="text-gray-400 hover:text-gray-600"
                aria-label="关闭"
                type="button"
              >
                <X className="w-5 h-5" />
              </AppButton>
            </div>

            <div className="p-3 space-y-2">
              <div className="text-xs text-gray-600">
                点击地图将根据当前要素的最近线段插入控制点。
                <div className="mt-1">阈值：{ADD_SNAP_MAX_DIST} 格，超出阈值不插入。</div>
                <div className="mt-1">进入本模式时会请求主控件重置/配置参考线为“当前要素目标 + 阈值 50”。</div>
              </div>

              <div className="flex gap-2">
                <AppButton
                  className={`flex-1 px-2 py-2 rounded-lg text-sm bg-yellow-400 text-white flex items-center justify-center gap-2 ${
                    undoStack.length ? '' : 'opacity-50 cursor-not-allowed'
                  }`}
                  onClick={doUndo}
                  disabled={!undoStack.length}
                  type="button"
                >
                  <Undo2 className="w-4 h-4" />
                  撤回
                </AppButton>

                <AppButton
                  className={`flex-1 px-2 py-2 rounded-lg text-sm bg-orange-400 text-white flex items-center justify-center gap-2 ${
                    redoStack.length ? '' : 'opacity-50 cursor-not-allowed'
                  }`}
                  onClick={doRedo}
                  disabled={!redoStack.length}
                  type="button"
                >
                  <Redo2 className="w-4 h-4" />
                  恢复
                </AppButton>

                <AppButton
                  className="flex-1 px-2 py-2 rounded-lg text-sm bg-green-600 text-white flex items-center justify-center gap-2"
                  onClick={() => commitAndClose('add')}
                  type="button"
                >
                  <Save className="w-4 h-4" />
                  保存
                </AppButton>
              </div>

              <div className="text-[11px] text-gray-500">当前控制点数：{sessionCoords.length}</div>
            </div>
          </AppCard>
        </DraggablePanel>
      )}
    </div>
  );
});