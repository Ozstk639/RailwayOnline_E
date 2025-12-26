import type { FeatureRecord, SignatureEntry } from './renderRules';

/**
 * 为“可读性优先”的规则表提供查询能力。
 *
 * 设计目标：
 * - 索引结构尽量直观（允许一定性能开销）。
 * - 支持：
 *   1) Class → idValue 的存在性判断（用于“若存在则不渲染/若不存在则渲染”）
 *   2) Class → signatureKey 的快速定位（用于你所说的 signature 索引体系）
 */

export type DuplicateKeyReport = {
  dupKey: string;
  className: string;
  idField: string;
  idValue: string;
  count: number;
  examples: Array<{ uid: string; source?: string }>;
};

export class FeatureStore {
  /** 全量记录（当前 world） */
  public readonly all: FeatureRecord[];

  /** Class -> records */
  public readonly byClass: Record<string, FeatureRecord[]> = {};

  /** Class -> idValue -> records */
  public readonly byClassId: Record<string, Record<string, FeatureRecord[]>> = {};

  /** signatureIndex: Class -> signatureKey -> entries[] */
  public readonly signatureIndex: Record<string, Record<string, SignatureEntry[]>> = {};

  /** 线颜色索引（按可用的 lineId 字段） */
  public readonly lineColorIndex: Record<string, string> = {};

  constructor(records: FeatureRecord[]) {
    this.all = records;

    for (const r of records) {
      const cls = r.meta.Class || 'UNKNOWN';
      (this.byClass[cls] ??= []).push(r);

      if (r.meta.idValue) {
        const m = (this.byClassId[cls] ??= {});
        (m[r.meta.idValue] ??= []).push(r);
      }

      // signature index
      const c = (this.signatureIndex[cls] ??= {});
      (c[r.meta.signatureKey] ??= []).push({
        uid: r.uid,
        signatureKey: r.meta.signatureKey,
        sig: r.meta.sig,
        groups: r.meta.groups,
        source: r.meta.source,
      });

      // line color index (用于 PFB / 站台轮廓按线路色)
      if (cls === 'RLE' || cls === 'LINE' || cls === 'LIN' || cls === 'RMP_LINE') {
        const lineId = String((r.featureInfo as any)?.LineID ?? (r.featureInfo as any)?.lineID ?? (r.featureInfo as any)?.ID ?? '').trim();
        const color = String((r.featureInfo as any)?.color ?? (r.featureInfo as any)?.Color ?? '').trim();
        if (lineId && color) this.lineColorIndex[lineId] = color;
      }
    }
  }

  hasClass(cls: string) {
    return (this.byClass[cls]?.length ?? 0) > 0;
  }

  hasSameIdInClass(targetClass: string, idValue: string) {
    if (!idValue) return false;
    return (this.byClassId[targetClass]?.[idValue]?.length ?? 0) > 0;
  }

  /**
   * 读取“关联线路颜色”：
   * - 优先从 groups.Lines / groups.lines 中找 color
   * - 其次从 featureInfo.LineID / lineID 对应到全局线路索引
   */
  findRelatedLineColor(r: FeatureRecord): string | null {
    const g = r.meta.groups as any;
    const lines = (g?.Lines ?? g?.lines ?? g?.LINEs ?? null) as any[] | null;
    if (Array.isArray(lines) && lines.length > 0) {
      const c = String(lines[0]?.color ?? lines[0]?.Color ?? '').trim();
      if (c) return c;
    }

    const fid = String((r.featureInfo as any)?.LineID ?? (r.featureInfo as any)?.lineID ?? '').trim();
    if (fid && this.lineColorIndex[fid]) return this.lineColorIndex[fid];

    // 兜底：在全量里线性扫一次（可读性优先）
    if (fid) {
      for (const x of this.all) {
        const id = String((x.featureInfo as any)?.LineID ?? (x.featureInfo as any)?.lineID ?? (x.featureInfo as any)?.ID ?? '').trim();
        if (id === fid) {
          const c = String((x.featureInfo as any)?.color ?? (x.featureInfo as any)?.Color ?? '').trim();
          if (c) return c;
        }
      }
    }
    return null;
  }

  /**
   * 输出 Class + idField + idValue 级别的重复 key 报告（用于排查“同 key 导致渲染覆盖/堆叠异常”）。
   */
  buildDuplicateKeyReport(): DuplicateKeyReport[] {
    const acc: Record<string, DuplicateKeyReport> = {};
    for (const r of this.all) {
      const cls = r.meta.Class || 'UNKNOWN';
      const idField = r.meta.idField;
      const idValue = r.meta.idValue;
      if (!idField || !idValue) continue;
      const dupKey = `${cls}|${idField}=${idValue}`;
      const item = (acc[dupKey] ??= {
        dupKey,
        className: cls,
        idField,
        idValue,
        count: 0,
        examples: [],
      });
      item.count += 1;
      if (item.examples.length < 5) item.examples.push({ uid: r.uid, source: r.meta.source });
    }

    return Object.values(acc).filter(x => x.count > 1);
  }
}
