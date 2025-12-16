/**
 * 玩家列表面板组件
 * 展示在线玩家列表，支持导航到玩家位置
 * 以模态框形式展示在左侧面板下方
 */

import { useState, useEffect, useCallback } from 'react';
import { X, MapPin, Navigation, RefreshCw, Users } from 'lucide-react';
import type { Player } from '@/types';
import { fetchPlayers } from '@/lib/playerApi';
import { getPlayerAvatarUrl } from '@/components/Map/PlayerLayer';

interface PlayersListProps {
  worldId: string;
  onClose: () => void;
  onPlayerSelect?: (player: Player) => void;
  onNavigateToPlayer?: (player: Player) => void;
}

export function PlayersList({
  worldId,
  onClose,
  onPlayerSelect,
  onNavigateToPlayer,
}: PlayersListProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  // 加载玩家数据
  const loadPlayers = useCallback(async () => {
    const data = await fetchPlayers(worldId);
    setPlayers(data);
    setLoading(false);
  }, [worldId]);

  // 初始加载和自动刷新
  useEffect(() => {
    loadPlayers();

    // 5秒自动刷新
    const interval = setInterval(loadPlayers, 5000);
    return () => clearInterval(interval);
  }, [loadPlayers]);

  return (
    <div className="bg-white rounded-lg shadow-lg w-72 max-h-[50vh] flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-cyan-500" />
          <h3 className="font-bold text-gray-800">在线玩家</h3>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {players.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={loadPlayers}
            disabled={loading}
            className={`p-1.5 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600 ${loading ? 'animate-spin' : ''}`}
            title="刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 玩家列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading && players.length === 0 ? (
          <div className="text-center py-6 text-sm text-gray-500">加载中...</div>
        ) : players.length === 0 ? (
          <div className="text-center py-6 text-sm text-gray-500">
            当前没有在线玩家
          </div>
        ) : (
          <div className="divide-y">
            {players.map(player => (
              <PlayerItem
                key={player.name}
                player={player}
                worldId={worldId}
                onSelect={onPlayerSelect}
                onNavigate={onNavigateToPlayer}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// 玩家列表项组件
interface PlayerItemProps {
  player: Player;
  worldId: string;
  onSelect?: (player: Player) => void;
  onNavigate?: (player: Player) => void;
}

function PlayerItem({ player, worldId, onSelect, onNavigate }: PlayerItemProps) {
  const avatarUrl = getPlayerAvatarUrl(player.name, 32, worldId);

  // 生命值百分比
  const healthPercent = (player.health / 20) * 100;

  return (
    <div className="px-3 py-2 hover:bg-gray-50 flex items-center gap-3">
      {/* 头像 */}
      <button
        onClick={() => onSelect?.(player)}
        className="flex-shrink-0 hover:opacity-80 transition-opacity"
      >
        <img
          src={avatarUrl}
          alt={player.name}
          className="w-8 h-8 rounded-full border-2 border-cyan-500"
          onError={(e) => {
            (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2306b6d4"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>';
          }}
        />
      </button>

      {/* 信息 */}
      <div className="flex-1 min-w-0">
        <button
          onClick={() => onSelect?.(player)}
          className="text-sm font-medium text-gray-800 hover:text-cyan-600 transition-colors block truncate"
        >
          {player.name}
        </button>
        <div className="flex items-center gap-2 mt-0.5">
          {/* 生命值小条 */}
          <div className="w-12 h-1 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-red-500"
              style={{ width: `${healthPercent}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-400">
            {Math.round(player.x)}, {Math.round(player.z)}
          </span>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onSelect?.(player)}
          className="p-1.5 hover:bg-gray-200 rounded text-gray-400 hover:text-cyan-600"
          title="定位"
        >
          <MapPin className="w-4 h-4" />
        </button>
        {onNavigate && (
          <button
            onClick={() => onNavigate(player)}
            className="p-1.5 hover:bg-gray-200 rounded text-gray-400 hover:text-blue-600"
            title="导航"
          >
            <Navigation className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default PlayersList;
