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
import type { ParsedStation, ParsedLine, Coordinate, Player } from '@/types';
import type { ParsedLandmark } from '@/lib/landmarkParser';

// 世界配置
const WORLDS = [
  { id: 'zth', name: '零洲', center: { x: -643, y: 35, z: -1562 } },
  { id: 'naraku', name: '奈落洲', center: { x: 0, y: 64, z: 0 } },
  { id: 'houtu', name: '后土洲', center: { x: 0, y: 64, z: 0 } }
];

// RMP 数据文件映射
const RMP_DATA_FILES: Record<string, string> = {
  zth: '/data/rmp_zth.json',
};

function MapContainer() {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const projectionRef = useRef<DynmapProjection | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [currentWorld, setCurrentWorld] = useState('zth');
  const [showRailway, setShowRailway] = useState(true);
  const [showLandmark, setShowLandmark] = useState(true);
  const [showPlayers, setShowPlayers] = useState(true);
  const [dimBackground, setDimBackground] = useState(false);
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
          const parsed = parseRMPData(rmpData);
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

    // 创建 Dynmap CRS
    const crs = createDynmapCRS(ZTH_FLAT_CONFIG);
    const projection = (crs as any).dynmapProjection as DynmapProjection;
    projectionRef.current = projection;

    // 计算初始中心点 - 优先使用零洲配置，否则退回第一个世界，避免 HMR/数据异常导致崩溃
    const world = WORLDS.find(w => w.id === 'zth') ?? WORLDS[0];
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

    // 添加缩放控件到右下角
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // 添加 Dynmap 瓦片图层
    const tileLayer = createDynmapTileLayer('zth', 'flat');
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
      <div className="absolute top-4 left-4 z-[1000] flex flex-col gap-2 max-w-[300px]">
        {/* 标题和世界切换 */}
        <div className="bg-white/90 px-4 py-2 rounded-lg shadow-lg">
          <h1 className="text-lg font-bold text-gray-800">RIA 铁路在线地图</h1>
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
      </div>

      {/* 右上角图层控制 */}
      <div className="absolute top-4 right-4 z-[1000]">
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

      {/* 玩家列表页面 */}
      {showPlayersPage && (
        <PlayersList
          worldId={currentWorld}
          onBack={() => setShowPlayersPage(false)}
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

      {/* 加载进度提示 */}
      <LoadingOverlay />
    </div>
  );
}

export default MapContainer;
