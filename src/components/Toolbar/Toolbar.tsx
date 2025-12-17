/**
 * 工具栏组件
 * 包含路径规划等快捷功能图标
 */

import { Navigation, List, HelpCircle, Train, Home, Moon, X, User, Users } from 'lucide-react';

interface ToolbarProps {
  onNavigationClick: () => void;
  onLinesClick: () => void;
  onPlayersClick: () => void;
  onHelpClick: () => void;
}

export function Toolbar({
  onNavigationClick,
  onLinesClick,
  onPlayersClick,
  onHelpClick,
}: ToolbarProps) {
  return (
    <div className="bg-white/90 rounded-lg shadow-lg p-2 flex items-center gap-1">
      {/* 路径规划 */}
      <button
        onClick={onNavigationClick}
        className="p-2 rounded-lg hover:bg-blue-50 text-gray-600 hover:text-blue-600 transition-colors group relative"
        title="路径规划"
      >
        <Navigation className="w-5 h-5" />
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          路径规划
        </span>
      </button>

      <div className="w-px h-6 bg-gray-200" />

      {/* 全部线路 */}
      <button
        onClick={onLinesClick}
        className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-800 transition-colors group relative"
        title="线路列表"
      >
        <List className="w-5 h-5" />
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          线路列表
        </span>
      </button>

      {/* 在线玩家 */}
      <button
        onClick={onPlayersClick}
        className="p-2 rounded-lg hover:bg-cyan-50 text-gray-600 hover:text-cyan-600 transition-colors group relative"
        title="在线玩家"
      >
        <Users className="w-5 h-5" />
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          在线玩家
        </span>
      </button>

      {/* 帮助 */}
      <button
        onClick={onHelpClick}
        className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-800 transition-colors group relative"
        title="帮助"
      >
        <HelpCircle className="w-5 h-5" />
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          帮助
        </span>
      </button>
    </div>
  );
}

/**
 * 关于卡片组件
 */
interface AboutCardProps {
  onClose: () => void;
}

export function AboutCard({ onClose }: AboutCardProps) {
  return (
    <div className="bg-white/90 rounded-lg shadow-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-800">关于</span>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-200 rounded text-gray-500"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="text-xs text-gray-600 space-y-2">
        <div className="bg-yellow-50 border border-yellow-200 rounded px-2 py-1 text-yellow-700">
          该平台正在测试中
        </div>
        <div>
          <span className="font-medium text-gray-800">开发：</span>
          <span>Venti_Lynn</span>
        </div>
        <div>
          <span className="font-medium text-gray-800">数据来源：</span>
          <div className="mt-1 space-y-0.5 text-gray-500">
            <div>
              <a href="https://satellite.ria.red/" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                莉亚红一号卫星
              </a>
            </div>
            <div>秋月白</div>
            <div>FY_杨</div>
            <div>暗夜</div>
            <div>
              <a href="https://ria-data.vercel.app/" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                莉亚数据开放平台
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 图层控制组件（右上角）
 */
interface LayerControlProps {
  showRailway: boolean;
  showLandmark: boolean;
  showPlayers: boolean;
  dimBackground: boolean;
  onToggleRailway: (show: boolean) => void;
  onToggleLandmark: (show: boolean) => void;
  onTogglePlayers: (show: boolean) => void;
  onToggleDimBackground: (dim: boolean) => void;
}

export function LayerControl({
  showRailway,
  showLandmark,
  showPlayers,
  dimBackground,
  onToggleRailway,
  onToggleLandmark,
  onTogglePlayers,
  onToggleDimBackground,
}: LayerControlProps) {
  return (
    <div className="bg-white/90 rounded-lg shadow-lg p-2 flex items-center gap-1">
      {/* 铁路图层 */}
      <button
        onClick={() => onToggleRailway(!showRailway)}
        className={`p-2 rounded-lg transition-colors group relative ${
          showRailway
            ? 'bg-blue-100 text-blue-600'
            : 'hover:bg-gray-100 text-gray-400'
        }`}
        title="铁路图层"
      >
        <Train className="w-5 h-5" />
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          铁路
        </span>
      </button>

      {/* 地标图层 */}
      <button
        onClick={() => onToggleLandmark(!showLandmark)}
        className={`p-2 rounded-lg transition-colors group relative ${
          showLandmark
            ? 'bg-green-100 text-green-600'
            : 'hover:bg-gray-100 text-gray-400'
        }`}
        title="地标图层"
      >
        <Home className="w-5 h-5" />
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          地标
        </span>
      </button>

      {/* 玩家图层 */}
      <button
        onClick={() => onTogglePlayers(!showPlayers)}
        className={`p-2 rounded-lg transition-colors group relative ${
          showPlayers
            ? 'bg-cyan-100 text-cyan-600'
            : 'hover:bg-gray-100 text-gray-400'
        }`}
        title="玩家图层"
      >
        <User className="w-5 h-5" />
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          玩家
        </span>
      </button>

      <div className="w-px h-6 bg-gray-200" />

      {/* 淡化背景 */}
      <button
        onClick={() => onToggleDimBackground(!dimBackground)}
        className={`p-2 rounded-lg transition-colors group relative ${
          dimBackground
            ? 'bg-purple-100 text-purple-600'
            : 'hover:bg-gray-100 text-gray-400'
        }`}
        title="淡化背景"
      >
        <Moon className="w-5 h-5" />
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          淡化背景
        </span>
      </button>
    </div>
  );
}

export default Toolbar;
