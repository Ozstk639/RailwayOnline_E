/**
 * 玩家图层组件
 * 在地图上渲染在线玩家位置（显示玩家头像）
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as L from 'leaflet';
import type { Player } from '@/types';
import { fetchPlayers } from '@/lib/playerApi';
import { DynmapProjection } from '@/lib/DynmapProjection';

/**
 * 获取玩家头像 URL (从 LittleSkin)
 */
function getPlayerAvatarUrl(playerName: string, size: number = 32): string {
  return `https://littleskin.cn/avatar/player/${encodeURIComponent(playerName)}?size=${size}`;
}

/**
 * 创建玩家头像 HTML (圆形头像带边框)
 */
function createPlayerAvatarHtml(playerName: string, size: number = 32): string {
  const avatarUrl = getPlayerAvatarUrl(playerName, size);
  return `
    <div style="
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      border: 3px solid #06b6d4;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      overflow: hidden;
      background: #1e293b;
    ">
      <img
        src="${avatarUrl}"
        alt="${playerName}"
        style="width: 100%; height: 100%; object-fit: cover;"
        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%2306b6d4%22><circle cx=%2212%22 cy=%228%22 r=%225%22/><path d=%22M20 21a8 8 0 0 0-16 0%22/></svg>'"
      />
    </div>
  `;
}

interface PlayerLayerProps {
  map: L.Map;
  projection: DynmapProjection;
  worldId: string;
  visible?: boolean;
  onPlayerClick?: (player: Player) => void;
}

export function PlayerLayer({
  map,
  projection,
  worldId,
  visible = true,
  onPlayerClick,
}: PlayerLayerProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const intervalRef = useRef<number | null>(null);

  // 加载玩家数据
  const loadPlayers = useCallback(async () => {
    const data = await fetchPlayers(worldId);
    setPlayers(data);
  }, [worldId]);

  // 初始加载和定时刷新
  useEffect(() => {
    // 立即加载一次
    loadPlayers();

    // 设置定时刷新 (5秒)
    intervalRef.current = window.setInterval(() => {
      loadPlayers();
    }, 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [loadPlayers]);

  // 世界切换时清空玩家列表
  useEffect(() => {
    setPlayers([]);
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

  // 渲染玩家图层内容
  useEffect(() => {
    const group = layerGroupRef.current;
    if (!group) return;

    group.clearLayers();
    if (players.length === 0) return;

    // 渲染每个玩家
    for (const player of players) {
      if (
        !Number.isFinite(player.x) ||
        !Number.isFinite(player.y) ||
        !Number.isFinite(player.z)
      ) continue;

      const latLng = projection.locationToLatLng(player.x, player.y, player.z);

      // 创建玩家头像图标
      const markerSize = 32;
      const markerIcon = L.divIcon({
        className: 'player-avatar-icon',
        html: createPlayerAvatarHtml(player.name, markerSize),
        iconSize: [markerSize + 6, markerSize + 6], // 加上边框尺寸
        iconAnchor: [(markerSize + 6) / 2, (markerSize + 6) / 2],
      });

      const marker = L.marker(latLng, { icon: markerIcon });

      // 玩家 tooltip
      const healthBar = `${'❤'.repeat(Math.ceil(player.health / 2))}`;
      marker.bindTooltip(
        `<b>${player.name}</b><br/><span style="color: #ef4444;">${healthBar}</span>`,
        {
          permanent: false,
          direction: 'top',
          offset: [0, -8],
        }
      );

      // 玩家点击事件
      if (onPlayerClick) {
        marker.on('click', () => {
          onPlayerClick(player);
        });
      }

      group.addLayer(marker);
    }
  }, [players, projection, onPlayerClick]);

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

// 导出获取头像 URL 函数供其他组件使用
export { getPlayerAvatarUrl };

export default PlayerLayer;
