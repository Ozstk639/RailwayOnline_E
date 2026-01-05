import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DynmapProjection } from '@/lib/DynmapProjection';
import DraggablePanel from '../DraggablePanel/DraggablePanel';
import { Ruler, X } from 'lucide-react';
import ToolIconButton from '@/components/Toolbar/ToolIconButton';
import AppButton from '@/components/ui/AppButton';
import AppCard from '@/components/ui/AppCard';


type WorldPoint = { x: number; z: number };

type MeasurementToolsModuleProps = {
  mapReady: boolean;
  leafletMapRef: MutableRefObject<L.Map | null>;
  projectionRef: MutableRefObject<DynmapProjection | null>;

  /**
   * 由 MapContainer 传入：当别的主面板打开时，递增该值以“强制关闭并清空本组件”
   */
  closeSignal?: number;

  /**
   * 当本组件被打开时回调：MapContainer 用它去“关闭 MeasuringModule（视同点击结束测绘）”
   */
  onBecameActive?: () => void;

  /**
   * 可选：将启动按钮插入到外部工具栏
   */
  launcherSlot?: (launcher: React.ReactNode) => React.ReactNode;
};

type MainTab = 'measure' | 'shape' | 'analysis';
type MeasureMetric = 'euclidean' | 'manhattan';
type ShapeKind = 'circle' | 'square' | 'polygon' | 'curve';

type ToolLayerKind = 'measure-line' | 'shape-ellipse' | 'shape-square';

type ShapeEllipseData = {
  center: WorldPoint;
  rx: number;
  rz: number;
  rotationDeg: number;
};

type ShapeSquareData = {
  p1: WorldPoint; // 对角点1
  p2: WorldPoint; // 对角点2
  rotationDeg: number;
};

type ToolLayer = {
  id: number;
  kind: ToolLayerKind;
  visible: boolean;
  leafletGroup: L.LayerGroup;
  summaryText: string; 
  detailText: string;
  data?: ShapeEllipseData | ShapeSquareData;
};

const Y_FOR_DISPLAY = 64;

function clampNumber(n: number, fallback: number) {
  return Number.isFinite(n) ? n : fallback;
}

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function rotateXZ(x: number, z: number, rad: number) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: x * c - z * s, z: x * s + z * c };
}

export default function MeasurementToolsModule(props: MeasurementToolsModuleProps) {
  const { mapReady, leafletMapRef, projectionRef, closeSignal, onBecameActive, launcherSlot } = props;

  // 主按钮开关
  const [active, setActive] = useState(false);

  // 三大主类按钮
  const [mainTab, setMainTab] = useState<MainTab>('measure');

  // 1) 测量：下拉选项（清除/直线/曼哈顿）
  const [measureMetric, setMeasureMetric] = useState<MeasureMetric>('euclidean');

  // 2) 形状：子选项
  const [shapeKind, setShapeKind] = useState<ShapeKind>('circle');

  // 图层管理
  const [layers, setLayers] = useState<ToolLayer[]>([]);
  const nextIdRef = useRef(1);

  // 选中某层（用于旋转滑条）
  const [selectedLayerId, setSelectedLayerId] = useState<number | null>(null);

  // Leaflet 根容器（只承载本工具产生的图形）
  const toolRootRef = useRef<L.LayerGroup | null>(null);

  // 测量（两点）
  const pendingMeasureStartRef = useRef<WorldPoint | null>(null);

  // 方形（两点）
  const pendingSquareStartRef = useRef<WorldPoint | null>(null);

  // 圆/椭圆：点击中心后弹窗输入半径
  const [radiusModalOpen, setRadiusModalOpen] = useState(false);
  const pendingCircleCenterRef = useRef<WorldPoint | null>(null);
  const [rxInput, setRxInput] = useState<string>('10');
  const [rzInput, setRzInput] = useState<string>('10');

  // ---------- 工具函数：坐标转换 ----------
  const toWorld = (latlng: L.LatLng): WorldPoint | null => {
    const proj = projectionRef.current;
    if (!proj) return null;
    const loc = proj.latLngToLocation(latlng, Y_FOR_DISPLAY);
    return { x: loc.x, z: loc.z };
  };

  const toLatLng = (p: WorldPoint): L.LatLng | null => {
    const proj = projectionRef.current;
    if (!proj) return null;
    return proj.locationToLatLng(p.x, Y_FOR_DISPLAY, p.z);
  };
  void toLatLng;


  const fmtCoord = (p: WorldPoint) => `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`;

  const makeLabelMarker = (latlng: L.LatLng, text: string) => {
    // DivIcon 方案：HTML 自带样式，避免依赖外部 CSS
    const html = `
      <div style="
        background: rgba(0,0,0,0.65);
        color: #fff;
        padding: 2px 6px;
        border-radius: 6px;
        font-size: 12px;
        white-space: nowrap;
        transform: translate(-50%, -50%);
      ">${text}</div>
    `;
    return L.marker(latlng, {
      interactive: false,
      icon: L.divIcon({
        className: '',
        html,
        iconSize: [0, 0],
      }),
    });
  };

  const handleClosePanels = () => {
  hardResetAndClose();
};


  // ---------- 根容器挂载/卸载 ----------
  useEffect(() => {
    if (!mapReady) return;
    const map = leafletMapRef.current;
    if (!map) return;

    if (!toolRootRef.current) {
      toolRootRef.current = L.layerGroup();
    }

    if (active) {
      if (!map.hasLayer(toolRootRef.current)) toolRootRef.current.addTo(map);
    } else {
      if (map.hasLayer(toolRootRef.current)) map.removeLayer(toolRootRef.current);
    }
  }, [mapReady, active, leafletMapRef]);

  // ---------- 强制关闭：来自 MapContainer 的 closeSignal ----------
  useEffect(() => {
    if (closeSignal === undefined) return;
    // 只要变化就强制清空并关闭
    hardResetAndClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeSignal]);

  // ---------- 切主类按钮：自动清空图层且不提示 ----------
  useEffect(() => {
    if (!active) return;
    clearAllLayers();
    // 切换时重置流程态
    pendingMeasureStartRef.current = null;
    pendingSquareStartRef.current = null;
    setSelectedLayerId(null);
    setRadiusModalOpen(false);
    pendingCircleCenterRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  // ---------- 地图点击监听（仅 active 时） ----------
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;

    const onMapClick = (e: L.LeafletMouseEvent) => {
      if (!active) return;
      if (radiusModalOpen) return; // 弹窗时禁止继续点图

      const w = toWorld(e.latlng);
      if (!w) return;

      if (mainTab === 'measure') {
        handleMeasureClick(w);
        return;
      }

      if (mainTab === 'shape') {
        handleShapeClick(w);
        return;
      }

      // analysis 暂未实装：不处理点击
    };

    map.on('click', onMapClick);
    return () => {
      map.off('click', onMapClick);
    };
    // 注意：mainTab/active/radiusModalOpen 变化会重绑，保证逻辑一致
  }, [active, mainTab, radiusModalOpen, measureMetric, shapeKind]);

  // ---------- 结果文本框 ----------
  const resultsText = useMemo(() => {
  if (!layers.length) return '';
  return layers.map((l, idx) => `Layer ${idx + 1} ${l.summaryText}`).join('\n');
}, [layers]);


  // ---------- 核心：清空 ----------
  const clearAllLayers = () => {
    // 清掉 Leaflet
    toolRootRef.current?.clearLayers();

    // 清掉 state
    setLayers([]);
    setSelectedLayerId(null);
  };

  const hardResetAndClose = () => {
    clearAllLayers();
    pendingMeasureStartRef.current = null;
    pendingSquareStartRef.current = null;
    pendingCircleCenterRef.current = null;
    setRadiusModalOpen(false);
    setMainTab('measure');
    setMeasureMetric('euclidean');
    setShapeKind('circle');
    setActive(false);
  };

  // ---------- 图层顺序/显隐同步 ----------
  const syncRootByStateOrder = (next: ToolLayer[]) => {
    const root = toolRootRef.current;
    if (!root) return;
    root.clearLayers();
    for (const l of next) {
      if (!l.visible) continue;
      root.addLayer(l.leafletGroup);
    }
  };

  // ---------- 创建：测量线 ----------
  const computeDistance = (a: WorldPoint, b: WorldPoint, metric: MeasureMetric) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (metric === 'manhattan') {
      return Math.abs(dx) + Math.abs(dz);
    }
    // euclidean
    return Math.hypot(dx, dz);
  };

  const addMeasureLineLayer = (a: WorldPoint, b: WorldPoint, metric: MeasureMetric) => {
    const proj = projectionRef.current;
    if (!proj) return;

    const llA = proj.locationToLatLng(a.x, Y_FOR_DISPLAY, a.z);
    const llB = proj.locationToLatLng(b.x, Y_FOR_DISPLAY, b.z);

    const group = L.layerGroup();

    const line = L.polyline([llA, llB], { color: '#00bcd4' });
    line.addTo(group);

    const mid = L.latLng((llA.lat + llB.lat) / 2, (llA.lng + llB.lng) / 2);
    const dist = computeDistance(a, b, metric);

    const label = makeLabelMarker(
      mid,
      metric === 'manhattan'
        ? `曼哈顿距离: ${dist.toFixed(2)}`
        : `直线距离: ${dist.toFixed(2)}`
    );
    label.addTo(group);

    const id = nextIdRef.current++;
    const layerObj: ToolLayer = {
  id,
  kind: 'measure-line',
  visible: true,
  leafletGroup: group,

  // 输出窗口（干净）
  summaryText:
    metric === 'manhattan'
      ? `距离(曼哈顿): ${dist.toFixed(2)}`
      : `距离(直线): ${dist.toFixed(2)}`,

  // 图层管理（细节）
  detailText:
    metric === 'manhattan'
      ? `距离(曼哈顿) = ${dist.toFixed(2)}  [A(${fmtCoord(a)}), B(${fmtCoord(b)})]`
      : `距离(直线) = ${dist.toFixed(2)}  [A(${fmtCoord(a)}), B(${fmtCoord(b)})]`,
};


    setLayers(prev => {
      const next = [...prev, layerObj];
      syncRootByStateOrder(next);
      return next;
    });
  };

  const handleMeasureClick = (p: WorldPoint) => {
    const start = pendingMeasureStartRef.current;
    if (!start) {
      pendingMeasureStartRef.current = p;
      return;
    }
    // 第二点
    addMeasureLineLayer(start, p, measureMetric);
    pendingMeasureStartRef.current = null;
  };

  // ---------- 创建：椭圆（圆） ----------
  const buildEllipseGroup = (data: ShapeEllipseData) => {
    const proj = projectionRef.current;
    if (!proj) return null;

    const { center, rx, rz, rotationDeg } = data;
    const rotationRad = degToRad(rotationDeg);

    const steps = 64;
    const latlngs: L.LatLng[] = [];

    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const localX = rx * Math.cos(t);
      const localZ = rz * Math.sin(t);
      const rot = rotateXZ(localX, localZ, rotationRad);
      const wp = { x: center.x + rot.x, z: center.z + rot.z };
      latlngs.push(proj.locationToLatLng(wp.x, Y_FOR_DISPLAY, wp.z));
    }

    const group = L.layerGroup();
    L.polygon(latlngs, { color: '#4caf50' }).addTo(group);

    // 四个“半径接触点”坐标 label（右/上/左/下）
    const touchLocal: Array<{ x: number; z: number }> = [
      { x: rx, z: 0 },
      { x: 0, z: rz },
      { x: -rx, z: 0 },
      { x: 0, z: -rz },
    ];

    touchLocal.forEach(tp => {
      const rot = rotateXZ(tp.x, tp.z, rotationRad);
      const wp = { x: center.x + rot.x, z: center.z + rot.z };
      const ll = proj.locationToLatLng(wp.x, Y_FOR_DISPLAY, wp.z);
      makeLabelMarker(ll, `(${fmtCoord(wp)})`).addTo(group);
    });

    return group;
  };

  const addEllipseLayer = (data: ShapeEllipseData) => {
    const group = buildEllipseGroup(data);
    if (!group) return;

    const area = Math.PI * data.rx * data.rz;

    const id = nextIdRef.current++;
    const layerObj: ToolLayer = {
  id,
  kind: 'shape-ellipse',
  visible: true,
  leafletGroup: group,

  summaryText: `面积: ${area.toFixed(2)}`,

  detailText: `面积(椭圆) = ${area.toFixed(2)}  [center(${fmtCoord(data.center)}), rx=${data.rx.toFixed(
    2
  )}, rz=${data.rz.toFixed(2)}, rot=${data.rotationDeg.toFixed(0)}°]`,

  data,
};


    setLayers(prev => {
      const next = [...prev, layerObj];
      syncRootByStateOrder(next);
      return next;
    });

    setSelectedLayerId(id);
  };

  // ---------- 创建：方形（由两点定义对角点） ----------
  const computeSquareVerticesFromDiagonal = (p1: WorldPoint, p2: WorldPoint) => {
    const cx = (p1.x + p2.x) / 2;
    const cz = (p1.z + p2.z) / 2;
    const vx = p1.x - cx;
    const vz = p1.z - cz;
    // 另外两个顶点：v 旋转 90°
    const wx = -vz;
    const wz = vx;

    const v1 = { x: cx + vx, z: cz + vz }; // p1
    const v3 = { x: cx - vx, z: cz - vz }; // p2
    const v2 = { x: cx + wx, z: cz + wz };
    const v4 = { x: cx - wx, z: cz - wz };
    return { center: { x: cx, z: cz }, vertices: [v1, v2, v3, v4] };
  };

  const applyRotationAround = (center: WorldPoint, pts: WorldPoint[], rotationDeg: number) => {
    const rad = degToRad(rotationDeg);
    return pts.map(p => {
      const dx = p.x - center.x;
      const dz = p.z - center.z;
      const rot = rotateXZ(dx, dz, rad);
      return { x: center.x + rot.x, z: center.z + rot.z };
    });
  };

  const buildSquareGroup = (data: ShapeSquareData) => {
    const proj = projectionRef.current;
    if (!proj) return null;

    const { center, vertices } = computeSquareVerticesFromDiagonal(data.p1, data.p2);
    const rotated = applyRotationAround(center, vertices, data.rotationDeg);

    const group = L.layerGroup();
    const latlngs = rotated.map(p => proj.locationToLatLng(p.x, Y_FOR_DISPLAY, p.z));
    L.polygon(latlngs, { color: '#ff9800' }).addTo(group);

    // 四个顶点显示坐标 label
    rotated.forEach(p => {
      const ll = proj.locationToLatLng(p.x, Y_FOR_DISPLAY, p.z);
      makeLabelMarker(ll, `(${fmtCoord(p)})`).addTo(group);
    });

    return group;
  };

  const addSquareLayer = (data: ShapeSquareData) => {
    const group = buildSquareGroup(data);
    if (!group) return;

    const d = computeDistance(data.p1, data.p2, 'euclidean');
    const area = (d * d) / 2; // 对角线为 d 的正方形：面积 = d^2 / 2

    const id = nextIdRef.current++;
    const layerObj: ToolLayer = {
  id,
  kind: 'shape-square',
  visible: true,
  leafletGroup: group,

  summaryText: `面积: ${area.toFixed(2)}`,

  detailText: `面积(方形) = ${area.toFixed(2)}  [p1(${fmtCoord(data.p1)}), p2(${fmtCoord(
    data.p2
  )}), rot=${data.rotationDeg.toFixed(0)}°]`,

  data,
};


    setLayers(prev => {
      const next = [...prev, layerObj];
      syncRootByStateOrder(next);
      return next;
    });

    setSelectedLayerId(id);
  };

  // ---------- 形状点击分派 ----------
  const handleShapeClick = (p: WorldPoint) => {
    if (shapeKind === 'circle') {
      pendingCircleCenterRef.current = p;
      setRxInput('10');
      setRzInput('10');
      setRadiusModalOpen(true);
      return;
    }

    if (shapeKind === 'square') {
      const start = pendingSquareStartRef.current;
      if (!start) {
        pendingSquareStartRef.current = p;
        return;
      }
      addSquareLayer({ p1: start, p2: p, rotationDeg: 0 });
      pendingSquareStartRef.current = null;
      return;
    }

    // 预留接口：未实装
    if (shapeKind === 'polygon') {
      // TODO: createPolygonShape(p)
      return;
    }
    if (shapeKind === 'curve') {
      // TODO: createCurveShape(p)
      return;
    }
  };

  // ---------- 图层操作：显隐 / 删除 / 上下移动 ----------
  const toggleVisible = (id: number) => {
    setLayers(prev => {
      const next = prev.map(l => (l.id === id ? { ...l, visible: !l.visible } : l));
      syncRootByStateOrder(next);
      return next;
    });
  };

  const deleteLayer = (id: number) => {
    setLayers(prev => {
      const target = prev.find(l => l.id === id);
      if (target) {
        // 避免 layer.remove() 在 LayerGroup 下残留：统一 removeLayer
        toolRootRef.current?.removeLayer(target.leafletGroup);
      }
      const next = prev.filter(l => l.id !== id);
      syncRootByStateOrder(next);
      return next;
    });

    setSelectedLayerId(prev => (prev === id ? null : prev));
  };

  const moveUp = (id: number) => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      syncRootByStateOrder(next);
      return next;
    });
  };

  const moveDown = (id: number) => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      syncRootByStateOrder(next);
      return next;
    });
  };

  // ---------- 旋转（只对 shape 层生效） ----------
  const updateRotation = (layerId: number, rotationDeg: number) => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === layerId);
      if (idx < 0) return prev;

      const old = prev[idx];
      if (old.kind !== 'shape-ellipse' && old.kind !== 'shape-square') return prev;

      // 先从 root 移除旧 group（避免残留）
      toolRootRef.current?.removeLayer(old.leafletGroup);

      let newGroup: L.LayerGroup | null = null;
      let newData: any = old.data;
      let newSummaryText = old.summaryText;
      let newDetailText = old.detailText;


      if (old.kind === 'shape-ellipse') {
  const d = old.data as ShapeEllipseData;
  newData = { ...d, rotationDeg };
  newGroup = buildEllipseGroup(newData);

  const area = Math.PI * newData.rx * newData.rz;
  newSummaryText = `面积: ${area.toFixed(2)}`;
  newDetailText = `面积(椭圆) = ${area.toFixed(2)}  [center(${fmtCoord(newData.center)}), rx=${newData.rx.toFixed(
    2
  )}, rz=${newData.rz.toFixed(2)}, rot=${newData.rotationDeg.toFixed(0)}°]`;
} else if (old.kind === 'shape-square') {
  const d = old.data as ShapeSquareData;
  newData = { ...d, rotationDeg };
  newGroup = buildSquareGroup(newData);

  const diag = computeDistance(newData.p1, newData.p2, 'euclidean');
  const area = (diag * diag) / 2;
  newSummaryText = `面积: ${area.toFixed(2)}`;
  newDetailText = `面积(方形) = ${area.toFixed(2)}  [p1(${fmtCoord(newData.p1)}), p2(${fmtCoord(
    newData.p2
  )}), rot=${newData.rotationDeg.toFixed(0)}°]`;
}


      if (!newGroup) return prev;

      const replaced: ToolLayer = {
        ...old,
        data: newData,
        leafletGroup: newGroup,
        summaryText: newSummaryText,
        detailText: newDetailText,
      };

      const next = [...prev];
      next[idx] = replaced;

      syncRootByStateOrder(next);
      return next;
    });
  };

  // ---------- UI：主按钮 ----------
  const handleMainToggle = () => {
    if (!active) {
      // 打开：要求同时关闭“开始测绘”（由 MapContainer 实现回调联动）
      onBecameActive?.();
      // 打开即清空，不提示
      clearAllLayers();
      setMainTab('measure');
      setActive(true);
      return;
    }

    // 关闭：同样清空
    hardResetAndClose();
  };

  // ---------- 弹窗确认：创建椭圆 ----------
  const confirmCreateEllipse = () => {
    const center = pendingCircleCenterRef.current;
    if (!center) {
      setRadiusModalOpen(false);
      return;
    }

    const rx = clampNumber(Number(rxInput), 0);
    const rz = clampNumber(Number(rzInput), 0);

    if (rx <= 0 || rz <= 0) {
      alert('半径必须为正数');
      return;
    }

    addEllipseLayer({
      center,
      rx,
      rz,
      rotationDeg: 0,
    });

    pendingCircleCenterRef.current = null;
    setRadiusModalOpen(false);
  };

  // ---------- 预留：分析接口（未实装） ----------
  const runSpatialRelationAnalysis = () => {
    // TODO: 空间关系分析实现入口
    alert('空间关系：未实装');
  };
  const runAttributeQuery = () => {
    // TODO: 属性查询实现入口
    alert('属性查询：未实装');
  };

  // ---------- 渲染 ----------
  const selectedLayer = selectedLayerId ? layers.find(l => l.id === selectedLayerId) : undefined;
  const selectedRotation =
    selectedLayer && (selectedLayer.kind === 'shape-ellipse' || selectedLayer.kind === 'shape-square')
      ? (selectedLayer.data as any)?.rotationDeg ?? 0
      : 0;

  const launcher = (
    <ToolIconButton
      label="测量工具"
      icon={<Ruler className="w-5 h-5" />}
      active={active}
      tone="blue"
      onClick={handleMainToggle}
    />
  );
  const launcherNode = launcherSlot ? (
    launcherSlot(launcher)
  ) : (
    <div className="hidden sm:block absolute bottom-8 right-2 sm:top-4 sm:bottom-auto sm:right-[260px] z-[1001]">
      {launcher}
    </div>
  );

  return (
    <>
      {/* 启动按钮：默认悬浮右上角，也可通过 launcherSlot 收纳到工具栏 */}
      {launcherNode}

      {/* =========================
          主操作面板：桌面端（可拖拽）
         ========================= */}
      {active && (
        <DraggablePanel id="mtools-main" defaultPosition={{ x: 16, y: 180 }} zIndex={2200}>
          <AppCard className="w-[520px] max-h-[70vh] overflow-hidden">
            {/* 标题栏（用于拖拽区域，右侧留出关闭按钮） */}
            <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
              <h3 className="font-bold text-gray-800">测量工具</h3>
              <AppButton onClick={handleClosePanels} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded" title="关闭">
                <X className="w-4 h-4" />
              </AppButton>
            </div>

            {/* 内容区 */}
            <div className="p-4 space-y-4">
              {/* tabs + 清空 */}
              <div className="flex items-center gap-2">
                <div className="flex border rounded-lg overflow-hidden">
                  <AppButton
                    className={`px-4 py-2 text-sm transition-colors ${
                      mainTab === 'measure' ? 'bg-blue-50 text-blue-600' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                    onClick={() => setMainTab('measure')}
                  >
                    测量
                  </AppButton>
                  <AppButton
                    className={`px-4 py-2 text-sm transition-colors ${
                      mainTab === 'shape' ? 'bg-blue-50 text-blue-600' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                    onClick={() => setMainTab('shape')}
                  >
                    形状
                  </AppButton>
                  <AppButton
                    className={`px-4 py-2 text-sm transition-colors ${
                      mainTab === 'analysis' ? 'bg-blue-50 text-blue-600' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                    onClick={() => setMainTab('analysis')}
                  >
                    分析
                  </AppButton>
                </div>

                <div className="ml-auto">
                  <AppButton
                    className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors text-sm"
                    onClick={clearAllLayers}
                  >
                    清空本工具图层
                  </AppButton>
                </div>
              </div>

              {/* 1) 测量 */}
              {mainTab === 'measure' && (
                <div className="space-y-3">
                  <div className="text-sm text-gray-700">
                    使用方法：在地图上依次点击两点，自动生成连线，并在中点显示距离标签。
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-700 w-12">模式</span>
                    <select
                      className="border rounded-lg px-3 py-2 text-sm flex-1"
                      value={measureMetric}
                      onChange={e => {
                        const v = e.target.value;
                        if (v === 'clear') {
                          clearAllLayers();
                          pendingMeasureStartRef.current = null;
                          setMeasureMetric('euclidean');
                          return;
                        }
                        setMeasureMetric(v as MeasureMetric);
                      }}
                    >
                      <option value="euclidean">直线距离（默认）</option>
                      <option value="manhattan">曼哈顿距离</option>
                      <option value="clear">清除</option>
                    </select>
                  </div>
                </div>
              )}

              {/* 2) 形状 */}
              {mainTab === 'shape' && (
                <div className="space-y-3">
                  <div className="text-sm text-gray-700">
                    圆/方形创建后，可在右侧图层列表选中该层，通过“旋转”滑条调整角度。
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <AppButton
                      className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                        shapeKind === 'circle' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                      onClick={() => setShapeKind('circle')}
                    >
                      圆
                    </AppButton>
                    <AppButton
                      className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                        shapeKind === 'square' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                      onClick={() => setShapeKind('square')}
                    >
                      方形
                    </AppButton>
                    <AppButton className="px-3 py-2 rounded-lg bg-gray-100 text-gray-400 cursor-not-allowed text-sm" disabled>
                      多边形:未实装
                    </AppButton>
                    <AppButton className="px-3 py-2 rounded-lg bg-gray-100 text-gray-400 cursor-not-allowed text-sm" disabled>
                      曲线(未实装)
                    </AppButton>
                  </div>
                </div>
              )}

              {/* 3) 分析 */}
              {mainTab === 'analysis' && (
                <div className="space-y-3">
                  <div className="text-sm text-gray-700">分析模块预留接口（当前未实装）。</div>
                  <div className="flex items-center gap-2">
                    <AppButton
                      className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors text-sm"
                      onClick={runSpatialRelationAnalysis}
                    >
                      空间关系
                    </AppButton>
                    <AppButton
                      className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors text-sm"
                      onClick={runAttributeQuery}
                    >
                      属性查询
                    </AppButton>
                  </div>
                </div>
              )}
            </div>
          </AppCard>
        </DraggablePanel>
      )}

      {/* =========================
          结果输出面板：桌面端（可拖拽，与你要求“分离窗口”一致）
          仅输出：Layer n + 面积/距离（summaryText）
         ========================= */}
      {active && (
        <DraggablePanel id="mtools-results" defaultPosition={{ x: 16, y: 520 }} zIndex={2200}>
          <AppCard className="w-[520px] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-bold text-gray-800">测量结果</h3>
              <AppButton onClick={handleClosePanels} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded" title="关闭">
                <X className="w-4 h-4" />
              </AppButton>
            </div>
            <div className="p-3">
              <textarea
                className="w-full border rounded-lg p-2 h-28 text-xs"
                readOnly
                value={resultsText}
                placeholder="这里仅显示：Layer n + 面积/距离"
              />
            </div>
          </AppCard>
        </DraggablePanel>
      )}

      {/* =========================
          手机端：DraggablePanel 不渲染，所以这里提供固定布局版本（保持同样风格）
         ========================= */}
      {active && (
        <>
          <div className="hidden fixed left-2 right-2 bottom-40 z-[2200]">
            <AppCard className="overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <h3 className="font-bold text-gray-800">测量工具</h3>
                <AppButton onClick={handleClosePanels} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </AppButton>
              </div>

              <div className="p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <div className="flex border rounded-lg overflow-hidden flex-1">
                    <AppButton
                      className={`flex-1 px-4 py-2 text-sm transition-colors ${
                        mainTab === 'measure' ? 'bg-blue-50 text-blue-600' : 'bg-white text-gray-600'
                      }`}
                      onClick={() => setMainTab('measure')}
                    >
                      测量
                    </AppButton>
                    <AppButton
                      className={`flex-1 px-4 py-2 text-sm transition-colors ${
                        mainTab === 'shape' ? 'bg-blue-50 text-blue-600' : 'bg-white text-gray-600'
                      }`}
                      onClick={() => setMainTab('shape')}
                    >
                      形状
                    </AppButton>
                    <AppButton
                      className={`flex-1 px-4 py-2 text-sm transition-colors ${
                        mainTab === 'analysis' ? 'bg-blue-50 text-blue-600' : 'bg-white text-gray-600'
                      }`}
                      onClick={() => setMainTab('analysis')}
                    >
                      分析
                    </AppButton>
                  </div>

                  <AppButton
                    className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors text-sm"
                    onClick={clearAllLayers}
                  >
                    清空
                  </AppButton>
                </div>

                {mainTab === 'measure' && (
                  <div className="space-y-3">
                    <div className="text-sm text-gray-700">
                      在地图上依次点击两点，自动生成连线，并在中点显示距离标签。
                    </div>
                    <select
                      className="border rounded-lg px-3 py-2 text-sm w-full"
                      value={measureMetric}
                      onChange={e => {
                        const v = e.target.value;
                        if (v === 'clear') {
                          clearAllLayers();
                          pendingMeasureStartRef.current = null;
                          setMeasureMetric('euclidean');
                          return;
                        }
                        setMeasureMetric(v as MeasureMetric);
                      }}
                    >
                      <option value="euclidean">直线距离（默认）</option>
                      <option value="manhattan">曼哈顿距离</option>
                      <option value="clear">清除</option>
                    </select>
                  </div>
                )}

                {mainTab === 'shape' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <AppButton
                        className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                          shapeKind === 'circle' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-700'
                        }`}
                        onClick={() => setShapeKind('circle')}
                      >
                        圆
                      </AppButton>
                      <AppButton
                        className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                          shapeKind === 'square' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-700'
                        }`}
                        onClick={() => setShapeKind('square')}
                      >
                        方形
                      </AppButton>
                      <AppButton className="px-3 py-2 rounded-lg bg-gray-100 text-gray-400 text-sm" disabled>
                        多边形:未实装
                      </AppButton>
                      <AppButton className="px-3 py-2 rounded-lg bg-gray-100 text-gray-400 text-sm" disabled>
                        曲线(未实装)
                      </AppButton>
                    </div>
                  </div>
                )}

                {mainTab === 'analysis' && (
                  <div className="flex items-center gap-2">
                    <AppButton
                      className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm"
                      onClick={runSpatialRelationAnalysis}
                    >
                      空间关系
                    </AppButton>
                    <AppButton className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm" onClick={runAttributeQuery}>
                      属性查询
                    </AppButton>
                  </div>
                )}
              </div>
            </AppCard>
          </div>

          <div className="hidden fixed left-2 right-2 bottom-8 z-[2200]">
            <AppCard className="overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <h3 className="font-bold text-gray-800">测量结果</h3>
                <AppButton onClick={handleClosePanels} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </AppButton>
              </div>
              <div className="p-3">
                <textarea className="w-full border rounded-lg p-2 h-24 text-xs" readOnly value={resultsText} />
              </div>
            </AppCard>
          </div>
        </>
      )}

      {/* 图层管理 */}
      {active && (
        <DraggablePanel
          id="measurement-layer-manager"
          defaultPosition={{ x: window.innerWidth - 380, y: 80 }}
          zIndex={2100}
        >
          <AppCard className="w-[360px] max-h-[calc(75vh)] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
              <h3 className="font-bold text-gray-800">测量图层管理</h3>
            </div>
            <div className="p-3 overflow-auto">
              {layers.length === 0 && <div className="text-xs text-gray-500">暂无图层</div>}

              <div className="space-y-2">
                {layers.map((l, idx) => {
                  const isSelected = selectedLayerId === l.id;
                  return (
                    <div
                      key={l.id}
                      className={`border rounded p-2 ${isSelected ? 'border-blue-500' : 'border-gray-200'}`}
                      onClick={() => setSelectedLayerId(l.id)}
                      role="button"
                    >
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium">Layer {idx + 1}</div>

                        <div className="ml-auto flex items-center gap-1">
                          <AppButton className="px-2 py-1 rounded bg-gray-200" onClick={e => (e.stopPropagation(), moveUp(l.id))}>
                            ↑
                          </AppButton>
                          <AppButton className="px-2 py-1 rounded bg-gray-200" onClick={e => (e.stopPropagation(), moveDown(l.id))}>
                            ↓
                          </AppButton>
                          <AppButton
                            className="px-2 py-1 rounded bg-gray-200"
                            onClick={e => (e.stopPropagation(), toggleVisible(l.id))}
                          >
                            {l.visible ? '隐藏' : '显示'}
                          </AppButton>
                          <AppButton
                            className="px-2 py-1 rounded bg-red-600 text-white"
                            onClick={e => (e.stopPropagation(), deleteLayer(l.id))}
                          >
                            删除
                          </AppButton>
                        </div>
                      </div>

                      <div className="text-xs text-gray-600 mt-1 break-words">
                        {(l as any).detailText ?? (l as any).summaryText ?? ''}
                      </div>

                      {isSelected && (l.kind === 'shape-ellipse' || l.kind === 'shape-square') && (
                        <div className="mt-2">
                          <div className="text-xs text-gray-600 mb-1">旋转（度）</div>
                          <input
                            type="range"
                            min={0}
                            max={360}
                            step={1}
                            value={selectedRotation}
                            onChange={e => updateRotation(l.id, Number(e.target.value))}
                            className="w-full"
                          />
                          <div className="text-xs text-gray-600 mt-1">{selectedRotation.toFixed(0)}°</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </AppCard>
        </DraggablePanel>
      )}

      {/* 半径输入弹窗（圆/椭圆）—— 增加标题栏与关闭按钮 */}
      {active && radiusModalOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40">
          <AppCard className="w-[420px] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-bold text-gray-800">输入圆半径</h3>
              <AppButton
                onClick={() => {
                  pendingCircleCenterRef.current = null;
                  setRadiusModalOpen(false);
                }}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                title="关闭"
              >
                <X className="w-4 h-4" />
              </AppButton>
            </div>

            <div className="p-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-20 text-sm">x 半径</div>
                  <input
                    className="border rounded-lg px-2 py-2 flex-1"
                    value={rxInput}
                    onChange={e => setRxInput(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-20 text-sm">z 半径</div>
                  <input
                    className="border rounded-lg px-2 py-2 flex-1"
                    value={rzInput}
                    onChange={e => setRzInput(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 mt-4">
                <AppButton
                  className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors text-sm"
                  onClick={() => {
                    pendingCircleCenterRef.current = null;
                    setRadiusModalOpen(false);
                  }}
                >
                  取消
                </AppButton>
                <AppButton
                  className="px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors text-sm"
                  onClick={confirmCreateEllipse}
                >
                  确认生成
                </AppButton>
              </div>
            </div>
          </AppCard>
        </div>
      )}
    </>
  );
}
