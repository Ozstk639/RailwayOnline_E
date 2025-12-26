/**
 * 规则驱动图层的数据源清单（按 worldId 管理）。
 *
 * 说明：
 * - 这里仅提供一个“可维护入口”。具体文件名/目录请按你的 public 结构调整。
 * - 如果 files 为空，本图层不会加载任何数据（不会报错）。
 */

export type WorldRuleDataSource = {
  baseUrl: string;
  files: string[];
};

export const RULE_DATA_SOURCES: Record<string, WorldRuleDataSource> = {
  /** 零洲 */
  zth: {
    baseUrl: '/data/JSON',
    files: [
    'EXchange_build.json',
    'ZRT13_01B.json',
    'ZRT13_01B_D.json',
    'ZRT13_01B_U.json',
    'ZRT13_Buids.json',
    'ZRT13_Stas.json',
    'ZRT1_01A.json',
    'ZRT1_01A_D.json',
    'ZRT1_01A_U.json',
    'ZRT1_01B.json',
    'ZRT1_01B_D.json',
    'ZRT1_01B_U.json',
    'ZRT1_01C.json',
    'ZRT1_01C_D.json',
    'ZRT1_01C_U.json',
    'ZRT1_01D.json',
    'ZRT1_01D_D.json',
    'ZRT1_01D_U.json',
    'ZRT1_Buids.json',
    'ZRT1_Stas.json',
    'ZRT4_01A.json',
    'ZRT4_01A_D.json',
    'ZRT4_01A_U.json',
    'ZRT4_01B.json',
    'ZRT4_01B_D.json',
    'ZRT4_01B_U.json',
    'ZRT4_01C.json',
    'ZRT4_01C_D.json',
    'ZRT4_01C_U.json',
    'ZRT4_Buids.json',
    'ZRT4_Stas.json',
    'ZRT7_01A.json',
    'ZRT7_01A_D.json',
    'ZRT7_01A_U.json',
    'ZRT7_01B.json',
    'ZRT7_01B_D.json',
    'ZRT7_01B_U.json',
    'ZRT7_01C.json',
    'ZRT7_01C_D.json',
    'ZRT7_01C_U.json',
    'ZRT7_Buids.json',
    'ZRT7_Stas.json',
    'ZRTL1_01A.json',
    'ZRTL1_01B.json'
    ],
  },

  /** 其他世界：先留空，避免误报 */
  eden: { baseUrl: '/data/Mapping/eden', files: [] },
  naraku: { baseUrl: '/data/Mapping/naraku', files: [] },
  houtu: { baseUrl: '/data/Mapping/houtu', files: [] },
};
