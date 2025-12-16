/**
 * 加载进度提示组件
 * 显示数据加载进度
 */

import { useLoadingStore } from '@/store/loadingStore';

export function LoadingOverlay() {
  const { isLoading, stages, initialized } = useLoadingStore();

  // 首次加载未完成 或 正在加载时显示
  if (!isLoading && initialized) {
    return null;
  }

  // 计算进度
  const completedCount = stages.filter(
    (s) => s.status === 'success' || s.status === 'error'
  ).length;
  const progress = stages.length > 0 ? (completedCount / stages.length) * 100 : 0;

  return (
    <div className="fixed inset-0 bg-gray-900/80 backdrop-blur-sm z-[9999] flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-80 max-w-[90vw]">
        {/* 标题 */}
        <div className="text-center mb-4">
          <h2 className="text-lg font-bold text-gray-800">RIA 铁路在线地图</h2>
          <p className="text-sm text-gray-500 mt-1">正在加载数据...</p>
        </div>

        {/* 进度条 */}
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-blue-500 transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* 加载阶段列表 */}
        <div className="space-y-2">
          {stages.map((stage) => (
            <div
              key={stage.name}
              className="flex items-center gap-2 text-sm"
            >
              {/* 状态图标 */}
              <div className="w-5 h-5 flex-shrink-0">
                {stage.status === 'pending' && (
                  <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
                )}
                {stage.status === 'loading' && (
                  <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                )}
                {stage.status === 'success' && (
                  <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {stage.status === 'error' && (
                  <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
              </div>

              {/* 阶段名称 */}
              <span
                className={`flex-1 ${
                  stage.status === 'loading'
                    ? 'text-blue-600 font-medium'
                    : stage.status === 'success'
                    ? 'text-green-600'
                    : stage.status === 'error'
                    ? 'text-red-600'
                    : 'text-gray-400'
                }`}
              >
                {stage.label}
              </span>

              {/* 状态文字 */}
              <span className="text-xs text-gray-400">
                {stage.status === 'loading' && '加载中'}
                {stage.status === 'success' && '完成'}
                {stage.status === 'error' && (stage.message || '失败')}
              </span>
            </div>
          ))}
        </div>

        {/* 提示文字 */}
        <p className="text-xs text-gray-400 text-center mt-4">
          数据来自 GitHub，如加载缓慢请稍候
        </p>
      </div>
    </div>
  );
}

export default LoadingOverlay;
