/**
 * 铁路数据解析器
 * 解析 RIA_Data 仓库中的铁路数据，生成用于地图渲染的线路和站点信息
 */

import type { Station, LineInfo, ParsedLine, ParsedStation, Coordinate, BureausConfig } from '@/types';
import { fetchWithMirror, fetchLocal, type ProgressCallback } from './fetchWithMirror';

// 数据源 URL (GitHub raw)
const RAILWAY_DATA_BASE_URL = 'https://raw.githubusercontent.com/RainC7/RIA_Data/main/data/railway';
const BUREAUS_CONFIG_URL = '/data/bureaus.json';

// 铁路局配置缓存
let bureausCache: BureausConfig | null = null;

// 线路颜色映射
const LINE_COLORS: Record<string, string> = {
  // R 局（红色系）
  'R-1': '#E53935',
  'R-2': '#D32F2F',
  'R-3': '#C62828',
  'R-4': '#B71C1C',
  'R-5': '#FF5252',
  'R-6': '#FF1744',
  // H 局（蓝色系）
  'H-1': '#1E88E5',
  'H-2': '#1976D2',
  'H-3': '#1565C0',
  'H-4': '#0D47A1',
  'H-5': '#2196F3',
  'H-6': '#03A9F4',
  'H-10': '#00BCD4',
  'H-101': '#0097A7',
  'H-201': '#00838F',
  // T 局（绿色系）
  'T-1': '#43A047',
  'T-2': '#388E3C',
  'T-3': '#2E7D32',
  'T-4': '#1B5E20',
  'T-5': '#4CAF50',
  'T-6': '#8BC34A',
  // G 局（紫色系）
  'G-1': '#8E24AA',
  'G-2': '#7B1FA2',
  'G-3': '#6A1B9A',
  'G-4': '#4A148C',
  'G-5': '#9C27B0',
  'G-6': '#AB47BC',
};

/**
 * 根据线路 ID 生成颜色
 * 如果没有预定义颜色，则根据 hash 生成
 */
function getLineColor(lineId: string): string {
  if (LINE_COLORS[lineId]) {
    return LINE_COLORS[lineId];
  }

  // 根据 lineId 生成 hash 颜色
  let hash = 0;
  for (let i = 0; i < lineId.length; i++) {
    hash = lineId.charCodeAt(i) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

/**
 * 获取指定世界的铁路数据
 */
export async function fetchRailwayData(
  worldId: string,
  onProgress?: ProgressCallback
): Promise<Station[]> {
  const url = `${RAILWAY_DATA_BASE_URL}/${worldId}.json`;

  try {
    return await fetchWithMirror<Station[]>(url, '铁路数据', onProgress);
  } catch (error) {
    console.error(`Error fetching railway data for ${worldId}:`, error);
    return [];
  }
}

/**
 * 获取铁路局配置
 */
export async function fetchBureausConfig(onProgress?: ProgressCallback): Promise<BureausConfig> {
  if (bureausCache) return bureausCache;

  try {
    bureausCache = await fetchLocal<BureausConfig>(BUREAUS_CONFIG_URL, '铁路局配置', onProgress);
    return bureausCache!;
  } catch (error) {
    console.error('Error fetching bureaus config:', error);
    return {};
  }
}

/**
 * 获取铁路局名称
 */
export function getBureauName(bureausConfig: BureausConfig, code: string): string {
  return bureausConfig[code]?.name || code;
}

/**
 * 解析铁路数据，生成线路和站点信息
 */
export function parseRailwayData(stations: Station[]): {
  lines: ParsedLine[];
  stationIndex: Map<string, ParsedStation>;
  rawStations: Station[];
} {
  // 线路索引: lineId -> { stations: Map<stationCode, stationInfo> }
  const lineIndex = new Map<string, Map<number, { name: string; coord: Coordinate; lineInfo: LineInfo }>>();

  // 站点索引: stationName -> ParsedStation
  const stationIndex = new Map<string, ParsedStation>();

  // 第一遍：收集所有线路和站点信息
  for (const station of stations) {
    // 收集该站点经过的所有线路
    const lineIds: string[] = [];

    for (const line of station.lines) {
      // 跳过未开通的线路（distance === -1）
      if (line.distance === -1) continue;

      const lineId = `${line.bureau}-${line.line}`;
      lineIds.push(lineId);

      // 添加到线路索引
      if (!lineIndex.has(lineId)) {
        lineIndex.set(lineId, new Map());
      }

      lineIndex.get(lineId)!.set(line.stationCode, {
        name: station.stationName,
        coord: line.coord,
        lineInfo: line,
      });
    }

    // 添加到站点索引（只有经过至少一条已开通线路的站点）
    if (lineIds.length > 0) {
      if (!stationIndex.has(station.stationName)) {
        const firstLine = station.lines.find(l => l.distance !== -1)!;
        stationIndex.set(station.stationName, {
          name: station.stationName,
          coord: firstLine.coord,
          stationCode: firstLine.stationCode,
          isTransfer: lineIds.length > 1,
          lines: lineIds,
        });
      } else {
        // 更新换乘信息
        const existing = stationIndex.get(station.stationName)!;
        existing.isTransfer = true;
        existing.lines = [...new Set([...existing.lines, ...lineIds])];
      }
    }
  }

  // 第二遍：生成线路数据（按 stationCode 排序）
  const lines: ParsedLine[] = [];

  for (const [lineId, stationsMap] of lineIndex) {
    const [bureau, line] = lineId.split('-');

    // 按 stationCode 排序
    const sortedStations = Array.from(stationsMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([code, info]) => ({
        name: info.name,
        coord: info.coord,
        stationCode: code,
        isTransfer: stationIndex.get(info.name)?.isTransfer || false,
        lines: stationIndex.get(info.name)?.lines || [lineId],
      }));

    lines.push({
      bureau,
      line,
      lineId,
      stations: sortedStations,
      color: getLineColor(lineId),
    });
  }

  // 按线路 ID 排序
  lines.sort((a, b) => {
    if (a.bureau !== b.bureau) {
      return a.bureau.localeCompare(b.bureau);
    }
    // 尝试数字比较
    const aNum = parseInt(a.line);
    const bNum = parseInt(b.line);
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return aNum - bNum;
    }
    return a.line.localeCompare(b.line);
  });

  return { lines, stationIndex, rawStations: stations };
}

/**
 * 获取线路的坐标数组（用于绑定 Polyline）
 */
export function getLineCoordinates(line: ParsedLine): [number, number][] {
  return line.stations.map(station => [station.coord.x, station.coord.z]);
}

/**
 * 计算两个站点之间的距离
 */
export function calculateDistance(coord1: Coordinate, coord2: Coordinate): number {
  const dx = coord1.x - coord2.x;
  const dz = coord1.z - coord2.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * 获取线路总长度
 */
export function getLineLength(line: ParsedLine): number {
  let total = 0;
  for (let i = 1; i < line.stations.length; i++) {
    total += calculateDistance(
      line.stations[i - 1].coord,
      line.stations[i].coord
    );
  }
  return total;
}

/**
 * 获取所有站点列表（去重）
 */
export function getAllStations(lines: ParsedLine[]): ParsedStation[] {
  const stationMap = new Map<string, ParsedStation>();

  for (const line of lines) {
    for (const station of line.stations) {
      if (!stationMap.has(station.name)) {
        stationMap.set(station.name, station);
      } else {
        // 合并线路信息
        const existing = stationMap.get(station.name)!;
        existing.lines = [...new Set([...existing.lines, ...station.lines])];
        existing.isTransfer = existing.lines.length > 1;
      }
    }
  }

  return Array.from(stationMap.values());
}
