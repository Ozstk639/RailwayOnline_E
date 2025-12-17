/**
 * 线路列表页面
 * 展示所有线路信息
 */

import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronDown } from 'lucide-react';
import type { ParsedLine, BureausConfig } from '@/types';
import { fetchRailwayData, parseRailwayData, fetchBureausConfig, getBureauName } from '@/lib/railwayParser';
import { fetchRMPData, parseRMPData } from '@/lib/rmpParser';

// RMP 数据文件映射
const RMP_DATA_FILES: Record<string, string> = {
  zth: '/data/rmp_zth.json',
  houtu: '/data/rmp_houtu.json',
};

// 世界配置
const WORLDS = [
  { id: 'zth', name: '零洲' },
  { id: 'naraku', name: '奈落洲' },
  { id: 'houtu', name: '后土洲' }
];

interface LinesPageProps {
  onBack: () => void;
  onLineSelect?: (line: ParsedLine) => void;
}

export function LinesPage({ onBack, onLineSelect }: LinesPageProps) {
  const [currentWorld, setCurrentWorld] = useState('zth');
  const [lines, setLines] = useState<ParsedLine[]>([]);
  const [bureausConfig, setBureausConfig] = useState<BureausConfig>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // 加载线路数据
  useEffect(() => {
    async function loadLines() {
      setLoading(true);

      // 加载铁路局配置
      const config = await fetchBureausConfig();
      setBureausConfig(config);

      // 加载 RIA_Data
      const railwayData = await fetchRailwayData(currentWorld);
      const { lines: riaLines } = parseRailwayData(railwayData);

      // 加载 RMP 数据
      let rmpLines: ParsedLine[] = [];
      const rmpFile = RMP_DATA_FILES[currentWorld];
      if (rmpFile) {
        try {
          const rmpData = await fetchRMPData(rmpFile);
          const parsed = parseRMPData(rmpData);
          rmpLines = parsed.lines;
        } catch (e) {
          console.warn(`Failed to load RMP data:`, e);
        }
      }

      setLines([...riaLines, ...rmpLines]);
      setLoading(false);
    }
    loadLines();
  }, [currentWorld]);

  // 按来源分组
  const groupedLines = lines.reduce((acc, line) => {
    const source = line.bureau === 'RMP' ? 'RMP' : 'RIA';
    if (!acc[source]) acc[source] = {};
    if (!acc[source][line.bureau]) acc[source][line.bureau] = [];
    acc[source][line.bureau].push(line);
    return acc;
  }, {} as Record<string, Record<string, ParsedLine[]>>);

  // 搜索过滤
  const filteredLines = searchQuery
    ? lines.filter(line =>
        line.lineId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        line.stations.some(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : null;

  return (
    <div className="fixed inset-0 bg-gray-100 z-[2000] overflow-auto">
      {/* 头部 */}
      <div className="sticky top-0 bg-white shadow-sm z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold">线路列表</h1>

          {/* 世界切换 */}
          <div className="flex gap-1 ml-auto">
            {WORLDS.map(world => (
              <button
                key={world.id}
                onClick={() => setCurrentWorld(world.id)}
                className={`px-3 py-1 text-sm rounded ${
                  currentWorld === world.id
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {world.name}
              </button>
            ))}
          </div>
        </div>

        {/* 搜索框 */}
        <div className="max-w-4xl mx-auto px-4 pb-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索线路或站点..."
            className="w-full px-4 py-2 border rounded-lg text-sm outline-none focus:border-blue-400"
          />
        </div>
      </div>

      {/* 内容 */}
      <div className="max-w-4xl mx-auto px-4 py-4">
        {loading ? (
          <div className="text-center py-8 text-gray-500">加载中...</div>
        ) : filteredLines ? (
          // 搜索结果
          <div>
            <div className="text-sm text-gray-500 mb-3">
              找到 {filteredLines.length} 条线路
            </div>
            <div className="grid gap-3">
              {filteredLines.map(line => (
                <LineCard key={line.lineId} line={line} onSelect={onLineSelect} />
              ))}
            </div>
          </div>
        ) : (
          // 分组显示
          <div className="space-y-6">
            {/* RIA 线路 */}
            {groupedLines['RIA'] && (
              <div>
                <h2 className="text-lg font-bold mb-3 text-gray-800">RIA 官方线路</h2>
                {Object.entries(groupedLines['RIA']).map(([bureau, bureauLines]) => (
                  <div key={bureau} className="mb-4">
                    <h3 className="text-sm font-medium text-gray-500 mb-2">
                      {getBureauName(bureausConfig, bureau)} ({bureauLines.length} 条)
                    </h3>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {bureauLines.map(line => (
                        <LineCard key={line.lineId} line={line} onSelect={onLineSelect} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* RMP 线路 */}
            {groupedLines['RMP'] && (
              <div>
                <h2 className="text-lg font-bold mb-3 text-gray-800">RMP 线路</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.values(groupedLines['RMP']).flat().map(line => (
                    <LineCard key={line.lineId} line={line} onSelect={onLineSelect} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// 线路卡片组件
function LineCard({ line, onSelect }: { line: ParsedLine; onSelect?: (line: ParsedLine) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      <button
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50"
        onClick={() => setExpanded(!expanded)}
      >
        {/* 颜色标识 */}
        <div
          className="w-4 h-4 rounded-full flex-shrink-0"
          style={{ backgroundColor: line.color }}
        />

        {/* 线路信息 */}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-800">
            {line.bureau === 'RMP' ? `线路 ${line.line}` : `${line.bureau}-${line.line}`}
          </div>
          <div className="text-xs text-gray-500">
            {line.stations.length} 站
          </div>
        </div>

        {/* 展开/收起图标 */}
        <ChevronDown
          className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="px-4 pb-3 border-t">
          {/* 操作按钮 */}
          {onSelect && (
            <button
              onClick={() => onSelect(line)}
              className="mt-2 mb-3 px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
            >
              在地图上查看
            </button>
          )}

          {/* 站点列表 */}
          <div className="flex flex-wrap gap-1 mt-2">
            {line.stations.map((station, idx) => (
              <span key={idx} className="text-xs">
                <span className={station.isTransfer ? 'font-medium text-blue-600' : 'text-gray-600'}>
                  {station.name}
                </span>
                {idx < line.stations.length - 1 && (
                  <span className="text-gray-300 mx-1">→</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default LinesPage;
