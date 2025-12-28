/**
 * 导航面板组件
 * - 旧版：调用 lib/pathfinding（铁路/传送/步行）
 * - 新增：铁路（新）模式
 *   - 起终点仍从「站点/地标/玩家」中选择（与原逻辑一致）
 *   - 但铁路（新）会：
 *     1) 调用 Navigation_Start：将起终点坐标映射到最近的 STB/SBP（优先 STB，找不到则 SBP）
 *     2) 调用 Navigation_Rail：在规则（Rule）铁路体系（STA/PLF/STB/SBP/RLE）上计算最短路/最少换乘
 *   - 输出结果：
 *     - 每个铁路段右侧独立开关展开“途经站”
 *     - 概览区以线路 color 分段展示（类似你提供的截图）
 *     - onRouteFound 仍保持传回 Array<{coord}>，但会额外挂载 styledSegments / stationMarkers（后续 MapContainer/RouteHighlightLayer 可直接复用）
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import {
  X,
  ArrowUpDown,
  Train,
  Home,
  Footprints,
  User,
  Zap,
  Clock,
  Rocket,
  Shield,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { ParsedStation, ParsedLine, Coordinate, Player, TravelMode } from '@/types';
import type { ParsedLandmark } from '@/lib/landmarkParser';
import {
  buildRailwayGraph,
  simplifyPath,
  findAutoPath,
  findRailOnlyPath,
  findWalkPath,
  calculateEstimatedTime,
  calculateElytraConsumption,
  calculateWalkTime,
  calculateRailTime,
  MultiModePathResult,
} from '@/lib/pathfinding';
import { findTeleportPath, extractToriiList } from '@/lib/toriiTeleport';


import { computeRailPlanFromCoords, type NavRailNewIntegratedPlan, type TransferType } from './Navigation_RailNewIntegrated';
import { listRailNewStaBuildingsForSearch, type RailNewStaBuildingSearchItem } from './Navigation_RailNewIntegrated';
import type { RouteHighlightData, RouteStyledSegment, RouteStationMarker } from '@/components/Map/RouteHighlightLayer';


// ---------------------------
// utils
// ---------------------------

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '-';
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}分${secs}秒` : `${mins}分钟`;
}

function formatArrivalTime(secondsFromNow: number): string {
  if (!Number.isFinite(secondsFromNow)) return '';
  const t = new Date(Date.now() + Math.max(0, secondsFromNow) * 1000);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}


// ---------------------------
// types
// ---------------------------

interface NavigationPanelProps {
  stations: ParsedStation[];
  lines: ParsedLine[];
  landmarks: ParsedLandmark[];
  players?: Player[];
  worldId: string;
  onRouteFound?: (route: RouteHighlightData | Array<{ coord: Coordinate }>) => void;
  onClose: () => void;
  onPointClick?: (coord: Coordinate) => void;
}

interface SearchItem {
  type: 'station' | 'landmark' | 'player' | 'StaBuilding';
  name: string;
  coord: Coordinate;

  // StaBuilding 专用（可选，但建议保留）
  staBuildingId?: string;
  staBuildingKind?: 'STB' | 'SBP';
}


// UI：在 TravelMode 的基础上增加 rail_new
type TravelModePanel = TravelMode | 'rail_new';

// 新铁路：最小化依赖的显示结构
type RailNewLegKind = 'access' | 'walk' | 'rail' | 'transfer';

interface RailNewLegBase {
  kind: RailNewLegKind;
}

interface RailNewWalkLeg extends RailNewLegBase {
  kind: 'access' | 'walk' | 'transfer';
  label: string;
  from: Coordinate;
  to: Coordinate;
  distance: number;
  timeSeconds: number;
  dashed?: boolean;
}

interface RailNewRailLeg extends RailNewLegBase {
  kind: 'rail';
  lineKey: string;
  lineName: string;
  color: string;
  fromStation: string;
  toStation: string;
  viaStations: string[];
  distance: number;
  timeSeconds: number;
  // 用于联络线“xxx/xxx/xxx”拼接显示
  lineNameChain?: string[];
}

type RailNewLeg = RailNewWalkLeg | RailNewRailLeg;

interface RailNewPlan {
  found: boolean;
  totalTimeSeconds: number;
  totalDistance: number;
  totalTransfers: number;
  legs: RailNewLeg[];
  // 可选：由 Navigation_Rail 返回的高亮数据
  routeHighlight?: {
    path?: Array<{ coord: Coordinate }>;
    styledSegments?: unknown[];
    stationMarkers?: unknown[];
  };
}

// 让 onRouteFound 仍传 Array<{coord}>，但在数组对象上挂载更多字段。
export type RoutePathV2 = Array<{ coord: Coordinate }> & {
  styledSegments?: unknown[];
  stationMarkers?: unknown[];
};

// ---------------------------
// Mode config
// ---------------------------

const TRAVEL_MODES: Array<{ mode: TravelModePanel; label: string; icon: typeof Train }> = [
  { mode: 'rail_new', label: '铁路(新)', icon: Train },
  { mode: 'rail', label: '铁路', icon: Train },
  { mode: 'teleport', label: '传送', icon: Zap },
  { mode: 'walk', label: '步行', icon: Footprints },
];

// 新铁路：可调整参数（默认值可按你的需要随时改）
const DEFAULT_RAIL_NEW_CONFIG = {
  // 站内换乘步行速度（m/s）
  transferWalkSpeed: 3.0,
  // 铁路乘坐速度（m/s）
  railRideSpeed: 16.0,
  // 站内换乘成本阈值：距离 cost = dist / factor（你此前要求的“十分之一权重”本质等价）
  transferCostFactor: 1.0,
  // 正常站台同台换乘成本（用于让联络线连接节点优先）
  normalPlatformTransferCost: 5.0,
};

// ---------------------------
// Search input
// ---------------------------

interface PointSearchInputProps {
  value: SearchItem | null;
  onChange: (item: SearchItem | null) => void;
  items: SearchItem[];
  placeholder: string;
  label: string;
}

function PointSearchInput({ value, onChange, items, placeholder, label }: PointSearchInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(value?.name || '');
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredItems = useMemo(() => {
    if (query.length === 0) return [];
    const q = query.toLowerCase();
    return items.filter((item) => item.name.toLowerCase().includes(q)).slice(0, 10);
  }, [query, items]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setQuery(value?.name || '');
  }, [value]);

  const handleSelect = (item: SearchItem) => {
    setQuery(item.name);
    onChange(item);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <label className="text-xs text-gray-500 mb-1 block">{label}</label>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
          const match = items.find((item) => item.name === e.target.value);
          onChange(match || null);
        }}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border rounded text-sm outline-none focus:border-blue-400"
      />

      {isOpen && filteredItems.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg max-h-48 overflow-y-auto z-50 border">
          {filteredItems.map((item, idx) => (
            <button
              key={`${item.type}-${item.name}-${idx}`}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 border-b border-gray-50 last:border-b-0 flex items-center gap-2"
              onClick={() => handleSelect(item)}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center ${
                  item.type === 'station'
                    ? 'bg-blue-500 text-white'
                    : item.type === 'player'
                      ? 'bg-cyan-500 text-white'
                        : item.type === 'StaBuilding'
                        ? 'bg-purple-500 text-white'
                        : 'bg-orange-500 text-white'
                }`}
              >
                {item.type === 'station' ? (
                  <Train className="w-3 h-3" />
                ) : item.type === 'player' ? (
                  <User className="w-3 h-3" />
                ) : item.type === 'StaBuilding' ? (
                  <Shield className="w-3 h-3" />
                ) : (
                  <Home className="w-3 h-3" />
                )}

              </span>
              <span>{item.name}</span>
              <span className="text-xs text-gray-400 ml-auto">
                {item.type === 'station' ? '站点' : item.type === 'player' ? '玩家' : item.type === 'StaBuilding' ? '站体' : '地标'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// [修改 3] 替换整个 “New Rail: adapters” 区块
// 位置：从
//   // ---------------------------
//   // New Rail: adapters
//   // ---------------------------
// 到 callNavRailPlan(...) 结束
// 全部删掉，并替换为下面这一段（helper 只负责：label + 组装 RailNewPlan + 组装 RouteHighlightData）

function transferTypeLabel(t: TransferType): string {
  switch (t) {
    case 'stationTransfer':
      return '站内换乘';
    case 'samePlatformTransfer':
      return '同台换乘';
    case 'throughRun':
      return '直通运行';
    case 'mergeMainline':
      return '并入主线';
    case 'leaveMainline':
      return '并出主线';
    case 'enterConnector':
      return '驶入联络线';
    default:
      return '换乘';
  }
}

function buildRouteHighlightFromIntegrated(raw: NavRailNewIntegratedPlan, startCoord: Coordinate, endCoord: Coordinate, useElytra: boolean): RouteHighlightData | null {
  const styledSegments: RouteStyledSegment[] = [];
  const stationMarkers: RouteStationMarker[] = [];

  const startB = raw.startResolvedBuilding?.point;
  const endB = raw.endResolvedBuilding?.point;

  const startD = raw.access?.startToBuildingDistance ?? raw.startResolvedBuilding?.distanceToInput ?? 0;
  const endD = raw.access?.endToBuildingDistance ?? raw.endResolvedBuilding?.distanceToInput ?? 0;

  // 接驳段（作为 access 虚线）
  if (startB && startD > 0.01) {
    styledSegments.push({
      kind: 'access',
      coords: [startCoord, startB],
      dashed: true,
      color: '#22c55e',
      tooltip: useElytra ? '鞘翅接驳' : '步行接驳',
    });
  }
  if (endB && endD > 0.01) {
    styledSegments.push({
      kind: 'access',
      coords: [endB, endCoord],
      dashed: true,
      color: '#22c55e',
      tooltip: useElytra ? '鞘翅接驳' : '步行接驳',
    });
  }

  // 铁路/换乘 overlay（颜色来自 RLE.color）
  for (const seg of raw.overlay?.segments ?? []) {
    styledSegments.push({
      kind: seg.kind === 'rail' ? 'rail' : 'transfer',
      coords: seg.coords,
      color: seg.color,
      dashed: !!(seg as any).dashed,
      tooltip: seg.kind === 'rail' ? seg.lineName : transferTypeLabel((seg as any).transferType),
    });
  }

  // markers（可选：起终点 + 站体点）
  stationMarkers.push({ kind: 'start', coord: startCoord, label: '起点', color: '#2563eb', radius: 6 });
  stationMarkers.push({ kind: 'end', coord: endCoord, label: '终点', color: '#ef4444', radius: 6 });

  if (raw.startResolvedBuilding?.point) {
    stationMarkers.push({
      kind: 'station',
      coord: raw.startResolvedBuilding.point,
      label: raw.startResolvedBuilding.name,
      color: '#10b981',
      radius: 5,
    });
  }
  if (raw.endResolvedBuilding?.point) {
    stationMarkers.push({
      kind: 'station',
      coord: raw.endResolvedBuilding.point,
      label: raw.endResolvedBuilding.name,
      color: '#10b981',
      radius: 5,
    });
  }

  if (styledSegments.length === 0) return null;

  return {
    styledSegments,
    stationMarkers,
    startCoord,
    endCoord,
    startLabel: '起点',
    endLabel: '终点',
  };
}

function buildRailNewPlanFromIntegrated(raw: NavRailNewIntegratedPlan, startCoord: Coordinate, endCoord: Coordinate, useElytra: boolean): RailNewPlan {
  if (!raw.ok) {
    return { found: false, totalTimeSeconds: 0, totalDistance: 0, totalTransfers: 0, legs: [] };
  }

  const startB = raw.startResolvedBuilding?.point;
  const endB = raw.endResolvedBuilding?.point;

  const startD = raw.access?.startToBuildingDistance ?? raw.startResolvedBuilding?.distanceToInput ?? 0;
  const endD = raw.access?.endToBuildingDistance ?? raw.endResolvedBuilding?.distanceToInput ?? 0;

  const legs: RailNewLeg[] = [];

  // 起点接驳
  if (startB && startD > 0.01) {
    legs.push({
      kind: 'access',
      label: useElytra ? '鞘翅接驳' : '步行接驳',
      from: startCoord,
      to: startB,
      distance: startD,
      timeSeconds: calculateWalkTime(startD, useElytra),
      dashed: true,
    });
  }

  // overlay 中 transfer 段用来补齐 transfer leg 的 from/to
  const transferOverlays = (raw.overlay?.segments ?? []).filter((s) => s.kind === 'transfer') as any[];
  let ti = 0;

  for (const seg of raw.segments ?? []) {
    if (seg.kind === 'rail') {
      const first = seg.lines?.[0];
      legs.push({
        kind: 'rail',
        lineKey: seg.lines.map((l) => `${l.lineId}:${l.direction}`).join('|'),
        lineName: first?.lineName ?? '线路',
        color: first?.color ?? '#3b82f6',
        fromStation: seg.fromStation,
        toStation: seg.toStation,
        viaStations: seg.viaStations ?? [],
        distance: seg.distance ?? 0,
        timeSeconds: seg.timeSeconds ?? 0,
        lineNameChain: seg.lines?.length > 1 ? seg.lines.map((l) => l.lineName) : undefined,
      });
    } else if (seg.kind === 'transfer') {
      const ov = transferOverlays[ti++];
      const coords: Coordinate[] | undefined = Array.isArray(ov?.coords) ? ov.coords : undefined;
      const from = coords?.[0] ?? startB ?? startCoord;
      const to = coords?.[coords.length - 1] ?? endB ?? endCoord;

      legs.push({
        kind: 'transfer',
        label: transferTypeLabel(seg.transferType),
        from,
        to,
        distance: seg.distance ?? 0,
        timeSeconds: seg.timeSeconds ?? 0,
        dashed: true,
      });
    }
  }

  // 终点接驳
  if (endB && endD > 0.01) {
    legs.push({
      kind: 'access',
      label: useElytra ? '鞘翅接驳' : '步行接驳',
      from: endB,
      to: endCoord,
      distance: endD,
      timeSeconds: calculateWalkTime(endD, useElytra),
      dashed: true,
    });
  }

  const totalTimeSeconds =
    (raw.totalTimeSeconds ?? 0) +
    (startD > 0.01 ? calculateWalkTime(startD, useElytra) : 0) +
    (endD > 0.01 ? calculateWalkTime(endD, useElytra) : 0);

  const totalDistance = (raw.totalDistance ?? 0) + startD + endD;

  return {
    found: true,
    totalTimeSeconds,
    totalDistance,
    totalTransfers: raw.transferCount ?? 0,
    legs,
  };
}





// ---------------------------
// Component
// ---------------------------

export function NavigationPanel({
  stations,
  lines,
  landmarks,
  players = [],
  worldId,
  onRouteFound,
  onClose,
  onPointClick,
}: NavigationPanelProps) {
  const [startPoint, setStartPoint] = useState<SearchItem | null>(null);
  const [endPoint, setEndPoint] = useState<SearchItem | null>(null);
  const [travelMode, setTravelMode] = useState<TravelModePanel>('rail');
  const [preferLessTransfer, setPreferLessTransfer] = useState(true);
  const [useElytra, setUseElytra] = useState(true);

  const [resultLegacy, setResultLegacy] = useState<MultiModePathResult | null>(null);
  const [resultRailNew, setResultRailNew] = useState<RailNewPlan | null>(null);
  const [searching, setSearching] = useState(false);

  const [railNewStaBuildingItems, setRailNewStaBuildingItems] = useState<SearchItem[]>([]);

useEffect(() => {
  let alive = true;

  (async () => {
    try {
      const buildings: RailNewStaBuildingSearchItem[] = await listRailNewStaBuildingsForSearch({ worldId });

      if (!alive) return;

      // 去重：同名优先 STB（中点）；没有 STB 则用 SBP
      const byName = new Map<string, RailNewStaBuildingSearchItem>();
      for (const b of buildings) {
        const key = b.name || b.id;
        const prev = byName.get(key);
        if (!prev) byName.set(key, b);
        else if (prev.kind !== 'STB' && b.kind === 'STB') byName.set(key, b);
      }

      const items: SearchItem[] = [];
      for (const b of byName.values()) {
        items.push({
          type: 'StaBuilding',
          name: b.name,
          coord: b.coord,
          staBuildingId: b.id,
          staBuildingKind: b.kind,
        });
      }

      items.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
      setRailNewStaBuildingItems(items);
    } catch (err) {
      console.error('[rail_new] listRailNewStaBuildingsForSearch failed', err);
      if (alive) setRailNewStaBuildingItems([]);
    }

  })();

  return () => {
    alive = false;
  };
}, [worldId]);


  // rail_new：每段展开状态
  const [expandedRailLegs, setExpandedRailLegs] = useState<Record<string, boolean>>({});

  const formatLineName = (lineId: string): string => {
    const line = lines.find((l) => l.lineId === lineId);
    if (line) return line.bureau === 'RMP' ? line.line : `${line.bureau}-${line.line}`;
    return lineId;
  };

  const searchItems = useMemo(() => {
    const items: SearchItem[] = [];

    // 站点（去重 name）
    const stationNames = new Set<string>();
    for (const station of stations) {
      if (!stationNames.has(station.name)) {
        stationNames.add(station.name);
        items.push({ type: 'station', name: station.name, coord: station.coord });
      }
    }

    // 地标
    for (const landmark of landmarks) {
      if (landmark.coord) items.push({ type: 'landmark', name: landmark.name, coord: landmark.coord });
    }

    // 玩家
    for (const player of players) {
      items.push({
        type: 'player',
        name: player.name,
        coord: { x: player.x, y: player.y, z: player.z },
      });
    }

    for (const b of railNewStaBuildingItems) items.push(b);

    return items;
  }, [stations, landmarks, players, railNewStaBuildingItems]);

  const railwayGraph = useMemo(() => buildRailwayGraph(lines), [lines]);
  const toriiList = useMemo(() => extractToriiList(landmarks), [landmarks]);

  // 交换起终点
  const handleSwap = () => {
    const temp = startPoint;
    setStartPoint(endPoint);
    setEndPoint(temp);
    setResultLegacy(null);
    setResultRailNew(null);
  };

  // 新铁路：展开/收起途经站
  const toggleRailLegExpand = (key: string) => {
    setExpandedRailLegs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // 搜索
  const handleSearch = async () => {
    if (!startPoint || !endPoint) return;

    const isSameLocation = startPoint.coord.x === endPoint.coord.x && startPoint.coord.z === endPoint.coord.z;
    if (isSameLocation) {
      setResultLegacy({
        found: false,
        mode: 'walk',
        segments: [],
        totalWalkDistance: 0,
        totalRailDistance: 0,
        totalTransfers: 0,
        teleportCount: 0,
        reverseTeleportCount: 0,
      });
      setResultRailNew({ found: false, totalTimeSeconds: 0, totalDistance: 0, totalTransfers: 0, legs: [] });
      return;
    }

    setSearching(true);

    try {
// [修改 4] handleSearch() 里 rail_new 分支：整段替换
// 位置：if (travelMode === 'rail_new') { ... } 这一整段
// 用下面替换掉原来的 “callNavStartNearestBuildings + callNavRailPlan + 数组挂载 styledSegments” 的实现

if (travelMode === 'rail_new') {
  const raw = await computeRailPlanFromCoords({
    worldId,
    startCoord: startPoint.coord,
    endCoord: endPoint.coord,
    mode: preferLessTransfer ? 'transfers' : 'time',

    // 参数映射：保持你原 UI config 不动
    transferWalkSpeed: DEFAULT_RAIL_NEW_CONFIG.transferWalkSpeed,
    railSpeed: DEFAULT_RAIL_NEW_CONFIG.railRideSpeed,
    stationTransferCostDivisor: DEFAULT_RAIL_NEW_CONFIG.transferCostFactor,
    normalSamePlatformTransferCost: DEFAULT_RAIL_NEW_CONFIG.normalPlatformTransferCost,
  });

  const plan = buildRailNewPlanFromIntegrated(raw, startPoint.coord, endPoint.coord, useElytra);

  setResultRailNew(plan);
  setResultLegacy(null);

  // 通知地图高亮：务必传 RouteHighlightData（不要再传 Array，否则 MapContainer 会归一化为 generic）
  if (onRouteFound && raw.ok) {
    const rh = buildRouteHighlightFromIntegrated(raw, startPoint.coord, endPoint.coord, useElytra);
    if (rh) onRouteFound(rh);
  }

  return;
}


      // ---------------------------
      // legacy pathfinding
      // ---------------------------

      let pathResult: MultiModePathResult;

      switch (travelMode) {
        case 'walk':
          pathResult = findWalkPath(startPoint.coord, endPoint.coord);
          break;

        case 'teleport': {
          const teleportPath = findTeleportPath(startPoint.coord, endPoint.coord, toriiList, worldId);
          let reverseTeleportCount = 0;
          const teleportSegments = teleportPath.segments.map((seg) => {
            if (seg.type === 'teleport' && seg.torii) {
              const isReverse = seg.destinationName === seg.torii.name;
              if (isReverse) reverseTeleportCount++;
              return {
                type: 'teleport' as const,
                torii: seg.torii,
                destination: seg.to,
                destinationName: seg.destinationName || '传送点',
                isReverse,
              };
            }
            return { type: 'walk' as const, from: seg.from, to: seg.to, distance: seg.distance };
          });
          pathResult = {
            found: teleportPath.found,
            mode: 'teleport',
            segments: teleportSegments,
            totalWalkDistance: teleportPath.totalWalkDistance,
            totalRailDistance: 0,
            totalTransfers: 0,
            teleportCount: teleportPath.teleportCount - reverseTeleportCount,
            reverseTeleportCount,
          };
          break;
        }

        case 'rail':
          pathResult = findRailOnlyPath(startPoint.coord, endPoint.coord, railwayGraph, stations, preferLessTransfer);
          break;

        case 'auto':
        default:
          pathResult = findAutoPath(startPoint.coord, endPoint.coord, railwayGraph, landmarks, stations, worldId, preferLessTransfer);
          break;
      }

      setResultLegacy(pathResult);
      setResultRailNew(null);

      if (onRouteFound && pathResult.found) {
        const path: Array<{ coord: Coordinate }> = [];
        for (const segment of pathResult.segments) {
          if (segment.type === 'walk') {
            path.push({ coord: segment.from });
            path.push({ coord: segment.to });
          } else if (segment.type === 'rail') {
            for (const node of segment.railPath.path) path.push({ coord: node.coord });
          } else if (segment.type === 'teleport') {
            path.push({ coord: segment.torii.coord });
            path.push({ coord: segment.destination });
          }
        }
        onRouteFound(path);
      }
    } finally {
      setSearching(false);
    }
  };

  // ---------------------------
  // Render
  // ---------------------------

  const hasResult = !!(resultLegacy || resultRailNew);

  return (
    <div className="bg-white rounded-lg shadow-lg w-full sm:w-72 max-h-[60vh] sm:max-h-[70vh] flex flex-col">
      {/* 标题 */}
      <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
        <h3 className="font-bold text-gray-800">路径规划</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* 模式选择 */}
      <div className="flex border-b">
        {TRAVEL_MODES.map(({ mode, label, icon: Icon }) => (
          <button
            key={mode}
            className={`flex-1 py-2 px-1 flex flex-col items-center gap-0.5 text-xs transition-colors ${
              travelMode === mode
                ? 'text-blue-600 border-b-2 border-blue-500 bg-blue-50'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
            onClick={() => {
              setTravelMode(mode);
              setResultLegacy(null);
              setResultRailNew(null);
            }}
          >
            <Icon className="w-4 h-4" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* 输入区域 */}
      <div className="p-3 border-b">
        <div className="flex items-start gap-2 mb-2">
          <div className="flex-1">
            <PointSearchInput
              value={startPoint}
              onChange={(v) => {
                setStartPoint(v);
                setResultLegacy(null);
                setResultRailNew(null);
              }}
              items={searchItems}
              placeholder="输入起点（站点/地标）..."
              label="起点"
            />
          </div>
          <button
            onClick={handleSwap}
            className="mt-6 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
            title="交换起终点"
          >
            <ArrowUpDown className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-2">
          <PointSearchInput
            value={endPoint}
            onChange={(v) => {
              setEndPoint(v);
              setResultLegacy(null);
              setResultRailNew(null);
            }}
            items={searchItems}
            placeholder="输入终点（站点/地标）..."
            label="终点"
          />
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            {(travelMode === 'rail' || travelMode === 'auto' || travelMode === 'rail_new') && (
              <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={preferLessTransfer}
                  onChange={(e) => {
                    setPreferLessTransfer(e.target.checked);
                    setResultLegacy(null);
                    setResultRailNew(null);
                  }}
                  className="w-3 h-3"
                />
                <span className="text-gray-600">少换乘</span>
              </label>
            )}

            <label className="flex items-center gap-1.5 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={useElytra}
                onChange={(e) => {
                  setUseElytra(e.target.checked);
                  setResultLegacy(null);
                  setResultRailNew(null);
                }}
                className="w-3 h-3"
              />
              <span className="text-gray-600">鞘翅</span>
            </label>
          </div>

          <button
            onClick={() => void handleSearch()}
            disabled={!startPoint || !endPoint || searching}
            className="px-4 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-xs font-medium"
          >
            {searching ? '搜索中...' : '搜索'}
          </button>
        </div>
      </div>

      {/* 结果区域 */}
      {hasResult && (
        <div className="flex-1 overflow-y-auto p-3">
          {/* 新铁路结果 */}
          {travelMode === 'rail_new' && resultRailNew && (
            <>
              {resultRailNew.found ? (
                <>
                  {/* 概览（截图风格简化版） */}
                  <div className="bg-gray-50 rounded-lg p-3 mb-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-800">铁路（新）</div>
                      <div className="text-xs text-gray-500">
                        到达时间 <span className="font-medium text-gray-800">{formatArrivalTime(resultRailNew.totalTimeSeconds)}</span>
                      </div>
                    </div>

                    {/* 线路 pills */}
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {resultRailNew.legs
                        .filter((l) => l.kind === 'rail')
                        .map((l, idx) => {
                          const leg = l as RailNewRailLeg;
                          return (
                            <div
                              key={`pill-${idx}`}
                              className="px-3 py-1 rounded text-xs font-medium text-white"
                              style={{ backgroundColor: leg.color || '#3b82f6' }}
                              title={leg.lineKey}
                            >
                              {leg.lineNameChain?.length ? leg.lineNameChain.join('/') : leg.lineName}
                            </div>
                          );
                        })}
                    </div>

                    <div className="mt-2 text-xs text-gray-600">
                      全程约 <span className="font-medium text-gray-800">{formatTime(resultRailNew.totalTimeSeconds)}</span>
                      {resultRailNew.totalTransfers > 0 && (
                        <span className="ml-3">换乘 <span className="font-medium text-blue-600">{resultRailNew.totalTransfers}</span> 次</span>
                      )}
                    </div>
                  </div>

                  {/* 详情 timeline */}
                  <div className="space-y-2">
                    {resultRailNew.legs.map((leg, index) => {
                      if (leg.kind === 'rail') {
                        const k = `${index}`;
                        const expanded = !!expandedRailLegs[k];
                        const displayLineName = leg.lineNameChain?.length ? leg.lineNameChain.join('/') : leg.lineName;
                        const stationsList = leg.viaStations?.length ? leg.viaStations : [leg.fromStation, leg.toStation].filter(Boolean);
                        const isConnectorLeg = leg.lineKey
                        .split('|')
                        .map((s) => s.trim())
                        .filter(Boolean)
                        .every((k) => k.endsWith(':4'));
                        const first = stationsList[0] || leg.fromStation;
                        const last = stationsList[stationsList.length - 1] || leg.toStation;
                        const mid = stationsList.slice(1, Math.max(1, stationsList.length - 1));

                        return (
                          <div key={`rail-leg-${index}`} className="relative pl-5">
                            {index < resultRailNew.legs.length - 1 && (
                              <div
                                className="absolute left-[7px] top-5 bottom-0 w-0.5"
                                style={{ backgroundColor: leg.color || '#3b82f6' }}
                              />
                            )}
                            <div
                              className="absolute left-0 top-0.5 w-4 h-4 rounded-full text-white flex items-center justify-center"
                              style={{ backgroundColor: leg.color || '#3b82f6' }}
                            >
                              <Train className="w-2.5 h-2.5" />
                            </div>

                            <div className="rounded p-2 border" style={{ borderColor: `${leg.color || '#3b82f6'}55` }}>
                              <div className="flex items-start gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="text-[10px] font-medium mb-0.5" style={{ color: leg.color || '#3b82f6' }}>
                                    {displayLineName}
                                    <span className="text-gray-400 ml-1">({formatTime(leg.timeSeconds)})</span>
                                  </div>
                                  {!isConnectorLeg && (
  <div className="text-xs text-gray-800 truncate">
    <span className="font-medium">{first}</span>
    {stationsList.length > 2 ? (
      <span className="text-gray-400 mx-1">→ {stationsList.length - 2}站 →</span>
    ) : (
      <span className="text-gray-400 mx-1">→</span>
    )}
    <span className="font-medium">{last}</span>
  </div>
)}
                                </div>

                                {!isConnectorLeg && (
  <button
    className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-800 flex-shrink-0"
    onClick={() => toggleRailLegExpand(k)}
    title="展开/收起途经站"
  >
    <span>途经</span>
    {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
  </button>
)}
                              </div>

                              {!isConnectorLeg && expanded && mid.length > 0 && (
  <div className="mt-2 flex flex-wrap gap-1">
    {mid.map((s, i) => (
      <span
        key={`${k}-mid-${i}`}
        className="px-2 py-0.5 rounded text-[10px] text-white"
        style={{ backgroundColor: leg.color || '#3b82f6' }}
      >
        {s}
      </span>
    ))}
  </div>
)}
                            </div>
                          </div>
                        );
                      }

                      // walk/access/transfer（接驳段也显示）
                      const icon = leg.kind === 'transfer' ? ChevronRight : Footprints;
                      const Icon = icon;
                      const bg = leg.kind === 'transfer' ? 'bg-gray-50' : 'bg-green-50';
                      const fg = leg.kind === 'transfer' ? 'text-gray-600' : 'text-green-600';

                      return (
                        <div key={`walk-leg-${index}`} className="relative pl-5">
                          {index < resultRailNew.legs.length - 1 && (
                            <div
                              className={`absolute left-[7px] top-5 bottom-0 w-0.5 ${leg.dashed ? 'bg-transparent' : 'bg-gray-200'}`}
                              style={leg.dashed ? { borderLeft: '2px dashed #cbd5e1' } : undefined}
                            />
                          )}
                          <div className={`absolute left-0 top-0.5 w-4 h-4 rounded-full text-white flex items-center justify-center ${leg.kind === 'transfer' ? 'bg-gray-500' : 'bg-green-500'}`}>
                            <Icon className="w-2.5 h-2.5" />
                          </div>

                          <div className={`${bg} rounded p-2`}>
                            <div className={`text-[10px] ${fg} font-medium mb-0.5`}>
                              {leg.label} {Math.round(leg.distance)}m
                              <span className="text-gray-400 ml-1">({formatTime(leg.timeSeconds)})</span>
                            </div>
                            {leg.kind !== 'transfer' && (
  <div className="text-xs text-gray-800">
    <button className="hover:underline" onClick={() => onPointClick?.(leg.from)}>
      ({Math.round(leg.from.x)}, {Math.round(leg.from.z)})
    </button>
    <span className="text-gray-400 mx-1">→</span>
    <button className="hover:underline" onClick={() => onPointClick?.(leg.to)}>
      ({Math.round(leg.to.x)}, {Math.round(leg.to.z)})
    </button>
  </div>
)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="text-center text-gray-500 py-4 text-sm">
                  {startPoint?.coord.x === endPoint?.coord.x && startPoint?.coord.z === endPoint?.coord.z
                    ? '起点和终点相同'
                    : '未找到可用路线（请检查：站台 Situation/Available、线路方向、换乘归属 STB/SBP 等）'}
                </div>
              )}
            </>
          )}

          {/* 旧模式结果 */}
          {travelMode !== 'rail_new' && resultLegacy && (
            <>
              {resultLegacy.found ? (
                <>
                  <div className="flex items-center gap-3 mb-3 text-xs flex-wrap">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-gray-400" />
                      <span className="text-gray-500">预计:</span>
                      <span className="font-medium text-orange-600">{formatTime(calculateEstimatedTime(resultLegacy, useElytra))}</span>
                    </div>
                    {resultLegacy.totalTransfers > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-gray-500">换乘:</span>
                        <span className="font-medium text-blue-600">{resultLegacy.totalTransfers}次</span>
                      </div>
                    )}
                    {resultLegacy.teleportCount > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-gray-500">传送:</span>
                        <span className="font-medium text-purple-600">{resultLegacy.teleportCount}次</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500">{useElytra ? '飞行' : '步行'}:</span>
                      <span className="font-medium">{Math.round(resultLegacy.totalWalkDistance)}m</span>
                    </div>
                    {resultLegacy.totalRailDistance > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-gray-500">铁路:</span>
                        <span className="font-medium">{Math.round(resultLegacy.totalRailDistance)}m</span>
                      </div>
                    )}
                  </div>

                  {useElytra && resultLegacy.totalWalkDistance > 0 && (() => {
                    const consumption = calculateElytraConsumption(resultLegacy.totalWalkDistance);
                    return (
                      <div className="bg-amber-50 rounded p-2 mb-3 text-xs">
                        <div className="flex items-center gap-1 mb-1 text-amber-700 font-medium">
                          <Rocket className="w-3 h-3" />
                          <span>鞘翅飞行消耗</span>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap text-gray-600">
                          <div className="flex items-center gap-1">
                            <Rocket className="w-3 h-3 text-red-500" />
                            <span>烟花: </span>
                            <span className="font-medium text-red-600">~{consumption.fireworksUsed}个</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Shield className="w-3 h-3 text-cyan-500" />
                            <span>耐久: </span>
                            <span className="font-medium text-cyan-600">{Math.round((consumption.durabilityUsed / 432) * 100)}%</span>
                            <span className="text-gray-400">({Math.round((consumption.durabilityUsedUnbreaking / 432) * 100)}% 耐久III)</span>
                          </div>
                        </div>
                        {consumption.elytraCount > 1 && (
                          <div className="mt-1 text-amber-600">⚠️ 需要 {consumption.elytraCount} 个鞘翅（或 {consumption.elytraCountUnbreaking} 个耐久III鞘翅）</div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="space-y-2">
                    {resultLegacy.segments.map((segment, index) => {
                      if (segment.type === 'walk') {
                        const walkTime = calculateWalkTime(segment.distance, useElytra);
                        return (
                          <div key={index} className="relative pl-5">
                            {index < resultLegacy.segments.length - 1 && (
                              <div className="absolute left-[7px] top-5 bottom-0 w-0.5 bg-gray-200" />
                            )}
                            <div className="absolute left-0 top-0.5 w-4 h-4 rounded-full bg-green-500 text-white flex items-center justify-center">
                              <Footprints className="w-2.5 h-2.5" />
                            </div>
                            <div className="bg-green-50 rounded p-2">
                              <div className="text-[10px] text-green-600 font-medium mb-0.5">
                                {useElytra ? '飞行' : '步行'} {Math.round(segment.distance)}m
                                <span className="text-gray-400 ml-1">({formatTime(walkTime)})</span>
                              </div>
                              <div className="text-xs text-gray-800">
                                <button className="text-green-700 hover:underline" onClick={() => onPointClick?.(segment.from)}>
                                  ({Math.round(segment.from.x)}, {Math.round(segment.from.z)})
                                </button>
                                <span className="text-gray-400 mx-1">→</span>
                                <button className="text-green-700 hover:underline" onClick={() => onPointClick?.(segment.to)}>
                                  ({Math.round(segment.to.x)}, {Math.round(segment.to.z)})
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      if (segment.type === 'teleport') {
                        const isReverseTP = segment.isReverse || segment.destinationName === segment.torii.name;
                        const toriiLabel = `#${segment.torii.id} ${segment.torii.name}`;

                        let fromName: string;
                        let toName: string;

                        if (isReverseTP) {
                          const prevSegment = index > 0 ? resultLegacy.segments[index - 1] : null;
                          if (prevSegment?.type === 'teleport') fromName = prevSegment.destinationName;
                          else fromName = segment.destinationName !== segment.torii.name ? segment.destinationName : '中转点';
                          toName = toriiLabel;
                        } else {
                          fromName = `任意位置 (${toriiLabel})`;
                          toName = segment.destinationName;
                        }

                        return (
                          <div key={index} className="relative pl-5">
                            {index < resultLegacy.segments.length - 1 && (
                              <div className="absolute left-[7px] top-5 bottom-0 w-0.5 bg-gray-200" />
                            )}
                            <div className="absolute left-0 top-0.5 w-4 h-4 rounded-full bg-purple-500 text-white flex items-center justify-center">
                              <Zap className="w-2.5 h-2.5" />
                            </div>
                            <div className="bg-purple-50 rounded p-2">
                              <div className="text-[10px] text-purple-600 font-medium mb-0.5">
                                传送 → {toName}
                                {isReverseTP && <span className="text-gray-400 ml-1">(+30秒)</span>}
                              </div>
                              <div className="text-xs text-gray-800">
                                <button
                                  className="text-purple-700 hover:underline"
                                  onClick={() => onPointClick?.(isReverseTP ? segment.destination : segment.torii.coord)}
                                >
                                  {fromName}
                                </button>
                                <span className="text-gray-400 mx-1">→</span>
                                <button
                                  className="text-purple-700 hover:underline"
                                  onClick={() => onPointClick?.(isReverseTP ? segment.torii.coord : segment.destination)}
                                >
                                  {toName}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      if (segment.type === 'rail') {
                        const railSegments = simplifyPath(segment.railPath.path);
                        const totalRailDist = segment.railPath.totalDistance;
                        const avgDistPerSeg = railSegments.length > 0 ? totalRailDist / railSegments.length : 0;

                        return railSegments.map((railSeg, railIndex) => {
                          const segDist = Math.sqrt(
                            Math.pow(railSeg.endCoord.x - railSeg.startCoord.x, 2) + Math.pow(railSeg.endCoord.z - railSeg.startCoord.z, 2)
                          );
                          const segTime = calculateRailTime(segDist || avgDistPerSeg);

                          return (
                            <div key={`${index}-${railIndex}`} className="relative pl-5">
                              {(railIndex < railSegments.length - 1 || index < resultLegacy.segments.length - 1) && (
                                <div className="absolute left-[7px] top-5 bottom-0 w-0.5 bg-gray-200" />
                              )}
                              <div className="absolute left-0 top-0.5 w-4 h-4 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center">
                                <Train className="w-2.5 h-2.5" />
                              </div>
                              <div className="bg-blue-50 rounded p-2">
                                <div className="text-[10px] text-blue-600 font-medium mb-0.5">
                                  {formatLineName(railSeg.lineId)}
                                  <span className="text-gray-400 ml-1">({formatTime(segTime)})</span>
                                </div>
                                <div className="text-xs text-gray-800">
                                  <button className="hover:underline hover:text-blue-600" onClick={() => onPointClick?.(railSeg.startCoord)}>
                                    {railSeg.stations[0]}
                                  </button>
                                  {railSeg.stations.length > 2 && (
                                    <span className="text-gray-400 mx-1">→ {railSeg.stations.length - 2}站 →</span>
                                  )}
                                  {railSeg.stations.length === 2 && <span className="text-gray-400 mx-1">→</span>}
                                  {railSeg.stations.length > 1 && (
                                    <button className="hover:underline hover:text-blue-600" onClick={() => onPointClick?.(railSeg.endCoord)}>
                                      {railSeg.stations[railSeg.stations.length - 1]}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        });
                      }

                      return null;
                    })}
                  </div>
                </>
              ) : (
                <div className="text-center text-gray-500 py-4 text-sm">
                  {startPoint?.coord.x === endPoint?.coord.x && startPoint?.coord.z === endPoint?.coord.z
                    ? '起点和终点相同'
                    : '未找到可用路线'}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default NavigationPanel;
