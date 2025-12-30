// File: src/components/Mapping/Workflow/RailwayWorkflow.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowComponentProps, WorldPoint, WorkflowCommitArgs } from './WorkflowHost';

/**
 * RailwayWorkflow（工作流：铁路）
 *
 * 关键实现约束（按你的最新确认）：
 * 1) “上下行单划”模式：输出 PLpoints 必须完全按用户绘制点序原样决定（不做自动反转/排序）。
 * 2) startplf / endplf 也必须遵循用户点序：
 *    - 我们仅有两个文本输入（起始站、终点站），因此需要决定是否交换它们。
 *    - 这里采用“与中心线方向（第二页）对齐”的判定：比较用户绘制线段的首点更接近中心线的起点还是终点，
 *      若更接近中心线终点，则认为用户点序与中心线方向相反 -> 交换 start/end。
 *    - 注意：这是“按点序与参考方向的相对关系”推断交换，不会改动用户点序本身。
 *
 * 注意：
 * - 本组件不直接操作 Leaflet / layers，仅通过 bridge 与 MeasuringModule 通信。
 * - MeasuringModule 需保证：setDrawMode('none') 时隐藏绘制相关按钮；setDrawMode('polyline') 时允许绘制。
 */

type DirChoice = '上行' | '下行' | '联络线' | '其他';
type BranchChoice = '三线合一' | '上下行单划';

type Step =
  | 'creator'   // 第 1 页：填写 CreateBy
  | 'center'    // 第 2 页：中心线 + 方向
  | 'branch'    // 第 3 页：三线合一 / 上下行单划（联络线/其他跳过）
  | 'info'      // 信息填写页（无前后）
  | 'down'      // 下行绘制页（仅下一步）
  | 'up';       // 上行绘制页（完成并保存）

type InfoForm = {
  lineName: string;
  sectionCode: string;
  times: string;           // 默认 "1"
  bureau: string;
  lineNo: string;
  colorHexNoHash: string;  // 不含#
  startStation: string;
  endStation: string;
};


const WORLD_ID_TO_CODE: Record<string, number> = {
  zth: 0,
  naraku: 1,
  houtu: 2,
  eden: 3,
  laputa: 4,
  yunduan: 5,
};

const WORLD_CODE_TO_PREFIX: Record<number, string> = {
  0: 'Z',
  1: 'N',
  2: 'H',
  3: 'E',
  4: 'L',
  5: 'Y',
};

function pad2(n: number) {
  const nn = Math.max(0, Math.floor(n));
  return String(nn).padStart(2, '0');
}

function dist2(a: WorldPoint, b: WorldPoint) {
  const dx = (a.x ?? 0) - (b.x ?? 0);
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return dx * dx + dz * dz;
}

function reversePoints(pts: WorldPoint[]) {
  return [...pts].reverse();
}

/**
 * 按“点序相对中心线方向”决定 start/end 是否交换：
 * - canonicalStart/End 来自中心线（第二页）
 * - 若 polyline 首点更接近 canonicalEnd，则认为方向相反 => 交换 start/end
 */
function resolveStartEndByPointOrder(args: {
  polyline: WorldPoint[];
  canonicalStart?: WorldPoint;
  canonicalEnd?: WorldPoint;
  startName: string;
  endName: string;
}) {
  const { polyline, canonicalStart, canonicalEnd, startName, endName } = args;

  if (!polyline || polyline.length < 2) {
    return { startplf: startName, endplf: endName, swapped: false };
  }
  if (!canonicalStart || !canonicalEnd) {
    return { startplf: startName, endplf: endName, swapped: false };
  }

  const first = polyline[0];
  const dToStart = dist2(first, canonicalStart);
  const dToEnd = dist2(first, canonicalEnd);

  if (dToEnd < dToStart) {
    return { startplf: endName, endplf: startName, swapped: true };
  }
  return { startplf: startName, endplf: endName, swapped: false };
}

function sanitizeColorNoHash(s: string) {
  const raw = String(s ?? '').trim();
  if (!raw) return '';
  return raw.startsWith('#') ? raw.slice(1) : raw;
}

function nonEmpty(s: string) {
  return String(s ?? '').trim().length > 0;
}

type TopNavProps = {
  title: string;
  showPrev?: boolean;
  showNext?: boolean;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
};

function TopNav(props: TopNavProps) {
  const { title, showPrev, showNext, prevDisabled, nextDisabled, onPrev, onNext } = props;
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="text-sm font-semibold">{title}</div>
      <div className="flex items-center gap-2">
        {showPrev ? (
          <button
            className={`px-3 py-1.5 rounded text-sm border border-gray-300 bg-white text-gray-900 ${
              prevDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'
            }`}
            disabled={!!prevDisabled}
            onClick={onPrev}
            type="button"
          >
            上一步
          </button>
        ) : null}
        {showNext ? (
          <button
            className={`px-3 py-1.5 rounded text-sm border border-gray-300 bg-white text-gray-900 ${
              nextDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'
            }`}
            disabled={!!nextDisabled}
            onClick={onNext}
            type="button"
          >
            下一步
          </button>
        ) : null}
      </div>
    </div>
  );
}

type LabeledInputProps = {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  type?: 'text' | 'number';
};

/**
 * 注意：必须在组件外定义，避免父组件 re-render 时“组件类型变化”导致 input 被卸载重建，
 * 从而出现“光标闪一下就消失、无法输入”的现象。
 */
function LabeledInput(props: LabeledInputProps) {
  const { label, value, placeholder, onChange, type = 'text' } = props;
  return (
    <label className="block space-y-1">
      <div className="text-xs opacity-80">{label}</div>
      <input
        type={type}
        className="w-full border p-1 rounded text-sm"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onMouseDownCapture={(e) => e.stopPropagation()}
        onPointerDownCapture={(e) => e.stopPropagation()}
        onTouchStartCapture={(e) => e.stopPropagation()}
      />
    </label>
  );
}


export default function RailwayWorkflow(props: WorkflowComponentProps) {
  const { bridge } = props;
  const bridgeRef = useRef(bridge);
  useEffect(() => {
    bridgeRef.current = bridge;
  }, [bridge]);


  const [step, setStep] = useState<Step>('creator');

  // Page 1
  const [creatorId, setCreatorId] = useState<string>(() => (bridgeRef.current.getEditorId?.() ?? '').trim());

  // Page 2
  const [dirChoice, setDirChoice] = useState<DirChoice>('下行');
  const [centerPoints, setCenterPoints] = useState<WorldPoint[]>([]);
  const [centerSavedOnce, setCenterSavedOnce] = useState(false);

  // Page 3
  const [branchChoice, setBranchChoice] = useState<BranchChoice | null>(null);
  const [branchLocked, setBranchLocked] = useState(false);

  // Info
  const [info, setInfo] = useState<InfoForm>({
    lineName: '',
    sectionCode: '',
    times: '1',
    bureau: '',
    lineNo: '',
    colorHexNoHash: '',
    startStation: '',
    endStation: '',
  });

  // Down/Up
  const [downPoints, setDownPoints] = useState<WorldPoint[]>([]);
  const [upPoints, setUpPoints] = useState<WorldPoint[]>([]);

  // 计算中心线起终点（用于 start/end 自动交换判定）
  const canonicalStart = useMemo(() => (centerPoints.length >= 2 ? centerPoints[0] : undefined), [centerPoints]);
  const canonicalEnd = useMemo(
    () => (centerPoints.length >= 2 ? centerPoints[centerPoints.length - 1] : undefined),
    [centerPoints]
  );

  const shouldSkipBranch = useMemo(() => dirChoice === '联络线' || dirChoice === '其他', [dirChoice]);

  // --------- Step enter effects (控制绘制模式/草稿点载入) ----------
  useEffect(() => {
    // 将 CreateBy 同步到 MeasuringModule（系统字段写入依赖）
    if (nonEmpty(creatorId)) {
      bridgeRef.current.setEditorId(creatorId.trim());
    }

    if (step === 'creator' || step === 'branch' || step === 'info') {
      bridgeRef.current.setDrawMode('none');
      bridgeRef.current.clearTempPoints();
      return;
    }

    // 绘制类页面：polyline
    bridgeRef.current.setDrawMode('polyline');

    if (step === 'center') {
      bridgeRef.current.setTempPoints(centerPoints);
      return;
    }
    if (step === 'down') {
      bridgeRef.current.setTempPoints(downPoints);
      return;
    }
    if (step === 'up') {
      bridgeRef.current.setTempPoints(upPoints);
      return;
    }
  }, [
    step,
    creatorId,

    centerPoints,
    downPoints,
    upPoints,
  ]);

  // --------- Workflow preview helpers ----------
  const previewStyle = useMemo(() => {
    // 仅给一个默认样式，具体颜色仍由 MeasuringModule 顶部色带控制
    return { weight: 4 };
  }, []);

  const saveCenterFromDraft = () => {
    const pts = bridgeRef.current.getTempPoints();
    if (!Array.isArray(pts)) return { ok: false as const, error: '无法读取中心线点序' };

    setCenterPoints(pts);
    setCenterSavedOnce(true);

    // 持久预览
    bridgeRef.current.upsertWorkflowPreview('railway:center', 'polyline', pts, previewStyle);

    return { ok: true as const, pts };
  };

  const saveDownFromDraft = () => {
    const pts = bridgeRef.current.getTempPoints();
    if (!Array.isArray(pts)) return { ok: false as const, error: '无法读取下行点序' };
    setDownPoints(pts);
    bridgeRef.current.upsertWorkflowPreview('railway:down', 'polyline', pts, previewStyle);
    return { ok: true as const, pts };
  };

  const saveUpFromDraft = () => {
    const pts = bridgeRef.current.getTempPoints();
    if (!Array.isArray(pts)) return { ok: false as const, error: '无法读取上行点序' };
    setUpPoints(pts);
    bridgeRef.current.upsertWorkflowPreview('railway:up', 'polyline', pts, previewStyle);
    return { ok: true as const, pts };
  };

  // --------- Navigation actions ----------
  const goTo = (next: Step) => setStep(next);

  const onNextFromCreator = () => {
    const id = creatorId.trim();
    if (!id) {
      window.alert('请填写填写者ID');
      return;
    }
    bridgeRef.current.setEditorId(id);
    goTo('center');
  };

  const onPrevFromCenter = () => {
    // 保存中心线（允许为空）
    saveCenterFromDraft();
    goTo('creator');
  };

  const onNextFromCenter = () => {
    const saved = saveCenterFromDraft();
    if (!saved.ok) {
      window.alert(saved.error);
      return;
    }
    if (!saved.pts || saved.pts.length < 2) {
      window.alert('中心线控制点至少需要 2 个点');
      return;
    }

    if (shouldSkipBranch) {
      goTo('info');
    } else {
      // 上/下行需要分支选择
      goTo('branch');
    }
  };

  const onPrevFromBranch = () => {
    if (branchLocked) return; // 锁定后不允许回到该页
    goTo('center');
  };

  const onNextFromBranch = () => {
    if (!branchChoice) {
      // 未选中不允许下一步
      return;
    }
    // 一旦离开该页，锁定（不可回到此页）
    setBranchLocked(true);
    goTo('info');
  };

  // --------- Build ID / Values ----------
  const buildBaseLineId = () => {
    const worldId = String(bridgeRef.current.getCurrentWorldId?.() ?? 'zth').trim() || 'zth';
    const worldCode = Number.isFinite(WORLD_ID_TO_CODE[worldId]) ? WORLD_ID_TO_CODE[worldId] : 0;
    const prefix = WORLD_CODE_TO_PREFIX[worldCode] ?? 'Z';

    const bureau = String(info.bureau ?? '').trim();
    const lineNo = String(info.lineNo ?? '').trim();
    const section = String(info.sectionCode ?? '').trim();

    const t = Number(String(info.times ?? '1').trim());
    const times2 = pad2(Number.isFinite(t) ? t : 1);

    // 例：ZRT1_A_01
    return `${prefix}R${bureau}${lineNo}_${section}_${times2}`;
  };

  const buildColor = () => sanitizeColorNoHash(info.colorHexNoHash);

  const buildDirectionValue = () => {
    if (dirChoice === '联络线') return 4;
    if (dirChoice === '其他') return 2;
    // 上/下行：展示线
    return 3;
  };

  const commitRle = (args: {
    coords: WorldPoint[];
    lineId: string;
    lineName: string;
    direction: number;
    startName: string;
    endName: string;
    allowAutoSwapByCanonical: boolean;
  }) => {
    const coords = args.coords ?? [];
    if (coords.length < 2) return { ok: false as const, error: '坐标点不足（至少 2 点）' };

    const startStation = String(args.startName ?? '').trim();
    const endStation = String(args.endName ?? '').trim();
    if (!startStation || !endStation) return { ok: false as const, error: '起始站/终点站未填写' };

    const resolved =
      args.allowAutoSwapByCanonical
        ? resolveStartEndByPointOrder({
            polyline: coords,
            canonicalStart,
            canonicalEnd,
            startName: startStation,
            endName: endStation,
          })
        : { startplf: startStation, endplf: endStation, swapped: false };

    const values: WorkflowCommitArgs['values'] = {
      LineID: args.lineId,
      LineName: args.lineName,
      bureau: String(info.bureau ?? '').trim(),
      line: String(info.lineNo ?? '').trim(),
      color: buildColor(),
      direction: args.direction,
      startplf: resolved.startplf,
      endplf: resolved.endplf,
    };

    const payload: WorkflowCommitArgs = {
      subType: '铁路',
      mode: 'polyline',
      coords,
      values,
      editorId: creatorId.trim(),
    };

    return bridgeRef.current.commitFeature(payload);
  };

  // --------- Info page: Complete actions ----------
  const validateInfoForm = () => {
    const need: Array<[keyof InfoForm, string]> = [
      ['lineName', '线路名'],
      ['sectionCode', '区段代码'],
      ['times', '测绘次数'],
      ['bureau', '路局代码'],
      ['lineNo', '线路编号'],
      ['colorHexNoHash', '标准色号'],
      ['startStation', '起始站'],
      ['endStation', '终点站'],
    ];
    for (const [k, label] of need) {
      if (!nonEmpty(info[k])) return { ok: false as const, error: `信息未填写完成：缺少 ${label}` };
    }
    const color = sanitizeColorNoHash(info.colorHexNoHash);
    if (!color) return { ok: false as const, error: '信息未填写完成：标准色号为空' };
    return { ok: true as const };
  };

  const onCompleteInfo = () => {
    // 1) 校验
    const v = validateInfoForm();
    if (!v.ok) {
      window.alert(v.error);
      return;
    }
    if (!creatorId.trim()) {
      window.alert('填写者ID为空，请返回第一步填写');
      return;
    }
    if (centerPoints.length < 2) {
      window.alert('中心线为空或点数不足，请返回第二步绘制中心线');
      return;
    }

    // 2) 构建基础字段
    const baseLineId = buildBaseLineId();
    const baseLineName = String(info.lineName ?? '').trim();
    const baseDirection = buildDirectionValue();

    // 3) 输出基础 RLE（dir=3 或 4/2）
    //    注意：基础线 start/end 以“信息页输入”为准；中心线点序即当前方向，不做额外交换
    const baseCommit = commitRle({
      coords: centerPoints,
      lineId: baseLineId,
      lineName: baseLineName,
      direction: baseDirection,
      startName: info.startStation,
      endName: info.endStation,
      allowAutoSwapByCanonical: false,
    });

    if (!baseCommit.ok) {
      window.alert(`输出失败：${baseCommit.error}`);
      return;
    }

    // 联络线/其他：直接结束工作流回到选择页
    if (dirChoice === '联络线' || dirChoice === '其他') {
      bridgeRef.current.exitWorkflowToSelector();
      return;
    }

    // 上/下行：根据分支处理
    if (!branchChoice) {
      // 理论上不会发生（因为会经过 branch 页），但做兜底
      window.alert('未选择工作流分支');
      return;
    }

    if (branchChoice === '三线合一') {
      // 立即输出上下行两条（dir=0/1）
      // 规则：若第二步方向选择为下行，则原中心线为下行（dir=0），反转为上行（dir=1）
      //       若第二步方向选择为上行，则相反
      const isDownFirst = dirChoice === '下行';

      const originalCoords = centerPoints;
      const reversedCoords = reversePoints(centerPoints);

      const start = info.startStation;
      const end = info.endStation;

      const downLineId = `${baseLineId}_D`;
      const upLineId = `${baseLineId}_U`;
      const downName = `${baseLineName}-下行`;
      const upName = `${baseLineName}-上行`;

      // 对“反转点序”的那条线：必须交换 start/end（严格遵循点序）
      const downFromOriginal = {
        coords: originalCoords,
        startName: start,
        endName: end,
      };
      const upFromReversed = {
        coords: reversedCoords,
        startName: end,
        endName: start,
      };

      const downFromReversed = {
        coords: reversedCoords,
        startName: end,
        endName: start,
      };
      const upFromOriginal = {
        coords: originalCoords,
        startName: start,
        endName: end,
      };

      if (isDownFirst) {
        const c1 = commitRle({
          coords: downFromOriginal.coords,
          lineId: downLineId,
          lineName: downName,
          direction: 0,
          startName: downFromOriginal.startName,
          endName: downFromOriginal.endName,
          allowAutoSwapByCanonical: false,
        });
        if (!c1.ok) {
          window.alert(`输出下行失败：${c1.error}`);
          return;
        }

        const c2 = commitRle({
          coords: upFromReversed.coords,
          lineId: upLineId,
          lineName: upName,
          direction: 1,
          startName: upFromReversed.startName,
          endName: upFromReversed.endName,
          allowAutoSwapByCanonical: false,
        });
        if (!c2.ok) {
          window.alert(`输出上行失败：${c2.error}`);
          return;
        }
      } else {
        const c1 = commitRle({
          coords: upFromOriginal.coords,
          lineId: upLineId,
          lineName: upName,
          direction: 1,
          startName: upFromOriginal.startName,
          endName: upFromOriginal.endName,
          allowAutoSwapByCanonical: false,
        });
        if (!c1.ok) {
          window.alert(`输出上行失败：${c1.error}`);
          return;
        }

        const c2 = commitRle({
          coords: downFromReversed.coords,
          lineId: downLineId,
          lineName: downName,
          direction: 0,
          startName: downFromReversed.startName,
          endName: downFromReversed.endName,
          allowAutoSwapByCanonical: false,
        });
        if (!c2.ok) {
          window.alert(`输出下行失败：${c2.error}`);
          return;
        }
      }

      // 结束工作流
      bridgeRef.current.exitWorkflowToSelector();
      return;
    }

    // 上下行单划：进入下行绘制页
    // 清空上下行状态与预览（保留中心线预览）
    setDownPoints([]);
    setUpPoints([]);
    bridgeRef.current.clearWorkflowPreview('railway:down');
    bridgeRef.current.clearWorkflowPreview('railway:up');

    goTo('down');
  };

  // --------- Down/Up actions ----------
  const onNextFromDown = () => {
    const saved = saveDownFromDraft();
    if (!saved.ok) {
      window.alert(saved.error);
      return;
    }
    if (!saved.pts || saved.pts.length < 2) {
      window.alert('下行方向至少需要 2 个点');
      return;
    }
    goTo('up');
  };

  const onCompleteUp = () => {
    const saved = saveUpFromDraft();
    if (!saved.ok) {
      window.alert(saved.error);
      return;
    }
    if (!saved.pts || saved.pts.length < 2) {
      window.alert('上行方向至少需要 2 个点');
      return;
    }
    if (downPoints.length < 2) {
      window.alert('下行方向为空或点数不足，请先完成下行绘制');
      return;
    }

    // 输出上下行两条：点序原样使用；start/end 根据点序相对中心线方向自动交换
    const v = validateInfoForm();
    if (!v.ok) {
      window.alert(v.error);
      return;
    }

    const baseLineId = buildBaseLineId();
    const baseLineName = String(info.lineName ?? '').trim();

    const downLineId = `${baseLineId}_D`;
    const upLineId = `${baseLineId}_U`;
    const downName = `${baseLineName}-下行`;
    const upName = `${baseLineName}-上行`;

    const downCommit = commitRle({
      coords: downPoints,
      lineId: downLineId,
      lineName: downName,
      direction: 0,
      startName: info.startStation,
      endName: info.endStation,
      allowAutoSwapByCanonical: true, // 按点序决定是否交换 start/end
    });
    if (!downCommit.ok) {
      window.alert(`输出下行失败：${downCommit.error}`);
      return;
    }

    const upCommit = commitRle({
      coords: saved.pts,
      lineId: upLineId,
      lineName: upName,
      direction: 1,
      startName: info.startStation,
      endName: info.endStation,
      allowAutoSwapByCanonical: true, // 按点序决定是否交换 start/end
    });
    if (!upCommit.ok) {
      window.alert(`输出上行失败：${upCommit.error}`);
      return;
    }

    // 完成：回到工作流选择
    bridgeRef.current.exitWorkflowToSelector();
  };

  // --------- UI ----------


  if (step === 'creator') {
    return (
      <div className="p-3">
        <TopNav
          title="铁路工作流：填写者"
          showNext
          nextDisabled={!creatorId.trim()}
          onNext={onNextFromCreator}
        />

        <div className="space-y-3">
          <LabeledInput
            label="填写者ID（将写入所有输出图层的 CreateBy）"
            value={creatorId}
            placeholder="例如：Ozstk639"
            onChange={setCreatorId}
          />

          <div className="text-xs opacity-80">
            此步骤不涉及坐标采集。完成后进入中心线绘制。
          </div>
        </div>
      </div>
    );
  }

  if (step === 'center') {
    const draftCount = bridgeRef.current.getTempPoints()?.length ?? 0;

    return (
      <div className="p-3">
        <TopNav
          title="铁路工作流：中心线"
          showPrev
          showNext
          onPrev={onPrevFromCenter}
          onNext={onNextFromCenter}
        />

        <div className="space-y-3">
          <div className="text-xs opacity-80">
            请在地图上绘制中心线（Polyline）。当前点数：{draftCount}
          </div>

          <label className="block space-y-1">
            <div className="text-xs opacity-80">选择方向</div>
            <select
              className="w-full px-3 py-2 rounded bg-white border border-gray-300 text-sm text-gray-900 outline-none focus:border-gray-500"
              value={dirChoice}
              onChange={(e) => setDirChoice(e.target.value as DirChoice)}
            >
              <option value="上行">上行</option>
              <option value="下行">下行</option>
              <option value="联络线">联络线</option>
              <option value="其他">其他</option>
            </select>
          </label>

          <div className="text-xs opacity-70">
            点击“下一步”会自动保存中心线点序并保持显示。
          </div>

          {centerSavedOnce ? (
  <div className="text-xs text-emerald-600">
    中心线已保存（后续上下行页可导入中心线到当前工作区）。
  </div>
) : (
  <div className="text-xs text-gray-500">
    中心线尚未保存：点击“上一步/下一步”会自动保存一次中心线点序。
  </div>
)}

        </div>
      </div>
    );
  }

if (step === 'branch') {
  const canNext = !!branchChoice;

  return (
    <div className="p-3">
      <TopNav
        title="铁路工作流：绘制方式选择"
        showPrev
        showNext={canNext}
        prevDisabled={branchLocked}
        nextDisabled={!canNext}
        onPrev={onPrevFromBranch}
        onNext={onNextFromBranch}
      />

      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            className={`p-4 rounded border text-left ${
              branchChoice === '三线合一'
                ? 'border-emerald-600 bg-emerald-50'
                : 'border-gray-300 bg-white hover:bg-gray-50'
            }`}
            onClick={() => {
              if (branchLocked) return;
              setBranchChoice('三线合一');
            }}
          >
            <div className="text-sm font-semibold mb-1 text-gray-900">三线合一</div>
            <div className="text-xs text-gray-600">
              完成信息后将输出：展示线(dir=3) + 下行(dir=0) + 上行(dir=1)
            </div>
          </button>

          <button
            type="button"
            className={`p-4 rounded border text-left ${
              branchChoice === '上下行单划'
                ? 'border-emerald-600 bg-emerald-50'
                : 'border-gray-300 bg-white hover:bg-gray-50'
            }`}
            onClick={() => {
              if (branchLocked) return;
              setBranchChoice('上下行单划');
            }}
          >
            <div className="text-sm font-semibold mb-1 text-gray-900">上下行单划</div>
            <div className="text-xs text-gray-600">
              完成信息后进入下行/上行两页，分别绘制并输出(dir=0/1)
            </div>
          </button>
        </div>

        {branchChoice ? (
          <div className="text-xs text-amber-600">
            此处一旦选择后则无法回到此页面，请确认
          </div>
        ) : null}
      </div>
    </div>
  );
}


  if (step === 'info') {
    return (
      <div className="p-3">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="text-sm font-semibold">铁路工作流：信息填写</div>
          <button
            className="px-3 py-1.5 rounded border text-sm hover:bg-gray-100"
            onClick={() => {
              // 信息页无“前一步/后一步”，但允许用户直接退出回到工作流选择（不输出）
              const ok = window.confirm('确认退出当前工作流？已填写信息将不会输出。');
              if (!ok) return;
              bridgeRef.current.exitWorkflowToSelector();
            }}
          >
            退出
          </button>
        </div>

        <div className="space-y-3">
          <LabeledInput
            label="线路名"
            value={info.lineName}
            onChange={(v) => setInfo((s) => ({ ...s, lineName: v }))}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <LabeledInput
              label="区段代码"
              value={info.sectionCode}
              onChange={(v) => setInfo((s) => ({ ...s, sectionCode: v }))}
              placeholder="例如：A"
            />
            <LabeledInput
              label="测绘次数（默认 1）"
              value={info.times}
              onChange={(v) => setInfo((s) => ({ ...s, times: v }))}
              placeholder="1"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <LabeledInput
              label="路局代码（bureau）"
              value={info.bureau}
              onChange={(v) => setInfo((s) => ({ ...s, bureau: v }))}
              placeholder="例如：T"
            />
            <LabeledInput
              label="线路编号（line）"
              value={info.lineNo}
              onChange={(v) => setInfo((s) => ({ ...s, lineNo: v }))}
              placeholder="例如：1"
            />
          </div>

          <LabeledInput
            label="标准色号（不含 #）"
            value={info.colorHexNoHash}
            onChange={(v) => setInfo((s) => ({ ...s, colorHexNoHash: v }))}
            placeholder="例如：ff0000"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <LabeledInput
              label="起始站（当前画线方向）"
              value={info.startStation}
              onChange={(v) => setInfo((s) => ({ ...s, startStation: v }))}
            />
            <LabeledInput
              label="终点站（当前画线方向）"
              value={info.endStation}
              onChange={(v) => setInfo((s) => ({ ...s, endStation: v }))}
            />
          </div>

          <button
            className="w-full px-4 py-2.5 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-700"
            onClick={onCompleteInfo}
          >
            完成并输出
          </button>

          <div className="text-xs opacity-70">
            点击完成将：构建 LineID、输出展示线（dir=3 或联络线/其他为 dir=4/2），并按选择生成后续上下行线。
          </div>
        </div>
      </div>
    );
  }

  if (step === 'down') {
    const draftCount = bridgeRef.current.getTempPoints()?.length ?? 0;

    return (
      <div className="p-3">
        <TopNav title="下行方向" showNext onNext={onNextFromDown} />

        <div className="space-y-3">
          <div className="text-xs opacity-80">
            请绘制下行线路（Polyline）。当前点数：{draftCount}
          </div>

          <button
            className="px-3 py-2 rounded border text-sm hover:bg-gray-100"
            onClick={() => {
              if (centerPoints.length < 2) {
                window.alert('中心线为空或点数不足，无法导入');
                return;
              }
              // 导入中心线点序到当前工作区（便于分离绘制）
              bridgeRef.current.setTempPoints(centerPoints);
            }}
          >
            导入中心线坐标到当前工作区
          </button>

          <div className="text-xs opacity-70">
            点击“下一步”会临时保存下行点序并进入上行绘制。
          </div>
        </div>
      </div>
    );
  }

  // step === 'up'
  {
    const draftCount = bridgeRef.current.getTempPoints()?.length ?? 0;

    return (
      <div className="p-3">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="text-sm font-semibold">上行方向</div>
          <button
            className="px-3 py-1.5 rounded border text-sm hover:bg-gray-100"
            onClick={() => {
              const ok = window.confirm('确认退出当前工作流？已绘制内容将不会输出。');
              if (!ok) return;
              bridgeRef.current.exitWorkflowToSelector();
            }}
          >
            退出
          </button>
        </div>

        <div className="space-y-3">
          <div className="text-xs opacity-80">
            请绘制上行线路（Polyline）。当前点数：{draftCount}
          </div>

          <button
            className="px-3 py-2 rounded border text-sm hover:bg-gray-100"
            onClick={() => {
              if (centerPoints.length < 2) {
                window.alert('中心线为空或点数不足，无法导入');
                return;
              }
              // 导入中心线点序到当前工作区（便于分离绘制）
              bridgeRef.current.setTempPoints(centerPoints);
            }}
          >
            导入中心线坐标到当前工作区
          </button>

          <button
            className="w-full px-4 py-2.5 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-700"
            onClick={onCompleteUp}
          >
            完成并保存
          </button>

          <div className="text-xs opacity-70">
            将检查上下行均非空，并输出下行(dir=0)与上行(dir=1)。点序原样保留；起终站字段将依据点序相对中心线方向自动交换以匹配点序。
          </div>
        </div>
      </div>
    );
  }
}