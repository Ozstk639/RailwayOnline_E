import { useEffect, useRef, useState, useCallback } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createDynmapCRS, ZTH_FLAT_CONFIG, DynmapProjection } from '@/lib/DynmapProjection';
import { DynmapTileLayer, createDynmapTileLayer } from '@/lib/DynmapTileLayer';
import { RailwayLayer } from './RailwayLayer';
import { LandmarkLayer } from './LandmarkLayer';
import { PlayerLayer } from './PlayerLayer';
import { RouteHighlightLayer } from './RouteHighlightLayer';
import { LineHighlightLayer } from './LineHighlightLayer';
import { WorldSwitcher } from './WorldSwitcher';
import { SearchBar } from '../Search/SearchBar';
import { NavigationPanel } from '../Navigation/NavigationPanel';
import { LineDetailCard } from '../LineDetail/LineDetailCard';
import { PointDetailCard } from '../PointDetail/PointDetailCard';
import { PlayerDetailCard } from '../PlayerDetail/PlayerDetailCard';
import { Toolbar, LayerControl, AboutCard } from '../Toolbar/Toolbar';
import { LinesPage } from '../Lines/LinesPage';
import { PlayersList } from '../Players/PlayersList';
import { LoadingOverlay } from '../Loading/LoadingOverlay';
import { useLoadingStore } from '@/store/loadingStore';
import { fetchRailwayData, parseRailwayData, getAllStations } from '@/lib/railwayParser';
import { fetchRMPData, parseRMPData } from '@/lib/rmpParser';
import { fetchLandmarkData, parseLandmarkData } from '@/lib/landmarkParser';
import { fetchPlayers } from '@/lib/playerApi';
import { loadMapSettings, saveMapSettings } from '@/lib/cookies';
import type { ParsedStation, ParsedLine, Coordinate, Player } from '@/types';
import type { ParsedLandmark } from '@/lib/landmarkParser';


// 世界配置
const WORLDS = [
  { id: 'zth', name: '零洲', center: { x: -643, y: 35, z: -1562 } },
  { id: 'eden', name: '伊甸', center: { x: 0, y: 64, z: 0 } },
  { id: 'naraku', name: '奈落洲', center: { x: 0, y: 64, z: 0 } },
  { id: 'houtu', name: '后土洲', center: { x: 0, y: 64, z: 0 } }
];

// RMP 数据文件映射
const RMP_DATA_FILES: Record<string, string> = {
  zth: '/data/rmp_zth.json',
  houtu: '/data/rmp_houtu.json',
};

function MapContainer() {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const projectionRef = useRef<DynmapProjection | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // 从 cookie 读取初始设置
  const savedSettings = loadMapSettings();
  const [currentWorld, setCurrentWorld] = useState(savedSettings?.currentWorld ?? 'zth');
  const [showRailway, setShowRailway] = useState(savedSettings?.showRailway ?? true);
  const [showLandmark, setShowLandmark] = useState(savedSettings?.showLandmark ?? true);
  const [showPlayers, setShowPlayers] = useState(savedSettings?.showPlayers ?? true);
  const [dimBackground, setDimBackground] = useState(savedSettings?.dimBackground ?? false);
  const [showNavigation, setShowNavigation] = useState(false);
  const [showLinesPage, setShowLinesPage] = useState(false);
  const [showPlayersPage, setShowPlayersPage] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [stations, setStations] = useState<ParsedStation[]>([]);
  const [lines, setLines] = useState<ParsedLine[]>([]);
  const [landmarks, setLandmarks] = useState<ParsedLandmark[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [routePath, setRoutePath] = useState<Array<{ coord: Coordinate }> | null>(null);
  const [highlightedLine, setHighlightedLine] = useState<ParsedLine | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<{
    type: 'station' | 'landmark';
    name: string;
    coord: Coordinate;
    station?: ParsedStation;
    landmark?: ParsedLandmark;
  } | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);



// ---------- 测绘 & 图层管理状态 ------------
const [measuringActive, setMeasuringActive] = useState(false); // 是否开启测绘控制UI
const [drawMode, setDrawMode] = useState<'none'|'point'|'polyline'|'polygon'>('none');
const [drawColor, setDrawColor] = useState('#ff0000');         // 当前颜色
const [drawing, setDrawing] = useState(false);                  // 是否正在绘制中

// 当前临时点集合（临时绘制的坐标）
const [tempPoints, setTempPoints] = useState<Array<{x:number;z:number}>>([]);

// 临时图层
const tempLayerGroupRef = useRef<L.LayerGroup|null>(null);

// 扩展 LayerType 定义（包含 jsonInfo）
type LayerType = {
  id: number;
  mode: 'point' | 'polyline' | 'polygon';
  color: string;
  coords: { x: number; z: number }[];
  visible: boolean;
  leafletGroup: L.LayerGroup;
  jsonInfo?: {
    subType: string;
    featureInfo: any;
    platformLines?: any[];
    stationPlatforms?: any[];
    linePoints?: [number, number, number][];
  };
};

// 所有固定图层
const [layers, setLayers] = useState<LayerType[]>([]);
const nextLayerId = useRef(1);

// 编辑模式下被编辑的图层ID
const [editingLayerId, setEditingLayerId] = useState<number|null>(null);

// 子类型选择
const [subType, setSubType] = useState<string>('默认');

// 撤销/重做栈
const [redoStack, setRedoStack] = useState<Array<{ x: number; z: number }>>([]);

// 当前 JSON 特征信息
const [featureInfo, setFeatureInfo] = useState<any>({});

// JSON Array 动态字段数据
// 站台 lines 数组
const [platformLines, setPlatformLines] = useState<any[]>([]);
// 车站 platforms
const [stationPlatforms, setStationPlatforms] = useState<any[]>([]);
// 铁路控制点
const [linePoints, setLinePoints] = useState<Array<[number, number, number]>>([]);

// ---- 导入矢量数据相关状态 ----
const [importPanelOpen, setImportPanelOpen] = useState(false);

const [importFormat, setImportFormat] = useState<'点'|'线'|'面'|'车站'|'铁路'|'站台'>('点');
const [importText, setImportText] = useState('');

const randomColor = () => {
  const r = Math.floor(Math.random()*255);
  const g = Math.floor(Math.random()*255);
  const b = Math.floor(Math.random()*255);
  return `rgb(${r},${g},${b})`;
};





  // 关闭"铁路图层"时，同时隐藏线路高亮与详情卡片，避免看起来"图层控制不生效"
  useEffect(() => {
    if (!showRailway) {
      setHighlightedLine(null);
    }
  }, [showRailway]);

  // 控制背景淡化
  useEffect(() => {
    const tilePane = document.querySelector('.leaflet-tile-pane');
    if (tilePane) {
      if (dimBackground) {
        tilePane.classList.add('dimmed');
      } else {
        tilePane.classList.remove('dimmed');
      }
    }
  }, [dimBackground]);

  // 保存地图设置到 cookie
  useEffect(() => {
    saveMapSettings({
      currentWorld,
      showRailway,
      showLandmark,
      showPlayers,
      dimBackground,
    });
  }, [currentWorld, showRailway, showLandmark, showPlayers, dimBackground]);

  // 加载状态管理
  const { startLoading, updateStage, finishLoading, initialized } = useLoadingStore();

  // 加载搜索数据
  useEffect(() => {
    async function loadSearchData() {
      // 首次加载时显示进度
      const isFirstLoad = !initialized;
      if (isFirstLoad) {
        startLoading([
          { name: 'railway', label: '铁路数据' },
          { name: 'rmp', label: 'RMP 线路数据' },
          { name: 'landmark', label: '地标数据' },
        ]);
      }

      // 加载 RIA_Data 站点数据
      if (isFirstLoad) updateStage('railway', 'loading');
      const railwayData = await fetchRailwayData(currentWorld);
      const { lines: riaLines } = parseRailwayData(railwayData);
      if (isFirstLoad) updateStage('railway', 'success');

      // 加载 RMP 数据（如果有）
      let rmpLines: ParsedLine[] = [];
      let rmpStations: ParsedStation[] = [];
      const rmpFile = RMP_DATA_FILES[currentWorld];
      if (rmpFile) {
        if (isFirstLoad) updateStage('rmp', 'loading');
        try {
          const rmpData = await fetchRMPData(rmpFile);
          const parsed = parseRMPData(rmpData, currentWorld);
          rmpLines = parsed.lines;
          rmpStations = parsed.stations;
          if (isFirstLoad) updateStage('rmp', 'success');
        } catch (e) {
          console.warn(`Failed to load RMP data for ${currentWorld}:`, e);
          if (isFirstLoad) updateStage('rmp', 'error', '加载失败');
        }
      } else {
        if (isFirstLoad) updateStage('rmp', 'success');
      }

      // 合并线路和站点
      const allLines = [...riaLines, ...rmpLines];
      const riaStations = getAllStations(riaLines);

      // 合并站点：RIA站点优先，RMP站点只添加不重复的
      const riaStationNames = new Set(riaStations.map(s => s.name));
      const uniqueRmpStations = rmpStations.filter(s => !riaStationNames.has(s.name));
      const allStations = [...riaStations, ...uniqueRmpStations];

      setLines(allLines);
      setStations(allStations);

      // 加载地标数据
      if (isFirstLoad) updateStage('landmark', 'loading');
      const landmarkData = await fetchLandmarkData(currentWorld);
      setLandmarks(parseLandmarkData(landmarkData));
      if (isFirstLoad) updateStage('landmark', 'success');

      // 加载玩家数据
      const playersData = await fetchPlayers(currentWorld);
      setPlayers(playersData);

      // 清除之前的路径
      setRoutePath(null);
      setHighlightedLine(null);

      // 完成加载
      if (isFirstLoad) {
        // 延迟一点关闭，让用户看到完成状态
        setTimeout(() => {
          finishLoading();
        }, 500);
      }
    }
    loadSearchData();
  }, [currentWorld, initialized, startLoading, updateStage, finishLoading]);



// ========= 地图点击监听（绘制模式） =========
useEffect(() => {
  const map = leafletMapRef.current;
  if (!map) {
    // 不要写 return undefined
    return;
  }

  const handleClick = (e: L.LeafletMouseEvent) => {
    if (!drawing || drawMode === 'none') return;
    onMapDrawClick(e);
  };

  map.on('click', handleClick);

  return () => {
    map.off('click', handleClick);
  };
}, [drawing, drawMode]);


// ========= 点击地图事件处理 =========
const onMapDrawClick = (e: L.LeafletMouseEvent) => {
  if (!projectionRef.current) return;
  const loc = projectionRef.current.latLngToLocation(e.latlng, 64);
  const newPoint = { x: loc.x, z: loc.z };

  setTempPoints(prev => {
    const updated = [...prev, newPoint];
    drawTemporary(updated);
    return updated;
  });
};

// ========= 临时图形绘制 =========
const drawTemporary = (pts: {x:number;z:number}[]) => {
  if (!leafletMapRef.current || !projectionRef.current) return;

  if (!tempLayerGroupRef.current) {
    tempLayerGroupRef.current = L.layerGroup().addTo(leafletMapRef.current);
  }
  const group = tempLayerGroupRef.current;
  group.clearLayers();

  const latlngs = pts.map(p =>
    projectionRef.current!.locationToLatLng(p.x, 64, p.z)
  );

  if (drawMode === 'point') {
    latlngs.forEach(ll => {
      L.circleMarker(ll, {
        color: drawColor,
        fillColor: drawColor,
        radius: 6
      }).addTo(group);
    });
  } else if (drawMode === 'polyline') {
    L.polyline(latlngs, { color: drawColor }).addTo(group);
  } else if (drawMode === 'polygon') {
    if (latlngs.length > 2) L.polygon(latlngs, { color: drawColor }).addTo(group);
    else L.polyline(latlngs, { color: drawColor }).addTo(group);
  }
};

const injectJSONCoordinateForFeature = () => {
  if (!featureInfo) return;

  if (subType === '站台' && tempPoints.length >= 1) {
    featureInfo.coordinate = { x: tempPoints[0].x, z: tempPoints[0].z };
  }
  if (subType === '车站' && tempPoints.length >= 1) {
    featureInfo.coordinate = { x: tempPoints[0].x, z: tempPoints[0].z };
  }
  if (subType === '铁路' && tempPoints.length > 0) {
    featureInfo.PLpoints = tempPoints.map(p => [p.x, -63, p.z]);
  }
};




// ========= 完成当前图层（带日志调试） =========
const finishLayer = () => {
  console.log('--- finishLayer start ---');
  console.log('drawMode:', drawMode);
  console.log('tempPoints:', tempPoints);
  console.log('editingLayerId:', editingLayerId);
  console.log('layers before:', layers.map(l => ({ id: l.id, coords: l.coords })));

  if (!leafletMapRef.current) {
    console.warn('finishLayer: leafletMapRef.current is null');
    return;
  }

  if (drawMode === 'none') {
    console.warn('finishLayer: drawMode is none');
    return;
  }

  if (editingLayerId === null && tempPoints.length === 0) {
    console.warn('finishLayer: new layer and no tempPoints -> abort');
    return;
  }

  let finalCoords: { x: number; z: number }[] = [];

  if (editingLayerId !== null) {
    const old = layers.find(l => l.id === editingLayerId);
    console.log('old layer found for editing:', old);
    finalCoords = tempPoints.length > 0 ? [...tempPoints] : (old?.coords ?? []);
  } else {
    finalCoords = [...tempPoints];
  }
  console.log('finalCoords used:', finalCoords);

  injectJSONForFeature();
  console.log('featureInfo after inject:', featureInfo);

  const newLayerId = editingLayerId ?? nextLayerId.current++;

  const latlngs = finalCoords.map(p => {
    const ll = projectionRef.current!.locationToLatLng(p.x, p.z ?? 64, p.z);
    console.log(`coord -> latlng: (${p.x},${p.z}) =>`, ll);
    return ll;
  });

  const newGroup = L.layerGroup();

  if (latlngs.length > 0) {
    if (drawMode === 'point') {
      latlngs.forEach(ll => {
        L.circleMarker(ll, { color: drawColor, fillColor: drawColor, radius: 6 }).addTo(newGroup);
      });
    } else if (drawMode === 'polyline') {
      L.polyline(latlngs, { color: drawColor }).addTo(newGroup);
    } else if (drawMode === 'polygon') {
      L.polygon(latlngs, { color: drawColor }).addTo(newGroup);
    }
  } else {
    console.warn('No latlngs to draw for newGroup');
  }

  const layerObj: LayerType = {
    id: newLayerId,
    mode: drawMode,
    color: drawColor,
    coords: finalCoords,
    visible: true,
    leafletGroup: newGroup,
    jsonInfo: {
      subType,
      featureInfo,
      platformLines: subType === '站台' ? platformLines : undefined,
      stationPlatforms: subType === '车站' ? stationPlatforms : undefined,
      linePoints: subType === '铁路' ? linePoints : undefined,
    },
  };

  console.log('constructed layerObj:', layerObj);

  // ——— 1) Update React state ———
  setLayers(prev => {
  if (editingLayerId !== null) {
    return prev.map(l => {
      if (l.id === editingLayerId) {
        // 移除旧 layer 的 leafletGroup
        l.leafletGroup.remove();
        return layerObj;
      }
      return l;
    });
  }
  return [...prev, layerObj];
});

  // ——— 2) Immediately add to map ———
  console.log('newGroup layers count before addTo:', newGroup.getLayers().length);
  console.log('about to add newGroup to map for layerId:', layerObj.id);
  newGroup.addTo(leafletMapRef.current!);
  console.log('newGroup added to map');

  // ——— 3) Cleanup temporary drawing ———
  console.log('clearing tempLayerGroup and tempPoints');
  tempLayerGroupRef.current?.clearLayers();
  setTempPoints([]);

  // ——— 4) Reset drawing/editing status ———
  setEditingLayerId(null);
  setDrawing(false);
  setDrawMode('none');

  setSubType('默认');
  setFeatureInfo({});
  setPlatformLines([]);
  setStationPlatforms([]);
  setLinePoints([]);

  console.log('finishLayer end, triggering refreshAllFixedLayers');

  setTimeout(() => {
    console.log('calling refreshAllFixedLayers');
    refreshAllFixedLayers();
    console.log('refreshAllFixedLayers done');
  }, 0);
};







const getLayerJSONOutput = (layer: LayerType) => {
  if (!layer.jsonInfo) return '';

  const { subType, featureInfo } = layer.jsonInfo;

  // Return pretty JSON for that subtype
  return JSON.stringify([featureInfo], null, 2);
};

const refreshAllFixedLayers = () => {
  const map = leafletMapRef.current;
  if (!map) return;

  layers.forEach(l => l.leafletGroup.remove());
  layers.forEach(l => {
    if (l.visible) l.leafletGroup.addTo(map);
  });
};

const handleUndo = () => {
  if (!tempPoints.length) return;
  const last = tempPoints[tempPoints.length - 1];
  setRedoStack(prev => [...prev, last]);
  const updated = tempPoints.slice(0, tempPoints.length - 1);
  setTempPoints(updated);
  drawTemporary(updated); // 重新绘制
};

const handleRedo = () => {
  if (!redoStack.length) return;
  const redoPoint = redoStack[redoStack.length - 1];
  setRedoStack(prev => prev.slice(0, prev.length - 1));
  const updated = [...tempPoints, redoPoint];
  setTempPoints(updated);
  drawTemporary(updated); // 重新绘制
};

const injectJSONForFeature = () => {
  if (!featureInfo) return;

  // 坐标
  if ((subType === '车站' || subType === '站台') && tempPoints.length >= 1) {
    featureInfo.coordinate = { x: tempPoints[0].x, z: tempPoints[0].z };
  }
  if (subType === '铁路' && tempPoints.length > 0) {
    const pts = tempPoints.map(p => [p.x, -63, p.z] as [number, number, number]);
    setLinePoints(pts);
    featureInfo.PLpoints = pts;
  }

  // 站台 lines
  if (subType === '站台') {
    featureInfo.lines = platformLines;
  }

  // 车站 platforms
  if (subType === '车站') {
    featureInfo.platforms = stationPlatforms;
  }
};


// ========= 清除所有图层 =========
const clearAllLayers = () => {
  layers.forEach(l => l.leafletGroup.clearLayers());
  setLayers([]);
  nextLayerId.current = 1;
  setTempPoints([]);
  tempLayerGroupRef.current?.clearLayers();
  setDrawing(false);
  setDrawMode('none');
  setEditingLayerId(null);
};

// ========= 图层显示/隐藏 =========
const toggleLayerVisible = (id:number) => {
  setLayers(prev => prev.map(l => {
    if (l.id === id) {
      if (l.visible) l.leafletGroup.remove();
      else l.leafletGroup.addTo(leafletMapRef.current!);
      return {...l, visible: !l.visible};
    }
    return l;
  }));
};

// --------- 图层顺序上移 ---------
const moveLayerUp = (id: number) => {
  setLayers(prev => {
    const idx = prev.findIndex(l => l.id === id);
    if (idx <= 0) return prev;

    const arr = [...prev];
    const temp = arr[idx - 1];
    arr[idx - 1] = arr[idx];
    arr[idx] = temp;

    // 通过重新添加控制图层显示顺序
    if (leafletMapRef.current) {
      arr.forEach(layer => {
        layer.leafletGroup.remove();
      });
      arr.forEach(layer => {
        if (layer.visible) layer.leafletGroup.addTo(leafletMapRef.current!);
      });
    }
    return arr;
  });
};

// --------- 图层顺序下移 ---------
const moveLayerDown = (id: number) => {
  setLayers(prev => {
    const idx = prev.findIndex(l => l.id === id);
    if (idx === -1 || idx === prev.length - 1) return prev;

    const arr = [...prev];
    const temp = arr[idx + 1];
    arr[idx + 1] = arr[idx];
    arr[idx] = temp;

    if (leafletMapRef.current) {
      arr.forEach(layer => {
        layer.leafletGroup.remove();
      });
      arr.forEach(layer => {
        if (layer.visible) layer.leafletGroup.addTo(leafletMapRef.current!);
      });
    }
    return arr;
  });
};

// --------- 当前临时输出文本 ---------
const currentTempOutput = () => {
  if (tempPoints.length === 0 || drawMode === 'none') return '';
  const pts = tempPoints.map(p => `${p.x.toFixed(1)},${p.z.toFixed(1)}`);
  if (drawMode === 'point') return `<point:${pts.join(';')}>`;
  if (drawMode === 'polyline') return `<polyline:${pts.join(';')}>`;
  return `<polygon:${pts.join(';')}>`;
};

// --------- 全部固定图层输出 ---------
const allLayersOutput = () => {
  return layers
    .map(l =>
      `layer${l.id}: <${l.mode}:${l.coords
        .map(p => `${p.x.toFixed(1)},${p.z.toFixed(1)}`)
        .join(';')}>`
    )
    .join('\n');
};


// ========= 编辑图层 =========
const editLayer = (id: number) => {
  const layer = layers.find(l => l.id === id);
  if (!layer) return;

  // restore jsonInfo & subtype
  if (layer.jsonInfo) {
    setSubType(layer.jsonInfo.subType);
    setFeatureInfo(layer.jsonInfo.featureInfo ?? {});
    setPlatformLines(layer.jsonInfo.platformLines ?? []);
    setStationPlatforms(layer.jsonInfo.stationPlatforms ?? []);
    setLinePoints(layer.jsonInfo.linePoints ?? []);
  } else {
    setSubType('默认');
    setFeatureInfo({});
    setPlatformLines([]);
    setStationPlatforms([]);
    setLinePoints([]);
  }

  // restore coords (so tempPoints is prefilled)
  tempLayerGroupRef.current?.clearLayers();
  setTempPoints(layer.coords);
  drawTemporary(layer.coords);

  setEditingLayerId(id);
  setDrawing(true);
  setDrawMode(layer.mode);
};





// ========= 删除图层 =========
const deleteLayer = (id:number) => {
  // 1) 先从 map 上移除 leafletGroup
  const layerToRemove = layers.find(l => l.id === id);
  if (layerToRemove) {
    layerToRemove.leafletGroup.remove();
  }

  // 2) 再从 React state 里删除图层对象
  setLayers(prev => prev.filter(l => l.id !== id));

  // 3) 如果你有刷新层顺序的逻辑，再调用它
  setTimeout(() => {
    refreshAllFixedLayers();
  }, 0);
};


const handleImport = () => {
  const text = importText.trim();
  if (!text) return;

  const color = randomColor();
  // 点/线/面 解析
  if (importFormat === '点' || importFormat === '线' || importFormat === '面') {
    // 分隔成坐标对
    const coords = text
      .split(';')
      .map(pair => pair.trim())
      .filter(Boolean)
      .map(pair => {
        const [xStr,zStr] = pair.split(',').map(s => s.trim());
        return { x: parseFloat(xStr), z: parseFloat(zStr) };
      });

    if (!coords.length) return;

    // 生成 Leaflet 图形
    const group = L.layerGroup();
    const latlngs = coords.map(p => projectionRef.current!.locationToLatLng(p.x, 64, p.z));

    if (importFormat === '点') {
      latlngs.forEach(ll => {
        L.circleMarker(ll, { color, fillColor: color, radius: 6 }).addTo(group);
      });
    } else if (importFormat === '线') {
      L.polyline(latlngs, { color }).addTo(group);
    } else if (importFormat === '面') {
      L.polygon(latlngs, { color }).addTo(group);
    }

    const id = nextLayerId.current++;
    const newLayer: LayerType = {
      id,
      mode: importFormat === '点' ? 'point' : importFormat === '线' ? 'polyline' : 'polygon',
      color,
      coords,
      visible: true,
      leafletGroup: group,
      jsonInfo: undefined // 无 jsonInfo
    };
    setLayers(prev => [...prev, newLayer]);
    setTimeout(refreshAllFixedLayers, 0);

    setImportText('');
    setImportPanelOpen(false);
    return;
  }

  // JSON 类型
  try {
    const parsed = JSON.parse(text);

    if (!Array.isArray(parsed)) {
      alert('JSON 必须是数组');
      return;
    }

    parsed.forEach((item: any) => {
      let coords: {x:number;z:number}[] = [];
      let mode: 'point'|'polyline'|'polygon' = 'point';

      if (importFormat === '车站') {
        coords = [{ x: item.coordinate.x, z: item.coordinate.z }];
        mode = 'point';
      } else if (importFormat === '站台') {
        coords = [{ x: item.coordinate.x, z: item.coordinate.z }];
        mode = 'point';
      } else if (importFormat === '铁路') {
        coords = (item.PLpoints||[]).map((pt: any) => ({ x: pt[0], z: pt[2] }));
        mode = 'polyline';
      }

      const group = L.layerGroup();
      const latlngs = coords.map(p => projectionRef.current!.locationToLatLng(p.x, item.height || 64, p.z));

      if (mode === 'point') {
        latlngs.forEach(ll => {
          L.circleMarker(ll, { color, fillColor: color, radius: 6 }).addTo(group);
        });
      } else if (mode === 'polyline') {
        L.polyline(latlngs, { color }).addTo(group);
      }

      const id = nextLayerId.current++;
      const newLayer: LayerType = {
        id,
        mode,
        color,
        coords,
        visible: true,
        leafletGroup: group,
        jsonInfo: {
          subType: importFormat, 
          featureInfo: item,
          platformLines: importFormat==='站台'? item.lines : undefined,
          stationPlatforms: importFormat==='车站'? item.platforms : undefined,
          linePoints: importFormat==='铁路'? coords.map((p:any,i:number)=>[p.x,item.height||-63,p.z]): undefined
        }
      };
      setLayers(prev => [...prev, newLayer]);
    });

    setTimeout(refreshAllFixedLayers, 0);

    setImportText('');
    setImportPanelOpen(false);
  } catch (e) {
    alert('非法 JSON: ' + e);
  }
};






  


  // 搜索结果选中处理
  const handleSearchSelect = useCallback((result: { coord: { x: number; y: number; z: number } }) => {
    const map = leafletMapRef.current;
    const proj = projectionRef.current;
    if (!map || !proj) return;

    const latLng = proj.locationToLatLng(result.coord.x, result.coord.y, result.coord.z);
    map.setView(latLng, 5);  // 放大到 zoom 5
  }, []);

  // 线路选中处理 - 高亮线路并调整视图
  const handleLineSelect = useCallback((line: ParsedLine) => {
    if (!showRailway) setShowRailway(true);
    setHighlightedLine(line);
    setRoutePath(null);  // 清除路径规划
    setSelectedPoint(null);  // 清除点位选中

    const map = leafletMapRef.current;
    const proj = projectionRef.current;
    if (!map || !proj || line.stations.length === 0) return;

    // 计算线路边界
    const bounds = L.latLngBounds(
      line.stations.map(s => proj.locationToLatLng(s.coord.x, s.coord.y || 64, s.coord.z))
    );
    map.fitBounds(bounds, { padding: [50, 50] });
  }, [showRailway]);

  // 站点点击处理
  const handleStationClick = useCallback((station: ParsedStation) => {
    setSelectedPoint({
      type: 'station',
      name: station.name,
      coord: station.coord,
      station,
    });
    setHighlightedLine(null);
    setSelectedPlayer(null);

    const map = leafletMapRef.current;
    const proj = projectionRef.current;
    if (!map || !proj) return;
    const latLng = proj.locationToLatLng(station.coord.x, station.coord.y || 64, station.coord.z);
    map.setView(latLng, 5);
  }, []);

  // 地标点击处理
  const handleLandmarkClick = useCallback((landmark: ParsedLandmark) => {
    if (!landmark.coord) return;
    setSelectedPoint({
      type: 'landmark',
      name: landmark.name,
      coord: landmark.coord,
      landmark,
    });
    setHighlightedLine(null);
    setSelectedPlayer(null);

    const map = leafletMapRef.current;
    const proj = projectionRef.current;
    if (!map || !proj) return;
    const latLng = proj.locationToLatLng(landmark.coord.x, landmark.coord.y || 64, landmark.coord.z);
    map.setView(latLng, 5);
  }, []);

  // 玩家点击处理
  const handlePlayerClick = useCallback((player: Player) => {
    setSelectedPlayer(player);
    setSelectedPoint(null);
    setHighlightedLine(null);

    const map = leafletMapRef.current;
    const proj = projectionRef.current;
    if (!map || !proj) return;
    const latLng = proj.locationToLatLng(player.x, player.y, player.z);
    map.setView(latLng, 5);
  }, []);

  // 计算附近点位
  const getNearbyPoints = useCallback((coord: Coordinate, radius: number = 500) => {
    const getDistance = (a: Coordinate, b: Coordinate) => {
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      return Math.sqrt(dx * dx + dz * dz);
    };

    const nearbyStations = stations
      .filter(s => getDistance(coord, s.coord) <= radius && getDistance(coord, s.coord) > 0)
      .sort((a, b) => getDistance(coord, a.coord) - getDistance(coord, b.coord))
      .slice(0, 5);

    const nearbyLandmarks = landmarks
      .filter(l => l.coord && getDistance(coord, l.coord) <= radius && getDistance(coord, l.coord) > 0)
      .sort((a, b) => getDistance(coord, a.coord!) - getDistance(coord, b.coord!))
      .slice(0, 5);

    return { nearbyStations, nearbyLandmarks };
  }, [stations, landmarks]);

  // 导航路径找到时的处理
  const handleRouteFound = useCallback((path: Array<{ coord: Coordinate }>) => {
    setRoutePath(path);
    setHighlightedLine(null);  // 清除线路高亮

    // 计算路径边界并调整地图视图
    const map = leafletMapRef.current;
    const proj = projectionRef.current;
    if (!map || !proj || path.length === 0) return;

    const bounds = L.latLngBounds(
      path.map(p => proj.locationToLatLng(p.coord.x, p.coord.y || 64, p.coord.z))
    );
    map.fitBounds(bounds, { padding: [50, 50] });
  }, []);

  // 世界切换处理
  const handleWorldChange = useCallback((worldId: string) => {
    setCurrentWorld(worldId);

    // 更新瓦片图层
    const map = leafletMapRef.current;
    const proj = projectionRef.current;
    if (!map || !proj) return;

    // 移除旧瓦片图层
    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }

    // 添加新瓦片图层
    const newTileLayer = createDynmapTileLayer(worldId, 'flat');
    newTileLayer.addTo(map);
    tileLayerRef.current = newTileLayer;

    // 移动到新世界的中心点
    const world = WORLDS.find(w => w.id === worldId);
    if (world) {
      const centerLatLng = proj.locationToLatLng(
        world.center.x,
        world.center.y,
        world.center.z
      );
      map.setView(centerLatLng, 2);
    }
  }, []);

  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;

    // 从 cookie 读取初始世界设置
    const savedWorld = loadMapSettings()?.currentWorld ?? 'zth';

    // 创建 Dynmap CRS
    const crs = createDynmapCRS(ZTH_FLAT_CONFIG);
    const projection = (crs as any).dynmapProjection as DynmapProjection;
    projectionRef.current = projection;

    // 计算初始中心点 - 使用保存的世界，否则退回零洲
    const world = WORLDS.find(w => w.id === savedWorld) ?? WORLDS.find(w => w.id === 'zth') ?? WORLDS[0];
    if (!world) return;

    const centerLatLng = projection.locationToLatLng(
      Number(world.center.x),
      Number(world.center.y),
      Number(world.center.z)
    );

    // 创建地图
    const map = L.map(mapRef.current, {
      crs: crs,
      center: centerLatLng,
      zoom: 2,
      minZoom: 0,
      maxZoom: projection.maxZoom,
      zoomControl: false,  // 禁用默认缩放控件，稍后自定义位置
      attributionControl: true
    });

    // 添加缩放控件 - 桌面端右下角，手机端左下角
    const isDesktop = window.innerWidth >= 640;
    L.control.zoom({ position: isDesktop ? 'bottomright' : 'bottomleft' }).addTo(map);

    // 添加 Dynmap 瓦片图层 - 使用保存的世界
    const tileLayer = createDynmapTileLayer(savedWorld, 'flat');
    tileLayer.addTo(map);
    tileLayerRef.current = tileLayer;

    // 开发期：输出缩放/中心点对应的瓦片 URL，便于定位“缩放偏移”类问题
    if (import.meta.env.DEV) {
      const logTileDebug = () => {
        const layer = tileLayerRef.current as unknown as DynmapTileLayer | null;
        const proj = projectionRef.current;
        if (!layer || !proj || typeof (layer as any).getDynmapTileForLatLng !== 'function') return;
        const center = map.getCenter();
        const zoom = map.getZoom();
        const tile = (layer as any).getDynmapTileForLatLng(center, zoom);
        const mc = proj.latLngToLocation(center, 64);
        console.log('[tile-debug]', { zoom, tileZoom: tile.tileZoom, center, mc, tile: tile.info, url: tile.url });
      };
      map.on('zoomend moveend', logTileDebug);
      logTileDebug();
    }

    // 添加坐标显示控件
    const coordControl = new L.Control({ position: 'bottomleft' });
    coordControl.onAdd = function() {
      const div = L.DomUtil.create('div', 'coord-display');
      div.style.cssText = 'background: rgba(255,255,255,0.9); padding: 5px 10px; border-radius: 4px; font-family: monospace; font-size: 12px;';
      div.innerHTML = 'X: 0, Z: 0';
      return div;
    };
    coordControl.addTo(map);

    // 监听鼠标移动，更新坐标显示
    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      // 使用投影的逆转换获取世界坐标
      const proj = projectionRef.current;
      if (!proj) return;

      const worldCoord = proj.latLngToLocation(e.latlng, 64);
      const coordDiv = document.querySelector('.coord-display');
      if (coordDiv) {
        coordDiv.innerHTML = `X: ${Math.round(worldCoord.x)}, Z: ${Math.round(worldCoord.z)}`;
      }
    });

    leafletMapRef.current = map;
    setMapReady(true);

    // 清理函数
    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative w-full h-full">
      {/* 地图容器 */}
      <div ref={mapRef} className="w-full h-full" />

      {/* 铁路图层 - 有路径规划结果时隐藏 */}
      {mapReady && leafletMapRef.current && projectionRef.current && (
        <RailwayLayer
          map={leafletMapRef.current}
          projection={projectionRef.current}
          worldId={currentWorld}
          visible={showRailway && !routePath}
          onStationClick={handleStationClick}
        />
      )}

      {/* 地标图层 - 有路径规划结果时隐藏 */}
      {mapReady && leafletMapRef.current && projectionRef.current && (
        <LandmarkLayer
          map={leafletMapRef.current}
          projection={projectionRef.current}
          worldId={currentWorld}
          visible={showLandmark && !routePath}
          onLandmarkClick={handleLandmarkClick}
        />
      )}

      {/* 玩家图层 */}
      {mapReady && leafletMapRef.current && projectionRef.current && (
        <PlayerLayer
          map={leafletMapRef.current}
          projection={projectionRef.current}
          worldId={currentWorld}
          visible={showPlayers}
          onPlayerClick={handlePlayerClick}
        />
      )}

      {/* 左侧面板区域 */}
      <div className="absolute top-2 left-2 right-2 sm:top-4 sm:left-4 sm:right-auto z-[1000] flex flex-col gap-2 sm:max-w-[300px]">
        {/* 标题和世界切换 */}
        <div className="bg-white/90 px-3 py-2 sm:px-4 rounded-lg shadow-lg">
          <h1 className="text-base sm:text-lg font-bold text-gray-800">RIA 铁路在线地图</h1>
          <WorldSwitcher
            worlds={WORLDS}
            currentWorld={currentWorld}
            onWorldChange={handleWorldChange}
          />
        </div>

        {/* 搜索栏 */}
        <SearchBar
          stations={stations}
          landmarks={landmarks}
          lines={lines}
          onSelect={handleSearchSelect}
          onLineSelect={handleLineSelect}
        />

        {/* 工具栏 */}
        <Toolbar
          onNavigationClick={() => setShowNavigation(true)}
          onLinesClick={() => setShowLinesPage(true)}
          onPlayersClick={() => setShowPlayersPage(true)}
          onHelpClick={() => setShowAbout(true)}
        />

{/* 主按钮 */}
<div className="absolute top-10 left-2 z-[1500] flex gap-2">
  {!measuringActive ? (
    <button
      className="bg-blue-600 text-white px-3 py-1 rounded-lg"
      onClick={() => setMeasuringActive(true)}
    >
      开始测绘
    </button>
  ) : (
    <button
      className="bg-gray-600 text-white px-3 py-1 rounded-lg"
      onClick={() => setMeasuringActive(false)}
    >
      退出测绘
    </button>
  )}

  {measuringActive && (
    <button
      className="bg-red-600 text-white px-3 py-1 rounded-lg"
      onClick={clearAllLayers}
    >
      清除所有图层
    </button>
      ) }
      
      { (
    <button
  className="bg-purple-800 text-white px-3 py-1 rounded-lg"
  onClick={() => setImportPanelOpen(!importPanelOpen)}
>
  导入矢量数据
</button>

    
  )}
</div>

{/* 测绘菜单 */}
{measuringActive && (
  <div className="absolute top-20 left-2 bg-white p-3 rounded-lg shadow-lg z-[1000] w-96 max-h-[70vh] overflow-y-auto">
    {/* 点/线/面 */}
    <div className="flex gap-2 mb-2">
      {(['point','polyline','polygon'] as const).map(m => (
        <button
          key={m}
          className={`flex-1 py-1 border ${
            drawMode === m ? 'bg-blue-300' : ''
          }`}
          onClick={() => {
            if (tempPoints.length > 0 && drawMode !== m) {
              if (!confirm('切换模式将清空当前临时图形？')) return;
              tempLayerGroupRef.current?.clearLayers();
              setTempPoints([]);
            }
            setDrawMode(m);
            setDrawing(true);
            setSubType('默认'); // reset
            setFeatureInfo({});
          }}
        >
          {m === 'point' ? '点' : m === 'polyline' ? '线' : '面'}
        </button>
      ))}
    </div>

    {/* 要素类型下拉 */}
    {drawMode !== 'none' && (
      <div className="mb-2">
        <label className="block text-sm font-bold">要素类型</label>
        <select
          value={subType}
          onChange={e => {
            setSubType(e.target.value);
            setFeatureInfo({});
            setPlatformLines([]);
            setStationPlatforms([]);
            setLinePoints([]);
          }}
          className="w-full border p-1 rounded"
        >
          <option value="默认">默认</option>
          {drawMode === 'point' && <>
            <option value="车站">车站</option>
            <option value="站台">站台</option>
            <option value="地标">地标</option>
          </>}
          {drawMode === 'polyline' && <>
            <option value="铁路">铁路</option>
            <option value="栈道">栈道</option>
            <option value="航道">航道</option>
          </>}
          {drawMode === 'polygon' && <>
            <option value="一般建筑">一般建筑</option>
            <option value="车站站体">车站站体</option>
          </>}
        </select>
      </div>
    )}

    {/* 颜色 */}
    {drawMode !== 'none' && (
      <div className="mb-2">
        <label className="block mb-1 text-sm">颜色</label>
        <input
          type="color"
          value={drawColor}
          onChange={e => setDrawColor(e.target.value)}
          className="w-full"
        />
      </div>
    )}

    {/* 撤销/重做/完成 */}
    {drawMode !== 'none' && (
      <div className="flex gap-2 mb-2">
        <button className="bg-yellow-400 text-white px-2 py-1 rounded" onClick={handleUndo}>撤销</button>
        <button className="bg-orange-400 text-white px-2 py-1 rounded" onClick={handleRedo}>重做</button>
        <button className="bg-green-500 text-white px-3 py-1 rounded-lg flex-1" onClick={finishLayer}>
          {editingLayerId !== null ? '保存编辑图层' : '完成当前图层'}
        </button>
      </div>
    )}

    {/* 临时输出 */}
    <div className="mb-2">
      <label className="text-sm font-bold">临时输出</label>
      <textarea readOnly className="w-full h-20 border p-1" value={currentTempOutput()} />
    </div>

{/* JSON 输入区 */}
{subType !== '默认' && (
  <div className="mb-2 border-t pt-2">
    <label className="text-sm font-bold">附加信息 ({subType})</label>

    {/* ---- 车站 Station ---- */}
    {subType === '车站' && (
      <>
        {/* stationID / stationName */}
        <input
          className="w-full border p-1 mb-1 rounded"
          placeholder="stationID"
          value={featureInfo.stationID || ''}
          onChange={e => setFeatureInfo({...featureInfo, stationID: e.target.value})}
        />
        <input
          className="w-full border p-1 mb-1 rounded"
          placeholder="stationName"
          value={featureInfo.stationName || ''}
          onChange={e => setFeatureInfo({...featureInfo, stationName: e.target.value})}
        />

        {/* height */}
        <input
          type="number"
          className="w-full border p-1 mb-1 rounded"
          placeholder="height (Y 轴坐标)"
          value={featureInfo.height ?? ''}
          onChange={e => setFeatureInfo({...featureInfo, height: +e.target.value})}
        />

        {/* labelL1 / L2 / L3 */}
        {['labelL1','labelL2','labelL3'].map(k => (
          <input
            key={k}
            type="number"
            className="w-full border p-1 mb-1 rounded"
            placeholder={k}
            value={featureInfo[k] ?? ''}
            onChange={e => setFeatureInfo({...featureInfo, [k]: +e.target.value})}
          />
        ))}

        {/* platforms 动态数组 */}
        {stationPlatforms.map((item, idx) => (
          <div key={idx} className="border p-1 mb-1 rounded">
            <input
              className="w-full border p-1 mb-1 rounded"
              placeholder="站台 ID"
              value={item.ID}
              onChange={e => {
                const arr = [...stationPlatforms];
                arr[idx].ID = e.target.value;
                setStationPlatforms(arr);
              }}
            />
            <input
              type="number"
              className="w-full border p-1 mb-1 rounded"
              placeholder="condistance"
              value={item.condistance}
              onChange={e => {
                const arr = [...stationPlatforms];
                arr[idx].condistance = +e.target.value;
                setStationPlatforms(arr);
              }}
            />
          </div>
        ))}
        <button
          className="bg-blue-500 text-white px-2 py-1 rounded"
          onClick={() => setStationPlatforms(prev => [...prev, {ID:'', condistance:0}])}
        >
          添加站台
        </button>
      </>
    )}

    {/* ---- 站台 Platform ---- */}
    {subType === '站台' && (
      <>
        {/* platformID / platformName */}
        <input
          className="w-full border p-1 mb-1 rounded"
          placeholder="platformID"
          value={featureInfo.platformID || ''}
          onChange={e => setFeatureInfo({...featureInfo, platformID:e.target.value})}
        />
        <input
          className="w-full border p-1 mb-1 rounded"
          placeholder="platformName"
          value={featureInfo.platformName || ''}
          onChange={e => setFeatureInfo({...featureInfo, platformName:e.target.value})}
        />

        {/* station 坐标（由 tempPoints 注入） */}

        {/* height */}
        <input
          type="number"
          className="w-full border p-1 mb-1 rounded"
          placeholder="height (Y 轴坐标)"
          value={featureInfo.height ?? ''}
          onChange={e => setFeatureInfo({...featureInfo, height:+e.target.value})}
        />

        {/* labelL1 / L2 / L3 */}
        {['labelL1','labelL2','labelL3'].map(k => (
          <input
            key={k}
            type="number"
            className="w-full border p-1 mb-1 rounded"
            placeholder={k}
            value={featureInfo[k] ?? ''}
            onChange={e => setFeatureInfo({...featureInfo, [k]: +e.target.value})}
          />
        ))}

        {/* ---- lines 动态数组 ---- */}
        {platformLines.map((item, idx) => (
          <div key={idx} className="border p-1 mb-1 rounded">
            {/* 线路ID */}
            <input
              className="w-full border p-1 mb-1 rounded"
              placeholder="线路 ID"
              value={item.ID}
              onChange={e => {
                const arr = [...platformLines]; arr[idx].ID = e.target.value;
                setPlatformLines(arr);
              }}
            />

            {/* stationCode */}
            <input
              type="number"
              className="w-full border p-1 mb-1 rounded"
              placeholder="stationCode"
              value={item.stationCode}
              onChange={e => {
                const arr = [...platformLines]; arr[idx].stationCode = +e.target.value;
                setPlatformLines(arr);
              }}
            />

            {/* distance */}
            <input
              type="number"
              className="w-full border p-1 mb-1 rounded"
              placeholder="distance"
              value={item.distance}
              onChange={e => {
                const arr = [...platformLines]; arr[idx].distance = +e.target.value;
                setPlatformLines(arr);
              }}
            />

            {/* NotAvaliable */}
            <select
              className="w-full border p-1 mb-1 rounded"
              value={item.NotAvaliable ? 'true' : 'false'}
              onChange={e => {
                const arr = [...platformLines]; arr[idx].NotAvaliable = e.target.value === 'true';
                setPlatformLines(arr);
              }}
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>

            {/* Overtaking */}
            <select
              className="w-full border p-1 mb-1 rounded"
              value={item.Overtaking ? 'true' : 'false'}
              onChange={e => {
                const arr = [...platformLines]; arr[idx].Overtaking = e.target.value === 'true';
                setPlatformLines(arr);
              }}
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </div>
        ))}

        <button
          className="bg-blue-500 text-white px-2 py-1 rounded"
          onClick={() => setPlatformLines(prev => [...prev, {ID:'', stationCode:0, distance:0, NotAvaliable:true, Overtaking:false}])}
        >
          添加线路信息
        </button>
      </>
    )}

    {/* ---- 铁路 Line ---- */}
    {subType === '铁路' && (
      <>
        {['LineID','LineName','bureau','line','startplf','endplf'].map(k => (
          <input key={k}
            className="w-full border p-1 mb-1 rounded"
            placeholder={k}
            value={featureInfo[k] || ''}
            onChange={e => setFeatureInfo({...featureInfo, [k]: e.target.value})}
          />
        ))}

        {/* direction */}
        <select
          className="w-full border p-1 rounded mb-1"
          value={featureInfo.direction ?? 0}
          onChange={e => setFeatureInfo({...featureInfo, direction:+e.target.value})}
        >
          {[0,1,2,3].map(v => <option key={v} value={v}>{v}</option>)}
        </select>

        {/* labelL1 / L2 / L3 */}
        {['labelL1','labelL2','labelL3'].map(k => (
          <input
            key={k}
            type="number"
            className="w-full border p-1 mb-1 rounded"
            placeholder={k}
            value={featureInfo[k] ?? ''}
            onChange={e => setFeatureInfo({...featureInfo, [k]:+e.target.value})}
          />
        ))}
      </>
    )}
  </div>
)}

  </div>
)}

{importPanelOpen && (
  <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-[1000]">
    <div className="bg-white p-4 rounded-lg shadow-lg w-80 max-h-[70vh] overflow-y-auto">

      <h3 className="font-bold mb-2">导入矢量数据</h3>

      <label className="block text-sm font-bold mb-1">格式</label>
      <select
        value={importFormat}
        onChange={e => setImportFormat(e.target.value as any)}
        className="w-full border p-1 rounded mb-2"
      >
        <option value="点">点</option>
        <option value="线">线</option>
        <option value="面">面</option>
        <option value="车站">车站</option>
        <option value="铁路">铁路</option>
        <option value="站台">站台</option>
      </select>

      <label className="block text-sm font-bold mb-1">数据输入</label>
      <textarea
        value={importText}
        onChange={e => setImportText(e.target.value)}
        className="w-full border p-1 rounded mb-2"
        placeholder={
          importFormat === '点' || importFormat === '线' || importFormat === '面'
            ? 'x,z;x,z;x,z...'
            : '符合 JSON 格式，如数组'
        }
        rows={6}
      />

      <button
        className="bg-green-600 text-white px-3 py-1 rounded-lg w-full"
        onClick={handleImport}
      >
        导入
      </button>

    </div>
  </div>
)}






{/* ======== 图层控制器 ======== */}
{measuringActive && (
  <div className="fixed top-20 right-4 bg-white p-3 rounded-lg shadow-lg z-[1000] w-72 max-h-[70vh] overflow-y-auto">

    <h3 className="font-bold mb-2">图层控制</h3>

    {layers.map(l => (
      <div key={l.id} className="flex items-center gap-1 mb-1">

        {/* 显示/隐藏 */}
        <button
          className={`px-2 py-1 text-sm ${
            l.visible ? 'bg-green-300' : 'bg-gray-300'
          }`}
          onClick={() => toggleLayerVisible(l.id)}
        >
          {l.visible ? '隐藏' : '显示'}
        </button>

        {/* 上移 */}
        <button
          className="px-2 py-1 text-sm bg-blue-200"
          onClick={() => moveLayerUp(l.id)}
        >
          ↑
        </button>

        {/* 下移 */}
        <button
          className="px-2 py-1 text-sm bg-blue-200"
          onClick={() => moveLayerDown(l.id)}
        >
          ↓
        </button>

        {/* 编辑 */}
        <button
          className="px-2 py-1 text-sm bg-yellow-300"
          onClick={() => editLayer(l.id)}
        >
          编辑
        </button>

        {/* 删除 */}
        <button
          className="px-2 py-1 text-sm bg-red-400 text-white"
          onClick={() => deleteLayer(l.id)}
        >
          删除
        </button>

        <button
  className="text-xs underline text-blue-600"
  onClick={() => {
    alert(getLayerJSONOutput(l)); // 或显示在 textarea
  }}
>
  JSON 输出
</button>


        <div className="flex-1 text-sm truncate">
          #{l.id} {l.mode} <span style={{ color: l.color }}>■</span>
        </div>

      </div>
    ))}

  </div>
)}






        {/* 关于卡片 */}
        {showAbout && (
          <AboutCard onClose={() => setShowAbout(false)} />
        )}

        {/* 路径规划面板 - 展开时隐藏其他内容 */}
        {showNavigation && (
          <NavigationPanel
            stations={stations}
            lines={lines}
            landmarks={landmarks}
            players={players}
            worldId={currentWorld}
            onRouteFound={handleRouteFound}
            onClose={() => setShowNavigation(false)}
            onPointClick={(coord) => {
              const map = leafletMapRef.current;
              const proj = projectionRef.current;
              if (!map || !proj) return;
              const latLng = proj.locationToLatLng(coord.x, coord.y || 64, coord.z);
              map.setView(latLng, 5);
            }}
          />
        )}

      {/* 线路详情卡片 - 路径规划打开时隐藏 */}
      {highlightedLine && !showNavigation && !selectedPoint && !selectedPlayer && (
        <LineDetailCard
          line={highlightedLine}
            onClose={() => setHighlightedLine(null)}
            onStationClick={(_name, coord) => {
              const map = leafletMapRef.current;
              const proj = projectionRef.current;
              if (!map || !proj) return;
              const latLng = proj.locationToLatLng(coord.x, coord.y || 64, coord.z);
              map.setView(latLng, 5);
            }}
          />
        )}

        {/* 点位详情卡片 */}
        {selectedPoint && !showNavigation && !selectedPlayer && (() => {
          const { nearbyStations, nearbyLandmarks } = getNearbyPoints(selectedPoint.coord);
          return (
            <PointDetailCard
              selectedPoint={selectedPoint}
              nearbyStations={nearbyStations}
              nearbyLandmarks={nearbyLandmarks}
              lines={lines}
              onClose={() => setSelectedPoint(null)}
              onStationClick={handleStationClick}
              onLandmarkClick={handleLandmarkClick}
              onLineClick={(line) => {
                setSelectedPoint(null);
                handleLineSelect(line);
              }}
            />
          );
        })()}

        {/* 玩家详情卡片 */}
        {selectedPlayer && !showNavigation && (() => {
          const playerCoord: Coordinate = { x: selectedPlayer.x, y: selectedPlayer.y, z: selectedPlayer.z };
          const { nearbyStations, nearbyLandmarks } = getNearbyPoints(playerCoord);
          return (
            <PlayerDetailCard
              player={selectedPlayer}
              nearbyStations={nearbyStations}
              nearbyLandmarks={nearbyLandmarks}
              onClose={() => setSelectedPlayer(null)}
              onStationClick={handleStationClick}
              onLandmarkClick={handleLandmarkClick}
            />
          );
        })()}

        {/* 清除路径按钮 - 路径规划打开时隐藏 */}
        {routePath && routePath.length > 0 && !showNavigation && (
          <button
            onClick={() => setRoutePath(null)}
            className="bg-gray-500 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-2 w-fit text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span>清除路径</span>
          </button>
        )}

        {/* 玩家列表面板 - 在左侧面板内显示 */}
        {showPlayersPage && (
          <PlayersList
            worldId={currentWorld}
            onClose={() => setShowPlayersPage(false)}
            onPlayerSelect={(player) => {
              setShowPlayersPage(false);
              handlePlayerClick(player);
            }}
            onNavigateToPlayer={() => {
              setShowPlayersPage(false);
              // 打开导航面板
              setShowNavigation(true);
            }}
          />
        )}
      </div>

      {/* 右侧图层控制 - 手机端右下角版权上方，桌面端右上角 */}
      <div className="absolute bottom-8 right-2 sm:top-4 sm:bottom-auto sm:right-4 z-[1000]">
        <LayerControl
          showRailway={showRailway}
          showLandmark={showLandmark}
          showPlayers={showPlayers}
          dimBackground={dimBackground}
          onToggleRailway={setShowRailway}
          onToggleLandmark={setShowLandmark}
          onTogglePlayers={setShowPlayers}
          onToggleDimBackground={setDimBackground}
        />
      </div>

      {/* 路径高亮图层 */}
      {mapReady && leafletMapRef.current && projectionRef.current && routePath && routePath.length > 0 && (
        <RouteHighlightLayer
          map={leafletMapRef.current}
          projection={projectionRef.current}
          path={routePath}
        />
      )}

      {/* 线路高亮图层 */}
      {mapReady && leafletMapRef.current && projectionRef.current && highlightedLine && showRailway && (
        <LineHighlightLayer
          map={leafletMapRef.current}
          projection={projectionRef.current}
          line={highlightedLine}
        />
      )}

      {/* 线路列表页面 */}
      {showLinesPage && (
        <LinesPage
          onBack={() => setShowLinesPage(false)}
          onLineSelect={(line) => {
            setShowLinesPage(false);
            handleLineSelect(line);
          }}
        />
      )}

      {/* 加载进度提示 */}
      <LoadingOverlay />
    </div>
  );
}

export default MapContainer;
