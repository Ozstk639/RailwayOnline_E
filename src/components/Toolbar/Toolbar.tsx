/**
 * 工具栏组件
 * 包含路径规划等快捷功能图标
 */

interface ToolbarProps {
  onNavigationClick: () => void;
}

export function Toolbar({
  onNavigationClick,
}: ToolbarProps) {
  return (
    <div className="bg-white/90 rounded-lg shadow-lg p-2 flex items-center gap-1">
      {/* 路径规划 */}
      <button
        onClick={onNavigationClick}
        className="p-2 rounded-lg hover:bg-blue-50 text-gray-600 hover:text-blue-600 transition-colors group relative"
        title="路径规划"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          路径规划
        </span>
      </button>

      <div className="w-px h-6 bg-gray-200" />

      {/* 全部线路 */}
      <button
        className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-800 transition-colors group relative"
        title="线路列表"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
        </svg>
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          线路列表
        </span>
      </button>

      {/* 帮助 */}
      <button
        className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-800 transition-colors group relative"
        title="帮助"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          帮助
        </span>
      </button>
    </div>
  );
}

/**
 * 图层控制组件（右上角）
 */
interface LayerControlProps {
  showRailway: boolean;
  showLandmark: boolean;
  onToggleRailway: (show: boolean) => void;
  onToggleLandmark: (show: boolean) => void;
}

export function LayerControl({
  showRailway,
  showLandmark,
  onToggleRailway,
  onToggleLandmark,
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
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5M5 12h14M8 5h8M8 19h8M6 5v14M18 5v14" />
        </svg>
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
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          地标
        </span>
      </button>
    </div>
  );
}

export default Toolbar;
