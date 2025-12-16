/**
 * 玩家数据 API
 * 从 Dynmap API 获取在线玩家位置信息
 */

import type { Player } from '@/types';

// 世界ID映射 (前端 -> API)
const WORLD_MAP: Record<string, string> = {
  zth: '_zth',
  eden: '_eden',
  naraku: '_naraku',
  houtu: '_houtu',
};

interface DynmapUpdateResponse {
  currentcount: number;
  hasStorm: boolean;
  isThundering: boolean;
  servertime: number;
  confighash: number;
  players: Array<{
    world: string;
    armor: number;
    name: string;
    x: number;
    y: number;
    z: number;
    health: number;
    sort: number;
    type: string;
    account: string;
  }>;
  updates: Array<{
    type: string;
    name: string;
    timestamp: number;
  }>;
}

/**
 * 获取指定世界的在线玩家列表
 * 通过 Vercel 代理绕过 CORS 限制
 */
export async function fetchPlayers(worldId: string): Promise<Player[]> {
  const apiWorld = WORLD_MAP[worldId] || `_${worldId}`;
  const timestamp = Date.now();
  // 使用 Vercel 代理路径
  const url = `/api/dynmap/${apiWorld}/up/world/world/${timestamp}`;

  try {
    const res = await fetch(url);

    if (!res.ok) {
      console.warn(`Failed to fetch players: ${res.status}`);
      return [];
    }

    const data: DynmapUpdateResponse = await res.json();

    // 转换为 Player 类型
    return (data.players || []).map(p => ({
      name: p.name,
      account: p.account,
      x: p.x,
      y: p.y,
      z: p.z,
      health: p.health,
      armor: p.armor,
      world: p.world,
    }));
  } catch (error) {
    console.warn('Error fetching players:', error);
    return [];
  }
}
