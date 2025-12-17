/**
 * 铁路图层组件
 * 在地图上渲染铁路线路和站点
 */

import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import type { ParsedLine, ParsedStation, BureausConfig } from '@/types';
import { fetchRailwayData, parseRailwayData, getBureauName } from '@/lib/railwayParser';
import { fetchRMPData, parseRMPData } from '@/lib/rmpParser';
import { DynmapProjection } from '@/lib/DynmapProjection';

// RMP 数据文件映射
const RMP_DATA_FILES: Record<string, string> = {
  zth: '/data/rmp_zth.json',
  houtu: '/data/rmp_houtu.json',
};

interface RailwayLayerProps {
  map: L.Map;
  projection: DynmapProjection;
  worldId: string;
  visible?: boolean;
  onStationClick?: (station: ParsedStation) => void;
}

export function RailwayLayer({
  map,
  projection,
  worldId,
  visible = true,
  onStationClick,
}: RailwayLayerProps) {
  const [lines, setLines] = useState<ParsedLine[]>([]);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  // 加载铁路数据（RIA_Data + RMP）
  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      // 先清空旧数据，避免切换世界时短暂显示上一世界的线路
      setLines([]);

      // 加载 RIA_Data 数据
      const stations = await fetchRailwayData(worldId);
      const { lines: riaLines } = parseRailwayData(stations);

      // 加载 RMP 数据（如果有）
      let rmpLines: ParsedLine[] = [];
      const rmpFile = RMP_DATA_FILES[worldId];
      if (rmpFile) {
        try {
          const rmpData = await fetchRMPData(rmpFile);
          const parsed = parseRMPData(rmpData, worldId);
          rmpLines = parsed.lines;
        } catch (e) {
          console.warn(`Failed to load RMP data for ${worldId}:`, e);
        }
      }

      // 合并两个数据源的线路
      if (!cancelled) {
        setLines([...riaLines, ...rmpLines]);
      }
    }
    loadData();
    return () => {
      cancelled = true;
    };
  }, [worldId]);

  // 创建图层组（仅一次）
  useEffect(() => {
    if (!map) return;

    const group = L.layerGroup();
    layerGroupRef.current = group;
    if (visible) group.addTo(map);

    return () => {
      group.remove();
      if (layerGroupRef.current === group) layerGroupRef.current = null;
    };
  }, [map]);

  // 渲染铁路图层内容（复用同一个图层组，避免可见性/世界切换时状态不同步）
  useEffect(() => {
    const group = layerGroupRef.current;
    if (!group) return;

    group.clearLayers();
    if (lines.length === 0) return;

    // 渲染每条线路
    for (const line of lines) {
      // 转换坐标
      const latLngs = line.stations.map(station =>
        projection.locationToLatLng(station.coord.x, station.coord.y, station.coord.z)
      );

      // 绘制线路
      const polyline = L.polyline(latLngs, {
        color: line.color,
        weight: 3,
        opacity: 0.8,
      });

      polyline.bindTooltip(`${line.bureau}-${line.line}`, {
        permanent: false,
        direction: 'center',
      });

      group.addLayer(polyline);

      // 绘制站点
      for (const station of line.stations) {
        const latLng = projection.locationToLatLng(
          station.coord.x,
          station.coord.y,
          station.coord.z
        );

        // 换乘站用更大的圆圈
        const radius = station.isTransfer ? 6 : 4;
        const fillColor = station.isTransfer ? '#ffffff' : line.color;
        const borderWidth = station.isTransfer ? 3 : 2;

        const marker = L.circleMarker(latLng, {
          radius,
          color: line.color,
          weight: borderWidth,
          fillColor,
          fillOpacity: 1,
        });

        // 站点 tooltip
        const tooltipContent = station.isTransfer
          ? `<b>${station.name}</b><br/>换乘站: ${station.lines.join(', ')}`
          : `<b>${station.name}</b><br/>${line.bureau}-${line.line}`;

        marker.bindTooltip(tooltipContent, {
          permanent: false,
          direction: 'top',
          offset: [0, -5],
        });

        // 站点点击事件
        if (onStationClick) {
          marker.on('click', () => {
            onStationClick(station);
          });
        }

        // 创建站点弹窗
        const popupContent = `
          <div class="station-popup">
            <h3 style="margin: 0 0 8px 0; font-size: 14px;">${station.name}</h3>
            <p style="margin: 0; font-size: 12px; color: #666;">
              坐标: X ${Math.round(station.coord.x)}, Z ${Math.round(station.coord.z)}
            </p>
            <p style="margin: 4px 0 0 0; font-size: 12px;">
              线路: ${station.lines.join(', ')}
            </p>
          </div>
        `;
        marker.bindPopup(popupContent);

        group.addLayer(marker);
      }
    }
  }, [lines, projection, onStationClick]);

  // 控制图层可见性
  useEffect(() => {
    const group = layerGroupRef.current;
    if (!group || !map) return;

    if (visible) {
      if (!map.hasLayer(group)) {
        group.addTo(map);
      }
    } else {
      if (map.hasLayer(group)) {
        map.removeLayer(group);
      }
    }
  }, [visible, map]);

  return null;
}

/**
 * 铁路图层控制面板
 */
interface RailwayControlProps {
  lines: ParsedLine[];
  visibleLines: Set<string>;
  bureausConfig: BureausConfig;
  onToggleLine: (lineId: string) => void;
  onToggleAll: (visible: boolean) => void;
}

export function RailwayControl({
  lines,
  visibleLines,
  bureausConfig,
  onToggleLine,
  onToggleAll,
}: RailwayControlProps) {
  // 按管理局分组
  const groupedLines = lines.reduce((acc, line) => {
    if (!acc[line.bureau]) {
      acc[line.bureau] = [];
    }
    acc[line.bureau].push(line);
    return acc;
  }, {} as Record<string, ParsedLine[]>);

  return (
    <div className="railway-control bg-white rounded-lg shadow-lg p-3 max-h-80 overflow-y-auto">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold text-sm">铁路线路</h3>
        <div className="flex gap-1">
          <button
            className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
            onClick={() => onToggleAll(true)}
          >
            全选
          </button>
          <button
            className="text-xs px-2 py-1 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
            onClick={() => onToggleAll(false)}
          >
            全不选
          </button>
        </div>
      </div>

      {Object.entries(groupedLines).map(([bureau, bureauLines]) => (
        <div key={bureau} className="mb-2">
          <div className="text-xs font-medium text-gray-500 mb-1">
            {getBureauName(bureausConfig, bureau)}
          </div>
          <div className="flex flex-wrap gap-1">
            {bureauLines.map(line => (
              <button
                key={line.lineId}
                className={`text-xs px-2 py-1 rounded transition-colors ${
                  visibleLines.has(line.lineId)
                    ? 'text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
                style={{
                  backgroundColor: visibleLines.has(line.lineId)
                    ? line.color
                    : undefined,
                }}
                onClick={() => onToggleLine(line.lineId)}
              >
                {line.lineId}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default RailwayLayer;
