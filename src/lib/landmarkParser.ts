/**
 * 地标数据解析器
 * 从 RIA_Data 仓库获取地标数据
 */

import { fetchWithMirror, type ProgressCallback } from './fetchWithMirror';

export interface LandmarkCoord {
  x: number;
  y: number;
  z: number;
}

export interface Landmark {
  id: number;
  name: string;
  grade: string;  // 白级/准级/标级/赤级/黑级/Unknown
  status: string; // Normal/Removed
  coordinates: LandmarkCoord | 'Unknown';
}

export interface ParsedLandmark {
  id: number;
  name: string;
  grade: string;
  status: string;
  coord: LandmarkCoord | null;
}

function coerceCoord(value: unknown): LandmarkCoord | null {
  const coord = value as Partial<LandmarkCoord> | null | undefined;
  const x = Number(coord?.x);
  const y = Number(coord?.y);
  const z = Number(coord?.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

// 地标等级颜色映射
export const GRADE_COLORS: Record<string, string> = {
  '白级': '#9E9E9E',    // 灰色
  '准级': '#4CAF50',    // 绿色
  '标级': '#2196F3',    // 蓝色
  '赤级': '#FF5722',    // 橙红色
  '黑级': '#212121',    // 黑色
  'Unknown': '#757575', // 深灰色
};

// 地标等级图标大小
export const GRADE_SIZES: Record<string, number> = {
  '白级': 4,
  '准级': 5,
  '标级': 6,
  '赤级': 7,
  '黑级': 8,
  'Unknown': 4,
};

/**
 * 获取地标数据
 */
export async function fetchLandmarkData(
  worldId: string,
  onProgress?: ProgressCallback
): Promise<Landmark[]> {
  const url = `https://raw.githubusercontent.com/RainC7/RIA_Data/main/data/landmark/${worldId}.json`;

  try {
    return await fetchWithMirror<Landmark[]>(url, '地标数据', onProgress);
  } catch (error) {
    console.error('Error fetching landmark data:', error);
    return [];
  }
}

/**
 * 解析地标数据
 */
export function parseLandmarkData(landmarks: Landmark[]): ParsedLandmark[] {
  return landmarks
    .filter(landmark => landmark.status !== 'Removed')
    .map(landmark => ({
      id: landmark.id,
      name: landmark.name,
      grade: landmark.grade,
      status: landmark.status,
      coord: landmark.coordinates === 'Unknown' ? null : coerceCoord(landmark.coordinates),
    }))
    .filter(landmark => landmark.coord !== null);
}

/**
 * 按等级分组地标
 */
export function groupLandmarksByGrade(landmarks: ParsedLandmark[]): Record<string, ParsedLandmark[]> {
  const groups: Record<string, ParsedLandmark[]> = {};

  for (const landmark of landmarks) {
    const grade = landmark.grade || 'Unknown';
    if (!groups[grade]) {
      groups[grade] = [];
    }
    groups[grade].push(landmark);
  }

  return groups;
}

/**
 * 获取地标颜色
 */
export function getLandmarkColor(grade: string): string {
  return GRADE_COLORS[grade] || GRADE_COLORS['Unknown'];
}

/**
 * 获取地标大小
 */
export function getLandmarkSize(grade: string): number {
  return GRADE_SIZES[grade] || GRADE_SIZES['Unknown'];
}
