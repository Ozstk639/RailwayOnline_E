// 世界配置
export interface WorldConfig {
  id: string;
  name: string;
  title: string;
  center: Coordinate;
  worldHeight: number;
}

// 坐标类型
export interface Coordinate {
  x: number;
  y: number;
  z: number;
}

// Dynmap 地图配置
export interface DynmapMapConfig {
  name: string;
  prefix: string;
  scale: number;
  azimuth: number;
  inclination: number;
  mapzoomout: number;
  mapzoomin: number;
  worldtomap: number[];
  maptoworld: number[];
  imageFormat: string;
}

// 铁路线路信息
export interface LineInfo {
  bureau: string;  // 管理局: R/H/T/G
  line: string;    // 线路号
  stationCode: number;  // 站点编号
  coord: Coordinate;
  distance?: number;  // 距前站距离(米)，可选：-1 表示未开通，省略则自动计算曼哈顿距离
}

// 特殊情况
export interface SpecialCase {
  type: 'directionNotAvaliable' | 'lineNotAvaliable' | 'throughTrain' | 'lineOvertaking';
  target: {
    bureau?: string;
    line?: string;
    isTrainUp?: boolean;
    stationCode?: number;  // 用于 lineOvertaking：越行后下一站编号
    bureau1?: string;
    line1?: string;
    bureau2?: string;
    line2?: string;
  };
}

// 车站数据
export interface Station {
  stationName: string;
  lines: LineInfo[];
  specialCases?: SpecialCase[];
}

// 地标数据
export interface Landmark {
  id: number;
  name: string;
  grade: '白级' | '准级' | '标级' | '赤级' | '黑级' | 'Unknown';
  status: 'Normal' | 'Removed';
  coordinates: Coordinate | 'Unknown';
}

// 路径段类型
export type PathSegmentType = 'line' | 'quadratic';

// 路径段（用于弯道渲染）
export interface PathSegment {
  type: PathSegmentType;
  points: Coordinate[];  // line: [start, end], quadratic: [start, control, end]
}

// 边的路径数据
export interface EdgePath {
  segments: PathSegment[];
  length: number;  // 预计算的路径长度
}

// 解析后的线路数据（用于绘制）
export interface ParsedLine {
  bureau: string;
  line: string;
  lineId: string;  // bureau-line 组合
  stations: ParsedStation[];
  color: string;
  edgePaths?: EdgePath[];  // 站点之间的路径数据，长度为 stations.length - 1
}

// 解析后的站点数据
export interface ParsedStation {
  name: string;
  coord: Coordinate;
  stationCode: number;
  isTransfer: boolean;  // 是否换乘站
  lines: string[];  // 经过的线路 ID 列表
}

// 地图状态
export interface MapState {
  currentWorld: string;
  zoom: number;
  center: Coordinate;
  showRailway: boolean;
  showLandmarks: boolean;
}

// 铁路局信息
export interface BureauInfo {
  name: string;
}

// 铁路局配置（路局代码 -> 路局信息）
export type BureausConfig = Record<string, BureauInfo>;

// 在线玩家数据
export interface Player {
  name: string;
  account: string;
  x: number;
  y: number;
  z: number;
  health: number;
  armor: number;
  world: string;
}
