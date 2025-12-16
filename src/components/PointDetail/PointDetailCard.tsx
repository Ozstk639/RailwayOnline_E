/**
 * 点位详情卡片组件
 * 展示选中站点或地标的详细信息及附近信息
 */

import type { ParsedStation, Coordinate, ParsedLine } from '@/types';
import type { ParsedLandmark, LandmarkCoord } from '@/lib/landmarkParser';

interface PointDetailCardProps {
  // 选中的点位（站点或地标）
  selectedPoint: {
    type: 'station' | 'landmark';
    name: string;
    coord: Coordinate;
    station?: ParsedStation;
    landmark?: ParsedLandmark;
  };
  // 附近的站点和地标
  nearbyStations: ParsedStation[];
  nearbyLandmarks: ParsedLandmark[];
  // 所有线路（用于点击跳转）
  lines?: ParsedLine[];
  onClose: () => void;
  onStationClick?: (station: ParsedStation) => void;
  onLandmarkClick?: (landmark: ParsedLandmark) => void;
  onLineClick?: (line: ParsedLine) => void;
}

// 计算两点间距离
function getDistance(a: Coordinate, b: Coordinate | LandmarkCoord): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function PointDetailCard({
  selectedPoint,
  nearbyStations,
  nearbyLandmarks,
  lines,
  onClose,
  onStationClick,
  onLandmarkClick,
  onLineClick,
}: PointDetailCardProps) {
  const isStation = selectedPoint.type === 'station';

  // 根据 lineId 或 line 名称查找线路数据
  const findLine = (lineIdOrName: string): ParsedLine | undefined => {
    // 先按 lineId 查找
    let line = lines?.find(l => l.lineId === lineIdOrName);
    // 如果找不到，按 line 名称查找
    if (!line) {
      line = lines?.find(l => l.line === lineIdOrName);
    }
    return line;
  };

  // 格式化线路显示名称
  const formatLineName = (lineIdOrName: string): string => {
    const line = findLine(lineIdOrName);
    if (line) {
      return line.bureau === 'RMP' ? line.line : `${line.bureau}-${line.line}`;
    }
    // 如果找不到线路，直接返回原名称（可能已经是中文名）
    return lineIdOrName;
  };

  return (
    <div className="bg-white rounded-lg shadow-lg w-72 max-h-[60vh] flex flex-col">
      {/* 头部 */}
      <div
        className={`px-4 py-3 rounded-t-lg flex items-center justify-between ${
          isStation ? 'bg-blue-500' : 'bg-orange-500'
        }`}
      >
        <div className="text-white">
          <div className="flex items-center gap-2">
            {isStation ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5M5 12h14M8 5h8M8 19h8M6 5v14M18 5v14" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              </svg>
            )}
            <h3 className="font-bold">{selectedPoint.name}</h3>
          </div>
          <p className="text-xs opacity-90 mt-1">
            X: {Math.round(selectedPoint.coord.x)}, Z: {Math.round(selectedPoint.coord.z)}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-white/80 hover:text-white p-1"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 详情内容 */}
      <div className="flex-1 overflow-y-auto">
        {/* 当前点位信息 */}
        <div className="px-4 py-3 border-b">
          {isStation && selectedPoint.station && (
            <div className="text-sm text-gray-600">
              <div className="font-medium text-gray-800 mb-1">所属线路</div>
              <div className="flex flex-wrap gap-1">
                {selectedPoint.station.lines.map((lineId, idx) => {
                  const line = findLine(lineId);
                  return (
                    <button
                      key={idx}
                      className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs hover:bg-blue-200 transition-colors"
                      onClick={() => line && onLineClick?.(line)}
                    >
                      {formatLineName(lineId)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {!isStation && selectedPoint.landmark && (
            <div className="text-sm text-gray-600">
              <div className="font-medium text-gray-800 mb-1">地标等级</div>
              <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded text-xs">
                {selectedPoint.landmark.grade}
              </span>
            </div>
          )}
        </div>

        {/* 附近站点 */}
        {nearbyStations.length > 0 && (
          <div className="px-4 py-3 border-b">
            <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5M5 12h14M8 5h8M8 19h8M6 5v14M18 5v14" />
              </svg>
              附近站点
            </div>
            <div className="space-y-1">
              {nearbyStations.map((station, idx) => (
                <button
                  key={idx}
                  className="w-full flex items-center justify-between py-1.5 px-2 hover:bg-gray-50 rounded text-left"
                  onClick={() => onStationClick?.(station)}
                >
                  <span className="text-sm text-gray-800 truncate">{station.name}</span>
                  <span className="text-xs text-gray-400 ml-2">
                    {Math.round(getDistance(selectedPoint.coord, station.coord))}m
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 附近地标 */}
        {nearbyLandmarks.length > 0 && (
          <div className="px-4 py-3">
            <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              </svg>
              附近地标
            </div>
            <div className="space-y-1">
              {nearbyLandmarks.map((landmark, idx) => (
                <button
                  key={idx}
                  className="w-full flex items-center justify-between py-1.5 px-2 hover:bg-gray-50 rounded text-left"
                  onClick={() => onLandmarkClick?.(landmark)}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-gray-800 truncate block">{landmark.name}</span>
                    <span className="text-xs text-gray-400">{landmark.grade}</span>
                  </div>
                  <span className="text-xs text-gray-400 ml-2">
                    {landmark.coord ? Math.round(getDistance(selectedPoint.coord, landmark.coord)) : '?'}m
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 无附近信息 */}
        {nearbyStations.length === 0 && nearbyLandmarks.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-gray-400">
            附近没有其他站点或地标
          </div>
        )}
      </div>
    </div>
  );
}

export default PointDetailCard;
