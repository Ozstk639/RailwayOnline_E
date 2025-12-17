/**
 * RMP 路径计算器
 * 计算 perpendicular、diagonal、simple 三种类型的弯道路径
 */

import type { Coordinate, PathSegment, EdgePath } from '@/types';

// 2D 点类型（RMP 坐标系）
interface Point2D {
  x: number;
  y: number;
}

// 坐标转换配置
export interface CoordTransformConfig {
  scale: number;
  offset: number;
  multiplier: number;
}

// perpendicular 边配置
export interface PerpendicularConfig {
  startFrom: 'from' | 'to';
  offsetFrom: number;
  offsetTo: number;
  roundCornerFactor: number;
}

// diagonal 边配置
export interface DiagonalConfig {
  startFrom: 'from' | 'to';
  offsetFrom: number;
  offsetTo: number;
  roundCornerFactor: number;
}

// simple 边配置
export interface SimpleConfig {
  offset: number;
}

/**
 * 向量归一化
 */
function normalize(v: Point2D): Point2D {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}

/**
 * 计算垂直向量（逆时针旋转 90 度）
 */
function perpendicular(v: Point2D): Point2D {
  return { x: -v.y, y: v.x };
}

/**
 * 计算两点距离
 */
function distance(p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 计算二次贝塞尔曲线长度（数值积分近似）
 */
function quadraticBezierLength(p0: Point2D, p1: Point2D, p2: Point2D): number {
  const segments = 10;
  let length = 0;
  let prev = p0;

  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    const curr = {
      x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
      y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    };
    length += distance(prev, curr);
    prev = curr;
  }

  return length;
}

/**
 * 将 2D 点转换为游戏坐标
 */
function toGameCoord(p: Point2D, config: CoordTransformConfig): Coordinate {
  return {
    x: (p.x * config.scale + config.offset) * config.multiplier,
    y: 64,
    z: (p.y * config.scale + config.offset) * config.multiplier,
  };
}

/**
 * 应用圆角到转角点
 * 返回圆角前后的点和贝塞尔曲线控制点
 */
function applyRoundCorner(
  before: Point2D,
  corner: Point2D,
  after: Point2D,
  factor: number
): { cornerStart: Point2D; cornerEnd: Point2D; control: Point2D } {
  // 计算从 corner 到 before 和 after 的方向向量
  const v1 = normalize({ x: before.x - corner.x, y: before.y - corner.y });
  const v2 = normalize({ x: after.x - corner.x, y: after.y - corner.y });

  // 计算可用的最大圆角半径（不超过两条边长度的一半）
  const dist1 = distance(corner, before);
  const dist2 = distance(corner, after);
  const maxFactor = Math.min(dist1, dist2) * 0.5;
  const clampedFactor = Math.min(factor, maxFactor);

  // 圆角起点和终点
  const cornerStart = {
    x: corner.x + v1.x * clampedFactor,
    y: corner.y + v1.y * clampedFactor,
  };
  const cornerEnd = {
    x: corner.x + v2.x * clampedFactor,
    y: corner.y + v2.y * clampedFactor,
  };

  return { cornerStart, cornerEnd, control: corner };
}

/**
 * 计算 perpendicular 类型路径（L 形折线，带圆角）
 */
export function calculatePerpendicularPath(
  from: Point2D,
  to: Point2D,
  config: PerpendicularConfig,
  coordConfig: CoordTransformConfig
): EdgePath {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // 计算偏移方向（垂直于连线）
  const dir = normalize({ x: dx, y: dy });
  const perpDir = perpendicular(dir);

  // 应用偏移（在 RMP 坐标系）
  const p1: Point2D = {
    x: from.x + perpDir.x * config.offsetFrom,
    y: from.y + perpDir.y * config.offsetFrom,
  };
  const p2: Point2D = {
    x: to.x + perpDir.x * config.offsetTo,
    y: to.y + perpDir.y * config.offsetTo,
  };

  // 根据 startFrom 决定转角点位置
  // startFrom: "from" 表示从起点方向开始，先走主要方向
  let corner: Point2D;

  // 判断主要方向（水平还是垂直）
  const isHorizontalDominant = Math.abs(dx) >= Math.abs(dy);

  if (config.startFrom === 'from') {
    // 从起点开始，先走主要方向
    if (isHorizontalDominant) {
      // 先水平后垂直：转角点在 (p2.x, p1.y)
      corner = { x: p2.x, y: p1.y };
    } else {
      // 先垂直后水平：转角点在 (p1.x, p2.y)
      corner = { x: p1.x, y: p2.y };
    }
  } else {
    // 从终点开始（反向），先走次要方向
    if (isHorizontalDominant) {
      // 先垂直后水平：转角点在 (p1.x, p2.y)
      corner = { x: p1.x, y: p2.y };
    } else {
      // 先水平后垂直：转角点在 (p2.x, p1.y)
      corner = { x: p2.x, y: p1.y };
    }
  }

  // 应用圆角
  const { cornerStart, cornerEnd, control } = applyRoundCorner(
    p1,
    corner,
    p2,
    config.roundCornerFactor
  );

  // 构建路径段（转换到游戏坐标）
  const segments: PathSegment[] = [];
  let totalLength = 0;

  // 第一段：起点到圆角起点
  const dist1 = distance(p1, cornerStart);
  if (dist1 > 0.001) {
    segments.push({
      type: 'line',
      points: [toGameCoord(p1, coordConfig), toGameCoord(cornerStart, coordConfig)],
    });
    totalLength += dist1 * coordConfig.multiplier;
  }

  // 第二段：圆角（二次贝塞尔曲线）
  const curveLength = quadraticBezierLength(cornerStart, control, cornerEnd);
  if (curveLength > 0.001) {
    segments.push({
      type: 'quadratic',
      points: [
        toGameCoord(cornerStart, coordConfig),
        toGameCoord(control, coordConfig),
        toGameCoord(cornerEnd, coordConfig),
      ],
    });
    totalLength += curveLength * coordConfig.multiplier;
  }

  // 第三段：圆角终点到终点
  const dist2 = distance(cornerEnd, p2);
  if (dist2 > 0.001) {
    segments.push({
      type: 'line',
      points: [toGameCoord(cornerEnd, coordConfig), toGameCoord(p2, coordConfig)],
    });
    totalLength += dist2 * coordConfig.multiplier;
  }

  return { segments, length: totalLength };
}

/**
 * 计算 diagonal 类型路径（45° 斜线连接，带圆角）
 */
export function calculateDiagonalPath(
  from: Point2D,
  to: Point2D,
  config: DiagonalConfig,
  coordConfig: CoordTransformConfig
): EdgePath {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // 计算偏移方向
  const dir = normalize({ x: dx, y: dy });
  const perpDir = perpendicular(dir);

  // 应用偏移
  const p1: Point2D = {
    x: from.x + perpDir.x * config.offsetFrom,
    y: from.y + perpDir.y * config.offsetFrom,
  };
  const p2: Point2D = {
    x: to.x + perpDir.x * config.offsetTo,
    y: to.y + perpDir.y * config.offsetTo,
  };

  // diagonal 类型：创建 45° 斜线
  // 计算需要走的斜线长度（取 x 和 y 差值的较小者）
  const newDx = p2.x - p1.x;
  const newDy = p2.y - p1.y;
  const diagonalLen = Math.min(Math.abs(newDx), Math.abs(newDy));

  // 斜线方向
  const signX = Math.sign(newDx) || 1;
  const signY = Math.sign(newDy) || 1;

  let corner1: Point2D, corner2: Point2D;

  if (config.startFrom === 'from') {
    // 从起点开始：先直线，后斜线，最后直线
    // 斜线在中间位置
    const midX = p1.x + (newDx - signX * diagonalLen) / 2;
    const midY = p1.y;

    corner1 = { x: midX, y: midY };
    corner2 = { x: midX + signX * diagonalLen, y: midY + signY * diagonalLen };
  } else {
    // 从终点开始
    const midX = p2.x - (newDx - signX * diagonalLen) / 2;
    const midY = p2.y;

    corner2 = { x: midX, y: midY };
    corner1 = { x: midX - signX * diagonalLen, y: midY - signY * diagonalLen };
  }

  // 构建路径段
  const segments: PathSegment[] = [];
  let totalLength = 0;

  // 应用圆角到第一个转角
  const round1 = applyRoundCorner(p1, corner1, corner2, config.roundCornerFactor);

  // 应用圆角到第二个转角
  const round2 = applyRoundCorner(corner1, corner2, p2, config.roundCornerFactor);

  // 第一段：起点到第一个圆角起点
  const dist1 = distance(p1, round1.cornerStart);
  if (dist1 > 0.001) {
    segments.push({
      type: 'line',
      points: [toGameCoord(p1, coordConfig), toGameCoord(round1.cornerStart, coordConfig)],
    });
    totalLength += dist1 * coordConfig.multiplier;
  }

  // 第二段：第一个圆角
  const curve1Len = quadraticBezierLength(round1.cornerStart, round1.control, round1.cornerEnd);
  if (curve1Len > 0.001) {
    segments.push({
      type: 'quadratic',
      points: [
        toGameCoord(round1.cornerStart, coordConfig),
        toGameCoord(round1.control, coordConfig),
        toGameCoord(round1.cornerEnd, coordConfig),
      ],
    });
    totalLength += curve1Len * coordConfig.multiplier;
  }

  // 第三段：两个圆角之间的斜线
  const dist2 = distance(round1.cornerEnd, round2.cornerStart);
  if (dist2 > 0.001) {
    segments.push({
      type: 'line',
      points: [toGameCoord(round1.cornerEnd, coordConfig), toGameCoord(round2.cornerStart, coordConfig)],
    });
    totalLength += dist2 * coordConfig.multiplier;
  }

  // 第四段：第二个圆角
  const curve2Len = quadraticBezierLength(round2.cornerStart, round2.control, round2.cornerEnd);
  if (curve2Len > 0.001) {
    segments.push({
      type: 'quadratic',
      points: [
        toGameCoord(round2.cornerStart, coordConfig),
        toGameCoord(round2.control, coordConfig),
        toGameCoord(round2.cornerEnd, coordConfig),
      ],
    });
    totalLength += curve2Len * coordConfig.multiplier;
  }

  // 第五段：第二个圆角终点到终点
  const dist3 = distance(round2.cornerEnd, p2);
  if (dist3 > 0.001) {
    segments.push({
      type: 'line',
      points: [toGameCoord(round2.cornerEnd, coordConfig), toGameCoord(p2, coordConfig)],
    });
    totalLength += dist3 * coordConfig.multiplier;
  }

  return { segments, length: totalLength };
}

/**
 * 计算 simple 类型路径（直线）
 */
export function calculateSimplePath(
  from: Point2D,
  to: Point2D,
  config: SimpleConfig,
  coordConfig: CoordTransformConfig
): EdgePath {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // 计算偏移方向
  const dir = normalize({ x: dx, y: dy });
  const perpDir = perpendicular(dir);

  // 应用偏移
  const p1: Point2D = {
    x: from.x + perpDir.x * config.offset,
    y: from.y + perpDir.y * config.offset,
  };
  const p2: Point2D = {
    x: to.x + perpDir.x * config.offset,
    y: to.y + perpDir.y * config.offset,
  };

  const length = distance(p1, p2) * coordConfig.multiplier;

  return {
    segments: [
      {
        type: 'line',
        points: [toGameCoord(p1, coordConfig), toGameCoord(p2, coordConfig)],
      },
    ],
    length,
  };
}

/**
 * 计算直线路径（无配置，用于回退）
 */
export function calculateStraightPath(
  from: Point2D,
  to: Point2D,
  coordConfig: CoordTransformConfig
): EdgePath {
  const length = distance(from, to) * coordConfig.multiplier;

  return {
    segments: [
      {
        type: 'line',
        points: [toGameCoord(from, coordConfig), toGameCoord(to, coordConfig)],
      },
    ],
    length,
  };
}
