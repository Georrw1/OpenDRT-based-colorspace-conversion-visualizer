// 曲线视图:tonescale 曲线 + chroma/purity 压缩曲线。Canvas2D,深色风格(参考 ciePlot.ts)。
// 目的:让 tn_sh(shoulder)等参数对高光滚降形状的影响「肉眼可见」——之前只有最终图像,
// 肩部形状变化很难感知;这里直接画出 log2曝光→输出 的响应曲线,并额外提供高光区域的放大插图
// (主曲线在 0..1 量程下 tn_sh 的差异只有零点几个百分点,肉眼很难分辨;放大插图把差异撑开)。
//
// 忠实性:曲线数据完全来自 evaluateCPU/evaluateCPUTrace(不新写任何色彩数学),
// 本文件只做采样 + Canvas2D 画图。

import { resolveConfig, evaluateCPU, evaluateCPUTrace } from "../drt";
import type { DrtParams } from "../params";
import { t } from "../locales/i18n";

const BG = "#0e0e10";
const GRID = "#2a2a2e";
const AXIS_TXT = "#777";
const FG = "#dcdce2";

/** 取输出编码 RGB 的最大分量,作为该曝光下的"输出亮度"代理(避免单通道遗漏高光溢出)。 */
function outLuma(enc: [number, number, number]): number {
  return Math.max(enc[0], enc[1], enc[2]);
}

/**
 * 图1:Tonescale 曲线(主图 + 高光肩部放大插图)。
 * 主图横轴 = log2(曝光/0.18)(scene-linear,以 0.18 中灰为参考,范围 -8..+8 档)。
 * 主图纵轴 = 输出(0..1 显示编码)。对中性灰 [x,x,x] 扫描后画出曲线,标注中灰点位置。
 * 右上角放大插图:只看 +2..+8 档、纵轴局部放大(0.85..1.02),
 * 这样 tn_sh(shoulder)对高光滚降形状的影响才能肉眼分辨——这是本视图的核心目的。
 */
function drawTonescale(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, params: DrtParams): void {
  const c = resolveConfig(params);
  const pad = 40;
  const X0 = x0 + pad, Y0 = y0 + h - pad, PW = w - pad - 16, PH = h - pad - 30;
  const STOP_MIN = -8, STOP_MAX = 8;

  const px = (stop: number) => X0 + ((stop - STOP_MIN) / (STOP_MAX - STOP_MIN)) * PW;
  const py = (v: number) => Y0 - Math.min(Math.max(v, 0), 1.15) * (PH / 1.15);

  // 背景网格
  ctx.strokeStyle = GRID;
  ctx.fillStyle = AXIS_TXT;
  ctx.font = "11px monospace";
  ctx.lineWidth = 1;
  for (let s = STOP_MIN; s <= STOP_MAX; s += 2) {
    ctx.beginPath(); ctx.moveTo(px(s), Y0); ctx.lineTo(px(s), Y0 - PH); ctx.stroke();
    ctx.fillText(`${s > 0 ? "+" : ""}${s}`, px(s) - 8, Y0 + 14);
  }
  for (let v = 0; v <= 1.0; v += 0.2) {
    ctx.beginPath(); ctx.moveTo(X0, py(v)); ctx.lineTo(X0 + PW, py(v)); ctx.stroke();
    ctx.fillText(v.toFixed(1), X0 - 30, py(v) + 4);
  }
  ctx.fillStyle = FG;
  ctx.font = "12px monospace";
  ctx.fillText(t("curves.ts_title"), X0, y0 + 16);
  ctx.fillStyle = AXIS_TXT;
  ctx.fillText(t("curves.log2_exp"), X0 + PW - 110, Y0 + 30);

  // 曲线:对中性灰扫描
  const N = 240;
  ctx.strokeStyle = "#ffaa3c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const stop = STOP_MIN + (i / N) * (STOP_MAX - STOP_MIN);
    const e = 0.18 * Math.pow(2, stop);
    const enc = evaluateCPU(c, [e, e, e]);
    const v = outLuma(enc);
    const X = px(stop), Y = py(v);
    i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
  }
  ctx.stroke();

  // 中灰参考点(0档)
  const midEnc = evaluateCPU(c, [0.18, 0.18, 0.18]);
  const midV = outLuma(midEnc);
  ctx.fillStyle = "#5ab4ff";
  ctx.beginPath(); ctx.arc(px(0), py(midV), 4, 0, 2 * Math.PI); ctx.fill();
  ctx.fillStyle = "#5ab4ff";
  ctx.font = "11px monospace";
  ctx.fillText(t("curves.mid_gray", midV.toFixed(3)), px(0) + 8, py(midV) - 8);

  // shoulder 起始区域标注(用 ts_x1 概念:tn_sh 决定的膝点附近,约在高光区域)
  ctx.strokeStyle = "rgba(160,160,180,0.35)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(px(2), Y0); ctx.lineTo(px(2), Y0 - PH); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#8a8a92";
  ctx.font = "10px monospace";
  ctx.fillText(t("curves.shoulder_hint"), px(2) + 4, Y0 - PH + 12);

  // ---- 高光肩部放大插图:+2..+8 档,纵轴局部放大到 0.82..1.02 ----
  // 主曲线在 0..1 全量程下 tn_sh 造成的差异只有零点几个百分点,肉眼很难分辨;
  // 这里单独放大高光区间,让肩部形状(圆润/陡峭)的变化清晰可见。
  const insetW = 300, insetH = 170;
  const insetX = X0 + PW - insetW - 6, insetY = y0 + 26;
  ctx.fillStyle = "rgba(18,18,22,0.92)";
  ctx.fillRect(insetX, insetY, insetW, insetH);
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 1;
  ctx.strokeRect(insetX, insetY, insetW, insetH);

  const IN_SMIN = 2, IN_SMAX = 8;
  const IN_VMIN = 0.82, IN_VMAX = 1.02;
  const ipad = 26;
  const iX0 = insetX + ipad, iY0 = insetY + insetH - 16, iPW = insetW - ipad - 8, iPH = insetH - 16 - 14;
  const ipx = (stop: number) => iX0 + ((stop - IN_SMIN) / (IN_SMAX - IN_SMIN)) * iPW;
  const ipy = (v: number) => iY0 - ((v - IN_VMIN) / (IN_VMAX - IN_VMIN)) * iPH;

  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.font = "9px monospace";
  ctx.fillStyle = "#888";
  for (let v = IN_VMIN; v <= IN_VMAX + 1e-6; v += 0.05) {
    ctx.beginPath(); ctx.moveTo(iX0, ipy(v)); ctx.lineTo(iX0 + iPW, ipy(v)); ctx.stroke();
    ctx.fillText(v.toFixed(2), iX0 - 24, ipy(v) + 3);
  }
  for (let s = IN_SMIN; s <= IN_SMAX; s += 2) {
    ctx.beginPath(); ctx.moveTo(ipx(s), iY0); ctx.lineTo(ipx(s), iY0 - iPH); ctx.stroke();
    ctx.fillText(`+${s}`, ipx(s) - 6, iY0 + 12);
  }
  ctx.fillStyle = "#bcbcc2";
  ctx.font = "10px monospace";
  ctx.fillText(t("curves.shoulder_inset"), insetX + 6, insetY + 12);

  ctx.strokeStyle = "#ffd23c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const IN_N = 160;
  for (let i = 0; i <= IN_N; i++) {
    const stop = IN_SMIN + (i / IN_N) * (IN_SMAX - IN_SMIN);
    const e = 0.18 * Math.pow(2, stop);
    const enc = evaluateCPU(c, [e, e, e]);
    const v = outLuma(enc);
    const X = ipx(stop), Y = ipy(v);
    i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
  }
  ctx.stroke();

  // 参数标注(当前 tn_sh / tn_con / tn_Lg / tn_Lp)
  ctx.fillStyle = "#9a9aa0";
  ctx.font = "11px monospace";
  ctx.fillText(
    t("curves.ts_params", params.tnSh.toFixed(2), params.tnCon.toFixed(2), params.tnLg.toFixed(1), params.tnLp.toFixed(0)),
    X0, y0 + h - 6,
  );
}

/**
 * 图2:Chroma/Purity 压缩曲线。
 * 横轴 = 输入饱和度(固定色相、扫描饱和度大小)。
 * 纵轴 = 纯度保留系数 ptf(来自 evaluateCPUTrace 的 purity_limit 节点标量)。
 * 展示 DRT 如何随亮度/饱和度压缩色彩纯度;用几个不同曝光档位的扫描线区分亮度影响。
 */
function drawChromaPurity(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, params: DrtParams): void {
  const c = resolveConfig(params);
  const pad = 40;
  const X0 = x0 + pad, Y0 = y0 + h - pad, PW = w - pad - 16, PH = h - pad - 30;

  const px = (sat: number) => X0 + sat * PW; // sat: 0..1
  const py = (v: number) => Y0 - Math.min(Math.max(v, 0), 1) * PH;

  ctx.strokeStyle = GRID;
  ctx.fillStyle = AXIS_TXT;
  ctx.font = "11px monospace";
  ctx.lineWidth = 1;
  for (let g = 0; g <= 1.0; g += 0.2) {
    ctx.beginPath(); ctx.moveTo(px(g), Y0); ctx.lineTo(px(g), Y0 - PH); ctx.stroke();
    ctx.fillText(g.toFixed(1), px(g) - 8, Y0 + 14);
    ctx.beginPath(); ctx.moveTo(X0, py(g)); ctx.lineTo(X0 + PW, py(g)); ctx.stroke();
    ctx.fillText(g.toFixed(1), X0 - 26, py(g) + 4);
  }
  ctx.fillStyle = FG;
  ctx.font = "12px monospace";
  ctx.fillText(t("curves.chroma_title"), X0, y0 + 16);
  ctx.fillStyle = AXIS_TXT;
  ctx.fillText(t("curves.chroma_x"), X0 + PW - 150, Y0 + 30);

  // 几个曝光档位(不同亮度)× 一个固定色相(红),扫描饱和度 0..1
  const EXPOSURES: Array<[number, string, string]> = [
    [0.18 * 0.25, "#5ab4ff", t("curves.exp_m2")],
    [0.18, "#ffaa3c", t("curves.exp_0")],
    [0.18 * 4, "#7fdf7f", t("curves.exp_p2")],
    [0.18 * 16, "#ff8080", t("curves.exp_p4")],
  ];
  const N = 100;
  for (const [e, color] of EXPOSURES) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const sat = i / N;
      // 红色相方向:R 分量保持 e,G/B 随 sat 从 e(无饱和度=灰)线性降到 0(纯红)
      const r = e;
      const gApprox = e * (1 - sat);
      const bApprox = e * (1 - sat);
      const trace = evaluateCPUTrace(c, [r, gApprox, bApprox]);
      const node = trace.find((s) => s.id === "purity_limit");
      const ptf = node?.scalars?.ptf ?? 1;
      const X = px(sat), Y = py(ptf);
      i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
    }
    ctx.stroke();
  }

  // 图例
  let ly = y0 + 36;
  ctx.font = "11px monospace";
  for (const [, color, legend] of EXPOSURES) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X0 + PW - 150, ly - 3); ctx.lineTo(X0 + PW - 138, ly - 3); ctx.stroke();
    ctx.fillStyle = "#bcbcc2";
    ctx.fillText(legend, X0 + PW - 132, ly);
    ly += 15;
  }

  ctx.fillStyle = "#9a9aa0";
  ctx.font = "11px monospace";
  ctx.fillText(t("curves.chroma_hint"), X0, y0 + h - 6);
}

/** 主入口:在 canvas 上画两张曲线图(上下排列),随 params 实时重画。 */
export function renderCurves(canvas: HTMLCanvasElement, params: DrtParams): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  const gap = 12;
  const halfH = (H - gap) / 2;
  drawTonescale(ctx, 0, 0, W, halfH, params);
  drawChromaPurity(ctx, 0, halfH + gap, W, halfH, params);
}
