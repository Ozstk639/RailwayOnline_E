/**
 * 工具栏组件
 * 包含路径规划等快捷功能图标
 */

import { useState, useRef, useEffect } from 'react';
import { Navigation, List, HelpCircle, Train, Home, Moon, X, User, Users, Map, Palette, Pencil, Settings, Layers } from 'lucide-react';
import type { MapStyle } from '@/lib/cookies';
import ToolIconButton from '@/components/Toolbar/ToolIconButton';
import AppButton from '@/components/ui/AppButton';
import AppCard from '@/components/ui/AppCard';

interface ToolbarProps {
  onNavigationClick: () => void;
  onLinesClick: () => void;
  onPlayersClick: () => void;
  onHelpClick: () => void;
  onSettingsClick: () => void;
}

export function Toolbar({
  onNavigationClick,
  onLinesClick,
  onPlayersClick,
  onHelpClick,
  onSettingsClick,
}: ToolbarProps) {
  return (
    <AppCard className="bg-white/90 p-2 flex items-center gap-1">
      {/* 路径规划 */}
      <AppButton
        onClick={onNavigationClick}
        className="p-2 rounded-lg hover:bg-blue-50 text-gray-600 hover:text-blue-600 transition-colors group relative"
        title="路径规划"
      >
        <Navigation className="w-5 h-5" />
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          路径规划
        </span>
      </AppButton>

      <div className="w-px h-6 bg-gray-200" />

      {/* 全部线路 */}
      <AppButton
        onClick={onLinesClick}
        className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-800 transition-colors group relative"
        title="线路列表"
      >
        <List className="w-5 h-5" />
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          线路列表
        </span>
      </AppButton>

      {/* 在线玩家 */}
      <AppButton
        onClick={onPlayersClick}
        className="p-2 rounded-lg hover:bg-cyan-50 text-gray-600 hover:text-cyan-600 transition-colors group relative"
        title="在线玩家"
      >
        <Users className="w-5 h-5" />
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          在线玩家
        </span>
      </AppButton>

      {/* 帮助 */}
      <AppButton
        onClick={onHelpClick}
        className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-800 transition-colors group relative"
        title="帮助"
      >
        <HelpCircle className="w-5 h-5" />
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          帮助
        </span>
      </AppButton>

      {/* 设置 */}
      <AppButton
        onClick={onSettingsClick}
        className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-800 transition-colors group relative"
        title="设置"
      >
        <Settings className="w-5 h-5" />
        <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          设置
        </span>
      </AppButton>
    </AppCard>
  );
}

/**
 * 地图风格选项
 */
const MAP_STYLE_OPTIONS: Array<{
  value: MapStyle;
  label: string;
  icon: React.ReactNode;
  description: string;
}> = [
  { value: 'default', label: '原版', icon: <Map className="w-5 h-5" />, description: '卫星原始渲染' },
  { value: 'watercolor', label: '淡彩', icon: <Palette className="w-5 h-5" />, description: '柔和水彩风格' },
  { value: 'sketch', label: '素描', icon: <Pencil className="w-5 h-5" />, description: '手绘地图风格' },
];

/**
 * 地图风格下拉选择器
 */
interface MapStyleSelectorProps {
  mapStyle: MapStyle;
  onToggleMapStyle: (style: MapStyle) => void;
}

function MapStyleSelector({ mapStyle, onToggleMapStyle }: MapStyleSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentStyle = MAP_STYLE_OPTIONS.find(s => s.value === mapStyle) || MAP_STYLE_OPTIONS[0];

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div ref={dropdownRef} className="relative">
      <AppButton
        onClick={() => setIsOpen(!isOpen)}
        className={`h-9 w-9 p-1.5 transition-colors group relative ${
          mapStyle !== 'default'
            ? 'bg-amber-100 text-amber-600'
            : 'hover:bg-gray-100 text-gray-400'
        }`}
        title="地图风格"
      >
        {currentStyle.icon}
        <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none max-md:hidden">
          {currentStyle.label}
        </span>
      </AppButton>

      {/* 下拉菜单 - 桌面端向下弹出，移动端向上弹出 */}
      <AppCard
        className={`absolute right-0 w-36 border border-gray-200 py-1 z-50 transition-all duration-150 md:mt-1 md:origin-top-right max-md:bottom-full max-md:mb-1 max-md:origin-bottom-right ${
          isOpen
            ? 'opacity-100 scale-100'
            : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        {MAP_STYLE_OPTIONS.map((option) => (
          <AppButton
            key={option.value}
            onClick={() => {
              onToggleMapStyle(option.value);
              setIsOpen(false);
            }}
            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 transition-colors ${
              mapStyle === option.value ? 'bg-amber-50 text-amber-700' : 'text-gray-700'
            }`}
          >
            {option.icon}
            <span className={mapStyle === option.value ? 'font-medium' : ''}>{option.label}</span>
          </AppButton>
        ))}
      </AppCard>
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
    <AppCard className="bg-white/90 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-800">关于</span>
        <AppButton
          onClick={onClose}
          className="p-1 hover:bg-gray-200 rounded text-gray-500"
        >
          <X className="w-4 h-4" />
        </AppButton>
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
          <span className="font-medium text-gray-500">测绘/测量控件：</span>
          <span>Ozstk639</span>
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
    </AppCard>
  );
}

/**
 * 图层控制组件（右上角）
 */
interface LayerControlProps {
  showRailway: boolean;
  showLandmark: boolean;
  showPlayers: boolean;
  showRuleLayers?: boolean;
  dimBackground: boolean;
  mapStyle: MapStyle;
  onToggleRailway: (show: boolean) => void;
  onToggleLandmark: (show: boolean) => void;
  onTogglePlayers: (show: boolean) => void;
  onToggleRuleLayers?: (show: boolean) => void;
  onToggleDimBackground: (dim: boolean) => void;
  onToggleMapStyle: (style: MapStyle) => void;
  children?: React.ReactNode;
}

export function LayerControl({
  showRailway,
  showLandmark,
  showPlayers,
  showRuleLayers,
  dimBackground,
  mapStyle,
  onToggleRailway,
  onToggleLandmark,
  onTogglePlayers,
  onToggleRuleLayers,
  onToggleDimBackground,
  onToggleMapStyle,
  children,
}: LayerControlProps) {
  const hasExtra = !!children;

  return (
    <AppCard className="bg-white/90 p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        {/* 铁路图层 */}
        <ToolIconButton
          label="铁路"
          icon={<Train className="w-5 h-5" />}
          active={showRailway}
          tone="blue"
          onClick={() => onToggleRailway(!showRailway)}
        />

        {/* 地标图层 */}
        <ToolIconButton
          label="地标"
          icon={<Home className="w-5 h-5" />}
          active={showLandmark}
          tone="green"
          onClick={() => onToggleLandmark(!showLandmark)}
        />

        {/* 玩家图层 */}
        <ToolIconButton
          label="玩家"
          icon={<User className="w-5 h-5" />}
          active={showPlayers}
          tone="cyan"
          onClick={() => onTogglePlayers(!showPlayers)}
        />

        {/* 规则图层 */}
        {typeof showRuleLayers === 'boolean' && onToggleRuleLayers && (
          <div className="hidden sm:block">
            <ToolIconButton
              label="规则"
              icon={<Layers className="w-5 h-5" />}
              active={showRuleLayers}
              tone="blue"
              onClick={() => onToggleRuleLayers(!showRuleLayers)}
            />
          </div>
        )}
      </div>

      <div className="h-px bg-gray-200" />

      <div className="flex flex-wrap items-center gap-1">
        {hasExtra && (
          <div className="flex items-center gap-1">
            {children}
          </div>
        )}

        {/* 淡化背景 */}
        <ToolIconButton
          label="淡化背景"
          icon={<Moon className="w-5 h-5" />}
          active={dimBackground}
          tone="purple"
          onClick={() => onToggleDimBackground(!dimBackground)}
        />

        {/* 地图风格下拉选择器 */}
        <MapStyleSelector mapStyle={mapStyle} onToggleMapStyle={onToggleMapStyle} />
      </div>
    </AppCard>
  );
}

export default Toolbar;
