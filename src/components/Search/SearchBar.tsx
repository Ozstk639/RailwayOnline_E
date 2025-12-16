/**
 * 搜索组件
 * 支持搜索站点、地标和线路
 */

import { useState, useEffect, useRef } from 'react';
import type { ParsedStation, ParsedLine } from '@/types';
import type { ParsedLandmark } from '@/lib/landmarkParser';

interface SearchResult {
  type: 'station' | 'landmark' | 'line';
  name: string;
  coord: { x: number; y: number; z: number };
  extra?: string;  // 额外信息，如线路或等级
  lineData?: ParsedLine;  // 线路数据（当 type 为 line 时）
}

interface SearchBarProps {
  stations: ParsedStation[];
  landmarks: ParsedLandmark[];
  lines: ParsedLine[];
  onSelect: (result: SearchResult) => void;
  onLineSelect?: (line: ParsedLine) => void;  // 线路选中回调
}

export function SearchBar({ stations, landmarks, lines, onSelect, onLineSelect }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 搜索逻辑
  useEffect(() => {
    if (query.length < 1) {
      setResults([]);
      return;
    }

    const searchQuery = query.toLowerCase();
    const matchedResults: SearchResult[] = [];

    // 搜索线路（优先显示）
    for (const line of lines) {
      const lineId = line.lineId;
      // RMP 线路直接显示 line 名称，其他显示为 "X局Y号线"
      const lineName = line.bureau === 'RMP'
        ? line.line
        : `${line.bureau}局${line.line}号线`;
      const lineNameAlt = `${line.bureau}-${line.line}`;

      if (
        lineId.toLowerCase().includes(searchQuery) ||
        lineName.toLowerCase().includes(searchQuery) ||
        lineNameAlt.toLowerCase().includes(searchQuery) ||
        line.bureau.toLowerCase().includes(searchQuery) ||
        line.line.toLowerCase().includes(searchQuery)
      ) {
        // 计算线路中点作为定位坐标
        const midIndex = Math.floor(line.stations.length / 2);
        const midStation = line.stations[midIndex] || line.stations[0];

        matchedResults.push({
          type: 'line',
          name: lineName,
          coord: midStation?.coord || { x: 0, y: 64, z: 0 },
          extra: `${line.stations.length} 站`,
          lineData: line,
        });
      }
    }

    // 搜索站点
    for (const station of stations) {
      if (station.name.toLowerCase().includes(searchQuery)) {
        matchedResults.push({
          type: 'station',
          name: station.name,
          coord: station.coord,
          extra: station.lines.join(', '),
        });
      }
    }

    // 搜索地标
    for (const landmark of landmarks) {
      if (landmark.coord && landmark.name.toLowerCase().includes(searchQuery)) {
        matchedResults.push({
          type: 'landmark',
          name: landmark.name,
          coord: landmark.coord,
          extra: landmark.grade,
        });
      }
    }

    // 限制结果数量
    setResults(matchedResults.slice(0, 15));
  }, [query, stations, landmarks, lines]);

  // 点击外部关闭
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (result: SearchResult) => {
    // 如果是线路，调用线路选中回调
    if (result.type === 'line' && result.lineData && onLineSelect) {
      onLineSelect(result.lineData);
    }
    onSelect(result);
    setQuery('');
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center bg-white rounded-lg shadow-lg">
        <span className="pl-3 text-gray-400">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="搜索线路、站点或地标..."
          className="w-64 px-3 py-2 text-sm outline-none rounded-r-lg"
        />
      </div>

      {/* 搜索结果下拉框 */}
      {isOpen && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg max-h-80 overflow-y-auto z-50">
          {results.map((result, index) => (
            <button
              key={`${result.type}-${result.name}-${index}`}
              className="w-full px-3 py-2 text-left hover:bg-gray-100 flex items-center gap-2 border-b border-gray-100 last:border-b-0"
              onClick={() => handleSelect(result)}
            >
              {/* 图标 */}
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                result.type === 'station'
                  ? 'bg-blue-100 text-blue-700'
                  : result.type === 'line'
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-green-100 text-green-700'
              }`}>
                {result.type === 'station' ? '站' : result.type === 'line' ? '线' : '标'}
              </span>

              {/* 名称和额外信息 */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate">
                  {result.name}
                </div>
                {result.extra && (
                  <div className="text-xs text-gray-500 truncate">
                    {result.extra}
                  </div>
                )}
              </div>

              {/* 坐标 */}
              <div className="text-xs text-gray-400">
                {Math.round(result.coord.x)}, {Math.round(result.coord.z)}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 无结果提示 */}
      {isOpen && query.length > 0 && results.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg p-3 text-sm text-gray-500">
          未找到匹配结果
        </div>
      )}
    </div>
  );
}

export default SearchBar;
