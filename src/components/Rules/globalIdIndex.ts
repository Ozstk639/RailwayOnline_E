import { RULE_DATA_SOURCES } from './ruleDataSources';
import { pickIdFieldValue } from './renderRules';

export type GlobalDbIdHit = {
  file: string;
  id: string;
  name: string;
};

export type TempLayerIdCandidate = {
  /** 图层在图层管理中的展示名（用于报错提示里的“xx图层”） */
  title: string;
  /** 该图层主 ID 值（用于对比） */
  id: string;
};

type CacheEntry = {
  builtAt: number;
  index: Map<string, GlobalDbIdHit>;
};

// 轻量缓存：避免用户反复点“临时挂载”时重复拉全库文件
const CACHE_TTL_MS = 60_000;
const cache: Record<string, CacheEntry | undefined> = {};

function pickAnyName(obj: any): string {
  if (!obj || typeof obj !== 'object') return '';
  const direct =
    obj.Name ??
    obj.name ??
    obj.StaName ??
    obj.StationName ??
    obj.LineName ??
    obj.PlatformName ??
    obj.BuildingName;
  if (direct != null && String(direct).trim()) return String(direct).trim();

  // fallback: first key that ends with Name/name
  for (const k of Object.keys(obj)) {
    if (typeof k !== 'string') continue;
    if (k.endsWith('Name') || k.endsWith('name')) {
      const v = (obj as any)[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
  }
  return '';
}

function extractObjectsFromJson(json: any): any[] {
  if (!json) return [];
  if (Array.isArray(json)) return json.filter((x) => x && typeof x === 'object');
  if (typeof json !== 'object') return [];

  // common keys
  const direct = (json as any).items ?? (json as any).features;
  if (Array.isArray(direct)) return direct.filter((x: any) => x && typeof x === 'object');

  // fallback: collect array values from root object
  const out: any[] = [];
  for (const v of Object.values(json as any)) {
    if (Array.isArray(v)) {
      for (const it of v) {
        if (it && typeof it === 'object') out.push(it);
      }
    }
  }
  return out;
}

async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function buildGlobalDbIdIndex(worldId: string): Promise<Map<string, GlobalDbIdHit>> {
  const now = Date.now();
  const c = cache[worldId];
  if (c && now - c.builtAt < CACHE_TTL_MS) return c.index;

  const ds = (RULE_DATA_SOURCES as any)[worldId] as { baseUrl: string; files: string[] } | undefined;
  const index = new Map<string, GlobalDbIdHit>();
  if (!ds || !Array.isArray(ds.files) || ds.files.length === 0) {
    cache[worldId] = { builtAt: now, index };
    return index;
  }

  // 串行加载：避免一次性并发请求过多
  for (const file of ds.files) {
    const url = `${ds.baseUrl}/${file}`;
    const json = await fetchJson(url);
    if (!json) continue;

    const items = extractObjectsFromJson(json);
    for (const obj of items) {
      const cls = String((obj as any).Class ?? (obj as any).subType ?? (obj as any).Type ?? '');
      const { idValue } = pickIdFieldValue(obj, cls);
      const id = String(idValue ?? '').trim();
      if (!id) continue;
      if (index.has(id)) continue;

      index.set(id, {
        file,
        id,
        name: pickAnyName(obj),
      });
    }
  }

  cache[worldId] = { builtAt: now, index };
  return index;
}

/**
 * 将“临时挂载候选图层”的 ID 与“全局数据库（RULE_DATA_SOURCES 全文件）”的 ID 做对比。
 * - 不依赖当前是否加载/显示
 * - 不改变任何现有载入/渲染模式（只做校验）
 */
export async function checkTempMountIdConflicts(params: {
  worldId: string;
  candidates: TempLayerIdCandidate[];
}): Promise<string[]> {
  const { worldId, candidates } = params;
  const messages: string[] = [];

  // 0) 先检查“当前测绘图层管理内部”的 ID 冲突（不需要读取全局库，反馈更及时）
  const seen = new Map<string, string>();
  for (const c of candidates) {
    const id = String(c.id ?? '').trim();
    if (!id) continue;
    const prevTitle = seen.get(id);
    if (prevTitle) {
      messages.push(`当前临时图层中的${c.title}，与 当前临时图层中的${prevTitle} 的ID ${id} 重合`);
      continue;
    }
    seen.set(id, c.title);
  }
  if (messages.length > 0) return messages;

  const index = await buildGlobalDbIdIndex(worldId);
  for (const c of candidates) {
    const id = String(c.id ?? '').trim();
    if (!id) continue;
    const hit = index.get(id);
    if (!hit) continue;
    messages.push(`当前临时图层中的${c.title}，与 ${hit.file} ${hit.id} ${hit.name} 重合`);
  }
  return messages;
}
