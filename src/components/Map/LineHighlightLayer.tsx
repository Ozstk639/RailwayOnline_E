/**
 * 线路高亮图层组件
 * 在地图上高亮显示选中的线路
 */

import { useEffect, useRef } from 'react';
import * as L from 'leaflet';
import type { DynmapProjection } from '@/lib/DynmapProjection';
import type { ParsedLine, PathSegment } from '@/types';

/**
 * 采样二次贝塞尔曲线为折线点
 */
function sampleQuadraticBezier(
  p0: L.LatLng,
  p1: L.LatLng,
  p2: L.LatLng,
  segments: number = 8
): L.LatLng[] {
  const points: L.LatLng[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    points.push(
      L.latLng(
        mt * mt * p0.lat + 2 * mt * t * p1.lat + t * t * p2.lat,
        mt * mt * p0.lng + 2 * mt * t * p1.lng + t * t * p2.lng
      )
    );
  }
  return points;
}

/**
 * 将路径段转换为 LatLng 数组
 */
function segmentToLatLngs(
  segment: PathSegment,
  projection: DynmapProjection
): L.LatLng[] {
  if (segment.type === 'line') {
    return segment.points.map(p =>
      projection.locationToLatLng(p.x, p.y, p.z)
    );
  } else if (segment.type === 'quadratic') {
    const [p0, p1, p2] = segment.points;
    const latLng0 = projection.locationToLatLng(p0.x, p0.y, p0.z);
    const latLng1 = projection.locationToLatLng(p1.x, p1.y, p1.z);
    const latLng2 = projection.locationToLatLng(p2.x, p2.y, p2.z);
    return sampleQuadraticBezier(latLng0, latLng1, latLng2);
  }
  return [];
}

interface LineHighlightLayerProps {
  map: L.Map;
  projection: DynmapProjection;
  line: ParsedLine;
}

export function LineHighlightLayer({
  map,
  projection,
  line,
}: LineHighlightLayerProps) {
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    // 创建图层组
    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;

    // 转换站点坐标（用于站点标记）
    const stationLatLngs = line.stations.map(s =>
      projection.locationToLatLng(s.coord.x, s.coord.y || 64, s.coord.z)
    );

    if (stationLatLngs.length < 2) return;

    // 绘制线路主体
    if (line.edgePaths && line.edgePaths.length > 0) {
      // 使用曲线渲染
      for (const edgePath of line.edgePaths) {
        for (const segment of edgePath.segments) {
          const latLngs = segmentToLatLngs(segment, projection);
          if (latLngs.length >= 2) {
            const path = L.polyline(latLngs, {
              color: line.color,
              weight: 5,
              opacity: 1,
              lineCap: 'round',
              lineJoin: 'round',
            });
            layerGroup.addLayer(path);
          }
        }
      }
    } else {
      // 回退到直线渲染
      const mainPath = L.polyline(stationLatLngs, {
        color: line.color,
        weight: 5,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
      });
      layerGroup.addLayer(mainPath);
    }

    // 添加站点标记
    line.stations.forEach((station, index) => {
      const latLng = stationLatLngs[index];
      const isTerminal = index === 0 || index === line.stations.length - 1;

      const marker = L.circleMarker(latLng, {
        radius: isTerminal ? 7 : 5,
        fillColor: '#ffffff',
        fillOpacity: 1,
        color: line.color,
        weight: isTerminal ? 3 : 2,
      });

      marker.bindTooltip(station.name, {
        permanent: false,
        direction: 'top',
        className: 'line-station-tooltip',
      });

      layerGroup.addLayer(marker);
    });

    // 清理函数
    return () => {
      if (layerGroupRef.current) {
        layerGroupRef.current.remove();
        layerGroupRef.current = null;
      }
    };
  }, [map, projection, line]);

  return null;
}

export default LineHighlightLayer;
