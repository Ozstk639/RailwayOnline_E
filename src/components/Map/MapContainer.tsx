import { useEffect, useRef, useState, useCallback } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createDynmapCRS, ZTH_FLAT_CONFIG, DynmapProjection } from '@/lib/DynmapProjection';
import { DynmapTileLayer, createDynmapTileLayer } from '@/lib/DynmapTileLayer';
import { createSketchTileLayer } from '@/lib/SketchTileLayer';
import { createWatercolorTileLayer } from '@/lib/SketchTileLayer';
import { RailwayLayer } from './RailwayLayer';
import { LandmarkLayer } from './LandmarkLayer';
import { PlayerLayer } from './PlayerLayer';
import { RouteHighlightLayer, type RouteHighlightData } from './RouteHighlightLayer';
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
import { DraggablePanel } from '../DraggablePanel/DraggablePanel';
import { SettingsPanel } from '../Settings/SettingsPanel';
import { useLoadingStore } from '@/store/loadingStore';
import { useDataStore } from '@/store/dataStore';
import { fetchPlayers } from '@/lib/playerApi';
import { loadMapSettings, saveMapSettings, MapStyle } from '@/lib/cookies';
import type { ParsedStation, ParsedLine, Coordinate, Player } from '@/types';
import type { ParsedLandmark } from '@/lib/landmarkParser';
import MeasuringModule from '@/components/Mapping/MeasuringModule';
import MeasurementToolsModule from '@/components/Mapping/Mtools';

import RuleDrivenLayer from '@/components/Rules/RuleDrivenLayer';
import RuleLayerToggle from '@/components/Rules/RuleLayerToggle';

import { formatGridNumber, snapWorldPointByMode } from '@/components/Mapping/GridSnapModeSwitch';


// 世界配置
const WORLDS = [
  { id: 'zth', name: '零洲', center: { x: -643, y: 35, z: -1562 } },
  { id: 'eden', name: '伊甸', center: { x: 0, y: 64, z: 0 } },
  { id: 'naraku', name: '奈落洲', center: { x: 0, y: 64, z: 0 } },
  { id: 'houtu', name: '后土洲', center: { x: 0, y: 64, z: 0 } }
];

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
  const [mapStyle, setMapStyle] = useState<MapStyle>(savedSettings?.mapStyle ?? 'default');
  const [showNavigation, setShowNavigation] = useState(false);
  const [showLinesPage, setShowLinesPage] = useState(false);
  const [showPlayersPage, setShowPlayersPage] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [stations, setStations] = useState<ParsedStation[]>([]);
  const [lines, setLines] = useState<ParsedLine[]>([]);
  const [landmarks, setLandmarks] = useState<ParsedLandmark[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [routeHighlight, setRouteHighlight] = useState<RouteHighlightData | null>(null);

// 是否存在可绘制的路线（用于隐藏图层/显示清除按钮）
  const hasRoute =
    routeHighlight?.styledSegments?.some(s => Array.isArray(s.coords) && s.coords.length >= 2) ?? false;

  const [highlightedLine, setHighlightedLine] = useState<ParsedLine | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<{
    type: 'station' | 'landmark';
    name: string;
    coord: Coordinate;
    station?: ParsedStation;
    landmark?: ParsedLandmark;
  } | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [measuringCloseSignal, setMeasuringCloseSignal] = useState(0);
  const [measureToolsCloseSignal, setMeasureToolsCloseSignal] = useState(0);
  const [showRuleLayers, setShowRuleLayers] = useState(true);

  // 面板 z-index 管理（用于置顶）
const [panelZIndexes, setPanelZIndexes] = useState<Record<string, number>>({
  info: 1000,
  navigation: 1001,
  navigation2: 1001,
  help: 1000,
  ruler: 1001,
  mapStyle: 1001,
  dynmap: 1001,
  ruleLayers: 1001,
  music: 1001,
});

  const zIndexCounterRef = useRef(1001);

  // 置顶面板
  const bringToFront = useCallback((panelId: string) => {
    zIndexCounterRef.current += 1;
    setPanelZIndexes(prev => ({
      ...prev,
      [panelId]: zIndexCounterRef.current,
    }));
  }, []);

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

  // 地图风格切换
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map || !mapReady) return;

    // 移除旧瓦片图层
    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }

// 添加新瓦片图层
let newTileLayer: L.TileLayer;


const tileLayerOptions = {
  minZoom: -3,
  maxZoom: map.getMaxZoom(), // =5
  minNativeZoom: 0,
  maxNativeZoom: 3
};

if (mapStyle === 'sketch') {
  newTileLayer = createSketchTileLayer(currentWorld, 'flat', tileLayerOptions);
} else if (mapStyle === 'watercolor') {
  newTileLayer = createWatercolorTileLayer(currentWorld, 'flat', tileLayerOptions);
} else {
  newTileLayer = createDynmapTileLayer(currentWorld, 'flat', tileLayerOptions);
}


    newTileLayer.addTo(map);
    tileLayerRef.current = newTileLayer;
  }, [mapStyle, mapReady, currentWorld]);

  // 保存地图设置到 cookie
  useEffect(() => {
    saveMapSettings({
      currentWorld,
      showRailway,
      showLandmark,
      showPlayers,
      dimBackground,
      mapStyle,
    });
  }, [currentWorld, showRailway, showLandmark, showPlayers, dimBackground, mapStyle]);

  // 加载状态管理
  const { startLoading, updateStage, finishLoading } = useLoadingStore();
  const { loadAllData, getWorldData, isLoaded: dataLoaded } = useDataStore();

  // 首次加载：预加载所有世界数据
  useEffect(() => {
    if (dataLoaded) return;

    startLoading([
      { name: 'bureaus', label: '铁路局配置' },
      { name: 'zth-railway', label: '零洲铁路数据' },
      { name: 'zth-rmp', label: '零洲 RMP 数据' },
      { name: 'zth-landmark', label: '零洲地标数据' },
      { name: 'houtu-railway', label: '后土洲铁路数据' },
      { name: 'houtu-rmp', label: '后土洲 RMP 数据' },
      { name: 'houtu-landmark', label: '后土洲地标数据' },
      { name: 'naraku-railway', label: '奈落洲铁路数据' },
      { name: 'naraku-landmark', label: '奈落洲地标数据' },
      { name: 'eden-railway', label: '伊甸铁路数据' },
      { name: 'eden-landmark', label: '伊甸地标数据' },
    ]);

    loadAllData((stage, status) => {
      updateStage(stage, status);
    }).then(() => {
      setTimeout(() => {
        finishLoading();
      }, 500);
    });
  }, [dataLoaded, loadAllData, startLoading, updateStage, finishLoading]);

  // 切换世界时从缓存加载数据
  useEffect(() => {
    if (!dataLoaded) return;

    const worldData = getWorldData(currentWorld);
    if (worldData) {
      setLines(worldData.lines);
      setStations(worldData.stations);
      setLandmarks(worldData.landmarks);
    }

    // 加载玩家数据（实时数据，不缓存）
    fetchPlayers(currentWorld).then(setPlayers);

    // 清除之前的路径
    setRouteHighlight(null);
    setHighlightedLine(null);

  }, [currentWorld, dataLoaded, getWorldData]);

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
    setRouteHighlight(null);  // 清除路径规划
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
const handleRouteFound = useCallback((route: RouteHighlightData | Array<{ coord: Coordinate }>) => {
  setHighlightedLine(null); // 清除线路高亮

  // 统一归一化为 RouteHighlightData
  let rh: RouteHighlightData | null = null;

  if (Array.isArray(route)) {
    const coords = route.map(p => p.coord).filter(Boolean);
    rh = coords.length >= 2 ? { styledSegments: [{ kind: 'generic', coords }] } : null;
  } else {
    rh = route;
  }

  setRouteHighlight(rh);

  // 计算边界并调整视图
  const map = leafletMapRef.current;
  const proj = projectionRef.current;
  if (!map || !proj || !rh?.styledSegments?.length) return;

  const allCoords: Coordinate[] = [];
  for (const seg of rh.styledSegments) {
    if (!Array.isArray(seg.coords)) continue;
    for (const c of seg.coords) allCoords.push(c);
  }
  if (allCoords.length === 0) return;

  const bounds = L.latLngBounds(
    allCoords.map(c => proj.locationToLatLng(c.x, c.y || 64, c.z))
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

    // 添加新瓦片图层（根据当前风格选择）
    let newTileLayer: L.TileLayer;
const tileLayerOptions = {
  minZoom: -3,
  maxZoom: map.getMaxZoom(), // =5
  minNativeZoom: 0,
  maxNativeZoom: 3
};

if (mapStyle === 'sketch') {
  newTileLayer = createSketchTileLayer(worldId, 'flat', tileLayerOptions);
} else if (mapStyle === 'watercolor') {
  newTileLayer = createWatercolorTileLayer(worldId, 'flat', tileLayerOptions);
} else {
  newTileLayer = createDynmapTileLayer(worldId, 'flat', tileLayerOptions);
}


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
  }, [mapStyle]);

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

const minZoom = -3;                 // 9级：-3..5
const maxZoom = projection.maxZoom; // 仍然是 5

const map = L.map(mapRef.current, {
  crs: crs,
  center: centerLatLng,
  zoom: 2,
  minZoom,
  maxZoom,

  // 明确锁定“整数缩放”
  zoomSnap: 1,
  zoomDelta: 1,

  zoomControl: false,
  attributionControl: true
});





    // 添加缩放控件 - 桌面端右下角，手机端左下角
    const isDesktop = window.innerWidth >= 640;
    L.control.zoom({ position: isDesktop ? 'bottomright' : 'bottomleft' }).addTo(map);

    // 添加 Dynmap 瓦片图层 - 使用保存的世界和风格
    const savedMapStyle = loadMapSettings()?.mapStyle ?? 'default';
const tileLayerOptions = {
  minZoom: -3,
  maxZoom: projection.maxZoom, // 5
  minNativeZoom: 0,            // 关键：zoom<0 时用 0 级瓦片缩放显示
  maxNativeZoom: 3             // 保持你现有 Dynmap 行为
};

let tileLayer: L.TileLayer;
if (savedMapStyle === 'sketch') {
  tileLayer = createSketchTileLayer(savedWorld, 'flat', tileLayerOptions);
} else if (savedMapStyle === 'watercolor') {
  tileLayer = createWatercolorTileLayer(savedWorld, 'flat', tileLayerOptions);
} else {
  tileLayer = createDynmapTileLayer(savedWorld, 'flat', tileLayerOptions);
}


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
  const proj = projectionRef.current;
  if (!proj) return;

  const worldCoord = proj.latLngToLocation(e.latlng, 64);

  // 与测绘控件保持一致：坐标显示也遵循“方块中心(.5)/方块边缘(.0)/自动(.5步进)”
  const snapped = snapWorldPointByMode({ x: worldCoord.x, z: worldCoord.z });

  const coordDiv = document.querySelector('.coord-display');
  if (coordDiv) {
    coordDiv.innerHTML = `X: ${formatGridNumber(snapped.x)}, Z: ${formatGridNumber(snapped.z)}`;
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

      <MeasuringModule
      mapReady={mapReady}
      leafletMapRef={leafletMapRef}
      projectionRef={projectionRef}
      currentWorldId={currentWorld}
      closeSignal={measuringCloseSignal}
      onBecameActive={() => setMeasureToolsCloseSignal(v => v + 1)}
      />

      <MeasurementToolsModule
      mapReady={mapReady}
      leafletMapRef={leafletMapRef}
      projectionRef={projectionRef}
      closeSignal={measureToolsCloseSignal}
      onBecameActive={() => setMeasuringCloseSignal(v => v + 1)}
      />

      {/* 规则驱动图层总开关（位置与右侧工具按钮体系对齐） */}
      <RuleLayerToggle
        active={showRuleLayers}
        onToggle={() => setShowRuleLayers(v => !v)}
      />

      {/* 规则驱动图层（总开关控制，worldId 切换自动重载） */}
      {mapReady && leafletMapRef.current && projectionRef.current && (
        <RuleDrivenLayer
          mapReady={mapReady}
          map={leafletMapRef.current}
          projection={projectionRef.current}
          worldId={currentWorld}
          visible={showRuleLayers}
        />
      )}


      {/* 铁路图层 - 有路径规划结果时隐藏 */}
      {mapReady && leafletMapRef.current && projectionRef.current && (
        <RailwayLayer
          map={leafletMapRef.current}
          projection={projectionRef.current}
          worldId={currentWorld}
          visible={showRailway && !hasRoute}
          mapStyle={mapStyle}
          onStationClick={handleStationClick}
        />
      )}

      {/* 地标图层 - 有路径规划结果时隐藏 */}
      {mapReady && leafletMapRef.current && projectionRef.current && (
        <LandmarkLayer
          map={leafletMapRef.current}
          projection={projectionRef.current}
          worldId={currentWorld}
          visible={showLandmark && !hasRoute}
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
          <h1 className="text-base sm:text-lg font-bold text-gray-800">RIA 在线地图</h1>
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
          onNavigationClick={() => { setShowNavigation(true); bringToFront('navigation'); }}
          onLinesClick={() => setShowLinesPage(true)}
          onPlayersClick={() => { setShowPlayersPage(true); bringToFront('players'); }}
          onHelpClick={() => { setShowAbout(true); bringToFront('about'); }}
          onSettingsClick={() => { setShowSettings(true); bringToFront('settings'); }}
        />

        {/* 手机端：保持原有的流式布局 */}
        <div className="sm:hidden flex flex-col gap-2">
          {/* 关于卡片 */}
          {showAbout && (
            <AboutCard onClose={() => setShowAbout(false)} />
          )}

          {/* 设置面板 */}
          {showSettings && (
            <SettingsPanel onClose={() => setShowSettings(false)} />
          )}

          {/* 路径规划面板 */}
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


          {/* 线路详情卡片 */}
          {highlightedLine && (
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
          {selectedPoint && (() => {
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
          {selectedPlayer && (() => {
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

          {/* 玩家列表面板 */}
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
                setShowNavigation(true);
              }}
            />
          )}
        </div>

        {/* 清除路径按钮 */}
{hasRoute && (
  <button
    onClick={() => setRouteHighlight(null)}
    className="bg-gray-500 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-2 w-fit text-sm"
  >
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
    <span>清除路径</span>
  </button>
)}

      </div>

      {/* 桌面端：可拖拽浮动面板 */}
      {/* 关于卡片 */}
      {showAbout && (
        <DraggablePanel
          id="about"
          defaultPosition={{ x: 16, y: 180 }}
          zIndex={panelZIndexes.about}
          onFocus={() => bringToFront('about')}
        >
          <AboutCard onClose={() => setShowAbout(false)} />
        </DraggablePanel>
      )}

      {/* 设置面板 */}
      {showSettings && (
        <DraggablePanel
          id="settings"
          defaultPosition={{ x: 16, y: 180 }}
          zIndex={panelZIndexes.settings}
          onFocus={() => bringToFront('settings')}
        >
          <SettingsPanel onClose={() => setShowSettings(false)} />
        </DraggablePanel>
      )}

      {/* 路径规划面板 */}
      {showNavigation && (
        <DraggablePanel
          id="navigation"
          defaultPosition={{ x: 16, y: 180 }}
          zIndex={panelZIndexes.navigation}
          onFocus={() => bringToFront('navigation')}
        >
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
        </DraggablePanel>
      )}

      {/* 玩家列表面板 */}
      {showPlayersPage && (
        <DraggablePanel
          id="players"
          defaultPosition={{ x: 16, y: 180 }}
          zIndex={panelZIndexes.players}
          onFocus={() => bringToFront('players')}
        >
          <PlayersList
            worldId={currentWorld}
            onClose={() => setShowPlayersPage(false)}
            onPlayerSelect={(player) => {
              handlePlayerClick(player);
            }}
            onNavigateToPlayer={() => {
              setShowNavigation(true);
              bringToFront('navigation');
            }}
          />
        </DraggablePanel>
      )}

      {/* 线路详情卡片 */}
      {highlightedLine && (
        <DraggablePanel
          id="lineDetail"
          defaultPosition={{ x: 340, y: 16 }}
          zIndex={panelZIndexes.lineDetail}
          onFocus={() => bringToFront('lineDetail')}
        >
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
        </DraggablePanel>
      )}

      {/* 点位详情卡片 */}
      {selectedPoint && (() => {
        const { nearbyStations, nearbyLandmarks } = getNearbyPoints(selectedPoint.coord);
        return (
          <DraggablePanel
            id="pointDetail"
            defaultPosition={{ x: 340, y: 16 }}
            zIndex={panelZIndexes.pointDetail}
            onFocus={() => bringToFront('pointDetail')}
          >
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
          </DraggablePanel>
        );
      })()}

      {/* 玩家详情卡片 */}
      {selectedPlayer && (() => {
        const playerCoord: Coordinate = { x: selectedPlayer.x, y: selectedPlayer.y, z: selectedPlayer.z };
        const { nearbyStations, nearbyLandmarks } = getNearbyPoints(playerCoord);
        return (
          <DraggablePanel
            id="playerDetail"
            defaultPosition={{ x: 340, y: 16 }}
            zIndex={panelZIndexes.playerDetail}
            onFocus={() => bringToFront('playerDetail')}
          >
            <PlayerDetailCard
              player={selectedPlayer}
              nearbyStations={nearbyStations}
              nearbyLandmarks={nearbyLandmarks}
              onClose={() => setSelectedPlayer(null)}
              onStationClick={handleStationClick}
              onLandmarkClick={handleLandmarkClick}
            />
          </DraggablePanel>
        );
      })()}

      {/* 右侧图层控制 - 手机端右下角版权上方，桌面端右上角 */}
      <div className="absolute bottom-8 right-2 sm:top-4 sm:bottom-auto sm:right-4 z-[1000]">
        <LayerControl
          showRailway={showRailway}
          showLandmark={showLandmark}
          showPlayers={showPlayers}
          dimBackground={dimBackground}
          mapStyle={mapStyle}
          onToggleRailway={setShowRailway}
          onToggleLandmark={setShowLandmark}
          onTogglePlayers={setShowPlayers}
          onToggleDimBackground={setDimBackground}
          onToggleMapStyle={setMapStyle}
        />
      </div>

      {/* 路径高亮图层 */}
{mapReady && leafletMapRef.current && projectionRef.current && hasRoute && routeHighlight && (
  <RouteHighlightLayer
    map={leafletMapRef.current}
    projection={projectionRef.current}
    route={routeHighlight}
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
