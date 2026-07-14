// 参数 schema —— 与 opendrt_v110.py 内核枚举严格一一对应。
// 阶段 3 框架:面板控件由此生成,参数对象驱动所有视图重绘。
//
// 忠实性:枚举名/取值直接来自内核,不重命名、不增删。
// 【全参数暴露】DrtParams 现覆盖 OpenDRT 官方全部可调项,按官方分组组织。
//   默认值 = drt.ts STANDARD 常量原值(即官方 Standard look),故不动滑块 = 与旧行为逐像素一致。
//   tooltip 为官方 OpenDRT.nk 说明的中文翻译(保留原义)。

export const LOOKS = [
  "Standard", "Arriba", "Sylvan", "Colorful",
  "Aery", "Dystopic", "Umbra", "Base",
] as const;

export const DISPLAYS = [
  "rec1886", "srgb", "displayp3", "p3d60", "p3dci",
  "xyz", "rec2100pq", "rec2100hlg", "dolbypq",
] as const;

export const IN_GAMUTS = [
  "xyz", "ap0", "ap1", "p3d65", "rec2020", "rec709",
  "awg3", "awg4", "rwg", "sgamut3", "sgamut3cine",
  "vgamut", "egamut", "egamut2", "davinciwg",
] as const;

export const IN_OETFS = [
  "linear", "davinci_intermediate", "filmlight_tlog", "acescct",
  "arri_logc3", "arri_logc4", "redlog3g10", "panasonic_vlog",
  "sony_slog3", "fuji_flog2",
] as const;
// 注:IN_OETFS 顺序必须与内核 linearizeScalar 的 tf 索引严格一致(index 4=arri_logc3, 5=arri_logc4)。

// DISPLAY_ENCODING_PRESETS: name -> [tn_su, display_gamut, eotf]
export const DISPLAY_ENCODING: Record<string, [number, number, number]> = {
  rec1886: [1, 0, 2],
  srgb: [2, 0, 1],
  displayp3: [2, 1, 1],
  p3d60: [0, 3, 3],
  p3dci: [0, 4, 3],
  xyz: [0, 5, 3],
  rec2100pq: [0, 2, 4],
  rec2100hlg: [0, 2, 5],
  dolbypq: [0, 1, 4],
};

// 创意白点枚举(cwp 索引): 0=D93 1=D75 2=D65 3=D60 4=D55 5=D50
export const CWP_OPTIONS = ["D93", "D75", "D65", "D60", "D55", "D50"] as const;
// Surround(tn_su)在 display 预设里已隐含,但官方也允许单独覆盖: 0=dark 1=dim 2=bright

// 色域代号 -> 友好显示标签(仅影响下拉文本,不改变枚举值/矩阵)。
export const IN_GAMUT_LABELS: Record<string, string> = {
  xyz: "CIE XYZ",
  ap0: "ap0 (ACES2065-1 / AP0)",
  ap1: "ap1 (ACEScg / AP1)",
  p3d65: "P3-D65",
  rec2020: "Rec.2020",
  rec709: "Rec.709 / sRGB",
  awg3: "ARRI Wide Gamut 3",
  awg4: "ARRI Wide Gamut 4",
  rwg: "REDWideGamutRGB",
  sgamut3: "Sony S-Gamut3",
  sgamut3cine: "Sony S-Gamut3.Cine",
  vgamut: "Panasonic V-Gamut",
  egamut: "FilmLight E-Gamut",
  egamut2: "FilmLight E-Gamut2",
  davinciwg: "DaVinci Wide Gamut",
};

export type LookName = (typeof LOOKS)[number];
export type DisplayName = (typeof DISPLAYS)[number];
export type InGamutName = (typeof IN_GAMUTS)[number];
export type InOetfName = (typeof IN_OETFS)[number];

// 全部可调参数。字段名对应 drt.ts ResolvedConfig / STANDARD。
export interface DrtParams {
  look: LookName;
  display: DisplayName;
  inGamut: InGamutName;
  inOetf: InOetfName;

  // Tonescale preset(下拉,None=不覆盖,其余覆盖 11 个 tn_ 参数)
  tonescalePreset: TonescalePresetName;

  // ---- Tonescale(色调映射)----
  tnLp: number;    // 峰值亮度 nits
  tnLg: number;    // 中灰目标 nits
  tnCon: number;   // 对比度
  tnSh: number;    // 肩部 shoulder clip
  tnToe: number;   // 趾部 toe(暗部压缩)
  tnOff: number;   // 预色调偏移 offset
  tnGb: number;    // HDR 中灰提升 grey boost
  ptHdr: number;   // HDR 纯度
  // Contrast High(高光对比,开关)
  tnHconEnable: number; tnHcon: number; tnHconPv: number; tnHconSt: number;
  // Contrast Low(中低调对比,开关)
  tnLconEnable: number; tnLcon: number; tnLconW: number;

  // ---- Creative White(创意白点)----
  cwp: number;     // 0..5 见 CWP_OPTIONS
  cwpLm: number;   // 创意白点限制范围

  // ---- Render Space(渲染空间去饱和)----
  rsSa: number;    // 色彩对比/去饱和量
  rsRw: number;    // 红权重
  rsBw: number;    // 蓝权重

  // ---- Purity Limit(纯度上限)----
  ptLml: number; ptLmlR: number; ptLmlG: number; ptLmlB: number;
  ptLmh: number; ptLmhR: number; ptLmhB: number;
  // Purity Softclip(纯度软限,开关)
  ptlEnable: number; ptlC: number; ptlM: number; ptlY: number;
  // Mid Purity(中调纯度,开关)
  ptmEnable: number;
  ptmLow: number; ptmLowRng: number; ptmLowSt: number;
  ptmHigh: number; ptmHighRng: number; ptmHighSt: number;

  // ---- Brilliance(亮丽度,开关)----
  brlEnable: number; brl: number; brlR: number; brlG: number; brlB: number; brlRng: number; brlSt: number;
  // Brilliance Post(后期亮丽度,开关)
  brlpEnable: number; brlp: number; brlpR: number; brlpG: number; brlpB: number;

  // ---- Hue Contrast R(红色相对比,开关)----
  hcEnable: number; hcR: number; hcRRng: number;

  // ---- Hue Shift RGB(RGB 色相偏移,开关)----
  hsRgbEnable: number;
  hsR: number; hsRRng: number; hsG: number; hsGRng: number; hsB: number; hsBRng: number;
  // ---- Hue Shift CMY(CMY 色相偏移,开关)----
  hsCmyEnable: number;
  hsC: number; hsCRng: number; hsM: number; hsMRng: number; hsY: number; hsYRng: number;
}

// 默认值严格等于 drt.ts STANDARD(官方 Standard look)+ 全局默认。
// 不动任何滑块 → resolveConfig 收到的值与旧版硬编码完全相同 → 逐像素一致。
export const DEFAULT_PARAMS: DrtParams = {
  look: "Standard",
  display: "rec1886",
  inGamut: "egamut2",
  inOetf: "linear",
  tonescalePreset: "None",

  tnLp: 100.0, tnLg: 10.0, tnCon: 1.66, tnSh: 0.5,
  tnToe: 0.003, tnOff: 0.005, tnGb: 0.13, ptHdr: 0.5,
  tnHconEnable: 0, tnHcon: 0.0, tnHconPv: 1.0, tnHconSt: 4.0,
  tnLconEnable: 0, tnLcon: 0.0, tnLconW: 0.5,

  cwp: 2, cwpLm: 0.25,

  rsSa: 0.35, rsRw: 0.25, rsBw: 0.55,

  ptLml: 0.25, ptLmlR: 0.5, ptLmlG: 0.0, ptLmlB: 0.1,
  ptLmh: 0.25, ptLmhR: 0.5, ptLmhB: 0.0,
  ptlEnable: 1, ptlC: 0.06, ptlM: 0.08, ptlY: 0.06,
  ptmEnable: 1,
  ptmLow: 0.4, ptmLowRng: 0.25, ptmLowSt: 0.5,
  ptmHigh: -0.8, ptmHighRng: 0.35, ptmHighSt: 0.4,

  brlEnable: 1, brl: 0.0, brlR: -2.5, brlG: -1.5, brlB: -1.5, brlRng: 0.5, brlSt: 0.35,
  brlpEnable: 1, brlp: -0.5, brlpR: -1.25, brlpG: -1.25, brlpB: -0.25,

  hcEnable: 1, hcR: 1.0, hcRRng: 0.3,

  hsRgbEnable: 1,
  hsR: 0.6, hsRRng: 0.6, hsG: 0.35, hsGRng: 1.0, hsB: 0.66, hsBRng: 1.0,
  hsCmyEnable: 1,
  hsC: 0.25, hsCRng: 1.0, hsM: 0.0, hsMRng: 1.0, hsY: 0.0, hsYRng: 1.0,
};

// ============================================================
// LOOK / TONESCALE PRESETS —— 逐字来自权威源 OpenDRT_v110.dctl(758-825 行)。
//   选 look 时前端把这些值填入 params(自动更改滑块);Standard 与 DEFAULT_PARAMS 逐字段一致。
//   tonescale preset(None=不覆盖)覆盖 11 个 tn_ 参数。忠实照抄,禁改数值。
// ============================================================
export const LOOK_PRESETS: Record<LookName, Partial<DrtParams>> = {
  'Standard': { tnCon: 1.66, tnSh: 0.5, tnToe: 0.003, tnOff: 0.005, tnHconEnable: 0, tnHcon: 0.0, tnHconPv: 1.0, tnHconSt: 4.0, tnLconEnable: 0, tnLcon: 0.0, tnLconW: 0.5, cwp: 2, cwpLm: 0.25, rsSa: 0.35, rsRw: 0.25, rsBw: 0.55, ptLml: 0.25, ptLmlR: 0.5, ptLmlG: 0.0, ptLmlB: 0.1, ptLmh: 0.25, ptLmhR: 0.5, ptLmhB: 0.0, ptlEnable: 1, ptlC: 0.06, ptlM: 0.08, ptlY: 0.06, ptmEnable: 1, ptmLow: 0.4, ptmLowRng: 0.25, ptmLowSt: 0.5, ptmHigh: -0.8, ptmHighRng: 0.35, ptmHighSt: 0.4, brlEnable: 1, brl: 0.0, brlR: -2.5, brlG: -1.5, brlB: -1.5, brlRng: 0.5, brlSt: 0.35, brlpEnable: 1, brlp: -0.5, brlpR: -1.25, brlpG: -1.25, brlpB: -0.25, hcEnable: 1, hcR: 1.0, hcRRng: 0.3, hsRgbEnable: 1, hsR: 0.6, hsRRng: 0.6, hsG: 0.35, hsGRng: 1.0, hsB: 0.66, hsBRng: 1.0, hsCmyEnable: 1, hsC: 0.25, hsCRng: 1.0, hsM: 0.0, hsMRng: 1.0, hsY: 0.0, hsYRng: 1.0 },
  'Arriba': { tnCon: 1.05, tnSh: 0.5, tnToe: 0.1, tnOff: 0.01, tnHconEnable: 0, tnHcon: 0.0, tnHconPv: 1.0, tnHconSt: 4.0, tnLconEnable: 1, tnLcon: 1.5, tnLconW: 0.2, cwp: 2, cwpLm: 0.25, rsSa: 0.35, rsRw: 0.25, rsBw: 0.55, ptLml: 0.25, ptLmlR: 0.45, ptLmlG: 0.0, ptLmlB: 0.1, ptLmh: 0.25, ptLmhR: 0.25, ptLmhB: 0.0, ptlEnable: 1, ptlC: 0.06, ptlM: 0.08, ptlY: 0.06, ptmEnable: 1, ptmLow: 1.0, ptmLowRng: 0.4, ptmLowSt: 0.5, ptmHigh: -0.8, ptmHighRng: 0.66, ptmHighSt: 0.6, brlEnable: 1, brl: 0.0, brlR: -2.5, brlG: -1.5, brlB: -1.5, brlRng: 0.5, brlSt: 0.35, brlpEnable: 1, brlp: 0.0, brlpR: -1.7, brlpG: -2.0, brlpB: -0.5, hcEnable: 1, hcR: 1.0, hcRRng: 0.3, hsRgbEnable: 1, hsR: 0.6, hsRRng: 0.8, hsG: 0.35, hsGRng: 1.0, hsB: 0.66, hsBRng: 1.0, hsCmyEnable: 1, hsC: 0.15, hsCRng: 1.0, hsM: 0.0, hsMRng: 1.0, hsY: 0.0, hsYRng: 1.0 },
  'Sylvan': { tnCon: 1.6, tnSh: 0.5, tnToe: 0.01, tnOff: 0.01, tnHconEnable: 0, tnHcon: 0.0, tnHconPv: 1.0, tnHconSt: 4.0, tnLconEnable: 1, tnLcon: 0.25, tnLconW: 0.75, cwp: 2, cwpLm: 0.25, rsSa: 0.25, rsRw: 0.25, rsBw: 0.55, ptLml: 0.15, ptLmlR: 0.5, ptLmlG: 0.15, ptLmlB: 0.1, ptLmh: 0.25, ptLmhR: 0.15, ptLmhB: 0.15, ptlEnable: 1, ptlC: 0.05, ptlM: 0.08, ptlY: 0.05, ptmEnable: 1, ptmLow: 0.5, ptmLowRng: 0.5, ptmLowSt: 0.5, ptmHigh: -0.8, ptmHighRng: 0.5, ptmHighSt: 0.5, brlEnable: 1, brl: -1.0, brlR: -2.0, brlG: -2.0, brlB: 0.0, brlRng: 0.25, brlSt: 0.25, brlpEnable: 1, brlp: -1.0, brlpR: -0.5, brlpG: -0.25, brlpB: -0.25, hcEnable: 1, hcR: 1.0, hcRRng: 0.4, hsRgbEnable: 1, hsR: 0.6, hsRRng: 1.15, hsG: 0.8, hsGRng: 1.25, hsB: 0.6, hsBRng: 1.0, hsCmyEnable: 1, hsC: 0.25, hsCRng: 0.25, hsM: 0.25, hsMRng: 0.5, hsY: 0.35, hsYRng: 0.5 },
  'Colorful': { tnCon: 1.5, tnSh: 0.5, tnToe: 0.003, tnOff: 0.003, tnHconEnable: 0, tnHcon: 0.0, tnHconPv: 1.0, tnHconSt: 4.0, tnLconEnable: 1, tnLcon: 0.4, tnLconW: 0.5, cwp: 2, cwpLm: 0.25, rsSa: 0.35, rsRw: 0.25, rsBw: 0.55, ptLml: 0.5, ptLmlR: 1.0, ptLmlG: 0.0, ptLmlB: 0.5, ptLmh: 0.15, ptLmhR: 0.15, ptLmhB: 0.15, ptlEnable: 1, ptlC: 0.05, ptlM: 0.06, ptlY: 0.05, ptmEnable: 1, ptmLow: 0.8, ptmLowRng: 0.5, ptmLowSt: 0.4, ptmHigh: -0.8, ptmHighRng: 0.4, ptmHighSt: 0.4, brlEnable: 1, brl: 0.0, brlR: -1.25, brlG: -1.25, brlB: -0.25, brlRng: 0.3, brlSt: 0.5, brlpEnable: 1, brlp: -0.5, brlpR: -1.25, brlpG: -1.25, brlpB: -0.5, hcEnable: 1, hcR: 1.0, hcRRng: 0.4, hsRgbEnable: 1, hsR: 0.5, hsRRng: 0.8, hsG: 0.35, hsGRng: 1.0, hsB: 0.5, hsBRng: 1.0, hsCmyEnable: 1, hsC: 0.25, hsCRng: 1.0, hsM: 0.0, hsMRng: 1.0, hsY: 0.25, hsYRng: 1.0 },
  'Aery': { tnCon: 1.15, tnSh: 0.5, tnToe: 0.04, tnOff: 0.006, tnHconEnable: 0, tnHcon: 0.0, tnHconPv: 0.0, tnHconSt: 0.5, tnLconEnable: 1, tnLcon: 0.5, tnLconW: 2.0, cwp: 1, cwpLm: 0.25, rsSa: 0.25, rsRw: 0.2, rsBw: 0.5, ptLml: 0.0, ptLmlR: 0.5, ptLmlG: 0.15, ptLmlB: 0.1, ptLmh: 0.0, ptLmhR: 0.1, ptLmhB: 0.0, ptlEnable: 1, ptlC: 0.05, ptlM: 0.08, ptlY: 0.05, ptmEnable: 1, ptmLow: 0.8, ptmLowRng: 0.35, ptmLowSt: 0.5, ptmHigh: -0.9, ptmHighRng: 0.5, ptmHighSt: 0.3, brlEnable: 1, brl: -3.0, brlR: 0.0, brlG: 0.0, brlB: 1.0, brlRng: 0.8, brlSt: 0.15, brlpEnable: 1, brlp: -1.0, brlpR: -1.0, brlpG: -1.0, brlpB: 0.0, hcEnable: 1, hcR: 0.5, hcRRng: 0.25, hsRgbEnable: 1, hsR: 0.6, hsRRng: 1.0, hsG: 0.35, hsGRng: 2.0, hsB: 0.5, hsBRng: 1.5, hsCmyEnable: 1, hsC: 0.35, hsCRng: 1.0, hsM: 0.25, hsMRng: 1.0, hsY: 0.35, hsYRng: 0.5 },
  'Dystopic': { tnCon: 1.6, tnSh: 0.5, tnToe: 0.01, tnOff: 0.008, tnHconEnable: 1, tnHcon: 0.25, tnHconPv: 0.0, tnHconSt: 1.0, tnLconEnable: 1, tnLcon: 1.0, tnLconW: 0.75, cwp: 3, cwpLm: 0.25, rsSa: 0.2, rsRw: 0.25, rsBw: 0.55, ptLml: 0.15, ptLmlR: 0.0, ptLmlG: 0.0, ptLmlB: 0.0, ptLmh: 0.0, ptLmhR: 0.0, ptLmhB: 0.0, ptlEnable: 1, ptlC: 0.05, ptlM: 0.08, ptlY: 0.05, ptmEnable: 1, ptmLow: 0.25, ptmLowRng: 0.25, ptmLowSt: 0.8, ptmHigh: -0.8, ptmHighRng: 0.6, ptmHighSt: 0.25, brlEnable: 1, brl: -2.0, brlR: -2.0, brlG: -2.0, brlB: 0.0, brlRng: 0.35, brlSt: 0.35, brlpEnable: 1, brlp: 0.0, brlpR: -1.0, brlpG: -1.0, brlpB: -1.0, hcEnable: 1, hcR: 1.0, hcRRng: 0.25, hsRgbEnable: 1, hsR: 0.7, hsRRng: 1.33, hsG: 1.0, hsGRng: 2.0, hsB: 0.75, hsBRng: 2.0, hsCmyEnable: 1, hsC: 1.0, hsCRng: 0.5, hsM: 1.0, hsMRng: 1.0, hsY: 1.0, hsYRng: 0.765 },
  'Umbra': { tnCon: 1.8, tnSh: 0.5, tnToe: 0.001, tnOff: 0.015, tnHconEnable: 0, tnHcon: 0.0, tnHconPv: 1.0, tnHconSt: 4.0, tnLconEnable: 1, tnLcon: 1.0, tnLconW: 1.0, cwp: 5, cwpLm: 0.25, rsSa: 0.35, rsRw: 0.25, rsBw: 0.55, ptLml: 0.0, ptLmlR: 0.5, ptLmlG: 0.0, ptLmlB: 0.15, ptLmh: 0.25, ptLmhR: 0.25, ptLmhB: 0.0, ptlEnable: 1, ptlC: 0.05, ptlM: 0.06, ptlY: 0.05, ptmEnable: 1, ptmLow: 0.4, ptmLowRng: 0.35, ptmLowSt: 0.66, ptmHigh: -0.6, ptmHighRng: 0.45, ptmHighSt: 0.45, brlEnable: 1, brl: -2.0, brlR: -4.5, brlG: -3.0, brlB: -4.0, brlRng: 0.35, brlSt: 0.3, brlpEnable: 1, brlp: 0.0, brlpR: -2.0, brlpG: -1.0, brlpB: -0.5, hcEnable: 1, hcR: 1.0, hcRRng: 0.35, hsRgbEnable: 1, hsR: 0.66, hsRRng: 1.0, hsG: 0.5, hsGRng: 2.0, hsB: 0.85, hsBRng: 2.0, hsCmyEnable: 1, hsC: 0.0, hsCRng: 1.0, hsM: 0.25, hsMRng: 1.0, hsY: 0.66, hsYRng: 0.66 },
  'Base': { tnCon: 1.66, tnSh: 0.5, tnToe: 0.003, tnOff: 0.005, tnHconEnable: 0, tnHcon: 0.0, tnHconPv: 1.0, tnHconSt: 4.0, tnLconEnable: 0, tnLcon: 0.0, tnLconW: 0.5, cwp: 2, cwpLm: 0.25, rsSa: 0.35, rsRw: 0.25, rsBw: 0.55, ptLml: 0.5, ptLmlR: 0.5, ptLmlG: 0.15, ptLmlB: 0.15, ptLmh: 0.8, ptLmhR: 0.5, ptLmhB: 0.0, ptlEnable: 1, ptlC: 0.05, ptlM: 0.06, ptlY: 0.05, ptmEnable: 0, ptmLow: 0.0, ptmLowRng: 0.5, ptmLowSt: 0.5, ptmHigh: 0.0, ptmHighRng: 0.5, ptmHighSt: 0.5, brlEnable: 0, brl: 0.0, brlR: 0.0, brlG: 0.0, brlB: 0.0, brlRng: 0.5, brlSt: 0.35, brlpEnable: 1, brlp: -0.5, brlpR: -1.6, brlpG: -1.6, brlpB: -0.8, hcEnable: 0, hcR: 0.0, hcRRng: 0.25, hsRgbEnable: 0, hsR: 0.0, hsRRng: 1.0, hsG: 0.0, hsGRng: 1.0, hsB: 0.0, hsBRng: 1.0, hsCmyEnable: 0, hsC: 0.0, hsCRng: 1.0, hsM: 0.0, hsMRng: 1.0, hsY: 0.0, hsYRng: 1.0 },
};

export const TONESCALE_PRESETS = ["None", 'Low Contrast', 'Medium Contrast', 'High Contrast', 'Arriba Tonescale', 'Sylvan Tonescale', 'Colorful Tonescale', 'Aery Tonescale', 'Dystopic Tonescale', 'Umbra Tonescale', 'ACES-1.x', 'ACES-2.0', 'Marvelous Tonescape', 'DaGrinchi ToneGroan'] as const;
export type TonescalePresetName = (typeof TONESCALE_PRESETS)[number];

// None=0 不覆盖;其余覆盖 11 个 tn_ 参数(DCTL tonescale_preset 1..13)。
export const TONESCALE_PRESET_VALUES: Record<string, Partial<DrtParams>> = {
  'Low Contrast': { tnCon: 1.4, tnSh: 0.5, tnToe: 0.003, tnOff: 0.005, tnHconEnable: 0, tnHcon: 0.0, tnHconPv: 1.0, tnHconSt: 4.0, tnLconEnable: 0, tnLcon: 0.0, tnLconW: 0.5 },
  'Medium Contrast': { tnCon: 1.66, tnSh: 0.5, tnToe: 0.003, tnOff: 0.005, tnHconEnable: 0, tnHcon: 0.0, tnHconPv: 1.0, tnHconSt: 4.0, tnLconEnable: 0, tnLcon: 0.0, tnLconW: 0.5 },
  'High Contrast': { tnCon: 1.4, tnSh: 0.5, tnToe: 0.003, tnOff: 0.005, tnHconEnable: 0, tnHcon: 0.0, tnHconPv: 1.0, tnHconSt: 4.0, tnLconEnable: 1, tnLcon: 1.0, tnLconW: 0.5 },
  'Arriba Tonescale': { tnCon: 1.05, tnSh: 0.5, tnToe: 0.1, tnOff: 0.01, tnHconEnable: 0, tnHcon: 0.0, tnHconPv: 1.0, tnHconSt: 4.0, tnLconEnable: 1, tnLcon: 1.5, tnLconW: 0.2 },
  'Sylvan Tonescale': { tnCon: 1.6, tnSh: 0.5, tnToe: 0.01, tnOff: 0.01, tnHconEnable: 0, tnHcon: 0.0, tnHconPv: 1.0, tnHconSt: 4.0, tnLconEnable: 1, tnLcon: 0.25, tnLconW: 0.75 },
  'Colorful Tonescale': { tnCon: 1.5, tnSh: 0.5, tnToe: 0.003, tnOff: 0.003, tnHconEnable: 0, tnHcon: 0.0, tnHconPv: 1.0, tnHconSt: 4.0, tnLconEnable: 1, tnLcon: 0.4, tnLconW: 0.5 },
  'Aery Tonescale': { tnCon: 1.15, tnSh: 0.5, tnToe: 0.04, tnOff: 0.006, tnHconEnable: 0, tnHcon: 0.0, tnHconPv: 0.0, tnHconSt: 0.5, tnLconEnable: 1, tnLcon: 0.5, tnLconW: 2.0 },
  'Dystopic Tonescale': { tnCon: 1.6, tnSh: 0.5, tnToe: 0.01, tnOff: 0.008, tnHconEnable: 1, tnHcon: 0.25, tnHconPv: 0.0, tnHconSt: 1.0, tnLconEnable: 1, tnLcon: 1.0, tnLconW: 0.75 },
  'Umbra Tonescale': { tnCon: 1.8, tnSh: 0.5, tnToe: 0.001, tnOff: 0.015, tnHconEnable: 0, tnHcon: 0.0, tnHconPv: 1.0, tnHconSt: 4.0, tnLconEnable: 1, tnLcon: 1.0, tnLconW: 1.0 },
  'ACES-1.x': { tnCon: 1.0, tnSh: 0.35, tnToe: 0.02, tnOff: 0.0, tnHconEnable: 1, tnHcon: 0.55, tnHconPv: 0.0, tnHconSt: 2.0, tnLconEnable: 1, tnLcon: 1.13, tnLconW: 1.0 },
  'ACES-2.0': { tnCon: 1.15, tnSh: 0.5, tnToe: 0.04, tnOff: 0.0, tnHconEnable: 0, tnHcon: 1.0, tnHconPv: 1.0, tnHconSt: 1.0, tnLconEnable: 0, tnLcon: 1.0, tnLconW: 0.6 },
  'Marvelous Tonescape': { tnCon: 1.5, tnSh: 0.5, tnToe: 0.003, tnOff: 0.01, tnHconEnable: 1, tnHcon: 0.25, tnHconPv: 0.0, tnHconSt: 4.0, tnLconEnable: 1, tnLcon: 1.0, tnLconW: 1.0 },
  'DaGrinchi ToneGroan': { tnCon: 1.2, tnSh: 0.5, tnToe: 0.02, tnOff: 0.0, tnHconEnable: 0, tnHcon: 0.0, tnHconPv: 1.0, tnHconSt: 1.0, tnLconEnable: 0, tnLcon: 0.0, tnLconW: 0.6 },
};

// ---- 分组控件定义 ----
// 滑块: [key, 中文标签, min, max, step, 官方tooltip中文]
export type SliderDef = [keyof DrtParams, string, number, number, number, string];
// 开关: [key, 中文标签, 官方tooltip中文]
export type ToggleDef = [keyof DrtParams, string, string];

export interface ParamGroup {
  id: string;
  title: string;         // 组标题(中文 + 英文原名)
  desc: string;          // 组作用一句话
  enableKey?: keyof DrtParams; // 若整组有 enable 开关
  toggles?: ToggleDef[]; // 组内独立开关(每个可带子滑块)
  sliders: SliderDef[];
  defaultCollapsed?: boolean;
}

// 兼容旧引用:核心 4 滑块(main.ts 若仍引用 SLIDERS 不至于崩)。
export const SLIDERS: Array<[keyof DrtParams, string, number, number, number]> = [
  ["tnLp", "峰值亮度 Lp (nits)", 48, 4000, 1],
  ["tnLg", "中灰目标 Lg", 3, 30, 0.1],
  ["tnCon", "对比度 tn_con", 1.0, 2.0, 0.01],
  ["tnSh", "shoulder tn_sh", 0.2, 0.8, 0.01],
];

export const PARAM_GROUPS: ParamGroup[] = [
  {
    id: "tonescale",
    title: "Tonescale 色调映射",
    desc: "把场景线性光映射为显示亮度:峰值/中灰/对比度/曲线形状。",
    sliders: [
      ["tnLp", "峰值亮度 Lp (nits)", 48, 4000, 1, "显示器峰值亮度(nits)。SDR 下最大值钉在 1.0;HDR 下调整最大值以匹配 HDR 容器峰值。"],
      ["tnLg", "中灰目标 Lg (nits)", 3, 30, 0.1, "中灰(0.18)在显示上的亮度(nits)。在显示器可用亮度范围内设定中灰的目标落点。"],
      ["tnCon", "对比度 Contrast", 1.0, 2.0, 0.01, "调整对比度/斜率。在 display-linear 域施加一个受约束的幂函数。"],
      ["tnSh", "肩部 Shoulder Clip", 0.2, 0.8, 0.01, "无量纲控制:scene-linear 到多大值时 tonescale 越过显示峰值(1.0)而 clip。sh=0 约对应 16,sh=1 约对应 1024。决定高光能容纳多少动态范围。"],
      ["tnToe", "趾部 Toe", 0.0, 0.1, 0.001, "二次趾部压缩。强烈压缩深暗部,有助于平滑过渡到显示最小值。与常见相机 DRT 的暗部策略类似。"],
      ["tnOff", "偏移 Offset", 0.0, 0.02, 0.001, "预色调 scene-linear 偏移。0.0 时 scene-linear 0.0 映射到 display-linear 0.0。正偏移可增加暗部细节。不应为负数。"],
      ["tnGb", "HDR 中灰提升 Grey Boost", 0.0, 0.5, 0.01, "峰值亮度每提升一档,中灰亮度提升的档数。例如 0.1 时,峰值每 +1 档中灰 +0.1 档。"],
      ["ptHdr", "HDR 纯度 Purity", 0.0, 1.0, 0.01, "峰值亮度增大时对纯度压缩与色相偏移的影响程度。0.0=SDR/HDR 行为一致;1.0=峰值增大时保留更多纯度并减少高光色相偏移。"],
    ],
    toggles: [
      ["tnHconEnable", "启用高光对比 Contrast High", "控制 tonescale 上段(高光)。默认关。想要更强高光对比或更柔和高光滚降时有用。"],
      ["tnLconEnable", "启用低调对比 Contrast Low", "为中间调与暗部增加对比。中灰(0.18)在调整中保持不变。默认关。"],
    ],
  },
  {
    id: "tonescale_hcon",
    title: "· 高光对比 Contrast High(需先开启)",
    desc: "微调高光段对比/滚降。",
    sliders: [
      ["tnHcon", "高光对比量 Contrast High", -1.0, 1.0, 0.01, "调整高光的量。正值增加高光曝光,负值减少,0 无效果。"],
      ["tnHconPv", "枢轴 Pivot", 0.0, 4.0, 0.1, "从中灰(0.18)之上多少档开始调整。"],
      ["tnHconSt", "强度 Strength", 0.0, 8.0, 0.1, "越过枢轴后效果起始的快慢。"],
    ],
    defaultCollapsed: true,
  },
  {
    id: "tonescale_lcon",
    title: "· 低调对比 Contrast Low(需先开启)",
    desc: "为中间调/暗部加对比,中灰不变。",
    sliders: [
      ["tnLcon", "低调对比量 Contrast Low", 0.0, 3.0, 0.01, "增加的对比量。0.0 无效;1.0 在原点(0,0)处向下曝光 1 档。"],
      ["tnLconW", "宽度 Width", 0.0, 2.0, 0.01, "调整宽度。<0.5 主要影响 0~中灰之间;>0.5 会越来越多地增加高光对比。"],
    ],
    defaultCollapsed: true,
  },
  {
    id: "creativewhite",
    title: "Creative White 创意白点",
    desc: "后色调阶段偏移显示峰值的白点(暖/冷)。",
    sliders: [
      ["cwpLm", "白点限制 Limit", 0.0, 1.0, 0.01, "限制受创意白点影响的强度范围。0.0=整个范围受影响;越小,中间调与暗部越保持中性(如仅把高光调暖)。"],
    ],
    defaultCollapsed: true,
  },
  {
    id: "renderspace",
    title: "Render Space 渲染空间去饱和",
    desc: "进入压缩前的整体色彩对比/去饱和加权。",
    sliders: [
      ["rsSa", "色彩对比 rs_sa", 0.0, 0.6, 0.01, "渲染空间去饱和(色彩对比)量。"],
      ["rsRw", "红权重 rs_rw", 0.0, 0.8, 0.01, "红通道在渲染去饱和中的权重。"],
      ["rsBw", "蓝权重 rs_bw", 0.0, 0.8, 0.01, "蓝通道在渲染去饱和中的权重。"],
    ],
    defaultCollapsed: true,
  },
  {
    id: "puritylimit",
    title: "Purity Limit 纯度上限",
    desc: "限制高强度处的色彩纯度(高光去饱和到白)。",
    sliders: [
      ["ptLml", "低光纯度限 pt_lml", 0.0, 1.0, 0.01, "低强度纯度上限总量。"],
      ["ptLmlR", "低光 R", 0.0, 1.0, 0.01, "低光纯度上限红分量。"],
      ["ptLmlG", "低光 G", 0.0, 1.0, 0.01, "低光纯度上限绿分量。"],
      ["ptLmlB", "低光 B", 0.0, 1.0, 0.01, "低光纯度上限蓝分量。"],
      ["ptLmh", "高光纯度限 pt_lmh", 0.0, 1.0, 0.01, "高强度纯度上限总量。"],
      ["ptLmhR", "高光 R", 0.0, 1.0, 0.01, "高光纯度上限红分量。"],
      ["ptLmhB", "高光 B", 0.0, 1.0, 0.01, "高光纯度上限蓝分量。"],
    ],
    toggles: [
      ["ptlEnable", "启用纯度软限 Purity Softclip", "对青/品红/黄方向的纯度做软限,防止过纯溢出。"],
      ["ptmEnable", "启用中调纯度 Mid Purity", "对中间调纯度做低/高两段的加/减,细调中间调饱和。"],
    ],
    defaultCollapsed: true,
  },
  {
    id: "purity_softclip",
    title: "· 纯度软限 Softclip(需先开启)",
    desc: "CMY 三方向纯度软限量。",
    sliders: [
      ["ptlC", "青 C", 0.0, 0.25, 0.005, "青方向纯度软限量。"],
      ["ptlM", "品红 M", 0.0, 0.25, 0.005, "品红方向纯度软限量。"],
      ["ptlY", "黄 Y", 0.0, 0.25, 0.005, "黄方向纯度软限量。"],
    ],
    defaultCollapsed: true,
  },
  {
    id: "purity_mid",
    title: "· 中调纯度 Mid Purity(需先开启)",
    desc: "中间调纯度低/高两段调整。",
    sliders: [
      ["ptmLow", "低段量 low", 0.0, 2.0, 0.01, "中调纯度低段调整量。"],
      ["ptmLowRng", "低段范围 rng", 0.1, 1.0, 0.01, "低段作用范围。"],
      ["ptmLowSt", "低段强度 st", 0.0, 1.0, 0.01, "低段过渡强度。"],
      ["ptmHigh", "高段量 high", -0.9, 0.0, 0.01, "中调纯度高段调整量(通常为负=去纯)。"],
      ["ptmHighRng", "高段范围 rng", 0.1, 1.0, 0.01, "高段作用范围。"],
      ["ptmHighSt", "高段强度 st", 0.0, 1.0, 0.01, "高段过渡强度。"],
    ],
    defaultCollapsed: true,
  },
  {
    id: "brilliance",
    title: "Brilliance 亮丽度",
    desc: "按通道微调亮度感,在不改色相下提亮/压暗。",
    toggles: [
      ["brlEnable", "启用亮丽度 Brilliance", "分通道亮度微调(压缩阶段前)。"],
      ["brlpEnable", "启用后期亮丽度 Brilliance Post", "压缩阶段后的分通道亮度微调。"],
    ],
    sliders: [],
    defaultCollapsed: true,
  },
  {
    id: "brilliance_main",
    title: "· 亮丽度 Brilliance(需先开启)",
    desc: "",
    sliders: [
      ["brl", "总量 brl", -3.0, 0.0, 0.01, "亮丽度总量。"],
      ["brlR", "红 R", -3.0, 0.0, 0.01, "红通道亮丽度。"],
      ["brlG", "绿 G", -3.0, 0.0, 0.01, "绿通道亮丽度。"],
      ["brlB", "蓝 B", -3.0, 0.0, 0.01, "蓝通道亮丽度。"],
      ["brlRng", "范围 rng", 0.0, 1.0, 0.01, "亮丽度作用范围。"],
      ["brlSt", "强度 st", 0.0, 1.0, 0.01, "亮丽度过渡强度。"],
    ],
    defaultCollapsed: true,
  },
  {
    id: "brilliance_post",
    title: "· 后期亮丽度 Post(需先开启)",
    desc: "",
    sliders: [
      ["brlp", "总量 brlp", -3.0, 0.0, 0.01, "后期亮丽度总量。"],
      ["brlpR", "红 R", -3.0, 0.0, 0.01, "后期红通道亮丽度。"],
      ["brlpG", "绿 G", -3.0, 0.0, 0.01, "后期绿通道亮丽度。"],
      ["brlpB", "蓝 B", -3.0, 0.0, 0.01, "后期蓝通道亮丽度。"],
    ],
    defaultCollapsed: true,
  },
  {
    id: "huecontrast",
    title: "Hue Contrast 色相对比(红)",
    desc: "对红色相区的对比微调。",
    toggles: [
      ["hcEnable", "启用红色相对比 Hue Contrast R", "对红色相区施加对比调整。"],
    ],
    sliders: [
      ["hcR", "红对比量 hc_r", 0.0, 2.0, 0.01, "红色相对比量。"],
      ["hcRRng", "范围 rng", 0.0, 2.0, 0.01, "红色相对比作用范围。"],
    ],
    defaultCollapsed: true,
  },
  {
    id: "hueshift_rgb",
    title: "Hue Shift RGB 色相偏移",
    desc: "红/绿/蓝随亮度的色相偏移量与范围。",
    toggles: [
      ["hsRgbEnable", "启用 RGB 色相偏移", "对 R/G/B 三方向施加随亮度的色相偏移。"],
    ],
    sliders: [
      ["hsR", "红偏移 hs_r", 0.0, 1.0, 0.01, "红方向色相偏移量。"],
      ["hsRRng", "红范围 rng", 0.0, 2.0, 0.01, "红方向作用范围。"],
      ["hsG", "绿偏移 hs_g", 0.0, 1.0, 0.01, "绿方向色相偏移量。"],
      ["hsGRng", "绿范围 rng", 0.0, 2.0, 0.01, "绿方向作用范围。"],
      ["hsB", "蓝偏移 hs_b", 0.0, 1.0, 0.01, "蓝方向色相偏移量。"],
      ["hsBRng", "蓝范围 rng", 0.0, 2.0, 0.01, "蓝方向作用范围。"],
    ],
    defaultCollapsed: true,
  },
  {
    id: "hueshift_cmy",
    title: "Hue Shift CMY 色相偏移",
    desc: "青/品红/黄随亮度的色相偏移量与范围。",
    toggles: [
      ["hsCmyEnable", "启用 CMY 色相偏移", "对 C/M/Y 三方向施加随亮度的色相偏移。"],
    ],
    sliders: [
      ["hsC", "青偏移 hs_c", 0.0, 1.0, 0.01, "青方向色相偏移量。"],
      ["hsCRng", "青范围 rng", 0.0, 2.0, 0.01, "青方向作用范围。"],
      ["hsM", "品红偏移 hs_m", 0.0, 1.0, 0.01, "品红方向色相偏移量。"],
      ["hsMRng", "品红范围 rng", 0.0, 2.0, 0.01, "品红方向作用范围。"],
      ["hsY", "黄偏移 hs_y", 0.0, 1.0, 0.01, "黄方向色相偏移量。"],
      ["hsYRng", "黄范围 rng", 0.0, 2.0, 0.01, "黄方向作用范围。"],
    ],
    defaultCollapsed: true,
  },
];
