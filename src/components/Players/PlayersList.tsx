/**
 * 玩家列表面板组件
 * 展示在线玩家列表，支持导航到玩家位置
 */

import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, MapPin, Navigation, RefreshCw, Users } from 'lucide-react';
import type { Player } from '@/types';
import { fetchPlayers } from '@/lib/playerApi';
import { getPlayerAvatarUrl } from '@/components/Map/PlayerLayer';

interface PlayersListProps {
  worldId: string;
  onBack: () => void;
  onPlayerSelect?: (player: Player) => void;
  onNavigateToPlayer?: (player: Player) => void;
}

export function PlayersList({
  worldId,
  onBack,
  onPlayerSelect,
  onNavigateToPlayer,
}: PlayersListProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // 加载玩家数据
  const loadPlayers = useCallback(async () => {
    setLoading(true);
    const data = await fetchPlayers(worldId);
    setPlayers(data);
    setLastUpdate(new Date());
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
    <div className="fixed inset-0 bg-gray-100 z-[2000] overflow-auto">
      {/* 头部 */}
      <div className="sticky top-0 bg-white shadow-sm z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold flex items-center gap-2">
              <Users className="w-5 h-5 text-cyan-500" />
              在线玩家
            </h1>
            <div className="text-xs text-gray-500 flex items-center gap-2">
              <span>{players.length} 人在线</span>
              {lastUpdate && (
                <span>· 更新于 {lastUpdate.toLocaleTimeString()}</span>
              )}
            </div>
          </div>

          {/* 刷新按钮 */}
          <button
            onClick={loadPlayers}
            disabled={loading}
            className={`p-2 hover:bg-gray-100 rounded-lg ${loading ? 'animate-spin' : ''}`}
            title="刷新"
          >
            <RefreshCw className="w-5 h-5 text-gray-500" />
          </button>
        </div>
      </div>

      {/* 内容 */}
      <div className="max-w-2xl mx-auto px-4 py-4">
        {loading && players.length === 0 ? (
          <div className="text-center py-8 text-gray-500">加载中...</div>
        ) : players.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            当前没有在线玩家
          </div>
        ) : (
          <div className="grid gap-3">
            {players.map(player => (
              <PlayerCard
                key={player.name}
                player={player}
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

// 玩家卡片组件
interface PlayerCardProps {
  player: Player;
  onSelect?: (player: Player) => void;
  onNavigate?: (player: Player) => void;
}

function PlayerCard({ player, onSelect, onNavigate }: PlayerCardProps) {
  const avatarUrl = getPlayerAvatarUrl(player.name, 48);

  // 生命值百分比
  const healthPercent = (player.health / 20) * 100;
  const healthColor = healthPercent > 50 ? 'bg-red-500' : healthPercent > 25 ? 'bg-yellow-500' : 'bg-red-700';

  // 护甲百分比
  const armorPercent = (player.armor / 20) * 100;

  return (
    <div className="bg-white rounded-lg shadow-sm p-4">
      <div className="flex items-start gap-4">
        {/* 头像 */}
        <button
          onClick={() => onSelect?.(player)}
          className="flex-shrink-0 hover:opacity-80 transition-opacity"
        >
          <img
            src={avatarUrl}
            alt={player.name}
            className="w-12 h-12 rounded-full border-2 border-cyan-500"
            onError={(e) => {
              (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2306b6d4"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>';
            }}
          />
        </button>

        {/* 信息 */}
        <div className="flex-1 min-w-0">
          {/* 玩家名 */}
          <button
            onClick={() => onSelect?.(player)}
            className="font-bold text-gray-800 hover:text-cyan-600 transition-colors"
          >
            {player.name}
          </button>

          {/* 坐标 */}
          <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            <span>X: {Math.round(player.x)}, Y: {Math.round(player.y)}, Z: {Math.round(player.z)}</span>
          </div>

          {/* 状态条 */}
          <div className="mt-2 space-y-1">
            {/* 生命值 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-8">生命</span>
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${healthColor} transition-all`}
                  style={{ width: `${healthPercent}%` }}
                />
              </div>
              <span className="text-xs text-gray-500 w-8">{player.health.toFixed(0)}</span>
            </div>

            {/* 护甲 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-8">护甲</span>
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${armorPercent}%` }}
                />
              </div>
              <span className="text-xs text-gray-500 w-8">{player.armor}</span>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-col gap-2">
          {/* 定位按钮 */}
          <button
            onClick={() => onSelect?.(player)}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-cyan-600"
            title="在地图上定位"
          >
            <MapPin className="w-5 h-5" />
          </button>

          {/* 导航按钮 */}
          {onNavigate && (
            <button
              onClick={() => onNavigate(player)}
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-blue-600"
              title="导航到此玩家"
            >
              <Navigation className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default PlayersList;
