// File: src/components/Mapping/Workflow/StationWorkflow.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowComponentProps, WorldPoint } from './WorkflowHost';

/**
 * StationWorkflow（工作流：车站和站台）
 *
 * 页面结构：
 * 1) 填写者
 * 2) 基础信息（bureau / line / section / stationNo / stationName）
 * 3) 车站总建筑（STB polygon，可跳过；离开后不可回退）
 * 4) 车站轮廓（PFB polygon，可从 STB 导入坐标）
 * 5) 下行站台（PLF point + 状态/线路组，可添加多线路）
 * 6) 上行站台（PLF point，可从下行导入坐标）
 * 7) 站台点（STA point，可从站台导入；若 STB 跳过则需手动输入车站建筑 ID）
 */

type Step = 'creator' | 'base' | 'stb' | 'pfb' | 'plfDown' | 'plfUp' | 'sta';

type BaseForm = {
  bureau: string;
  lineNo: string;
  sectionCode: string;
  stationNo: string;
  stationName: string;
};

type LineEntry = {
  ID: string;
  stationCode?: string | number;
  stationDistance?: string | number;
  Avaliable: boolean;
  Overtaking: boolean;
  getin: boolean;
  getout: boolean;
  NextOT: boolean;
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

function nonEmpty(s: string) {
  return String(s ?? '').trim().length > 0;
}

function resolveWorldPrefix(worldIdRaw: string): string {
  const w = String(worldIdRaw ?? '').trim();
  if (!w) return 'Z';

  // 允许传入 0..5
  const asNum = Number(w);
  if (Number.isFinite(asNum) && WORLD_CODE_TO_PREFIX[asNum as any]) return WORLD_CODE_TO_PREFIX[asNum as any];

  // 允许传入 zth/naraku/... 等
  const code = WORLD_ID_TO_CODE[w];
  if (Number.isFinite(code)) return WORLD_CODE_TO_PREFIX[code];

  // 允许传入已经是 Z/N/H/E/L/Y
  if (/^[ZNHELY]$/i.test(w)) return w.toUpperCase();

  return 'Z';
}

function firstPointOnly(pts: WorldPoint[]) {
  if (!Array.isArray(pts) || pts.length === 0) return [] as WorldPoint[];
  return [pts[0]];
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
  disabled?: boolean;
};

/**
 * 注意：必须在组件外定义，避免父组件 re-render 时“组件类型变化”导致 input 被卸载重建，
 * 从而出现“光标闪一下就消失、无法输入”的现象。
 */
function LabeledInput(props: LabeledInputProps) {
  const { label, value, placeholder, onChange, type = 'text', disabled } = props;
  return (
    <label className="block space-y-1">
      <div className="text-xs opacity-80">{label}</div>
      <input
        type={type}
        className={`w-full border p-1 rounded text-sm ${disabled ? 'bg-gray-100 text-gray-500' : ''}`}
        value={value}
        placeholder={placeholder}
        disabled={!!disabled}
        onChange={(e) => onChange(e.target.value)}
        onMouseDownCapture={(e) => e.stopPropagation()}
        onPointerDownCapture={(e) => e.stopPropagation()}
        onTouchStartCapture={(e) => e.stopPropagation()}
      />
    </label>
  );
}

type ToggleProps = {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
};

function Toggle(props: ToggleProps) {
  const { label, value, onChange } = props;
  return (
    <label className="flex items-center justify-between gap-3 px-3 py-2 border border-gray-200 rounded bg-white">
      <span className="text-sm text-gray-900">{label}</span>
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
        onMouseDownCapture={(e) => e.stopPropagation()}
        onPointerDownCapture={(e) => e.stopPropagation()}
        onTouchStartCapture={(e) => e.stopPropagation()}
      />
    </label>
  );
}

export default function StationWorkflow(props: WorkflowComponentProps) {
  const { bridge } = props;

  const bridgeRef = useRef(bridge);
  useEffect(() => {
    bridgeRef.current = bridge;
  }, [bridge]);

  const [step, setStep] = useState<Step>('creator');

  // Page 1
  const [creatorId, setCreatorId] = useState<string>(() => (bridgeRef.current.getEditorId?.() ?? '').trim());

  // Page 2
  const [base, setBase] = useState<BaseForm>({
    bureau: '',
    lineNo: '',
    sectionCode: '',
    stationNo: '',
    stationName: '',
  });

  // World
  const worldPrefix = useMemo(() => resolveWorldPrefix(bridge.getCurrentWorldId?.() ?? ''), [bridge]);

  // STB page
  const [stbAbbrA, setStbAbbrA] = useState('');
  const [stbAbbrB, setStbAbbrB] = useState('');
  const [stbFinalized, setStbFinalized] = useState(false);
  const [stbSkipped, setStbSkipped] = useState(false);
  const [stbId, setStbId] = useState('');
  const [stbPolygon, setStbPolygon] = useState<WorldPoint[]>([]);

  // PFB page
  const [pfbPolygon, setPfbPolygon] = useState<WorldPoint[]>([]);
  const [pfbId, setPfbId] = useState('');

  // PLF down
  const [plfNoDown, setPlfNoDown] = useState('');
  const [plfSituationDown, setPlfSituationDown] = useState(true);
  const [plfConnectDown, setPlfConnectDown] = useState(true);
  const [plfLinesDown, setPlfLinesDown] = useState<LineEntry[]>(() => [
    {
      ID: '',
      Avaliable: true,
      Overtaking: false,
      getin: true,
      getout: true,
      NextOT: false,
    },
  ]);
  const [plfDownId, setPlfDownId] = useState('');
  const [plfDownPoint, setPlfDownPoint] = useState<WorldPoint[]>([]);

  // PLF up
  const [plfNoUp, setPlfNoUp] = useState('');
  const [plfSituationUp, setPlfSituationUp] = useState(true);
  const [plfConnectUp, setPlfConnectUp] = useState(true);
  const [plfLinesUp, setPlfLinesUp] = useState<LineEntry[]>(() => [
    {
      ID: '',
      Avaliable: true,
      Overtaking: false,
      getin: true,
      getout: true,
      NextOT: false,
    },
  ]);
  const [plfUpId, setPlfUpId] = useState('');
  const [plfUpPoint, setPlfUpPoint] = useState<WorldPoint[]>([]);

  // STA
  const [stbIdManual, setStbIdManual] = useState('');

  // 线路 ID：用于 PFB LineID、PLF lines[0].ID
  const lineIdRef = useMemo(() => {
    const bureau = String(base.bureau ?? '').trim();
    const lineNo = String(base.lineNo ?? '').trim();
    const section = String(base.sectionCode ?? '').trim();
    if (!bureau || !lineNo) return '';
    // 与铁路工作流保持一致的“线路ID引用”生成方式（此处 times 固定 01）
    if (section) return `${worldPrefix}R${bureau}${lineNo}_${section}_01`;
    return `${worldPrefix}R${bureau}${lineNo}`;
  }, [base.bureau, base.lineNo, base.sectionCode, worldPrefix]);

  const stationId = useMemo(() => {
    const bureau = String(base.bureau ?? '').trim();
    const lineNo = String(base.lineNo ?? '').trim();
    const stationNo = String(base.stationNo ?? '').trim();
    if (!bureau || !lineNo || !stationNo) return '';
    return `${worldPrefix}R${bureau}${lineNo}STA_${stationNo}`;
  }, [base.bureau, base.lineNo, base.stationNo, worldPrefix]);

  // 为默认 lines[0].ID 自动回填
  useEffect(() => {
    if (!lineIdRef) return;
    setPlfLinesDown((prev) => {
      if (!prev?.length) return prev;
      const next = [...prev];
      if (!String(next[0]?.ID ?? '').trim()) next[0] = { ...next[0], ID: lineIdRef };
      // stationCode 默认 = stationNo
      const sc = String(base.stationNo ?? '').trim();
      if (sc && (next[0].stationCode === undefined || next[0].stationCode === '')) next[0] = { ...next[0], stationCode: sc };
      return next;
    });
    setPlfLinesUp((prev) => {
      if (!prev?.length) return prev;
      const next = [...prev];
      if (!String(next[0]?.ID ?? '').trim()) next[0] = { ...next[0], ID: lineIdRef };
      const sc = String(base.stationNo ?? '').trim();
      if (sc && (next[0].stationCode === undefined || next[0].stationCode === '')) next[0] = { ...next[0], stationCode: sc };
      return next;
    });
  }, [lineIdRef, base.stationNo]);

  // step -> draw mode
  useEffect(() => {
    const b = bridgeRef.current;
    if (!b) return;

    if (step === 'creator' || step === 'base') {
      b.setDrawMode('none');
      b.clearTempPoints();
      return;
    }

    if (step === 'stb') {
      b.setDrawMode('polygon');
      b.setTempPoints(stbPolygon);
      return;
    }

    if (step === 'pfb') {
      b.setDrawMode('polygon');
      b.setTempPoints(pfbPolygon);
      return;
    }

    if (step === 'plfDown') {
      b.setDrawMode('point');
      b.setTempPoints(plfDownPoint);
      return;
    }

    if (step === 'plfUp') {
      b.setDrawMode('point');
      b.setTempPoints(plfUpPoint);
      return;
    }

    if (step === 'sta') {
      b.setDrawMode('point');
      b.clearTempPoints();
    }
  }, [step, stbPolygon, pfbPolygon, plfDownPoint, plfUpPoint]);

  // ---------- handlers ----------
  const goCreatorNext = () => {
    const id = String(creatorId ?? '').trim();
    if (!id) return;
    const b = bridgeRef.current;
    b.setEditorId(id);
    setCreatorId(id);
    setStep('base');
  };

  const goBasePrev = () => setStep('creator');
  const goBaseNext = () => {
    const bureau = String(base.bureau ?? '').trim();
    const lineNo = String(base.lineNo ?? '').trim();
    const section = String(base.sectionCode ?? '').trim();
    const stationNo = String(base.stationNo ?? '').trim();
    const stationName = String(base.stationName ?? '').trim();
    if (!bureau || !lineNo || !section || !stationNo || !stationName) return;

    // 已经离开过 STB 页面，则不允许回退到 STB：直接去 PFB
    setStep(stbFinalized ? 'pfb' : 'stb');
  };

  const goPrevFromStb = () => setStep('base');

  const finalizeStbSkip = () => {
    if (stbFinalized) return;
    const b = bridgeRef.current;
    const pts = b.getTempPoints() ?? [];
    if (pts.length > 0) return;
    setStbFinalized(true);
    setStbSkipped(true);
    setStbId('');
    setStbPolygon([]);
    b.clearTempPoints();
    setStep('pfb');
  };

  const finalizeStbNext = () => {
    if (stbFinalized) return;
    const b = bridgeRef.current;
    const pts = b.getTempPoints() ?? [];
    if (pts.length < 3) return;

    const abbrA = String(stbAbbrA ?? '').trim();
    const abbrB = String(stbAbbrB ?? '').trim();
    const abbr = (abbrA + abbrB).trim();
    if (!abbr) {
      alert('请填写“车站名字符简称”。');
      return;
    }

    const bureau = String(base.bureau ?? '').trim();
    const buildingId = `${worldPrefix}R${bureau}STB_${abbr}`;
    const buildingName = String(base.stationName ?? '').trim();

    if (!stationId) {
      alert('基础信息不完整：无法生成 stationID。');
      return;
    }

    const res = b.commitFeature({
      subType: '车站建筑',
      mode: 'polygon',
      coords: pts,
      values: {
        staBuildingID: buildingId,
        staBuildingName: buildingName,
      },
      groupInfo: {
        Stations: [{ ID: stationId }],
      },
      editorId: String(creatorId ?? '').trim(),
    });

    if (!res.ok) {
      alert(res.error);
      return;
    }

    setStbFinalized(true);
    setStbSkipped(false);
    setStbId(buildingId);
    setStbPolygon(pts);
    b.clearTempPoints();
    setStep('pfb');
  };

  const goPrevFromPfb = () => setStep('base');
  const finalizePfbNext = () => {
    const b = bridgeRef.current;
    const pts = b.getTempPoints() ?? [];
    if (pts.length < 3) return;

    if (!nonEmpty(base.bureau) || !nonEmpty(base.lineNo) || !nonEmpty(base.stationNo) || !nonEmpty(base.stationName)) {
      alert('基础信息不完整。');
      return;
    }
    if (!lineIdRef) {
      alert('无法生成 LineID（请检查路局代码/线路编号/区段代码）。');
      return;
    }

    const id = `${worldPrefix}R${String(base.bureau).trim()}${String(base.lineNo).trim()}PFB_${String(base.stationNo).trim()}`;
    const name = String(base.stationName ?? '').trim();

    const res = b.commitFeature({
      subType: '站台轮廓',
      mode: 'polygon',
      coords: pts,
      values: {
        plfRoundID: id,
        plfRoundName: name,
        LineID: lineIdRef,
      },
      groupInfo: {},
      editorId: String(creatorId ?? '').trim(),
    });

    if (!res.ok) {
      alert(res.error);
      return;
    }

    setPfbId(id);
    setPfbPolygon(pts);
    b.clearTempPoints();
    setStep('plfDown');
  };

  const normalizeLines = (lines: LineEntry[]) => {
    const out: LineEntry[] = [];
    for (const it of lines ?? []) {
      const ID = String(it?.ID ?? '').trim();
      if (!ID) return { ok: false as const, error: '线路条目中存在空的线路ID(ID)。' };
      out.push({
        ID,
        stationCode: it.stationCode,
        stationDistance: it.stationDistance,
        Avaliable: !!it.Avaliable,
        Overtaking: !!it.Overtaking,
        getin: !!it.getin,
        getout: !!it.getout,
        NextOT: !!it.NextOT,
      });
    }
    return { ok: true as const, lines: out };
  };

  const finalizePlfDownNext = () => {
    const b = bridgeRef.current;
    const pts = firstPointOnly(b.getTempPoints() ?? []);
    if (pts.length < 1) return;
    const no = String(plfNoDown ?? '').trim();
    if (!no) return;

    const chk = normalizeLines(plfLinesDown);
    if (!chk.ok) {
      alert(chk.error);
      return;
    }

    const id = `${worldPrefix}R${String(base.bureau).trim()}${String(base.lineNo).trim()}PLF*${String(base.stationNo).trim()}*D`;
    const name = `${String(base.stationName).trim()}-${no}站台`;

    const res = b.commitFeature({
      subType: '站台',
      mode: 'point',
      coords: pts,
      values: {
        platformID: id,
        platformName: name,
        Situation: !!plfSituationDown,
        Connect: !!plfConnectDown,
      },
      groupInfo: {
        lines: chk.lines,
      },
      editorId: String(creatorId ?? '').trim(),
    });

    if (!res.ok) {
      alert(res.error);
      return;
    }

    setPlfDownId(id);
    setPlfDownPoint(pts);
    b.clearTempPoints();
    // 默认把下行站台号复制到上行站台
    if (!nonEmpty(plfNoUp)) setPlfNoUp(no);
    setStep('plfUp');
  };

  const finalizePlfUpNext = () => {
    const b = bridgeRef.current;
    const pts = firstPointOnly(b.getTempPoints() ?? []);
    if (pts.length < 1) return;
    const no = String(plfNoUp ?? '').trim();
    if (!no) return;

    const chk = normalizeLines(plfLinesUp);
    if (!chk.ok) {
      alert(chk.error);
      return;
    }

    const id = `${worldPrefix}R${String(base.bureau).trim()}${String(base.lineNo).trim()}PLF*${String(base.stationNo).trim()}*U`;
    const name = `${String(base.stationName).trim()}-${no}站台`;

    const res = b.commitFeature({
      subType: '站台',
      mode: 'point',
      coords: pts,
      values: {
        platformID: id,
        platformName: name,
        Situation: !!plfSituationUp,
        Connect: !!plfConnectUp,
      },
      groupInfo: {
        lines: chk.lines,
      },
      editorId: String(creatorId ?? '').trim(),
    });

    if (!res.ok) {
      alert(res.error);
      return;
    }

    setPlfUpId(id);
    setPlfUpPoint(pts);
    b.clearTempPoints();
    setStep('sta');
  };

  const finalizeStaNext = () => {
    const b = bridgeRef.current;
    const pts = firstPointOnly(b.getTempPoints() ?? []);
    if (pts.length < 1) return;

    if (!stationId) {
      alert('基础信息不完整：无法生成 stationID。');
      return;
    }
    if (!plfDownId || !plfUpId) {
      alert('请先完成下行与上行站台绘制。');
      return;
    }

    const building = stbSkipped ? String(stbIdManual ?? '').trim() : String(stbId ?? '').trim();
    if (!building) {
      alert('车站建筑ID为空。');
      return;
    }

    const res = b.commitFeature({
      subType: '车站',
      mode: 'point',
      coords: pts,
      values: {
        stationID: stationId,
        stationName: String(base.stationName ?? '').trim(),
        STBuilding: building,
      },
      groupInfo: {
        platforms: [{ ID: plfDownId }, { ID: plfUpId }],
      },
      editorId: String(creatorId ?? '').trim(),
    });

    if (!res.ok) {
      alert(res.error);
      return;
    }

    // 完成后回到快捷模式工作流选择页
    b.exitWorkflowToSelector();
  };

  // --------- render ---------

  if (step === 'creator') {
    const canNext = nonEmpty(creatorId);
    return (
      <div className="p-3">
        <TopNav title="车站和站台：填写者" showNext nextDisabled={!canNext} onNext={goCreatorNext} />

        <div className="space-y-3">
          <LabeledInput
            label="填写者ID（将写入所有输出图层的 CreateBy）"
            value={creatorId}
            placeholder="例如：Ozstk639"
            onChange={setCreatorId}
          />

          <div className="text-xs opacity-70">此步骤不涉及坐标采集。完成后进入信息填写。</div>
        </div>
      </div>
    );
  }

  if (step === 'base') {
    const canNext =
      nonEmpty(base.bureau) &&
      nonEmpty(base.lineNo) &&
      nonEmpty(base.sectionCode) &&
      nonEmpty(base.stationNo) &&
      nonEmpty(base.stationName);

    return (
      <div className="p-3">
        <TopNav
          title="车站和站台：基础信息"
          showPrev
          showNext
          prevDisabled={false}
          nextDisabled={!canNext}
          onPrev={goBasePrev}
          onNext={goBaseNext}
        />

        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <LabeledInput label="路局代码 (bureau)" value={base.bureau} onChange={(v) => setBase((p) => ({ ...p, bureau: v }))} />
            <LabeledInput label="线路编号 (line)" value={base.lineNo} onChange={(v) => setBase((p) => ({ ...p, lineNo: v }))} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <LabeledInput
              label="区段代码"
              value={base.sectionCode}
              onChange={(v) => setBase((p) => ({ ...p, sectionCode: v }))}
              placeholder="例如：A"
            />
            <LabeledInput
              label="当前车站编号"
              value={base.stationNo}
              onChange={(v) => setBase((p) => ({ ...p, stationNo: v }))}
              placeholder="例如：01"
            />
          </div>

          <LabeledInput
            label="车站名"
            value={base.stationName}
            onChange={(v) => setBase((p) => ({ ...p, stationName: v }))}
            placeholder="例如：西直门"
          />

          <div className="text-xs opacity-70">World 前缀：{worldPrefix}</div>
        </div>
      </div>
    );
  }

  if (step === 'stb') {
    const pts = bridge.getTempPoints?.() ?? [];
    const canNext = pts.length >= 3;
    const canSkip = pts.length === 0;
    const lockedHint = (
      <div className="text-xs text-amber-600">此页一旦点击“下一步/跳过”后将无法回退，请确认。</div>
    );

    return (
      <div className="p-3">
        <TopNav
          title="车站和站台：车站总建筑"
          showPrev
          showNext
          prevDisabled={false}
          nextDisabled={!canNext}
          onPrev={goPrevFromStb}
          onNext={finalizeStbNext}
        />

        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <LabeledInput
              label="车站名字符简称（1）"
              value={stbAbbrA}
              onChange={setStbAbbrA}
              placeholder="例如：XZM"
            />
            <LabeledInput
              label="车站名字符简称（2）"
              value={stbAbbrB}
              onChange={setStbAbbrB}
              placeholder="可留空"
            />
          </div>

          <div className="text-xs opacity-70">请使用面要素绘制模式绘制车站总建筑（STB）。</div>
          {lockedHint}

          <div className="flex gap-2">
            <button
              className={`px-3 py-2 rounded text-sm border border-gray-300 bg-white text-gray-900 ${
                !canSkip || stbFinalized ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'
              }`}
              type="button"
              disabled={!canSkip || stbFinalized}
              onClick={finalizeStbSkip}
            >
              跳过
            </button>
            <div className="text-xs opacity-70 self-center">当绘制区为空时可跳过；绘制完成后请点击右上角“下一步”。</div>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'pfb') {
    const pts = bridge.getTempPoints?.() ?? [];
    const canNext = pts.length >= 3;

    return (
      <div className="p-3">
        <TopNav
          title="车站和站台：车站轮廓（仅单线）"
          showPrev
          showNext
          prevDisabled={false}
          nextDisabled={!canNext}
          onPrev={goPrevFromPfb}
          onNext={finalizePfbNext}
        />

        <div className="space-y-3">
          <div className="text-xs opacity-70">请使用面要素绘制模式绘制车站轮廓（PFB）。</div>

          {!stbSkipped && stbPolygon.length >= 3 ? (
            <button
              className="px-3 py-2 rounded text-sm border border-gray-300 bg-white text-gray-900 hover:bg-gray-100"
              type="button"
              onClick={() => bridgeRef.current.setTempPoints(stbPolygon)}
            >
              从车站总建筑导入坐标
            </button>
          ) : null}

          <div className="text-xs opacity-70">保存后将输出到图层管理：plfRoundID={pfbId || '(自动生成)'}。</div>
        </div>
      </div>
    );
  }

  if (step === 'plfDown') {
    const pts = bridge.getTempPoints?.() ?? [];
    const canNext = pts.length >= 1 && nonEmpty(plfNoDown);

    return (
      <div className="p-3">
        <TopNav title="车站和站台：下行站台" showNext nextDisabled={!canNext} onNext={finalizePlfDownNext} />

        <div className="space-y-3">
          <LabeledInput label="站台号" value={plfNoDown} onChange={setPlfNoDown} placeholder="例如：1" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Toggle label="站台是否启用 (Situation)" value={plfSituationDown} onChange={setPlfSituationDown} />
            <Toggle label="外部连接功能 (Connect)" value={plfConnectDown} onChange={setPlfConnectDown} />
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold">经行线路（lines）</div>

            {plfLinesDown.map((ln, idx) => (
              <div key={idx} className="border border-gray-200 rounded p-2 bg-white space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold">线路条目 #{idx + 1}</div>
                  {idx > 0 ? (
                    <button
                      className="px-2 py-1 text-xs rounded border border-gray-300 hover:bg-gray-100"
                      type="button"
                      onClick={() => setPlfLinesDown((p) => p.filter((_, i) => i !== idx))}
                    >
                      删除
                    </button>
                  ) : null}
                </div>

                <LabeledInput
                  label="线路ID (ID)"
                  value={ln.ID}
                  onChange={(v) =>
                    setPlfLinesDown((p) => {
                      const next = [...p];
                      next[idx] = { ...next[idx], ID: v };
                      return next;
                    })
                  }
                  placeholder={lineIdRef || '例如：ZRT1_A_01'}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <LabeledInput
                    label="站台编号 (stationCode，可选)"
                    value={String(ln.stationCode ?? '')}
                    onChange={(v) =>
                      setPlfLinesDown((p) => {
                        const next = [...p];
                        next[idx] = { ...next[idx], stationCode: v };
                        return next;
                      })
                    }
                    placeholder={String(base.stationNo ?? '')}
                  />
                  <LabeledInput
                    label="线路距离 (stationDistance，可选)"
                    value={String(ln.stationDistance ?? '')}
                    onChange={(v) =>
                      setPlfLinesDown((p) => {
                        const next = [...p];
                        next[idx] = { ...next[idx], stationDistance: v };
                        return next;
                      })
                    }
                    placeholder="可留空"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Toggle
                    label="可使用性 (Avaliable)"
                    value={ln.Avaliable}
                    onChange={(v) =>
                      setPlfLinesDown((p) => {
                        const next = [...p];
                        next[idx] = { ...next[idx], Avaliable: v };
                        return next;
                      })
                    }
                  />
                  <Toggle
                    label="越行 (Overtaking)"
                    value={ln.Overtaking}
                    onChange={(v) =>
                      setPlfLinesDown((p) => {
                        const next = [...p];
                        next[idx] = { ...next[idx], Overtaking: v };
                        return next;
                      })
                    }
                  />
                  <Toggle
                    label="可上车 (getin)"
                    value={ln.getin}
                    onChange={(v) =>
                      setPlfLinesDown((p) => {
                        const next = [...p];
                        next[idx] = { ...next[idx], getin: v };
                        return next;
                      })
                    }
                  />
                  <Toggle
                    label="可下车 (getout)"
                    value={ln.getout}
                    onChange={(v) =>
                      setPlfLinesDown((p) => {
                        const next = [...p];
                        next[idx] = { ...next[idx], getout: v };
                        return next;
                      })
                    }
                  />
                  <Toggle
                    label="下一站越行 (NextOT)"
                    value={ln.NextOT}
                    onChange={(v) =>
                      setPlfLinesDown((p) => {
                        const next = [...p];
                        next[idx] = { ...next[idx], NextOT: v };
                        return next;
                      })
                    }
                  />
                </div>
              </div>
            ))}

            <button
              className="px-3 py-2 rounded text-sm border border-gray-300 bg-white text-gray-900 hover:bg-gray-100"
              type="button"
              onClick={() =>
                setPlfLinesDown((p) => [
                  ...p,
                  {
                    ID: '',
                    Avaliable: true,
                    Overtaking: false,
                    getin: true,
                    getout: true,
                    NextOT: false,
                  },
                ])
              }
            >
              添加其他线路
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'plfUp') {
    const pts = bridge.getTempPoints?.() ?? [];
    const canNext = pts.length >= 1 && nonEmpty(plfNoUp);

    return (
      <div className="p-3">
        <TopNav title="车站和站台：上行站台" showNext nextDisabled={!canNext} onNext={finalizePlfUpNext} />

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs opacity-70">可选：导入下行站台点坐标到当前工作区。</div>
            <button
              className={`px-3 py-2 rounded text-sm border border-gray-300 bg-white text-gray-900 ${
                plfDownPoint.length ? 'hover:bg-gray-100' : 'opacity-50 cursor-not-allowed'
              }`}
              type="button"
              disabled={!plfDownPoint.length}
              onClick={() => bridgeRef.current.setTempPoints(plfDownPoint)}
            >
              导入下行站台点
            </button>
          </div>

          <LabeledInput label="站台号" value={plfNoUp} onChange={setPlfNoUp} placeholder="例如：1" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Toggle label="站台是否启用 (Situation)" value={plfSituationUp} onChange={setPlfSituationUp} />
            <Toggle label="外部连接功能 (Connect)" value={plfConnectUp} onChange={setPlfConnectUp} />
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold">经行线路（lines）</div>
            {plfLinesUp.map((ln, idx) => (
              <div key={idx} className="border border-gray-200 rounded p-2 bg-white space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold">线路条目 #{idx + 1}</div>
                  {idx > 0 ? (
                    <button
                      className="px-2 py-1 text-xs rounded border border-gray-300 hover:bg-gray-100"
                      type="button"
                      onClick={() => setPlfLinesUp((p) => p.filter((_, i) => i !== idx))}
                    >
                      删除
                    </button>
                  ) : null}
                </div>

                <LabeledInput
                  label="线路ID (ID)"
                  value={ln.ID}
                  onChange={(v) =>
                    setPlfLinesUp((p) => {
                      const next = [...p];
                      next[idx] = { ...next[idx], ID: v };
                      return next;
                    })
                  }
                  placeholder={lineIdRef || '例如：ZRT1_A_01'}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <LabeledInput
                    label="站台编号 (stationCode，可选)"
                    value={String(ln.stationCode ?? '')}
                    onChange={(v) =>
                      setPlfLinesUp((p) => {
                        const next = [...p];
                        next[idx] = { ...next[idx], stationCode: v };
                        return next;
                      })
                    }
                    placeholder={String(base.stationNo ?? '')}
                  />
                  <LabeledInput
                    label="线路距离 (stationDistance，可选)"
                    value={String(ln.stationDistance ?? '')}
                    onChange={(v) =>
                      setPlfLinesUp((p) => {
                        const next = [...p];
                        next[idx] = { ...next[idx], stationDistance: v };
                        return next;
                      })
                    }
                    placeholder="可留空"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Toggle
                    label="可使用性 (Avaliable)"
                    value={ln.Avaliable}
                    onChange={(v) =>
                      setPlfLinesUp((p) => {
                        const next = [...p];
                        next[idx] = { ...next[idx], Avaliable: v };
                        return next;
                      })
                    }
                  />
                  <Toggle
                    label="越行 (Overtaking)"
                    value={ln.Overtaking}
                    onChange={(v) =>
                      setPlfLinesUp((p) => {
                        const next = [...p];
                        next[idx] = { ...next[idx], Overtaking: v };
                        return next;
                      })
                    }
                  />
                  <Toggle
                    label="可上车 (getin)"
                    value={ln.getin}
                    onChange={(v) =>
                      setPlfLinesUp((p) => {
                        const next = [...p];
                        next[idx] = { ...next[idx], getin: v };
                        return next;
                      })
                    }
                  />
                  <Toggle
                    label="可下车 (getout)"
                    value={ln.getout}
                    onChange={(v) =>
                      setPlfLinesUp((p) => {
                        const next = [...p];
                        next[idx] = { ...next[idx], getout: v };
                        return next;
                      })
                    }
                  />
                  <Toggle
                    label="下一站越行 (NextOT)"
                    value={ln.NextOT}
                    onChange={(v) =>
                      setPlfLinesUp((p) => {
                        const next = [...p];
                        next[idx] = { ...next[idx], NextOT: v };
                        return next;
                      })
                    }
                  />
                </div>
              </div>
            ))}

            <button
              className="px-3 py-2 rounded text-sm border border-gray-300 bg-white text-gray-900 hover:bg-gray-100"
              type="button"
              onClick={() =>
                setPlfLinesUp((p) => [
                  ...p,
                  {
                    ID: '',
                    Avaliable: true,
                    Overtaking: false,
                    getin: true,
                    getout: true,
                    NextOT: false,
                  },
                ])
              }
            >
              添加其他线路
            </button>
          </div>
        </div>
      </div>
    );
  }

  // step === 'sta'
  {
    const pts = bridge.getTempPoints?.() ?? [];
    const buildingOk = stbSkipped ? nonEmpty(stbIdManual) : nonEmpty(stbId);
    const canNext = pts.length >= 1 && buildingOk && nonEmpty(plfDownId) && nonEmpty(plfUpId);

    return (
      <div className="p-3">
        <TopNav title="车站和站台：站台点" showNext nextDisabled={!canNext} onNext={finalizeStaNext} />

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              className={`px-3 py-2 rounded text-sm border border-gray-300 bg-white text-gray-900 ${
                plfDownPoint.length ? 'hover:bg-gray-100' : 'opacity-50 cursor-not-allowed'
              }`}
              type="button"
              disabled={!plfDownPoint.length}
              onClick={() => bridgeRef.current.setTempPoints(plfDownPoint)}
            >
              导入下行站台点
            </button>
            <button
              className={`px-3 py-2 rounded text-sm border border-gray-300 bg-white text-gray-900 ${
                plfUpPoint.length ? 'hover:bg-gray-100' : 'opacity-50 cursor-not-allowed'
              }`}
              type="button"
              disabled={!plfUpPoint.length}
              onClick={() => bridgeRef.current.setTempPoints(plfUpPoint)}
            >
              导入上行站台点
            </button>
          </div>

          {stbSkipped ? (
            <LabeledInput
              label="车站建筑ID（第三页跳过时必填）"
              value={stbIdManual}
              onChange={setStbIdManual}
              placeholder="例如：ZRTSTB_XZM"
            />
          ) : (
            <div className="text-xs opacity-70">车站建筑ID：{stbId || '(未生成)'}（来自第三页）</div>
          )}

          <div className="text-xs opacity-70">
            stationID：{stationId || '(自动生成)'}；platforms：{plfDownId || '(D未生成)'} / {plfUpId || '(U未生成)'}
          </div>
        </div>
      </div>
    );
  }
}
