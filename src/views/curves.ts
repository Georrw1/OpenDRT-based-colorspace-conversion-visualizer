import { resolveConfig, evaluateCPU, evaluateCPUTrace, linearizeScalar, type ResolvedConfig } from "../drt";
import type { DrtParams } from "../params";
import { t } from "../locales/i18n";

const BG = "#0e0e10";
const GRID = "#2a2a2e";
const AXIS_TXT = "#777";
const FG = "#dcdce2";
const PI = Math.PI;

function outLuma(enc: [number, number, number]): number {
  return Math.max(enc[0], enc[1], enc[2]);
}

function modp(a: number, b: number): number { return a - b * Math.floor(a / b); }
function hue_offset(h: number, o: number): number { return modp(h - o + PI, 2.0 * PI) - PI; }
function gauss_window(x: number, w: number): number { return Math.exp((-x * x) / w); }

function getHue(rgb: [number, number, number]): number {
  const opp0 = rgb[0] - rgb[2];
  const opp1 = rgb[1] - (rgb[0] + rgb[2]) / 2.0;
  return modp(Math.atan2(opp0, opp1) + PI + 1.10714931, 2.0 * PI);
}

function generateRgbForHue(hueRad: number, L: number): [number, number, number] {
  const targetAtan = hueRad - PI - 1.10714931;
  const opp0 = Math.sin(targetAtan);
  const opp1 = Math.cos(targetAtan);
  
  let R = opp0, B = 0, G = opp1 + opp0 / 2;
  const min = Math.min(R, G, B);
  R -= min; G -= min; B -= min;
  
  const max = Math.max(R, G, B);
  if (max > 0) {
    R = (R / max) * L;
    G = (G / max) * L;
    B = (B / max) * L;
  }
  return [R, G, B];
}

function getProbeState(c: ResolvedConfig, probePixel: { x: number; y: number; rgb: [number, number, number] } | null) {
  let hue = -1;
  let ach_d = 0.5;
  let tsn_pt = 0.5;
  let tsn0 = 0.18;
  let tsn_const = 0.5;
  
  if (probePixel) {
    const trace = evaluateCPUTrace(c, probePixel.rgb);
    const opp = trace.find(t => t.id === "opponent_hue");
    const norm = trace.find(t => t.id === "norm");
    const hyp = trace.find(t => t.id === "hyperbolic_compress");
    
    if (opp && opp.scalars) {
      hue = opp.scalars.hue;
      ach_d = opp.scalars.ach_d;
    }
    if (norm && norm.scalars) {
      tsn0 = norm.scalars.tsn0;
    }
    if (hyp && hyp.scalars) {
      tsn_pt = hyp.scalars.tsn_pt;
      tsn_const = hyp.scalars.tsn_const;
    }
  }
  return { hue, ach_d, tsn_pt, tsn0, tsn_const };
}

function updateFormula(mode: string) {
  const formulaDiv = document.getElementById("curves-formula");
  if (!formulaDiv) return;
  let latex = "";
  if (mode === "tonescale_purity") {
    latex = `
      \\begin{aligned}
      &\\text{1. } \\textbf{Tonescale (Hyperbolic Compress)} \\\\[0.5em]
      &tsn_{pt} = \\left( \\frac{tsn_0}{tsn_0 + s} \\right)^p \\\\[0.5em]
      &\\text{2. } \\textbf{Purity Limit (Chroma Compression)} \\\\[0.5em]
      &ptf = \\min\\left(1.0, \\frac{ach\\_d}{ach\\_d + \\text{mid\\_rng}} \\cdot \\text{high\\_ptf} \\right)
      \\end{aligned}
    `;
  } else if (mode === "hue_shift") {
    latex = `
      \\begin{aligned}
      &\\text{1. } \\textbf{RGB Hue Shift Weights (Gauss Windows)} \\\\[0.5em]
      &W_r = \\exp\\left(-\\frac{(\\Delta hue_r)^2}{0.66}\\right), \\quad W_g = \\dots, \\quad W_b = \\dots \\\\[0.5em]
      &\\text{2. } \\textbf{Hue Shift Contribution} \\\\[0.5em]
      &Shift_{R} = W_r \\cdot hs\\_r \\cdot ach\\_d \\cdot tsn_{pt}^{\\frac{1}{hs\\_r\\_rng}} \\\\[0.5em]
      &Shift_{G} = W_g \\cdot (-hs\\_g) \\cdot ach\\_d \\cdot tsn_{pt}^{\\frac{1}{hs\\_g\\_rng}} \\\\[0.5em]
      &Shift_{B} = W_b \\cdot (-hs\\_b) \\cdot ach\\_d \\cdot tsn_{pt}^{\\frac{1}{hs\\_b\\_rng}}
      \\end{aligned}
    `;
  } else if (mode === "brilliance") {
    latex = `
      \\begin{aligned}
      &\\text{1. } \\textbf{Pre-Brilliance Multiplier} \\\\[0.5em]
      &Brl_{base} = brl \\cdot ach\\_d^{\\frac{1}{brl\\_st}} \\\\[0.5em]
      &Brl_{R} = (brl + brl\\_r \\cdot W_r) \\cdot ach\\_d^{\\frac{1}{brl\\_st}} \\\\[0.5em]
      &Brl_{total} = (brl + brl\\_r W_r + brl\\_g W_g + brl\\_b W_b) \\cdot ach\\_d^{\\frac{1}{brl\\_st}} \\\\[0.5em]
      &tsn_{brl} = tsn_0 \\cdot 2^{Brl_{factor} \\cdot f(tsn_0)}
      \\end{aligned}
    `;
  } else if (mode === "transfer") {
    latex = `
      \\begin{aligned}
      &\\text{1. } \\textbf{OETF}^{-1} \\text{ (Input Log to Linear)} \\\\[0.5em]
      &Lin = \\text{decode}(CV_{in}) \\\\[0.5em]
      &\\text{2. } \\textbf{EOTF} \\text{ (Linear to Display Encoded)} \\\\[0.5em]
      &CV_{out} = Lin_{disp}^{\\frac{1}{\\gamma_{eotf}}}
      \\end{aligned}
    `;
  }

  try {
    if ((window as any).katex) {
      formulaDiv.innerHTML = (window as any).katex.renderToString(latex, { displayMode: true, throwOnError: false });
    } else {
      formulaDiv.innerHTML = `<pre style="color:#aaa;font-size:12px;">${latex}</pre>`;
    }
  } catch (e) {
    formulaDiv.innerHTML = `<pre style="color:#aaa;font-size:12px;">${latex}</pre>`;
  }
}

function drawTonescale(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, params: DrtParams): void {
  const c = resolveConfig(params);
  const pad = 40;
  const X0 = x0 + pad, Y0 = y0 + h - pad, PW = w - pad - 16, PH = h - pad - 30;
  const STOP_MIN = -8, STOP_MAX = 8;

  const px = (stop: number) => X0 + ((stop - STOP_MIN) / (STOP_MAX - STOP_MIN)) * PW;
  const py = (v: number) => Y0 - Math.min(Math.max(v, 0), 1.15) * (PH / 1.15);

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

  const midEnc = evaluateCPU(c, [0.18, 0.18, 0.18]);
  const midV = outLuma(midEnc);
  ctx.fillStyle = "#5ab4ff";
  ctx.beginPath(); ctx.arc(px(0), py(midV), 4, 0, 2 * PI); ctx.fill();
  ctx.fillText(t("curves.mid_gray", midV.toFixed(3)), px(0) + 8, py(midV) - 8);

  ctx.strokeStyle = "rgba(160,160,180,0.35)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(px(2), Y0); ctx.lineTo(px(2), Y0 - PH); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#8a8a92";
  ctx.font = "10px monospace";
  ctx.fillText(t("curves.shoulder_hint"), px(2) + 4, Y0 - PH + 12);

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
  ctx.setLineDash([]);
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

  ctx.fillStyle = "#9a9aa0";
  ctx.font = "11px monospace";
  ctx.fillText(
    t("curves.ts_params", params.tnSh.toFixed(2), params.tnCon.toFixed(2), params.tnLg.toFixed(1), params.tnLp.toFixed(0)),
    X0, y0 + h - 6,
  );
}

function drawChromaPurity(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, params: DrtParams): void {
  const c = resolveConfig(params);
  const pad = 40;
  const X0 = x0 + pad, Y0 = y0 + h - pad, PW = w - pad - 16, PH = h - pad - 30;

  const px = (sat: number) => X0 + sat * PW;
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

function drawHueShift(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, params: DrtParams, probePixel: any): void {
  const c = resolveConfig(params);
  const pad = 40;
  const X0 = x0 + pad, Y0 = y0 + h / 2, PW = w - pad - 16, PH = (h - pad * 2) / 2;
  const state = getProbeState(c, probePixel);

  const px = (deg: number) => X0 + (deg / 360) * PW;
  const py = (shiftDeg: number) => Y0 - (shiftDeg / 45) * PH;

  ctx.strokeStyle = GRID;
  ctx.fillStyle = AXIS_TXT;
  ctx.font = "11px monospace";
  ctx.lineWidth = 1;
  
  for (let d = 0; d <= 360; d += 60) {
    ctx.beginPath(); ctx.moveTo(px(d), Y0 - PH); ctx.lineTo(px(d), Y0 + PH); ctx.stroke();
    ctx.fillText(d.toString(), px(d) - 8, Y0 + PH + 14);
  }
  for (let s = -45; s <= 45; s += 15) {
    ctx.beginPath(); ctx.moveTo(X0, py(s)); ctx.lineTo(X0 + PW, py(s)); ctx.stroke();
    ctx.fillText(s.toString(), X0 - 24, py(s) + 4);
  }

  ctx.fillStyle = FG;
  ctx.font = "12px monospace";
  ctx.fillText(t("curves.hue_title") || "Hue Shift", X0, y0 + 16);
  ctx.fillStyle = AXIS_TXT;
  ctx.fillText(t("curves.hue_x") || "Input Hue (°)", X0 + PW - 120, Y0 + PH + 30);

  const N = 360;
  const rCurve: {x: number, y: number}[] = [];
  const gCurve: {x: number, y: number}[] = [];
  const bCurve: {x: number, y: number}[] = [];
  const totalCurve: {x: number, y: number}[] = [];

  const fixWrap = (s: number) => {
    if (s > PI) return s - 2*PI;
    if (s < -PI) return s + 2*PI;
    return s;
  };

  for (let i = 0; i <= N; i++) {
    const deg = (i / N) * 360;
    const rad = deg * PI / 180;
    let rgb = generateRgbForHue(rad, 1.0);
    const inHue = getHue(rgb);
    
    const ha_rgb_hs = [
      gauss_window(hue_offset(rad, -0.4), 0.66),
      gauss_window(hue_offset(rad, 4.3), 0.66),
      gauss_window(hue_offset(rad, 2.5), 0.66),
    ];

    if (c.hs_rgb_enable) {
      const hs_rgb = [
        ha_rgb_hs[0] * state.ach_d * Math.pow(state.tsn_pt, 1.0 / c.hs_r_rng),
        ha_rgb_hs[1] * state.ach_d * Math.pow(state.tsn_pt, 1.0 / c.hs_g_rng),
        ha_rgb_hs[2] * state.ach_d * Math.pow(state.tsn_pt, 1.0 / c.hs_b_rng),
      ];
      
      const calcShift = (wR: number, wG: number, wB: number) => {
        let hsf = [wR * c.hs_r, wG * -c.hs_g, wB * -c.hs_b];
        hsf = [hsf[2] - hsf[1], hsf[0] - hsf[2], hsf[1] - hsf[0]];
        const after = [rgb[0] + hsf[0], rgb[1] + hsf[1], rgb[2] + hsf[2]] as [number,number,number];
        return fixWrap(getHue(after) - inHue) * 180 / PI;
      };

      rCurve.push({x: inHue * 180 / PI, y: calcShift(hs_rgb[0], 0, 0)});
      gCurve.push({x: inHue * 180 / PI, y: calcShift(0, hs_rgb[1], 0)});
      bCurve.push({x: inHue * 180 / PI, y: calcShift(0, 0, hs_rgb[2])});
      totalCurve.push({x: inHue * 180 / PI, y: calcShift(hs_rgb[0], hs_rgb[1], hs_rgb[2])});
    }
  }

  const drawLine = (pts: {x: number, y: number}[], color: string, isDash = false) => {
    pts.sort((a,b) => a.x - b.x);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    if (isDash) ctx.setLineDash([4, 4]); else ctx.setLineDash([]);
    ctx.beginPath();
    let first = true;
    for (const p of pts) {
      if (first) { ctx.moveTo(px(p.x), py(p.y)); first = false; }
      else ctx.lineTo(px(p.x), py(p.y));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  if (c.hs_rgb_enable) {
    drawLine(rCurve, "#ff4a4a");
    drawLine(gCurve, "#4aff4a");
    drawLine(bCurve, "#4a8aff");
    drawLine(totalCurve, "#ffffff", true);
  }

  let ly = y0 + 36;
  const drawLegend = (color: string, text: string, isDash = false) => {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
    if (isDash) ctx.setLineDash([4, 4]); else ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(X0 + 20, ly - 3); ctx.lineTo(X0 + 40, ly - 3); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#bcbcc2"; ctx.fillText(text, X0 + 48, ly);
    ly += 16;
  };

  drawLegend("#ff4a4a", "Red Shift (hs_r)");
  drawLegend("#4aff4a", "Green Shift (hs_g)");
  drawLegend("#4a8aff", "Blue Shift (hs_b)");
  drawLegend("#ffffff", "Total RGB Shift", true);

  if (state.hue !== -1) {
    const pxH = px(state.hue * 180 / PI);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath(); ctx.moveTo(pxH, Y0 - PH); ctx.lineTo(pxH, Y0 + PH); ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.fillText("Probe", pxH + 4, Y0 - PH + 10);
  }
}

function drawBrilliance(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, params: DrtParams, probePixel: any): void {
  const c = resolveConfig(params);
  const pad = 40;
  const X0 = x0 + pad, Y0 = y0 + h / 2, PW = w - pad - 16, PH = (h - pad * 2) / 2;
  const state = getProbeState(c, probePixel);

  const px = (deg: number) => X0 + (deg / 360) * PW;
  const py = (mult: number) => Y0 - ((mult - 1.0) / 1.5) * PH;

  ctx.strokeStyle = GRID;
  ctx.fillStyle = AXIS_TXT;
  ctx.font = "11px monospace";
  ctx.lineWidth = 1;
  
  for (let d = 0; d <= 360; d += 60) {
    ctx.beginPath(); ctx.moveTo(px(d), Y0 - PH); ctx.lineTo(px(d), Y0 + PH); ctx.stroke();
    ctx.fillText(d.toString(), px(d) - 8, Y0 + PH + 14);
  }
  for (let m = -0.5; m <= 2.5; m += 0.5) {
    ctx.beginPath(); ctx.moveTo(X0, py(m)); ctx.lineTo(X0 + PW, py(m)); ctx.stroke();
    ctx.fillText(m.toFixed(1), X0 - 24, py(m) + 4);
  }

  ctx.fillStyle = FG;
  ctx.font = "12px monospace";
  ctx.fillText(t("curves.brilliance_title") || "Brilliance", X0, y0 + 16);
  ctx.fillStyle = AXIS_TXT;
  ctx.fillText(t("curves.hue_x") || "Input Hue (°)", X0 + PW - 120, Y0 + PH + 30);

  const N = 360;
  const baseCurve: {x: number, y: number}[] = [];
  const rCurve: {x: number, y: number}[] = [];
  const gCurve: {x: number, y: number}[] = [];
  const bCurve: {x: number, y: number}[] = [];
  const totalCurve: {x: number, y: number}[] = [];

  for (let i = 0; i <= N; i++) {
    const deg = (i / N) * 360;
    const rad = deg * PI / 180;
    const inHue = rad;
    
    const ha_rgb = [
      gauss_window(hue_offset(rad, 0.1), 0.66),
      gauss_window(hue_offset(rad, 4.3), 0.66),
      gauss_window(hue_offset(rad, 2.3), 0.66),
    ];

    if (c.brl_enable) {
      const brl_tsf = Math.pow(state.tsn0 / (state.tsn0 + 1.0), 1.0 - c.brl_rng);
      const calcBrl = (wBase: number, wR: number, wG: number, wB: number) => {
        const brl_exf = (wBase * c.brl + c.brl_r * wR + c.brl_g * wG + c.brl_b * wB) * Math.pow(state.ach_d, 1.0 / c.brl_st);
        return Math.pow(2.0, brl_exf * (brl_exf < 0.0 ? brl_tsf : 1.0 - brl_tsf));
      };

      baseCurve.push({x: inHue * 180 / PI, y: calcBrl(1, 0, 0, 0)});
      rCurve.push({x: inHue * 180 / PI, y: calcBrl(1, ha_rgb[0], 0, 0)});
      gCurve.push({x: inHue * 180 / PI, y: calcBrl(1, 0, ha_rgb[1], 0)});
      bCurve.push({x: inHue * 180 / PI, y: calcBrl(1, 0, 0, ha_rgb[2])});
      totalCurve.push({x: inHue * 180 / PI, y: calcBrl(1, ha_rgb[0], ha_rgb[1], ha_rgb[2])});
    }
  }

  const drawLine = (pts: {x: number, y: number}[], color: string, isDash = false) => {
    pts.sort((a,b) => a.x - b.x);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    if (isDash) ctx.setLineDash([4, 4]); else ctx.setLineDash([]);
    ctx.beginPath();
    let first = true;
    for (const p of pts) {
      if (first) { ctx.moveTo(px(p.x), py(p.y)); first = false; }
      else ctx.lineTo(px(p.x), py(p.y));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  if (c.brl_enable) {
    drawLine(baseCurve, "#777777", true);
    drawLine(rCurve, "#ff4a4a");
    drawLine(gCurve, "#4aff4a");
    drawLine(bCurve, "#4a8aff");
    drawLine(totalCurve, "#ffffff", true);
  }

  let ly = y0 + 36;
  const drawLegend = (color: string, text: string, isDash = false) => {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
    if (isDash) ctx.setLineDash([4, 4]); else ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(X0 + 20, ly - 3); ctx.lineTo(X0 + 40, ly - 3); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#bcbcc2"; ctx.fillText(text, X0 + 48, ly);
    ly += 16;
  };

  drawLegend("#777777", "Base Brilliance", true);
  drawLegend("#ff4a4a", "Red Brilliance (brl_r)");
  drawLegend("#4aff4a", "Green Brilliance (brl_g)");
  drawLegend("#4a8aff", "Blue Brilliance (brl_b)");
  drawLegend("#ffffff", "Total Brilliance", true);

  if (state.hue !== -1) {
    const pxH = px(state.hue * 180 / PI);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath(); ctx.moveTo(pxH, Y0 - PH); ctx.lineTo(pxH, Y0 + PH); ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.fillText("Probe", pxH + 4, Y0 - PH + 10);
  }
}

function drawTransfer(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, params: DrtParams): void {
  const c = resolveConfig(params);
  const pad = 40;
  const X0 = x0 + pad, Y0 = y0 + h - pad, PW = w - pad - 16, PH = h - pad - 30;

  const px = (v: number) => X0 + v * PW;
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
  ctx.fillText(t("curves.transfer_title") || "Transfer Functions", X0, y0 + 16);
  ctx.fillStyle = AXIS_TXT;
  ctx.fillText("Code Value (0..1)", X0 + PW - 120, Y0 + 30);

  const N = 200;
  
  ctx.strokeStyle = "#5ab4ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const cv = i / N;
    const lin = linearizeScalar(cv, c.in_oetf as any);
    const X = px(cv);
    const Y = py(Math.log2(lin + 1) / 4);
    i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
  }
  ctx.stroke();
  
  ctx.strokeStyle = "#ffaa3c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const eotf_p = 2.0 + c.eotf * 0.2;
  for (let i = 0; i <= N; i++) {
    const cv = i / N;
    let enc = cv;
    if (c.eotf > 0 && c.eotf < 4) enc = Math.pow(cv, 1.0 / eotf_p);
    const X = px(cv), Y = py(enc);
    i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
  }
  ctx.stroke();

  ctx.fillStyle = "#5ab4ff"; ctx.fillText("OETF⁻¹ (Log to Linear, scaled)", X0 + 20, y0 + 40);
  ctx.fillStyle = "#ffaa3c"; ctx.fillText("EOTF (Linear to Display)", X0 + 20, y0 + 56);
}

export function renderCurves(
  canvas: HTMLCanvasElement, 
  params: DrtParams, 
  mode: string = "tonescale_purity", 
  probePixel: any = null
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  const gap = 12;
  const halfH = Math.floor((H - gap) / 2);

  if (mode === "tonescale_purity") {
    drawTonescale(ctx, 0, 0, W, halfH, params);
    drawChromaPurity(ctx, 0, halfH + gap, W, halfH, params);
  } else if (mode === "hue_shift") {
    drawHueShift(ctx, 0, 0, W, H, params, probePixel);
  } else if (mode === "brilliance") {
    drawBrilliance(ctx, 0, 0, W, H, params, probePixel);
  } else if (mode === "transfer") {
    drawTransfer(ctx, 0, 0, W, H, params);
  }

  updateFormula(mode);
}
