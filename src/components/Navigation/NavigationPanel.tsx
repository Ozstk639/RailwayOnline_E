/**
 * 导航面板组件
 * 提供起终点搜索和路径规划功能
 * 支持站点和地标作为起终点
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { X, ArrowUpDown, Train, Home, Footprints, User } from 'lucide-react';
import type { ParsedStation, ParsedLine, Coordinate, Player } from '@/types';
import type { ParsedLandmark } from '@/lib/landmarkParser';
import { buildRailwayGraph, findShortestPath, simplifyPath, PathResult } from '@/lib/pathfinding';

interface NavigationPanelProps {
  stations: ParsedStation[];
  lines: ParsedLine[];
  landmarks: ParsedLandmark[];
  players?: Player[];  // 在线玩家列表
  onRouteFound?: (path: Array<{ coord: Coordinate }>) => void;
  onClose: () => void;
  onPointClick?: (coord: Coordinate) => void;  // 点击起点/终点跳转
}

// 搜索项类型
interface SearchItem {
  type: 'station' | 'landmark' | 'player';
  name: string;
  coord: Coordinate;
}

// 计算两点间距离
function getDistance(a: Coordinate, b: Coordinate): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// 找到最近的站点
function findNearestStation(
  coord: Coordinate,
  stations: ParsedStation[]
): ParsedStation | null {
  if (stations.length === 0) return null;

  let nearest = stations[0];
  let minDist = getDistance(coord, stations[0].coord);

  for (const station of stations) {
    const dist = getDistance(coord, station.coord);
    if (dist < minDist) {
      minDist = dist;
      nearest = station;
    }
  }

  return nearest;
}

// 搜索输入组件
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

  // 过滤匹配的项目
  const filteredItems = useMemo(() => {
    if (query.length === 0) return [];
    const q = query.toLowerCase();
    return items
      .filter(item => item.name.toLowerCase().includes(q))
      .slice(0, 10);
  }, [query, items]);

  // 点击外部关闭
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 同步外部值
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
          // 检查是否完全匹配
          const match = items.find(item => item.name === e.target.value);
          onChange(match || null);
        }}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border rounded text-sm outline-none focus:border-blue-400"
      />

      {/* 下拉搜索结果 */}
      {isOpen && filteredItems.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg max-h-48 overflow-y-auto z-50 border">
          {filteredItems.map((item, idx) => (
            <button
              key={`${item.type}-${item.name}-${idx}`}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 border-b border-gray-50 last:border-b-0 flex items-center gap-2"
              onClick={() => handleSelect(item)}
            >
              {/* 类型图标 */}
              <span className={`w-5 h-5 rounded-full flex items-center justify-center ${
                item.type === 'station' ? 'bg-blue-500 text-white' :
                item.type === 'player' ? 'bg-cyan-500 text-white' :
                'bg-orange-500 text-white'
              }`}>
                {item.type === 'station' ? (
                  <Train className="w-3 h-3" />
                ) : item.type === 'player' ? (
                  <User className="w-3 h-3" />
                ) : (
                  <Home className="w-3 h-3" />
                )}
              </span>
              <span>{item.name}</span>
              <span className="text-xs text-gray-400 ml-auto">
                {item.type === 'station' ? '站点' : item.type === 'player' ? '玩家' : '地标'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 完整路线结果
interface FullRouteResult {
  found: boolean;
  // 起点步行
  walkStart?: {
    from: SearchItem;
    to: ParsedStation;
    distance: number;
  };
  // 铁路路线
  railPath?: PathResult;
  // 终点步行
  walkEnd?: {
    from: ParsedStation;
    to: SearchItem;
    distance: number;
  };
  // 总距离
  totalDistance: number;
  // 总换乘
  totalTransfers: number;
}

export function NavigationPanel({
  stations,
  lines,
  landmarks,
  players = [],
  onRouteFound,
  onClose,
  onPointClick,
}: NavigationPanelProps) {
  const [startPoint, setStartPoint] = useState<SearchItem | null>(null);
  const [endPoint, setEndPoint] = useState<SearchItem | null>(null);
  const [preferLessTransfer, setPreferLessTransfer] = useState(true);
  const [result, setResult] = useState<FullRouteResult | null>(null);
  const [searching, setSearching] = useState(false);

  // 格式化线路显示名称
  const formatLineName = (lineId: string): string => {
    const line = lines.find(l => l.lineId === lineId);
    if (line) {
      return line.bureau === 'RMP' ? line.line : `${line.bureau}-${line.line}`;
    }
    return lineId;
  };

  // 根据站点名查找坐标
  const findStationCoord = (stationName: string): Coordinate | null => {
    const station = stations.find(s => s.name === stationName);
    return station?.coord || null;
  };

  // 构建搜索项列表（站点 + 地标 + 玩家）
  const searchItems = useMemo(() => {
    const items: SearchItem[] = [];

    // 添加站点（去重）
    const stationNames = new Set<string>();
    for (const station of stations) {
      if (!stationNames.has(station.name)) {
        stationNames.add(station.name);
        items.push({
          type: 'station',
          name: station.name,
          coord: station.coord,
        });
      }
    }

    // 添加地标
    for (const landmark of landmarks) {
      if (landmark.coord) {
        items.push({
          type: 'landmark',
          name: landmark.name,
          coord: landmark.coord,
        });
      }
    }

    // 添加在线玩家
    for (const player of players) {
      items.push({
        type: 'player',
        name: player.name,
        coord: { x: player.x, y: player.y, z: player.z },
      });
    }

    return items;
  }, [stations, landmarks, players]);

  // 搜索路径
  const handleSearch = () => {
    if (!startPoint || !endPoint) return;
    if (startPoint.name === endPoint.name) {
      setResult({
        found: false,
        totalDistance: 0,
        totalTransfers: 0,
      });
      return;
    }

    setSearching(true);

    setTimeout(() => {
      // 确定起点站和终点站
      let startStation: ParsedStation | null = null;
      let endStation: ParsedStation | null = null;
      let walkStartDist = 0;
      let walkEndDist = 0;

      if (startPoint.type === 'station') {
        startStation = stations.find(s => s.name === startPoint.name) || null;
      } else {
        // 地标或玩家：找最近站点
        startStation = findNearestStation(startPoint.coord, stations);
        if (startStation) {
          walkStartDist = getDistance(startPoint.coord, startStation.coord);
        }
      }

      if (endPoint.type === 'station') {
        endStation = stations.find(s => s.name === endPoint.name) || null;
      } else {
        // 地标或玩家：找最近站点
        endStation = findNearestStation(endPoint.coord, stations);
        if (endStation) {
          walkEndDist = getDistance(endPoint.coord, endStation.coord);
        }
      }

      if (!startStation || !endStation) {
        setResult({ found: false, totalDistance: 0, totalTransfers: 0 });
        setSearching(false);
        return;
      }

      // 如果起终点是同一站
      if (startStation.name === endStation.name) {
        const fullResult: FullRouteResult = {
          found: true,
          totalDistance: walkStartDist + walkEndDist,
          totalTransfers: 0,
        };

        if (walkStartDist > 0) {
          fullResult.walkStart = {
            from: startPoint,
            to: startStation,
            distance: walkStartDist,
          };
        }
        if (walkEndDist > 0) {
          fullResult.walkEnd = {
            from: startStation,
            to: endPoint,
            distance: walkEndDist,
          };
        }

        setResult(fullResult);
        setSearching(false);

        // 通知路径
        if (onRouteFound) {
          const path: Array<{ coord: Coordinate }> = [{ coord: startPoint.coord }];
          if (startStation) path.push({ coord: startStation.coord });
          path.push({ coord: endPoint.coord });
          onRouteFound(path);
        }
        return;
      }

      // 构建图并搜索铁路路径
      const graph = buildRailwayGraph(lines);
      const railResult = findShortestPath(graph, startStation.name, endStation.name, preferLessTransfer);

      if (!railResult.found) {
        setResult({ found: false, totalDistance: 0, totalTransfers: 0 });
        setSearching(false);
        return;
      }

      // 构建完整结果
      const fullResult: FullRouteResult = {
        found: true,
        railPath: railResult,
        totalDistance: walkStartDist + railResult.totalDistance + walkEndDist,
        totalTransfers: railResult.transfers,
      };

      if (walkStartDist > 0) {
        fullResult.walkStart = {
          from: startPoint,
          to: startStation,
          distance: walkStartDist,
        };
      }
      if (walkEndDist > 0) {
        fullResult.walkEnd = {
          from: endStation,
          to: endPoint,
          distance: walkEndDist,
        };
      }

      setResult(fullResult);
      setSearching(false);

      // 通知路径（包含步行路段）
      if (onRouteFound) {
        const path: Array<{ coord: Coordinate }> = [];

        // 起点步行
        if (fullResult.walkStart) {
          path.push({ coord: startPoint.coord });
        }

        // 铁路路径
        for (const node of railResult.path) {
          path.push({ coord: node.coord });
        }

        // 终点步行
        if (fullResult.walkEnd) {
          path.push({ coord: endPoint.coord });
        }

        onRouteFound(path);
      }
    }, 0);
  };

  // 交换起终点
  const handleSwap = () => {
    const temp = startPoint;
    setStartPoint(endPoint);
    setEndPoint(temp);
    setResult(null);
  };

  // 简化铁路路径显示
  const railSegments = result?.railPath?.found ? simplifyPath(result.railPath.path) : [];

  return (
    <div className="bg-white rounded-lg shadow-lg w-72 max-h-[70vh] flex flex-col">
      {/* 标题 */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="font-bold text-gray-800">路径规划</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* 输入区域 */}
      <div className="p-3 border-b">
        <div className="flex items-start gap-2 mb-2">
          <div className="flex-1">
            <PointSearchInput
              value={startPoint}
              onChange={(v) => { setStartPoint(v); setResult(null); }}
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
            onChange={(v) => { setEndPoint(v); setResult(null); }}
            items={searchItems}
            placeholder="输入终点（站点/地标）..."
            label="终点"
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={preferLessTransfer}
              onChange={(e) => {
                setPreferLessTransfer(e.target.checked);
                setResult(null);
              }}
              className="w-3 h-3"
            />
            <span className="text-gray-600">少换乘</span>
          </label>

          <button
            onClick={handleSearch}
            disabled={!startPoint || !endPoint || searching}
            className="px-4 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-xs font-medium"
          >
            {searching ? '搜索中...' : '搜索'}
          </button>
        </div>
      </div>

      {/* 结果区域 */}
      {result && (
        <div className="flex-1 overflow-y-auto p-3">
          {result.found ? (
            <>
              {/* 统计信息 */}
              <div className="flex items-center gap-3 mb-3 text-xs">
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">换乘:</span>
                  <span className="font-medium text-blue-600">{result.totalTransfers}次</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">总距离:</span>
                  <span className="font-medium">{Math.round(result.totalDistance)}m</span>
                </div>
              </div>

              {/* 路线详情 */}
              <div className="space-y-2">
                {/* 起点步行 */}
                {result.walkStart && (
                  <div className="relative pl-5">
                    <div className="absolute left-[7px] top-0 bottom-0 w-0.5 bg-gray-300 border-dashed" style={{ borderLeft: '2px dashed #ccc', width: 0 }} />
                    <div className="absolute left-0 top-0.5 w-4 h-4 rounded-full bg-green-500 text-white flex items-center justify-center">
                      <Footprints className="w-2.5 h-2.5" />
                    </div>
                    <div className="bg-green-50 rounded p-2">
                      <div className="text-[10px] text-green-600 font-medium mb-0.5">
                        步行 {Math.round(result.walkStart.distance)}m
                      </div>
                      <div className="text-xs text-gray-800">
                        <button
                          className="text-green-700 hover:underline"
                          onClick={() => onPointClick?.(result.walkStart!.from.coord)}
                        >
                          {result.walkStart.from.name}
                        </button>
                        <span className="text-gray-400 mx-1">→</span>
                        <button
                          className="text-green-700 hover:underline"
                          onClick={() => onPointClick?.(result.walkStart!.to.coord)}
                        >
                          {result.walkStart.to.name}站
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 铁路路线 */}
                {railSegments.map((segment, index) => (
                  <div key={index} className="relative pl-5">
                    {/* 连接线 */}
                    {(index < railSegments.length - 1 || result.walkEnd) && (
                      <div className="absolute left-[7px] top-5 bottom-0 w-0.5 bg-gray-200" />
                    )}

                    {/* 线路标识 */}
                    <div className="absolute left-0 top-0.5 w-4 h-4 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center">
                      {index + 1}
                    </div>

                    {/* 线路信息 */}
                    <div className="bg-gray-50 rounded p-2">
                      <div className="text-[10px] text-blue-600 font-medium mb-0.5">
                        {formatLineName(segment.lineId)}
                      </div>
                      <div className="text-xs text-gray-800">
                        <button
                          className="hover:underline hover:text-blue-600"
                          onClick={() => {
                            const coord = findStationCoord(segment.stations[0]);
                            if (coord) onPointClick?.(coord);
                          }}
                        >
                          {segment.stations[0]}
                        </button>
                        {segment.stations.length > 2 && (
                          <span className="text-gray-400 mx-1">
                            → {segment.stations.length - 2}站 →
                          </span>
                        )}
                        {segment.stations.length === 2 && (
                          <span className="text-gray-400 mx-1">→</span>
                        )}
                        {segment.stations.length > 1 && (
                          <button
                            className="hover:underline hover:text-blue-600"
                            onClick={() => {
                              const coord = findStationCoord(segment.stations[segment.stations.length - 1]);
                              if (coord) onPointClick?.(coord);
                            }}
                          >
                            {segment.stations[segment.stations.length - 1]}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {/* 终点步行 */}
                {result.walkEnd && (
                  <div className="relative pl-5">
                    <div className="absolute left-0 top-0.5 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center">
                      <Footprints className="w-2.5 h-2.5" />
                    </div>
                    <div className="bg-red-50 rounded p-2">
                      <div className="text-[10px] text-red-600 font-medium mb-0.5">
                        步行 {Math.round(result.walkEnd.distance)}m
                      </div>
                      <div className="text-xs text-gray-800">
                        <button
                          className="text-red-700 hover:underline"
                          onClick={() => onPointClick?.(result.walkEnd!.from.coord)}
                        >
                          {result.walkEnd.from.name}站
                        </button>
                        <span className="text-gray-400 mx-1">→</span>
                        <button
                          className="text-red-700 hover:underline"
                          onClick={() => onPointClick?.(result.walkEnd!.to.coord)}
                        >
                          {result.walkEnd.to.name}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-center text-gray-500 py-4 text-sm">
              {startPoint?.name === endPoint?.name ? '起点和终点相同' : '未找到可用路线'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default NavigationPanel;
