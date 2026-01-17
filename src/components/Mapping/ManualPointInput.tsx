import { useMemo, useState } from 'react';

import { X } from 'lucide-react';

import { DraggablePanel } from '@/components/DraggablePanel/DraggablePanel';
import { parseHalfStepNumber } from './GridSnapModeSwitch';
import AppButton from '@/components/ui/AppButton';

export interface ManualPointInputValue {
  x: number;
  y: number;
  z: number;
}

export interface ManualPointInputProps {
  /** 是否允许使用（例如 drawMode === 'none' 或当前不在绘制/编辑状态时禁用） */
  enabled?: boolean;

  /** 当前绘制模式：用于批量输入时决定是否仅录入第一个点 */
  activeMode?: 'none' | 'point' | 'polyline' | 'polygon' | string;

  /** 默认 y 值（与你项目里常见 -64/-63 的 JSON 高度保持一致） */
  defaultY?: number;

  /** 点击“完成”时回调（不清空输入，不关闭面板） */
  onSubmit: (v: ManualPointInputValue) => void;
}

const isValid = (n: number | null) => typeof n === 'number' && Number.isFinite(n);

export default function ManualPointInput({ enabled = true, activeMode = 'none', defaultY = -64, onSubmit }: ManualPointInputProps) {
  const [open, setOpen] = useState(false);

  const [xRaw, setXRaw] = useState('');
  const [yRaw, setYRaw] = useState(String(defaultY));
  const [zRaw, setZRaw] = useState('');

  const [batchRaw, setBatchRaw] = useState('');

  const disabled = !enabled;

  const title = useMemo(() => {
    if (disabled) return '手动输入：需先进入点/线/面绘制或编辑状态';
    return '手动输入：仅允许整数或 .5（例如 10、10.5、-64、-64.5）';
  }, [disabled]);

  const submit = () => {
    if (disabled) return;

    const x = parseHalfStepNumber(xRaw);
    const y = parseHalfStepNumber(yRaw);
    const z = parseHalfStepNumber(zRaw);

    if (!isValid(x) || !isValid(y) || !isValid(z)) {
      window.alert('手动输入坐标非法：x/y/z 仅允许输入整数或 .5 的数值。');
      return;
    }

    onSubmit({ x: x!, y: y!, z: z! });
  };

  const parseBatch = (raw: string) => {
    const norm = String(raw ?? '')
      .replace(/；/g, ';')
      .replace(/\n+/g, ';')
      .replace(/\r+/g, ';');
    const parts = norm
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);

    const yDefault = parseHalfStepNumber(yRaw);
    const yFallback = isValid(yDefault) ? (yDefault as number) : defaultY;

    const points: ManualPointInputValue[] = [];
    for (let i = 0; i < parts.length; i++) {
      const token = parts[i];
      // 支持 x,y,z 或 x,z；同时兼容中文逗号/空格分隔
      const nums = token
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);

      if (nums.length !== 2 && nums.length !== 3) {
        return { ok: false as const, error: `第 ${i + 1} 组坐标格式非法：需为 x,y,z 或 x,z（以 ; 分隔）。` };
      }

      const x = parseHalfStepNumber(nums[0]);
      const y = nums.length === 3 ? parseHalfStepNumber(nums[1]) : yFallback;
      const z = parseHalfStepNumber(nums.length === 3 ? nums[2] : nums[1]);

      if (!isValid(x) || !isValid(y) || !isValid(z)) {
        return { ok: false as const, error: `第 ${i + 1} 组坐标非法：仅允许整数或 .5 的数值。` };
      }

      points.push({ x: x as number, y: y as number, z: z as number });
    }

    return { ok: true as const, points };
  };

  const submitBatch = () => {
    if (disabled) return;

    const r = parseBatch(batchRaw);
    if (!r.ok) {
      window.alert(r.error);
      return;
    }
    if (r.points.length === 0) return;

    // 点要素：仅录入第一个坐标；线/面：按顺序逐一录入
    if (String(activeMode) === 'point') {
      onSubmit(r.points[0]);
      return;
    }
    r.points.forEach((p) => onSubmit(p));
  };

  return (
    <div className="mb-2" title={title}>
      <AppButton
        type="button"
        className={`w-full px-2 py-1 rounded text-sm border ${
          open ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
      >
        手动输入
      </AppButton>

{open && (
  <DraggablePanel id="manual-point-input" defaultPosition={{ x: 380, y: 120 }}>
    <div className="bg-white border rounded shadow-md w-80">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="text-sm font-semibold">手动输入</div>
        <AppButton
          type="button"
          className="p-1 rounded hover:bg-gray-100"
          onClick={() => setOpen(false)}
          title="关闭"
        >
          <X size={16} />
        </AppButton>
      </div>

      <div className="p-3">
        <div className="text-xs text-gray-600 mb-2">
          仅允许整数或 .5。点击“完成”会按当前输入向绘制/编辑要素添加一个控制点。
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-xs mb-1">X</div>
            <input
              value={xRaw}
              onChange={(e) => setXRaw(e.target.value)}
              className="w-full px-2 py-1 border rounded text-sm"
              placeholder="例如 10 / 10.5"
            />
          </div>

          <div>
            <div className="text-xs mb-1">Y</div>
            <input
              value={yRaw}
              onChange={(e) => setYRaw(e.target.value)}
              className="w-full px-2 py-1 border rounded text-sm"
              placeholder="例如 -64 / -64.5"
            />
          </div>

          <div>
            <div className="text-xs mb-1">Z</div>
            <input
              value={zRaw}
              onChange={(e) => setZRaw(e.target.value)}
              className="w-full px-2 py-1 border rounded text-sm"
              placeholder="例如 20 / 20.5"
            />
          </div>
        </div>

        <div className="mt-3 flex justify-end">
          <AppButton type="button" className="bg-green-500 text-white px-3 py-1 rounded" onClick={submit}>
            完成
          </AppButton>
        </div>

        <div className="mt-4 pt-3 border-t">
          <div className="text-xs text-gray-600 mb-2">
            批量输入：按 <code className="px-1 bg-gray-100 rounded">x,y,z;x,y,z;</code> 或 <code className="px-1 bg-gray-100 rounded">x,z;x,z;</code> 输入。
            以 <code className="px-1 bg-gray-100 rounded">;</code> 分隔；若省略 y，则使用上方 Y（无效则回退 {defaultY}）。
            点要素仅录入第一个坐标。
          </div>

          <textarea
            value={batchRaw}
            onChange={(e) => setBatchRaw(e.target.value)}
            className="w-full h-24 px-2 py-1 border rounded text-sm font-mono"
            placeholder="例如：10, -64, 20; 11, -64, 21;\n或：10,20;11,21;"
          />

          <div className="mt-2 flex justify-end">
            <AppButton type="button" className="bg-blue-600 text-white px-3 py-1 rounded" onClick={submitBatch}>
              按序录入
            </AppButton>
          </div>
        </div>
      </div>
    </div>
  </DraggablePanel>
)}

    </div>
  );
}