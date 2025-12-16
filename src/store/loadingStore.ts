/**
 * 加载状态管理
 * 使用 Zustand 管理全局加载进度
 */

import { create } from 'zustand';

export interface LoadingStage {
  name: string;
  label: string;
  status: 'pending' | 'loading' | 'success' | 'error';
  message?: string;
}

interface LoadingState {
  // 是否正在加载
  isLoading: boolean;
  // 加载阶段列表
  stages: LoadingStage[];
  // 是否首次加载完成
  initialized: boolean;

  // Actions
  startLoading: (stages: Array<{ name: string; label: string }>) => void;
  updateStage: (name: string, status: LoadingStage['status'], message?: string) => void;
  finishLoading: () => void;
  resetLoading: () => void;
}

export const useLoadingStore = create<LoadingState>((set) => ({
  isLoading: false,
  stages: [],
  initialized: false,

  startLoading: (stages) => {
    set({
      isLoading: true,
      stages: stages.map((s) => ({
        name: s.name,
        label: s.label,
        status: 'pending',
      })),
    });
  },

  updateStage: (name, status, message) => {
    set((state) => ({
      stages: state.stages.map((s) =>
        s.name === name ? { ...s, status, message } : s
      ),
    }));
  },

  finishLoading: () => {
    set({
      isLoading: false,
      initialized: true,
    });
  },

  resetLoading: () => {
    set({
      isLoading: false,
      stages: [],
    });
  },
}));
