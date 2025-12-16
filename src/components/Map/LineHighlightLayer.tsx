/**
 * 线路高亮图层组件
 * 在地图上高亮显示选中的线路
 */

import { useEffect, useRef } from 'react';
import * as L from 'leaflet';
import type { DynmapProjection } from '@/lib/DynmapProjection';
import type { ParsedLine } from '@/types';

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

    // 转换坐标
    const latLngs = line.stations.map(s =>
      projection.locationToLatLng(s.coord.x, s.coord.y || 64, s.coord.z)
    );

    if (latLngs.length < 2) return;

    // 绘制线路主体（使用线路颜色，加粗显示）
    const mainPath = L.polyline(latLngs, {
      color: line.color,
      weight: 5,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
    });
    layerGroup.addLayer(mainPath);

    // 添加站点标记
    line.stations.forEach((station, index) => {
      const latLng = latLngs[index];
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
