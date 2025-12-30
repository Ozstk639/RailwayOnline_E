// File: src/components/Mapping/Workflow/WorkflowHost.tsx
import { useEffect, useMemo, useRef, type ComponentType } from 'react';
import * as L from 'leaflet';

import type { FeatureKey, DrawMode } from '@/components/Mapping/featureFormats';

/** 与 MeasuringModule 内部一致的世界坐标点 */
export type WorldPoint = { x: number; z: number; y?: number };

/** 目前实现：railway / station；后续可扩展 */
export type WorkflowKey = 'railway' | 'station';

export type WorkflowPreviewKind = 'point' | 'polyline' | 'polygon';

export type WorkflowPreviewStyle = {
  color?: string;
  weight?: number;
  dashArray?: string;
};

export type WorkflowCommitArgs = {
  subType: FeatureKey;
  mode: DrawMode;
  coords: WorldPoint[];
  color?: string;

  values?: Record<string, any>;
  groupInfo?: Record<string, any[]>;
  editorId?: string;
};

export type WorkflowCommitResult =
  | { ok: true; layerId: number }
  | { ok: false; error: string };

export type WorkflowBridge = {
  /** 当前世界（用于 LineID world 字母转换） */
  getCurrentWorldId: () => string;

  /** 编辑者（CreateBy） */
  getEditorId: () => string;
  setEditorId: (id: string) => void;

  /** 切换绘制模式（none/point/polyline/polygon） */
  setDrawMode: (mode: 'none' | DrawMode) => void;

  /** 设置绘制颜色（#rrggbb） */
  setDrawColor: (hex: string) => void;

  /** 草稿点序 */
  getTempPoints: () => WorldPoint[];
  setTempPoints: (pts: WorldPoint[]) => void;
  clearTempPoints: () => void;

  /** undo/redo（若 MeasuringModule 侧实现了） */
  requestUndo?: () => void;
  requestRedo?: () => void;

  /** 工作流预览（可选；用于在非草稿容器中长期显示） */
  upsertWorkflowPreview: (
    key: string,
    kind: WorkflowPreviewKind,
    points: WorldPoint[],
    style?: WorkflowPreviewStyle
  ) => void;
  clearWorkflowPreview: (key?: string) => void;

  /** 写入固定测绘图层 */
  commitFeature: (args: WorkflowCommitArgs) => WorkflowCommitResult;

  /** 退出到“工作流选择页”（由 MeasuringModule 侧实现） */
  exitWorkflowToSelector: () => void;
};

export type WorkflowComponentProps = {
  workflowKey: WorkflowKey;
  bridge: WorkflowBridge;
  onExit: () => void;
};

export type WorkflowRegistry = Record<
  WorkflowKey,
  ComponentType<WorkflowComponentProps>
>;

export type WorkflowHostProps = {
  workflowKey: WorkflowKey;
  bridge: WorkflowBridge;
  registry: Partial<WorkflowRegistry>;
  onExit: () => void;
};

/**
 * WorkflowHost：承载工作流 UI，并做 Leaflet 事件隔离（不影响按钮 click）。
 * 注意：不要在这里使用 onClickCapture 去 stopPropagation，否则会吞掉内部按钮 onClick。
 */
export default function WorkflowHost(props: WorkflowHostProps) {
  const { workflowKey, bridge, registry, onExit } = props;

  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    // Leaflet 官方做法：阻止事件冒泡到地图（不影响面板内部交互）
    try {
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
    } catch {
      // ignore
    }
  }, []);

  const WorkflowComponent = useMemo(() => {
    return registry?.[workflowKey] ?? null;
  }, [registry, workflowKey]);

  if (!WorkflowComponent) {
    return (
      <div ref={hostRef} className="p-3 rounded border border-gray-300 bg-white">
        <div className="text-sm font-semibold mb-1">工作流未注册</div>
        <div className="text-xs text-gray-600">
          当前选择的工作流 key：<span className="font-mono">{workflowKey}</span>
        </div>
        <div className="mt-3">
          <button
            type="button"
            className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-700"
            onClick={() => {
              try {
                bridge.exitWorkflowToSelector();
              } catch {
                onExit();
              }
            }}
          >
            返回工作流选择
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={hostRef} className="w-full">
      <WorkflowComponent
        workflowKey={workflowKey}
        bridge={bridge}
        onExit={() => {
          try {
            bridge.exitWorkflowToSelector();
          } catch {
            onExit();
          }
        }}
      />
    </div>
  );
}
