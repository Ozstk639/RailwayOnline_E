/**
 * Dynmap 投影系统
 * 基于 Dynmap hdmap.js 的 HDProjection 实现
 *
 * 将 Minecraft 世界坐标转换为 Leaflet LatLng 坐标
 *
 * 重要：中心点(center)只影响初始视图位置，不影响瓦片坐标计算！
 * 瓦片坐标系统始终以 world_to_map 矩阵变换后的原点为基准。
 */

import L from 'leaflet';

export interface DynmapProjectionOptions {
  // 世界坐标 -> 地图坐标 的变换矩阵 (3x3, 行优先)
  worldToMap: number[];
  // 地图坐标 -> 世界坐标 的变换矩阵 (3x3, 行优先)
  mapToWorld: number[];
  // mapzoomin: 额外缩放级别
  mapzoomin: number;
  // mapzoomout: 缩小级别
  mapzoomout: number;
  // 瓦片大小 (128)
  tileSize: number;
  // tilescale: 瓦片缩放 (默认 0)
  tilescale?: number;
}

function computeMapzoomoutFromScale(scale: number): number {
  const s = Number(scale);
  if (!Number.isFinite(s) || s <= 0) return 0;
  return Math.floor(Math.log2(s)) + 1;
}

/**
 * 从 worldToMap 矩阵粗略估计 basemodscale（flat/iso 均可用的近似）。
 * 对应 Dynmap 的 basemodscale（每方块像素数）。
 */
export function estimateBaseModScale(worldToMap: number[]): number {
  const candidates = [worldToMap[0], worldToMap[2], worldToMap[3], worldToMap[5]]
    .map(v => Math.abs(Number(v)))
    .filter(v => Number.isFinite(v));
  const max = candidates.length ? Math.max(...candidates) : 0;
  return max || 1;
}

export function deriveMapzoomout(worldToMap: number[]): number {
  return computeMapzoomoutFromScale(estimateBaseModScale(worldToMap));
}

/**
 * Dynmap 投影类
 * 实现世界坐标和地图 LatLng 之间的转换
 *
 * 基于 hdmap.js 的公式:
 * fromLocationToLatLng:
 *   lat = wtp[3]*x + wtp[4]*y + wtp[5]*z
 *   lng = wtp[0]*x + wtp[1]*y + wtp[2]*z
 *   return LatLng(-((128 << tilescale) - lat) / (1 << mapzoomout), lng / (1 << mapzoomout))
 *
 * 对于 flat 地图 (worldtomap = [4, 0, 0, 0, 0, -4, 0, 1, 0]):
 *   lng = 4 * x
 *   lat = -4 * z
 *   leaflet_lat = -((128 - (-4*z)) / 32) = -(128 + 4*z) / 32
 *   leaflet_lng = 4 * x / 32 = x / 8
 */
export class DynmapProjection {
  private worldToMap: number[];
  private mapToWorld: number[];
  private mapzoomin: number;
  private mapzoomout: number;
  private tileSize: number;
  private tilescale: number;

  constructor(options: DynmapProjectionOptions) {
    this.worldToMap = options.worldToMap;
    this.mapToWorld = options.mapToWorld;
    this.mapzoomin = options.mapzoomin;
    this.mapzoomout = options.mapzoomout;
    this.tileSize = options.tileSize;
    this.tilescale = options.tilescale || 0;
  }

  /**
   * 将世界坐标转换为 Leaflet LatLng
   *
   * 严格按照 hdmap.js fromLocationToLatLng:
   *   lng = wtp[0]*x + wtp[1]*y + wtp[2]*z
   *   lat = wtp[3]*x + wtp[4]*y + wtp[5]*z
   *   leaflet_lat = -((128 << tilescale) - lat) / (1 << mapzoomout)
   *   leaflet_lng = lng / (1 << mapzoomout)
   *
   * 对于 flat 地图 (worldtomap = [4, 0, 0, 0, 0, -4, 0, 1, 0]):
   *   mapLng = 4 * x
   *   mapLat = -4 * z
   *   leaflet_lat = -((128 - (-4*z)) / 32) = -(128 + 4*z) / 32
   *   leaflet_lng = 4 * x / 32 = x / 8
   *
   * 世界 (0,0,0) -> mapLng=0, mapLat=0 -> leaflet_lat=-4, leaflet_lng=0
   */
  locationToLatLng(x: number, y: number, z: number): L.LatLng {
    const worldX = Number(x);
    const worldY = Number(y);
    const worldZ = Number(z);
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY) || !Number.isFinite(worldZ)) {
      console.warn('DynmapProjection.locationToLatLng: invalid location', { x, y, z });
      return L.latLng(0, 0);
    }

    const wtp = this.worldToMap;
    const tileSize = this.tileSize << this.tilescale;  // 128
    const zoomOutScale = 1 << this.mapzoomout;  // 32

    // 矩阵变换
    const mapLng = wtp[0] * worldX + wtp[1] * worldY + wtp[2] * worldZ;  // 4*x
    const mapLat = wtp[3] * worldX + wtp[4] * worldY + wtp[5] * worldZ;  // -4*z

    // Dynmap 的 LatLng 转换公式
    const leafletLat = -(tileSize - mapLat) / zoomOutScale;
    const leafletLng = mapLng / zoomOutScale;

    return L.latLng(leafletLat, leafletLng);
  }

  /**
   * 将 Leaflet LatLng 转换为世界坐标
   *
   * hdmap.js fromLatLngToLocation 的逆运算:
   *   mapLng = leaflet_lng * (1 << mapzoomout)
   *   mapLat = (128 << tilescale) + leaflet_lat * (1 << mapzoomout)
   *   然后应用 map_to_world 矩阵
   */
  latLngToLocation(latLng: L.LatLng, y: number = 64): { x: number; y: number; z: number } {
    const worldY = Number(y);
    if (!Number.isFinite(latLng.lat) || !Number.isFinite(latLng.lng) || !Number.isFinite(worldY)) {
      console.warn('DynmapProjection.latLngToLocation: invalid latLng/y', { latLng, y });
      return { x: 0, y: 0, z: 0 };
    }

    const ptw = this.mapToWorld;
    const tileSize = this.tileSize << this.tilescale;  // 128
    const zoomOutScale = 1 << this.mapzoomout;  // 32

    // 逆转换 Leaflet LatLng 到地图坐标
    const mapLng = latLng.lng * zoomOutScale;
    const mapLat = tileSize + latLng.lat * zoomOutScale;

    // 应用 map_to_world 矩阵
    // ptw = [0.25, 0, 0, 0, 0, 1, 0, -0.25, 0]
    // worldX = 0.25 * mapLng
    // worldZ = -0.25 * mapLat
    const worldX = ptw[0] * mapLng + ptw[1] * mapLat + ptw[2] * worldY;
    const worldZ = ptw[6] * mapLng + ptw[7] * mapLat + ptw[8] * worldY;

    return { x: worldX, y: worldY, z: worldZ };
  }

  get maxZoom(): number {
    return this.mapzoomin + this.mapzoomout;
  }
}

/**
 * 创建 Dynmap 专用的 Leaflet CRS
 *
 * Dynmap 的坐标系统：
 * 1. locationToLatLng 将世界坐标转换为 Dynmap 的 LatLng
 * 2. CRS.project 将 LatLng 转换为像素坐标
 * 3. 瓦片坐标系统以世界原点 (0,0,0) 经过 world_to_map 变换后的点为基准
 *
 * Dynmap LatLng 的含义：
 * - leaflet_lng = mapLng / 32 = (4*x) / 32 = x/8
 * - leaflet_lat = -(128 - mapLat) / 32 = -(128 - (-4*z)) / 32 = -(128 + 4*z) / 32
 *
 * 像素坐标：
 * - pixel_x = leaflet_lng * 128 = x/8 * 128 = 16*x
 * - pixel_y = leaflet_lat * 128 (但需要处理 Y 轴方向)
 */
export function createDynmapCRS(options: DynmapProjectionOptions): L.CRS {
  const projection = new DynmapProjection(options);

  // 创建 Leaflet 投影对象
  const leafletProjection: L.Projection = {
    project(latlng: L.LatLng): L.Point {
      // LatLng -> Point (Leaflet 的“像素”坐标系在 zoom=0 时的单位)
      //
      // 关键点：
      // - DynmapProjection.locationToLatLng 已经把 worldtomap 的像素坐标除以 2^mapzoomout
      // - 因此这里必须“保持单位不变”，不能再乘 tileSize，否则会额外放大 128 倍
      //
      // Leaflet 会在内部再做：pixel = project(latlng) * 2^zoom
      // 并用 tileSize(=128) 去切瓦片网格。
      return L.point(latlng.lng, -latlng.lat);
    },
    unproject(point: L.Point): L.LatLng {
      // Point -> LatLng
      return L.latLng(-point.y, point.x);
    },
    bounds: L.bounds([-Infinity, -Infinity], [Infinity, Infinity])
  };

  // 创建 CRS
  const crs = L.Util.extend({}, L.CRS.Simple, {
    projection: leafletProjection,
    transformation: new L.Transformation(1, 0, 1, 0),
    scale(zoom: number): number {
      return Math.pow(2, zoom);
    },
    zoom(scale: number): number {
      return Math.log(scale) / Math.LN2;
    },
    infinite: true
  });

  // 附加投影实例供外部使用
  (crs as any).dynmapProjection = projection;

  return crs as L.CRS;
}

/**
 * 零洲 flat 地图的默认配置
 * 从 satellite.ria.red API 获取
 */
export const ZTH_FLAT_CONFIG: DynmapProjectionOptions = {
  // worldtomap: [4.0, 0.0, ~0, ~0, 0.0, -4.0, 0.0, 1.0, 0.0]
  // lng = 4*x, lat = -4*z
  worldToMap: [4, 0, 0, 0, 0, -4, 0, 1, 0],
  // maptoworld: [0.25, ~0, 0, 0, 0, 1, ~0, -0.25, 0]
  mapToWorld: [0.25, 0, 0, 0, 0, 1, 0, -0.25, 0],
  // Dynmap 默认 mapzoomin=2（超采样放大 2 级）
  mapzoomin: 2,
  // mapzoomout 由 basemodscale(=4) 推导：floor(log2(4))+1 = 3
  mapzoomout: deriveMapzoomout([4, 0, 0, 0, 0, -4, 0, 1, 0]),
  tileSize: 128,
  tilescale: 0
};

// 世界中心点配置（仅用于初始视图，不影响瓦片坐标）
export const WORLD_CENTERS = {
  zth: { x: -643, y: 35, z: -1562 },
  naraku: { x: 0, y: 64, z: 0 },
  houtu: { x: 0, y: 64, z: 0 }
};

/**
 * 获取世界配置
 */
export function getWorldConfig(worldId: string): DynmapProjectionOptions {
  return ZTH_FLAT_CONFIG;
}
