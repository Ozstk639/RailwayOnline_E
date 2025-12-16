/**
 * 世界切换器组件
 * 使用标签页样式在不同世界之间切换
 */

import { Globe } from 'lucide-react';

interface World {
  id: string;
  name: string;
  center: { x: number; y: number; z: number };
}

interface WorldSwitcherProps {
  worlds: World[];
  currentWorld: string;
  onWorldChange: (worldId: string) => void;
}

export function WorldSwitcher({
  worlds,
  currentWorld,
  onWorldChange,
}: WorldSwitcherProps) {
  return (
    <div className="flex items-center gap-1 mt-2">
      <Globe className="w-4 h-4 text-gray-400 mr-1" />
      {worlds.map(world => (
        <button
          key={world.id}
          onClick={() => onWorldChange(world.id)}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
            world.id === currentWorld
              ? 'bg-blue-500 text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {world.name}
        </button>
      ))}
    </div>
  );
}

export default WorldSwitcher;
