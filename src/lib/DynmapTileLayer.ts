/**
 * Dynmap 瓦片图层
 * 基于 LiveAtlas 的 DynmapTileLayer.ts 实现
 *
 * 处理 Dynmap 特殊的瓦片 URL 生成规则
 */

import L from 'leaflet';

export interface DynmapTileLayerOptions extends L.TileLayerOptions {
  // 基础 URL，如 https://satellite.ria.red/tiles/_zth/
  baseUrl: string;
  // 地图前缀，如 flat
  prefix: string;
  // 图片格式，如 jpg 或 png
  imageFormat: string;
  // 额外的缩放级别（mapzoomin）
  extraZoomLevels: number;
  // 是否支持昼夜切换
  nightAndDay?: boolean;
  // 当前是否为夜间模式
  isNight?: boolean;
}

export interface DynmapLatLngTileResult {
  mapZoom: number;
  tileZoom: number;
  coords: L.Coords;
  izoom: number;
  zoomoutlevel: number;
  scale: number;
  info: {
    prefix: string;
    nightday: string;
    scaledx: number;
    scaledy: number;
    zoom: string;
    x: number;
    y: number;
    fmt: string;
  };
  url: string;
}

/**
 * Dynmap 瓦片图层类
 */
export class DynmapTileLayer extends L.TileLayer {
  private _baseUrl: string;
  private _prefix: string;
  private _imageFormat: string;
  private _extraZoomLevels: number;
  private _nightAndDay: boolean;
  private _isNight: boolean;

  constructor(options: DynmapTileLayerOptions) {
    // 使用占位符 URL，实际 URL 在 getTileUrl 中生成
    super('', {
      ...options,
      // Dynmap 瓦片大小固定为 128
      tileSize: 128,
      // Dynmap 使用 zoomReverse (最大放大对应 izoom=0)
      zoomReverse: true,
      // 不需要自动检测 retina
      detectRetina: false,
      // 关闭错误瓦片的默认占位
      errorTileUrl: ''
    });

    this._baseUrl = options.baseUrl;
    this._prefix = options.prefix;
    this._imageFormat = options.imageFormat || 'jpg';
    this._extraZoomLevels = options.extraZoomLevels || 0;
    this._nightAndDay = options.nightAndDay || false;
    this._isNight = options.isNight || true;
  }

  /**
   * 生成缩放前缀
   * 0 -> ''
   * 1 -> 'z'
   * 2 -> 'zz'
   * 5 -> 'zzzzz'
   */
  private zoomPrefix(amount: number): string {
    if (amount === 0) return '';
    return 'z'.repeat(amount);
  }

  /**
   * 获取瓦片信息
   * 基于 dynmaputils.js getTileInfo
   */
  private getTileInfo(coords: L.Coords): {
    prefix: string;
    nightday: string;
    scaledx: number;
    scaledy: number;
    zoom: string;
    x: number;
    y: number;
    fmt: string;
  } {
    const maxZoom = this.options.maxZoom || 6;
    // izoom: 最大缩放时为 0，最小缩放时为 maxZoom
    const izoom = maxZoom - coords.z;
    // zoomoutlevel: 计算实际的缩放级别
    const zoomoutlevel = Math.max(0, izoom - this._extraZoomLevels);
    // 缩放因子
    const scale = 1 << zoomoutlevel;

    // 计算瓦片坐标
    // Dynmap 的 Y 坐标需要翻转
    const x = scale * coords.x;
    const y = scale * -coords.y;

    return {
      prefix: this._prefix,
      nightday: (this._nightAndDay && !this._isNight) ? '_day' : '',
      scaledx: x >> 5,  // 除以 32
      scaledy: y >> 5,
      zoom: this.zoomPrefix(zoomoutlevel),
      x: x,
      y: y,
      fmt: this._imageFormat
    };
  }

  /**
   * 将 LatLng 在指定 zoom 下映射为 Leaflet 传入的 tile coords。
   *
   * Leaflet 内部逻辑本质是：
   *   point = CRS.latLngToPoint(latlng, zoom)
   *   coords = floor(point / tileSize)
   *
   * 我们的 CRS.project 使用 point = (lng, -lat)，
   * 因而 coords = floor(lng*2^zoom / tileSize), floor(-lat*2^zoom / tileSize)。
   */
  getCoordsForLatLng(latLng: L.LatLng, zoom: number): L.Coords {
    const zoomScale = Math.pow(2, zoom);
    const tileSize = typeof this.options.tileSize === 'number' ? this.options.tileSize : 128;
    const x = Math.floor((latLng.lng * zoomScale) / tileSize);
    const y = Math.floor((-latLng.lat * zoomScale) / tileSize);
    return { x, y, z: zoom } as L.Coords;
  }

  private clampTileZoom(zoom: number): number {
    const rounded = Math.round(zoom);
    const minNativeZoom = this.options.minNativeZoom;
    const maxNativeZoom = this.options.maxNativeZoom;
    if (typeof minNativeZoom === 'number' && rounded < minNativeZoom) return minNativeZoom;
    if (typeof maxNativeZoom === 'number' && maxNativeZoom < rounded) return maxNativeZoom;
    return rounded;
  }

  /**
   * 用 LatLng 直接计算 Dynmap 的瓦片信息与 URL（与 Leaflet 实际取瓦片一致）。
   *
   * 注意：如果 mapZoom > maxNativeZoom（超采样放大），Leaflet 实际取瓦片会使用 clamp 后的 tileZoom。
   */
  getDynmapTileForLatLng(latLng: L.LatLng, mapZoom: number): DynmapLatLngTileResult {
    const tileZoom = this.clampTileZoom(mapZoom);
    const coords = this.getCoordsForLatLng(latLng, tileZoom);

    const maxZoom = this.options.maxZoom || 6;
    const izoom = maxZoom - coords.z;
    const zoomoutlevel = Math.max(0, izoom - this._extraZoomLevels);
    const scale = 1 << zoomoutlevel;

    const info = this.getTileInfo(coords);
    const zoomPart = info.zoom ? `${info.zoom}_` : '';
    const url = `${this._baseUrl}${info.prefix}${info.nightday}/${info.scaledx}_${info.scaledy}/${zoomPart}${info.x}_${info.y}.${info.fmt}`;

    return { mapZoom, tileZoom, coords, izoom, zoomoutlevel, scale, info, url };
  }

  /**
   * 重写获取瓦片 URL 的方法
   */
  getTileUrl(coords: L.Coords): string {
    const info = this.getTileInfo(coords);

    // URL 格式: {baseUrl}{prefix}{nightday}/{scaledx}_{scaledy}/{zoom}_{x}_{y}.{fmt}
    // 例如: https://satellite.ria.red/map/_zth/tiles/world/flat/2_2/zzzzz_64_64.jpg
    const zoomPart = info.zoom ? `${info.zoom}_` : '';
    const url = `${this._baseUrl}${info.prefix}${info.nightday}/${info.scaledx}_${info.scaledy}/${zoomPart}${info.x}_${info.y}.${info.fmt}`;

    return url;
  }

  /**
   * 设置夜间模式
   */
  setNight(isNight: boolean): void {
    if (this._isNight !== isNight) {
      this._isNight = isNight;
      this.redraw();
    }
  }
}

/**
 * 创建 Dynmap 瓦片图层的工厂函数
 */
export function createDynmapTileLayer(
  worldId: string,
  mapName: string = 'flat',
  options?: Partial<DynmapTileLayerOptions>
): DynmapTileLayer {
  const defaultOptions: DynmapTileLayerOptions = {
    // 正确的 URL 格式: https://satellite.ria.red/map/_zth/tiles/world/flat/5_-1/zzzzz_160_-32.jpg
    baseUrl: `https://satellite.ria.red/map/_${worldId}/tiles/world/`,
    prefix: mapName,
    imageFormat: 'jpg',
    // Dynmap 默认 mapzoomin=2（超采样）
    extraZoomLevels: 2,
    // maxZoom = mapzoomin(2) + mapzoomout(3)
    maxZoom: 5,
    // maxNativeZoom = mapzoomout（超过该级别只做前端放大）
    maxNativeZoom: 3,
    minZoom: 0,
    nightAndDay: false,
    isNight: true,
    // 设置属性
    attribution: '&copy; <a href="https://satellite.ria.red">RIA Satellite</a>'
  };

  const merged: DynmapTileLayerOptions = {
    ...defaultOptions,
    ...options
  };

  // 如果调用方没显式给 maxNativeZoom，则根据 maxZoom/extraZoomLevels 推导
  if (merged.maxNativeZoom === undefined && typeof merged.maxZoom === 'number') {
    merged.maxNativeZoom = Math.max(0, merged.maxZoom - (merged.extraZoomLevels || 0));
  }

  return new DynmapTileLayer(merged);
}
