/**
 * 路径规划算法
 * 使用 BFS/Dijkstra 算法查找最短路径
 */

import type { ParsedLine, Coordinate, Station } from '@/types';

// 路径节点
interface PathNode {
  stationName: string;
  lineId: string;
  coord: Coordinate;
}

// 路径结果
export interface PathResult {
  found: boolean;
  path: PathNode[];
  transfers: number;       // 换乘次数
  totalDistance: number;   // 总距离
  lines: string[];         // 途经线路
}

// 图节点
interface GraphNode {
  stationName: string;
  lineId: string;
  coord: Coordinate;
  stationCode: number;
  neighbors: Array<{
    stationName: string;
    lineId: string;
    distance: number;
    isTransfer: boolean;  // 是否为换乘
  }>;
}

// 特殊情况预处理结果
interface SpecialCasesIndex {
  // 方向限制: Map<"stationName@lineId", Set<"up"|"down">>
  blockedDirections: Map<string, Set<string>>;
  // 未开通线路: Set<"stationName@lineId">
  unavailableLines: Set<string>;
  // 越行: Map<"stationName@lineId", number> (下一站 stationCode)
  overtakingMap: Map<string, number>;
  // 贯通运行: Map<"stationName@lineId1", "lineId2">
  throughTrainMap: Map<string, string>;
}

/**
 * 预处理特殊情况
 */
function processSpecialCases(stations: Station[]): SpecialCasesIndex {
  const blockedDirections = new Map<string, Set<string>>();
  const unavailableLines = new Set<string>();
  const overtakingMap = new Map<string, number>();
  const throughTrainMap = new Map<string, string>();

  for (const station of stations) {
    if (!station.specialCases) continue;

    for (const sc of station.specialCases) {
      switch (sc.type) {
        case 'directionNotAvaliable': {
          const lineId = `${sc.target.bureau}-${sc.target.line}`;
          const key = `${station.stationName}@${lineId}`;
          if (!blockedDirections.has(key)) {
            blockedDirections.set(key, new Set());
          }
          blockedDirections.get(key)!.add(sc.target.isTrainUp ? 'up' : 'down');
          break;
        }

        case 'lineNotAvaliable': {
          const lineId = `${sc.target.bureau}-${sc.target.line}`;
          const key = `${station.stationName}@${lineId}`;
          unavailableLines.add(key);
          break;
        }

        case 'lineOvertaking': {
          const lineId = `${sc.target.bureau}-${sc.target.line}`;
          const key = `${station.stationName}@${lineId}`;
          if (sc.target.stationCode !== undefined) {
            overtakingMap.set(key, sc.target.stationCode);
          }
          break;
        }

        case 'throughTrain': {
          const lineId1 = `${sc.target.bureau1}-${sc.target.line1}`;
          const lineId2 = `${sc.target.bureau2}-${sc.target.line2}`;
          throughTrainMap.set(`${station.stationName}@${lineId1}`, lineId2);
          throughTrainMap.set(`${station.stationName}@${lineId2}`, lineId1);
          break;
        }
      }
    }
  }

  return { blockedDirections, unavailableLines, overtakingMap, throughTrainMap };
}

/**
 * 构建铁路网络图
 */
export function buildRailwayGraph(
  lines: ParsedLine[],
  rawStations?: Station[]
): Map<string, GraphNode> {
  const graph = new Map<string, GraphNode>();

  // 预处理特殊情况
  const specialCases = rawStations ? processSpecialCases(rawStations) : {
    blockedDirections: new Map<string, Set<string>>(),
    unavailableLines: new Set<string>(),
    overtakingMap: new Map<string, number>(),
    throughTrainMap: new Map<string, string>(),
  };

  // 用于查找同一站点的不同线路
  const stationLines = new Map<string, Array<{ lineId: string; coord: Coordinate }>>();

  // 第一遍：收集所有站点信息
  for (const line of lines) {
    for (const station of line.stations) {
      const nodeKey = `${station.name}@${line.lineId}`;

      // 跳过不可用的线路
      if (specialCases.unavailableLines.has(nodeKey)) continue;

      // 添加到图
      graph.set(nodeKey, {
        stationName: station.name,
        lineId: line.lineId,
        coord: station.coord,
        stationCode: station.stationCode,
        neighbors: [],
      });

      // 记录站点-线路关系
      if (!stationLines.has(station.name)) {
        stationLines.set(station.name, []);
      }
      stationLines.get(station.name)!.push({
        lineId: line.lineId,
        coord: station.coord,
      });
    }
  }

  // 第二遍：建立连接关系
  for (const line of lines) {
    for (let i = 0; i < line.stations.length; i++) {
      const station = line.stations[i];
      const nodeKey = `${station.name}@${line.lineId}`;
      const node = graph.get(nodeKey);

      if (!node) continue;  // 节点可能因特殊情况被跳过

      // 获取当前站点的方向限制
      const blockedDirs = specialCases.blockedDirections.get(nodeKey);

      // 检查是否有越行
      const overtakeTarget = specialCases.overtakingMap.get(nodeKey);

      // 连接同一线路的相邻站点（上行方向：stationCode 减小）
      if (i > 0) {
        const prev = line.stations[i - 1];
        const prevKey = `${prev.name}@${line.lineId}`;

        // 检查上行方向是否被阻止
        if (!blockedDirs?.has('up') && graph.has(prevKey)) {
          // 优先使用 edgePath 中的预计算长度
          let distance: number;
          if (line.edgePaths && line.edgePaths[i - 1]) {
            distance = line.edgePaths[i - 1].length;
          } else {
            distance = calculateDistance(station.coord, prev.coord);
          }
          node.neighbors.push({
            stationName: prev.name,
            lineId: line.lineId,
            distance,
            isTransfer: false,
          });
        }
      }

      // 连接同一线路的相邻站点（下行方向：stationCode 增大）
      if (i < line.stations.length - 1) {
        const next = line.stations[i + 1];
        const nextKey = `${next.name}@${line.lineId}`;

        // 检查下行方向是否被阻止
        if (!blockedDirs?.has('down') && graph.has(nextKey)) {
          // 如果有越行，检查下一站是否是越行目标
          if (overtakeTarget !== undefined) {
            // 有越行时，只连接到越行目标站
            const targetStation = line.stations.find(s => s.stationCode === overtakeTarget);
            if (targetStation) {
              const targetKey = `${targetStation.name}@${line.lineId}`;
              if (graph.has(targetKey)) {
                const distance = calculateDistance(station.coord, targetStation.coord);
                node.neighbors.push({
                  stationName: targetStation.name,
                  lineId: line.lineId,
                  distance,
                  isTransfer: false,
                });
              }
            }
          } else {
            // 正常连接下一站
            // 优先使用 edgePath 中的预计算长度
            let distance: number;
            if (line.edgePaths && line.edgePaths[i]) {
              distance = line.edgePaths[i].length;
            } else {
              distance = calculateDistance(station.coord, next.coord);
            }
            node.neighbors.push({
              stationName: next.name,
              lineId: line.lineId,
              distance,
              isTransfer: false,
            });
          }
        }
      }

      // 连接同一站点的不同线路（换乘）
      const sameStationLines = stationLines.get(station.name) || [];
      for (const other of sameStationLines) {
        if (other.lineId !== line.lineId) {
          const otherKey = `${station.name}@${other.lineId}`;
          if (!graph.has(otherKey)) continue;

          // 检查是否为贯通运行
          const isThroughTrain = specialCases.throughTrainMap.get(nodeKey) === other.lineId;

          node.neighbors.push({
            stationName: station.name,
            lineId: other.lineId,
            distance: 0,
            isTransfer: !isThroughTrain,  // 贯通运行不算换乘
          });
        }
      }
    }
  }

  return graph;
}

/**
 * 计算两点之间的距离
 */
function calculateDistance(a: Coordinate, b: Coordinate): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * 使用 Dijkstra 算法查找最短路径
 * @param graph 铁路网络图
 * @param startStation 起始站名
 * @param endStation 终点站名
 * @param preferLessTransfer 是否优先减少换乘（默认 true）
 */
export function findShortestPath(
  graph: Map<string, GraphNode>,
  startStation: string,
  endStation: string,
  preferLessTransfer: boolean = true
): PathResult {
  // 找到起始站的所有线路入口
  const startNodes: string[] = [];
  const endNodes: string[] = [];

  for (const [key, node] of graph) {
    if (node.stationName === startStation) {
      startNodes.push(key);
    }
    if (node.stationName === endStation) {
      endNodes.push(key);
    }
  }

  if (startNodes.length === 0 || endNodes.length === 0) {
    return {
      found: false,
      path: [],
      transfers: 0,
      totalDistance: 0,
      lines: [],
    };
  }

  // Dijkstra 算法
  const distances = new Map<string, number>();
  const transfers = new Map<string, number>();
  const previous = new Map<string, string | null>();
  const visited = new Set<string>();

  // 初始化
  for (const key of graph.keys()) {
    distances.set(key, Infinity);
    transfers.set(key, Infinity);
    previous.set(key, null);
  }

  // 从所有起始点开始
  for (const start of startNodes) {
    distances.set(start, 0);
    transfers.set(start, 0);
  }

  // 优先队列（简化版，使用数组）
  const queue = [...startNodes];

  while (queue.length > 0) {
    // 找到距离最小的节点
    let minIdx = 0;
    let minCost = Infinity;

    for (let i = 0; i < queue.length; i++) {
      const key = queue[i];
      const cost = preferLessTransfer
        ? transfers.get(key)! * 100000 + distances.get(key)!
        : distances.get(key)! + transfers.get(key)! * 100;

      if (cost < minCost) {
        minCost = cost;
        minIdx = i;
      }
    }

    const currentKey = queue.splice(minIdx, 1)[0];

    if (visited.has(currentKey)) continue;
    visited.add(currentKey);

    const current = graph.get(currentKey)!;

    // 检查是否到达终点
    if (endNodes.includes(currentKey)) {
      // 回溯路径
      const path: PathNode[] = [];
      let key: string | null = currentKey;

      while (key) {
        const node = graph.get(key)!;
        path.unshift({
          stationName: node.stationName,
          lineId: node.lineId,
          coord: node.coord,
        });
        key = previous.get(key) || null;
      }

      // 计算途经线路
      const lineSet = new Set<string>();
      for (const node of path) {
        lineSet.add(node.lineId);
      }

      return {
        found: true,
        path,
        transfers: transfers.get(currentKey)!,
        totalDistance: distances.get(currentKey)!,
        lines: Array.from(lineSet),
      };
    }

    // 遍历邻居
    for (const neighbor of current.neighbors) {
      const neighborKey = `${neighbor.stationName}@${neighbor.lineId}`;

      if (visited.has(neighborKey)) continue;

      const newDist = distances.get(currentKey)! + neighbor.distance;
      const newTransfers = transfers.get(currentKey)! + (neighbor.isTransfer ? 1 : 0);

      const currentCost = preferLessTransfer
        ? transfers.get(neighborKey)! * 100000 + distances.get(neighborKey)!
        : distances.get(neighborKey)! + transfers.get(neighborKey)! * 100;

      const newCost = preferLessTransfer
        ? newTransfers * 100000 + newDist
        : newDist + newTransfers * 100;

      if (newCost < currentCost) {
        distances.set(neighborKey, newDist);
        transfers.set(neighborKey, newTransfers);
        previous.set(neighborKey, currentKey);

        if (!queue.includes(neighborKey)) {
          queue.push(neighborKey);
        }
      }
    }
  }

  return {
    found: false,
    path: [],
    transfers: 0,
    totalDistance: 0,
    lines: [],
  };
}

/**
 * 简化路径（合并同一线路的连续站点）
 */
export function simplifyPath(path: PathNode[]): Array<{
  lineId: string;
  stations: string[];
  startCoord: Coordinate;
  endCoord: Coordinate;
}> {
  if (path.length === 0) return [];

  const segments: Array<{
    lineId: string;
    stations: string[];
    startCoord: Coordinate;
    endCoord: Coordinate;
  }> = [];

  let currentSegment = {
    lineId: path[0].lineId,
    stations: [path[0].stationName],
    startCoord: path[0].coord,
    endCoord: path[0].coord,
  };

  for (let i = 1; i < path.length; i++) {
    const node = path[i];

    if (node.lineId === currentSegment.lineId) {
      // 同一线路，添加站点
      if (node.stationName !== currentSegment.stations[currentSegment.stations.length - 1]) {
        currentSegment.stations.push(node.stationName);
        currentSegment.endCoord = node.coord;
      }
    } else {
      // 换乘，保存当前段，开始新段
      segments.push(currentSegment);
      currentSegment = {
        lineId: node.lineId,
        stations: [node.stationName],
        startCoord: node.coord,
        endCoord: node.coord,
      };
    }
  }

  // 添加最后一段
  segments.push(currentSegment);

  return segments;
}
