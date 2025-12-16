/**
 * Rail Map Painter (RMP) 数据解析器
 * 将 RMP 导出的 JSON 转换为地图可用的线路数据
 */

import type { ParsedLine, ParsedStation, Coordinate } from '@/types';

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
    reconcileId?: string;
    parallelIndex?: number;
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

/**
 * RMP 坐标转换为游戏坐标
 * 公式: (coord + 0.05) * 10
 */
function rmpToGameCoord(x: number, y: number): Coordinate {
  return {
    x: (x + 0.05) * 10,
    y: 64,  // 默认Y高度
    z: (y + 0.05) * 10,  // RMP的y对应游戏的z
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
 */
export function parseRMPData(data: RMPData): {
  lines: ParsedLine[];
  stations: ParsedStation[];
} {
  const { nodes, edges } = data.graph;

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

  // 构建邻接表，用于排序站点
  const buildAdjacency = (edges: RMPEdge[]): Map<string, Set<string>> => {
    const adj = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!adj.has(edge.source)) adj.set(edge.source, new Set());
      if (!adj.has(edge.target)) adj.set(edge.target, new Set());
      adj.get(edge.source)!.add(edge.target);
      adj.get(edge.target)!.add(edge.source);
    }
    return adj;
  };

  // DFS 遍历获取有序站点列表
  const getOrderedStations = (edges: RMPEdge[]): string[] => {
    if (edges.length === 0) return [];

    const adj = buildAdjacency(edges);

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
    const ordered: string[] = [];

    const dfs = (node: string) => {
      if (visited.has(node)) return;
      visited.add(node);
      ordered.push(node);

      const neighbors = adj.get(node) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        }
      }
    };

    dfs(startNode);
    return ordered;
  };

  // 构建线路数据
  const lines: ParsedLine[] = [];
  const allStationsMap = new Map<string, ParsedStation>();
  let lineIndex = 1;

  for (const [color, colorEdges] of linesByColor) {
    // 获取有序节点列表
    const orderedNodeKeys = getOrderedStations(colorEdges);

    // 过滤出实际站点（排除虚拟节点）
    const stationNodes = orderedNodeKeys
      .map(key => nodeMap.get(key))
      .filter((node): node is RMPNode => node !== undefined && isStationNode(node));

    if (stationNodes.length < 2) continue;

    // 获取线路名称
    const badge = lineBadges.get(color);
    const lineName = badge?.name || `线路${lineIndex}`;
    const lineId = `RMP-${lineIndex}`;

    // 构建站点列表
    const lineStations: ParsedStation[] = [];

    for (let i = 0; i < stationNodes.length; i++) {
      const node = stationNodes[i];
      const name = getStationName(node);
      if (!name) continue;

      const coord = rmpToGameCoord(node.attributes.x, node.attributes.y);

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
      lines.push({
        bureau: 'RMP',
        line: lineName,
        lineId,
        stations: lineStations,
        color,
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
