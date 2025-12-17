/**
 * Rail Map Painter (RMP) 数据解析器
 * 将 RMP 导出的 JSON 转换为地图可用的线路数据
 */

import type { ParsedLine, ParsedStation, Coordinate, EdgePath } from '@/types';
import {
  calculatePerpendicularPath,
  calculateDiagonalPath,
  calculateSimplePath,
  calculateStraightPath,
} from './rmpPathCalculator';

// RMP 节点类型
interface RMPNode {
  key: string;
  attributes: {
    visible: boolean;
    zIndex: number;
    x: number;
    y: number;
    type: string;
    // 不同类型的站点数据
    'bjsubway-int'?: {
      names: string[];
      nameOffsetX: string;
      nameOffsetY: string;
      outOfStation?: boolean;
    };
    'bjsubway-basic'?: {
      names: string[];
      nameOffsetX: string;
      nameOffsetY: string;
      open?: boolean;
      construction?: boolean;
    };
    'suzhourt-basic'?: {
      names: string[];
      color: string[];
      nameOffsetX: string;
      nameOffsetY: string;
      textVertical?: boolean;
    };
    'shmetro-int'?: {
      names: string[];
      nameOffsetX: string;
      nameOffsetY: string;
      rotate?: number;
      height?: number;
      width?: number;
    };
    'bjsubway-text-line-badge'?: {
      names: string[];
      color: string[];
    };
  };
}

// RMP 边类型
interface RMPEdge {
  key: string;
  source: string;
  target: string;
  attributes: {
    visible: boolean;
    zIndex: number;
    type: string;
    style: string;
    'single-color'?: {
      color: string[];
    };
    'mrt-under-constr'?: {
      color: string[];
    };
    'bjsubway-dotted'?: {
      color: string[];
    };
    reconcileId?: string;
    parallelIndex?: number;
    // 三种边类型的配置
    perpendicular?: {
      startFrom: 'from' | 'to';
      offsetFrom: number;
      offsetTo: number;
      roundCornerFactor: number;
    };
    diagonal?: {
      startFrom: 'from' | 'to';
      offsetFrom: number;
      offsetTo: number;
      roundCornerFactor: number;
    };
    simple?: {
      offset: number;
    };
  };
}

// RMP 数据结构
interface RMPData {
  svgViewBoxZoom: number;
  svgViewBoxMin: { x: number; y: number };
  graph: {
    nodes: RMPNode[];
    edges: RMPEdge[];
  };
  version?: string;
}

// 不同世界的坐标转换配置
interface CoordTransformConfig {
  scale: number;      // 坐标缩放比例
  offset: number;     // 坐标偏移量（转换前）
  multiplier: number; // 最终乘数
}

const WORLD_COORD_CONFIGS: Record<string, CoordTransformConfig> = {
  // 零洲: (coord + 0.05) * 10
  zth: { scale: 1, offset: 0.05, multiplier: 10 },
  // 后土: coord * 4 (1:4 比例)
  houtu: { scale: 1, offset: 0, multiplier: 4 },
};

const DEFAULT_COORD_CONFIG: CoordTransformConfig = { scale: 1, offset: 0.05, multiplier: 10 };

/**
 * RMP 坐标转换为游戏坐标
 */
function rmpToGameCoord(x: number, y: number, config: CoordTransformConfig = DEFAULT_COORD_CONFIG): Coordinate {
  return {
    x: (x * config.scale + config.offset) * config.multiplier,
    y: 64,  // 默认Y高度
    z: (y * config.scale + config.offset) * config.multiplier,  // RMP的y对应游戏的z
  };
}

/**
 * 从节点获取站名
 */
function getStationName(node: RMPNode): string | null {
  const attr = node.attributes;

  // 尝试各种站点类型
  const typeData =
    attr['bjsubway-int'] ||
    attr['bjsubway-basic'] ||
    attr['suzhourt-basic'] ||
    attr['shmetro-int'];

  if (typeData && typeData.names && typeData.names.length > 0) {
    return typeData.names[0];
  }

  return null;
}

/**
 * 判断节点是否为站点（非虚拟节点、非标签）
 */
function isStationNode(node: RMPNode): boolean {
  const type = node.attributes.type;
  return (
    type === 'bjsubway-int' ||
    type === 'bjsubway-basic' ||
    type === 'suzhourt-basic' ||
    type === 'shmetro-int'
  );
}

/**
 * 判断节点是否为换乘站
 */
function isTransferStation(node: RMPNode): boolean {
  const type = node.attributes.type;
  return type === 'bjsubway-int' || type === 'shmetro-int';
}

/**
 * 从边获取线路颜色
 */
function getEdgeColor(edge: RMPEdge): string {
  const singleColor = edge.attributes['single-color'];
  if (singleColor && singleColor.color && singleColor.color.length >= 3) {
    return singleColor.color[2];
  }
  return '#888888';
}

/**
 * 从线路badge节点获取线路信息
 */
function getLineBadges(nodes: RMPNode[]): Map<string, { name: string; color: string }> {
  const badges = new Map<string, { name: string; color: string }>();

  for (const node of nodes) {
    if (node.attributes.type === 'bjsubway-text-line-badge') {
      const badgeData = node.attributes['bjsubway-text-line-badge'];
      if (badgeData && badgeData.names && badgeData.names.length > 0) {
        const color = badgeData.color && badgeData.color.length >= 3
          ? badgeData.color[2]
          : '#888888';
        badges.set(color, {
          name: badgeData.names[0],
          color,
        });
      }
    }
  }

  return badges;
}

/**
 * 解析 RMP 数据
 * @param data RMP 数据
 * @param worldId 世界ID，用于确定坐标转换配置
 */
export function parseRMPData(data: RMPData, worldId: string = 'zth'): {
  lines: ParsedLine[];
  stations: ParsedStation[];
} {
  const { nodes, edges } = data.graph;
  const coordConfig = WORLD_COORD_CONFIGS[worldId] || DEFAULT_COORD_CONFIG;

  // 建立节点索引
  const nodeMap = new Map<string, RMPNode>();
  for (const node of nodes) {
    nodeMap.set(node.key, node);
  }

  // 获取线路名称映射
  const lineBadges = getLineBadges(nodes);

  // 按颜色分组边，构建线路
  const linesByColor = new Map<string, RMPEdge[]>();
  for (const edge of edges) {
    if (!edge.attributes.visible) continue;

    const color = getEdgeColor(edge);
    if (!linesByColor.has(color)) {
      linesByColor.set(color, []);
    }
    linesByColor.get(color)!.push(edge);
  }

  // 构建邻接表，用于排序站点，同时保存边信息
  const buildAdjacencyWithEdges = (edges: RMPEdge[]): {
    adj: Map<string, Set<string>>;
    edgeMap: Map<string, RMPEdge>;
  } => {
    const adj = new Map<string, Set<string>>();
    const edgeMap = new Map<string, RMPEdge>();
    for (const edge of edges) {
      if (!adj.has(edge.source)) adj.set(edge.source, new Set());
      if (!adj.has(edge.target)) adj.set(edge.target, new Set());
      adj.get(edge.source)!.add(edge.target);
      adj.get(edge.target)!.add(edge.source);
      // 保存边信息（双向）
      edgeMap.set(`${edge.source}->${edge.target}`, edge);
      edgeMap.set(`${edge.target}->${edge.source}`, edge);
    }
    return { adj, edgeMap };
  };

  // DFS 遍历获取有序站点列表，同时返回边的顺序
  const getOrderedStationsWithEdges = (edges: RMPEdge[]): {
    orderedNodes: string[];
    orderedEdges: RMPEdge[];
  } => {
    if (edges.length === 0) return { orderedNodes: [], orderedEdges: [] };

    const { adj, edgeMap } = buildAdjacencyWithEdges(edges);

    // 找到端点（只有一个邻居的节点）作为起点
    let startNode = edges[0].source;
    for (const [node, neighbors] of adj) {
      if (neighbors.size === 1) {
        startNode = node;
        break;
      }
    }

    // DFS 遍历
    const visited = new Set<string>();
    const orderedNodes: string[] = [];
    const orderedEdges: RMPEdge[] = [];

    const dfs = (node: string, prevNode: string | null) => {
      if (visited.has(node)) return;
      visited.add(node);
      orderedNodes.push(node);

      // 如果有前一个节点，记录这条边
      if (prevNode) {
        const edge = edgeMap.get(`${prevNode}->${node}`);
        if (edge) {
          orderedEdges.push(edge);
        }
      }

      const neighbors = adj.get(node) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, node);
        }
      }
    };

    dfs(startNode, null);
    return { orderedNodes, orderedEdges };
  };

  /**
   * 计算两个节点之间的边路径
   */
  const calculateEdgePath = (
    fromNode: RMPNode,
    toNode: RMPNode,
    edge: RMPEdge,
    coordConfig: CoordTransformConfig
  ): EdgePath => {
    const from = { x: fromNode.attributes.x, y: fromNode.attributes.y };
    const to = { x: toNode.attributes.x, y: toNode.attributes.y };

    // 判断边的方向是否需要反转
    const isReversed = edge.target === fromNode.key;

    const edgeType = edge.attributes.type;

    if (edgeType === 'perpendicular' && edge.attributes.perpendicular) {
      const config = edge.attributes.perpendicular;
      // 如果方向反转，需要调整 startFrom
      const adjustedConfig = isReversed
        ? { ...config, startFrom: config.startFrom === 'from' ? 'to' as const : 'from' as const }
        : config;
      return calculatePerpendicularPath(from, to, adjustedConfig, coordConfig);
    }

    if (edgeType === 'diagonal' && edge.attributes.diagonal) {
      const config = edge.attributes.diagonal;
      const adjustedConfig = isReversed
        ? { ...config, startFrom: config.startFrom === 'from' ? 'to' as const : 'from' as const }
        : config;
      return calculateDiagonalPath(from, to, adjustedConfig, coordConfig);
    }

    if (edgeType === 'simple' && edge.attributes.simple) {
      return calculateSimplePath(from, to, edge.attributes.simple, coordConfig);
    }

    // 回退到直线
    return calculateStraightPath(from, to, coordConfig);
  };

  // 构建线路数据
  const lines: ParsedLine[] = [];
  const allStationsMap = new Map<string, ParsedStation>();
  let lineIndex = 1;

  for (const [color, colorEdges] of linesByColor) {
    // 获取有序节点列表和边
    const { orderedNodes: orderedNodeKeys, orderedEdges } = getOrderedStationsWithEdges(colorEdges);

    // 过滤出实际站点（排除虚拟节点），同时记录原始索引
    const stationNodesWithIndex: { node: RMPNode; originalIndex: number }[] = [];
    for (let i = 0; i < orderedNodeKeys.length; i++) {
      const node = nodeMap.get(orderedNodeKeys[i]);
      if (node && isStationNode(node)) {
        stationNodesWithIndex.push({ node, originalIndex: i });
      }
    }

    if (stationNodesWithIndex.length < 2) continue;

    // 获取线路名称
    const badge = lineBadges.get(color);
    const lineName = badge?.name || `线路${lineIndex}`;
    const lineId = `RMP-${lineIndex}`;

    // 构建站点列表
    const lineStations: ParsedStation[] = [];

    for (let i = 0; i < stationNodesWithIndex.length; i++) {
      const { node } = stationNodesWithIndex[i];
      const name = getStationName(node);
      if (!name) continue;

      const coord = rmpToGameCoord(node.attributes.x, node.attributes.y, coordConfig);

      const station: ParsedStation = {
        name,
        coord,
        stationCode: i + 1,
        isTransfer: isTransferStation(node),
        lines: [lineName],  // 使用线路名称而非 lineId
      };

      lineStations.push(station);

      // 更新全局站点索引
      if (allStationsMap.has(name)) {
        const existing = allStationsMap.get(name)!;
        existing.lines = [...new Set([...existing.lines, lineName])];
        existing.isTransfer = existing.lines.length > 1;
      } else {
        allStationsMap.set(name, { ...station });
      }
    }

    if (lineStations.length >= 2) {
      // 计算站点之间的边路径
      const edgePaths: EdgePath[] = [];
      for (let i = 0; i < stationNodesWithIndex.length - 1; i++) {
        const { node: fromNode, originalIndex: fromIdx } = stationNodesWithIndex[i];
        const { node: toNode, originalIndex: toIdx } = stationNodesWithIndex[i + 1];

        // 找到这两个站点之间的所有边（可能有多个虚拟节点）
        // 合并中间所有边的路径
        const combinedSegments: EdgePath['segments'] = [];
        let totalLength = 0;

        // 遍历从 fromIdx 到 toIdx-1 的所有边
        for (let edgeIdx = fromIdx; edgeIdx < toIdx; edgeIdx++) {
          const edge = orderedEdges[edgeIdx];
          if (edge) {
            const fromKey = orderedNodeKeys[edgeIdx];
            const toKey = orderedNodeKeys[edgeIdx + 1];
            const fromNodeForEdge = nodeMap.get(fromKey);
            const toNodeForEdge = nodeMap.get(toKey);

            if (fromNodeForEdge && toNodeForEdge) {
              const path = calculateEdgePath(fromNodeForEdge, toNodeForEdge, edge, coordConfig);
              combinedSegments.push(...path.segments);
              totalLength += path.length;
            }
          }
        }

        // 如果没有找到边，使用直线
        if (combinedSegments.length === 0) {
          const path = calculateStraightPath(
            { x: fromNode.attributes.x, y: fromNode.attributes.y },
            { x: toNode.attributes.x, y: toNode.attributes.y },
            coordConfig
          );
          edgePaths.push(path);
        } else {
          edgePaths.push({ segments: combinedSegments, length: totalLength });
        }
      }

      lines.push({
        bureau: 'RMP',
        line: lineName,
        lineId,
        stations: lineStations,
        color,
        edgePaths,
      });
      lineIndex++;
    }
  }

  // 更新线路中站点的换乘信息
  for (const line of lines) {
    for (const station of line.stations) {
      const globalStation = allStationsMap.get(station.name);
      if (globalStation) {
        station.isTransfer = globalStation.isTransfer;
        station.lines = globalStation.lines;
      }
    }
  }

  return {
    lines,
    stations: Array.from(allStationsMap.values()),
  };
}

/**
 * 从 URL 或文件加载 RMP 数据
 */
export async function fetchRMPData(url: string): Promise<RMPData> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch RMP data: ${response.status}`);
  }
  return await response.json();
}

/**
 * 获取 RMP 数据统计信息
 */
export function getRMPStats(data: RMPData): {
  totalNodes: number;
  stationCount: number;
  edgeCount: number;
  lineCount: number;
  colors: string[];
} {
  const { nodes, edges } = data.graph;

  const stationCount = nodes.filter(isStationNode).length;
  const colors = [...new Set(edges.map(getEdgeColor))];

  return {
    totalNodes: nodes.length,
    stationCount,
    edgeCount: edges.length,
    lineCount: colors.length,
    colors,
  };
}
