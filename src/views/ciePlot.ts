// CIE 1931 色度图:一张「人眼可见色的地图」。本视图分两层:
//   ① 地图底座(静态参考):光谱轨迹马蹄形 + 输入/显示色域三角(中性虚线) + D65 白点。
//   ② 你的图像(动态主角):每个像素处理前(蓝)→处理后(橙)的色度位置,
//      默认用「位移连线」直接展示 DRT 把每个颜色推到哪里 = 色彩压缩的可视化。
// 蓝/橙只用于散点(输入/输出),色域三角一律中性虚线,避免语义撞色。
// path-to-white(R/G/B 提亮时漂向白点的轨迹)属 DRT 通用行为,默认关闭,可开关。

import { INPUT_GAMUT_MATRICES, resolveConfig, evaluateCPU } from "../drt";
import type { DrtParams } from "../params";
import { decodeSceneLinear, type LoadedSource } from "../io/loadImage";

// 散点模式:位移连线(默认主角) / 仅处理前 / 仅处理后 / 前后叠加
export type CieScatterMode = "shift" | "input" | "output" | "both";

const MAX_SCATTER = 12000;    // 散点降采样上限
const MAX_SHIFT_LINES = 700;  // 位移连线降采样上限(连线更重,数量更少)

// CIE 1931 2° 光谱轨迹 xy(近似标准值,用于背景马蹄形)。
const SPECTRAL: Array<[number, number]> = [
  [0.1741, 0.0050], [0.1733, 0.0048], [0.1714, 0.0051], [0.1644, 0.0109],
  [0.1440, 0.0297], [0.1241, 0.0578], [0.0913, 0.1327], [0.0454, 0.2950],
  [0.0082, 0.5384], [0.0139, 0.7502], [0.0743, 0.8338], [0.1547, 0.8059],
  [0.2296, 0.7543], [0.3016, 0.6923], [0.3731, 0.6245], [0.4441, 0.5547],
  [0.5125, 0.4866], [0.5752, 0.4242], [0.6270, 0.3725], [0.6658, 0.3340],
  [0.6915, 0.3083], [0.7079, 0.2920], [0.7190, 0.2809], [0.7260, 0.2740],
  [0.7347, 0.2653],
];

type Mat3 = number[][];
function mul(m: Mat3, v: [number, number, number]): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}
function xyOf(XYZ: [number, number, number]): [number, number] {
  const s = XYZ[0] + XYZ[1] + XYZ[2];
  if (s <= 0) return [0, 0];
  return [XYZ[0] / s, XYZ[1] / s];
}

function gamutTriangle(name: string): { R: [number, number]; G: [number, number]; B: [number, number]; W: [number, number] } {
  const m = INPUT_GAMUT_MATRICES[name]!;
  const R = xyOf([m[0][0], m[1][0], m[2][0]]);
  const G = xyOf([m[0][1], m[1][1], m[2][1]]);
  const B = xyOf([m[0][2], m[1][2], m[2][2]]);
  const W = xyOf(mul(m, [1, 1, 1]));
  return { R, G, B, W };
}

const DISPLAY_MATRIX: Record<number, string> = { 0: "rec709", 1: "p3d65", 2: "rec2020" };

function decodeOutputToXY(enc: [number, number, number], c: ReturnType<typeof resolveConfig>): [number, number] {
  let lin: [number, number, number];
  if (c.eotf > 0 && c.eotf < 4) {
    const g = 2.0 + c.eotf * 0.2;
    lin = [Math.pow(Math.max(enc[0], 0), g), Math.pow(Math.max(enc[1], 0), g), Math.pow(Math.max(enc[2], 0), g)];
  } else {
    lin = [enc[0], enc[1], enc[2]];
  }
  const mName = DISPLAY_MATRIX[c.display_gamut] ?? "p3d65";
  const XYZ = mul(INPUT_GAMUT_MATRICES[mName]!, lin);
  return xyOf(XYZ);
}

function samplePixels(src: LoadedSource, oetf: string, cap: number): Float32Array {
  const lin = decodeSceneLinear(src, oetf);
  const nPix = src.width * src.height;
  const step = Math.max(1, Math.floor(nPix / cap));
  const out: number[] = [];
  for (let p = 0; p < nPix; p += step) {
    const i = p * 4;
    const r = lin[i], g = lin[i + 1], b = lin[i + 2];
    if (r + g + b <= 1e-6) continue;
    out.push(r, g, b);
  }
  return new Float32Array(out);
}

export interface CieOptions {
  mode?: CieScatterMode;
  showPtw?: boolean; // path-to-white 开关(默认关)
}

export function renderCie(
  canvas: HTMLCanvasElement,
  params: DrtParams,
  source?: LoadedSource,
  opts: CieOptions = {},
): void {
  const mode: CieScatterMode = opts.mode ?? "shift";
  const showPtw = opts.showPtw ?? false;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  const pad = 44;
  const XMAX = 0.8, YMAX = 0.9;
  const px = (x: number) => pad + (x / XMAX) * (W - 2 * pad);
  const py = (y: number) => H - pad - (y / YMAX) * (H - 2 * pad);

  ctx.fillStyle = "#0e0e10";
  ctx.fillRect(0, 0, W, H);

  // 网格与坐标轴
  ctx.strokeStyle = "#2a2a2e";
  ctx.fillStyle = "#777";
  ctx.font = "11px monospace";
  ctx.lineWidth = 1;
  for (let gx = 0; gx <= 0.8; gx += 0.1) {
    ctx.beginPath(); ctx.moveTo(px(gx), py(0)); ctx.lineTo(px(gx), py(YMAX)); ctx.stroke();
    ctx.fillText(gx.toFixed(1), px(gx) - 8, py(0) + 16);
  }
  for (let gy = 0; gy <= 0.9; gy += 0.1) {
    ctx.beginPath(); ctx.moveTo(px(0), py(gy)); ctx.lineTo(px(XMAX), py(gy)); ctx.stroke();
    ctx.fillText(gy.toFixed(1), px(0) - 32, py(gy) + 4);
  }
  ctx.fillStyle = "#666";
  ctx.fillText("CIE x", px(XMAX) - 8, py(0) + 32);
  ctx.fillText("CIE y", px(0) - 34, py(YMAX) - 8);

  // 光谱轨迹(可见色边界)+ 紫线闭合
  ctx.strokeStyle = "#9a9aa0";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  SPECTRAL.forEach(([x, y], i) => { const X = px(x), Y = py(y); i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); });
  ctx.closePath();
  ctx.stroke();

  const c = resolveConfig(params);
  const inGamutName = INPUT_GAMUT_MATRICES[params.inGamut] ? params.inGamut : "egamut2";
  const displayName = DISPLAY_MATRIX[c.display_gamut] ?? "p3d65";

  const BLUE = "#5ab4ff";   // 输入态(处理前)专用
  const ORANGE = "#ffaa3c"; // 输出态(处理后)专用

  // ---- ② 你的图像:散点 / 位移连线(在参考线之下先画) ----
  if (source) {
    const inMtx = INPUT_GAMUT_MATRICES[inGamutName]!;

    if (mode === "shift") {
      // 位移连线:处理前(蓝)→处理后(橙),直接看每个颜色被 DRT 推到哪
      const pixels = samplePixels(source, params.inOetf, MAX_SHIFT_LINES);
      const nPts = pixels.length / 3;
      for (let k = 0; k < nPts; k++) {
        const r = pixels[k * 3], g = pixels[k * 3 + 1], b = pixels[k * 3 + 2];
        const [ix, iy] = xyOf(mul(inMtx, [r, g, b]));
        const enc = evaluateCPU(c, [r, g, b]);
        const [ox, oy] = decodeOutputToXY(enc, c);
        if ((ix <= 0 && iy <= 0) || (ox <= 0 && oy <= 0)) continue;
        // 连线:半透明灰白,弱化,只作"轨迹"
        ctx.strokeStyle = "rgba(200,200,210,0.16)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px(ix), py(iy)); ctx.lineTo(px(ox), py(oy)); ctx.stroke();
        // 起点蓝(处理前)
        ctx.fillStyle = BLUE;
        ctx.fillRect(px(ix) - 1, py(iy) - 1, 2, 2);
        // 终点橙(处理后)
        ctx.fillStyle = ORANGE;
        ctx.fillRect(px(ox) - 1, py(oy) - 1, 2, 2);
      }
    } else {
      const pixels = samplePixels(source, params.inOetf, MAX_SCATTER);
      const nPts = pixels.length / 3;
      if (mode === "input" || mode === "both") {
        ctx.fillStyle = "rgba(90,180,255,0.35)";
        for (let k = 0; k < nPts; k++) {
          const r = pixels[k * 3], g = pixels[k * 3 + 1], b = pixels[k * 3 + 2];
          const [x, y] = xyOf(mul(inMtx, [r, g, b]));
          if (x <= 0 && y <= 0) continue;
          ctx.fillRect(px(x) - 0.5, py(y) - 0.5, 1.4, 1.4);
        }
      }
      if (mode === "output" || mode === "both") {
        ctx.fillStyle = "rgba(255,170,60,0.35)";
        for (let k = 0; k < nPts; k++) {
          const r = pixels[k * 3], g = pixels[k * 3 + 1], b = pixels[k * 3 + 2];
          const enc = evaluateCPU(c, [r, g, b]);
          const [x, y] = decodeOutputToXY(enc, c);
          if (x <= 0 && y <= 0) continue;
          ctx.fillRect(px(x) - 0.5, py(y) - 0.5, 1.4, 1.4);
        }
      }
    }
  }

  // ---- ① 地图底座:色域三角(中性虚线,不与散点撞色) ----
  // 输入 gamut = 白色虚线;显示 gamut = 灰色点线
  const triSpecs: Array<[string, string, number[]]> = [[inGamutName, "#e8e8ee", [6, 4]]];
  if (displayName !== inGamutName) triSpecs.push([displayName, "#8a8a92", [2, 3]]);
  for (const [name, color, dash] of triSpecs) {
    const t = gamutTriangle(name);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(px(t.R[0]), py(t.R[1]));
    ctx.lineTo(px(t.G[0]), py(t.G[1]));
    ctx.lineTo(px(t.B[0]), py(t.B[1]));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    // R/G/B 顶点小标注
    ctx.fillStyle = color;
    ctx.font = "10px monospace";
    ctx.fillText("R", px(t.R[0]) + 3, py(t.R[1]) + 3);
    ctx.fillText("G", px(t.G[0]) + 3, py(t.G[1]) + 3);
    ctx.fillText("B", px(t.B[0]) + 3, py(t.B[1]) + 3);
    // 白点
    ctx.beginPath(); ctx.arc(px(t.W[0]), py(t.W[1]), 3, 0, 2 * Math.PI); ctx.fill();
  }

  // path-to-white(可选):R/G/B 在多档曝光下过完整 DRT 后漂向白点的轨迹
  if (showPtw) {
    const primDirs: Array<[string, [number, number, number]]> = [
      ["rgba(255,80,80,0.85)", [1, 0, 0]],
      ["rgba(80,255,80,0.85)", [0, 1, 0]],
      ["rgba(100,140,255,0.85)", [0, 0, 1]],
    ];
    const exposures: number[] = [];
    for (let st = -3; st <= 8; st += 0.5) exposures.push(0.18 * Math.pow(2, st));
    for (const [color, dir] of primDirs) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      for (const e of exposures) {
        const enc = evaluateCPU(c, [dir[0] * e, dir[1] * e, dir[2] * e]);
        const [x, y] = decodeOutputToXY(enc, c);
        const X = px(x), Y = py(y);
        if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
      }
      ctx.stroke();
    }
  }

  // ---- 图例(中文,分「你的图像」与「参考」两组) ----
  ctx.font = "12px monospace";
  const legendItems: Array<[string, string, "sq" | "line" | "dash" | "dot"]> = [];
  if (source) {
    if (mode === "shift") {
      legendItems.push(["处理前像素", BLUE, "sq"]);
      legendItems.push(["处理后像素", ORANGE, "sq"]);
      legendItems.push(["→ 每个颜色的位移", "rgba(200,200,210,0.7)", "line"]);
    } else {
      if (mode === "input" || mode === "both") legendItems.push(["处理前像素(输入)", BLUE, "sq"]);
      if (mode === "output" || mode === "both") legendItems.push(["处理后像素(输出)", ORANGE, "sq"]);
    }
  }
  legendItems.push([`源色域 ${inGamutName}`, "#e8e8ee", "dash"]);
  if (displayName !== inGamutName) legendItems.push([`显示色域 ${displayName}`, "#8a8a92", "dot"]);
  legendItems.push(["可见色边界(光谱轨迹)", "#9a9aa0", "line"]);
  if (showPtw) legendItems.push(["R/G/B path-to-white", "#ff8080", "line"]);

  // 图例底板
  const boxW = 210, boxH = legendItems.length * 19 + 14;
  const bx = W - pad - boxW, by = pad - 6;
  ctx.fillStyle = "rgba(20,20,24,0.82)";
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.strokeStyle = "#333"; ctx.lineWidth = 1; ctx.strokeRect(bx, by, boxW, boxH);

  let ly = by + 18;
  for (const [txt, col, kind] of legendItems) {
    const sx = bx + 10;
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
    if (kind === "sq") {
      ctx.fillRect(sx, ly - 9, 11, 11);
    } else if (kind === "line") {
      ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(sx, ly - 3); ctx.lineTo(sx + 12, ly - 3); ctx.stroke();
    } else if (kind === "dash") {
      ctx.setLineDash([5, 3]); ctx.beginPath(); ctx.moveTo(sx, ly - 3); ctx.lineTo(sx + 12, ly - 3); ctx.stroke(); ctx.setLineDash([]);
    } else {
      ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(sx, ly - 3); ctx.lineTo(sx + 12, ly - 3); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.fillStyle = "#dcdce2"; ctx.font = "12px monospace";
    ctx.fillText(txt, sx + 18, ly);
    ly += 19;
  }

  // 底部一句话说明
  ctx.fillStyle = "#888";
  ctx.font = "11px monospace";
  const srcName = source ? source.name : "(未上传)";
  const modeTxt = mode === "shift" ? "位移连线" : mode === "input" ? "仅处理前" : mode === "output" ? "仅处理后" : "前后叠加";
  ctx.fillText(`色度地图 · 显示 = ${modeTxt} · 像素来自:${srcName}`, pad, H - 14);
}
