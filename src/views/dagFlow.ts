// DAG 可视流程图:Nuke 风格纵向节点图,把 evaluateCPUTrace 的 25 个节点画成方块 + 连线(自上而下)。
// 点击/悬浮某节点:高亮该节点,显示中文作用说明 + 当前探针像素在该节点的 RGB 值 + 小色块预览。
// 若未选中像素,用默认中灰 0.18 走一遍 trace 填充,保证 DAG 始终有内容可看。
//
// 忠实性:所有数值来自 evaluateCPUTrace(阶段4新增的插桩副本,不改动 evaluateCPU 本身)。
// 本文件只负责节点图的布局与绘制、交互状态管理。

import { resolveConfig, evaluateCPUTrace, TRACE_NODE_INFO, type TraceStep, type ResolvedConfig } from "../drt";
import type { DrtParams } from "../params";
import { NODE_FORMULAS } from "../nodeFormulas";

// KaTeX 从 CDN 以 defer 加载,渲染时用 window.katex(可能尚未就绪则降级为纯文本)。
declare global { interface Window { katex?: any; } }
function renderKatex(el: HTMLElement, latex: string): void {
  const k = window.katex;
  if (k && typeof k.render === "function") {
    try { k.render(latex, el, { displayMode: true, throwOnError: false }); return; }
    catch { /* 落到纯文本 */ }
  }
  el.textContent = latex; // 降级
}

const BG = "#0e0e10";
const NODE_W = 190;
const NODE_H = 40;
const NODE_GAP_Y = 22;
const COL_X = 40; // 节点左边缘
const TOP_Y = 30;

export interface DagState {
  hoverIndex: number | null;
  selectedIndex: number | null;
}

/** 把 canvas 局部坐标转换为命中的节点索引(供 main.ts 接线 hover/click 用)。 */
export function hitTestNode(localY: number, localX: number): number | null {
  if (localX < COL_X - 8 || localX > COL_X + NODE_W + 8) return null;
  const idx = Math.floor((localY - TOP_Y + NODE_GAP_Y / 2) / (NODE_H + NODE_GAP_Y));
  if (idx < 0 || idx >= TRACE_NODE_INFO.length) return null;
  const nodeTop = TOP_Y + idx * (NODE_H + NODE_GAP_Y);
  if (localY < nodeTop || localY > nodeTop + NODE_H) return null;
  return idx;
}

/** 把 RGB clamp 到 [0,1] 用于色块预览(仅显示用,不改变实际数值)。 */
function clampColor(rgb: [number, number, number]): string {
  const r = Math.round(Math.min(Math.max(rgb[0], 0), 1) * 255);
  const g = Math.round(Math.min(Math.max(rgb[1], 0), 1) * 255);
  const b = Math.round(Math.min(Math.max(rgb[2], 0), 1) * 255);
  return `rgb(${r},${g},${b})`;
}

function fmt(v: number): string {
  return v.toFixed(4);
}

/**
 * 计算探针像素的完整 trace。probeInput 为 scene-linear RGB;若未提供,默认中灰 0.18。
 */
export function computeProbeTrace(params: DrtParams, probeInput?: [number, number, number]): TraceStep[] {
  const c: ResolvedConfig = resolveConfig(params);
  const input = probeInput ?? [0.18, 0.18, 0.18];
  return evaluateCPUTrace(c, input);
}

// “整图中间态”预览的降采样尺寸上限(长边)。CPU 逐像素跑 trace,需控制像素量保证交互速度。
// 右侧「整图中间态」降采样最长边。每像素重跑 25 步 trace,故适度取值;
// 点节点时才重算(非逐帧),512 在自用调试工具下清晰度与响应可接受。
export const DAG_IMG_MAX = 512;

// 后期节点(已在显示编码域)直接显示;早/中期节点处于线性/渲染空间,为便于观察加一个显示型 gamma。
// index >= EOTF_DONE_FROM 的节点视为已编码(不再加 gamma)。inverse_eotf 是最后一个(索引 24)。
const EOTF_DONE_FROM = 24;

/**
 * 把一张降采样的 scene-linear 图(RGBA float)逐像素跑 evaluateCPUTrace,
 * 将第 nodeIndex 个节点的中间 RGB 绘到 canvas——即“整张图在该步骤后的样子”。
 * 忠实性:数值完全来自 evaluateCPUTrace,仅为可视化做 clamp 与(线性节点)显示 gamma。
 */
export function renderNodeImage(
  canvas: HTMLCanvasElement,
  linear: Float32Array,   // RGBA,长度 = w*h*4,scene-linear(行0=顶)
  w: number,
  h: number,
  params: DrtParams,
  nodeIndex: number | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  // 未选节点时显示最终输出(最后一个节点),与图像预览一致。
  const c: ResolvedConfig = resolveConfig(params);
  const idx = nodeIndex ?? (TRACE_NODE_INFO.length - 1);
  const encoded = idx >= EOTF_DONE_FROM;

  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let p = 0; p < w * h; p++) {
    const si = p * 4;
    const trace = evaluateCPUTrace(c, [linear[si], linear[si + 1], linear[si + 2]]);
    const rgb = trace[idx].rgb;
    for (let ch = 0; ch < 3; ch++) {
      let v = Math.min(Math.max(rgb[ch], 0), 1);
      // 线性/渲染空间节点加显示 gamma(~2.2)以便肉眼观察;已编码节点直接用。
      if (!encoded) v = Math.pow(v, 1.0 / 2.2);
      d[si + ch] = Math.round(v * 255);
    }
    d[si + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * 绘制纵向 DAG:节点方块自上而下排列,箭头连线,悬浮/选中节点高亮。
 * trace 为当前探针像素跑出的 25 步 trace(与 TRACE_NODE_INFO 顺序一致)。
 * 返回 canvas 所需的总绘制高度(供外部按需设置 canvas.height 以完整显示)。
 */
export function renderDag(
  canvas: HTMLCanvasElement,
  trace: TraceStep[],
  state: DagState,
): number {
  const ctx = canvas.getContext("2d");
  const n = TRACE_NODE_INFO.length;
  const totalH = TOP_Y + n * (NODE_H + NODE_GAP_Y) + 20;
  if (!ctx) return totalH;

  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // 标题
  ctx.fillStyle = "#dcdce2";
  ctx.font = "13px monospace";
  ctx.fillText("OpenDRT 处理流程(Nuke 风格节点图,自上而下)", COL_X, 18);

  for (let i = 0; i < n; i++) {
    const info = TRACE_NODE_INFO[i];
    const step = trace[i];
    const top = TOP_Y + i * (NODE_H + NODE_GAP_Y);
    const isHover = state.hoverIndex === i;
    const isSelected = state.selectedIndex === i;

    // 连线(箭头指向下一节点)
    if (i > 0) {
      const prevBottom = TOP_Y + (i - 1) * (NODE_H + NODE_GAP_Y) + NODE_H;
      ctx.strokeStyle = "#4a4a52";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(COL_X + NODE_W / 2, prevBottom);
      ctx.lineTo(COL_X + NODE_W / 2, top);
      ctx.stroke();
      // 箭头三角
      ctx.fillStyle = "#4a4a52";
      ctx.beginPath();
      ctx.moveTo(COL_X + NODE_W / 2 - 4, top - 6);
      ctx.lineTo(COL_X + NODE_W / 2 + 4, top - 6);
      ctx.lineTo(COL_X + NODE_W / 2, top);
      ctx.closePath();
      ctx.fill();
    }

    // 节点方块
    ctx.fillStyle = isSelected ? "#2a3a4a" : isHover ? "#242428" : "#1c1c20";
    ctx.strokeStyle = isSelected ? "#6cf" : isHover ? "#888" : "#3a3a40";
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.beginPath();
    const rr = 6;
    ctx.moveTo(COL_X + rr, top);
    ctx.arcTo(COL_X + NODE_W, top, COL_X + NODE_W, top + NODE_H, rr);
    ctx.arcTo(COL_X + NODE_W, top + NODE_H, COL_X, top + NODE_H, rr);
    ctx.arcTo(COL_X, top + NODE_H, COL_X, top, rr);
    ctx.arcTo(COL_X, top, COL_X + NODE_W, top, rr);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 小色块预览(该节点 rgb,clamp 到0..1显示)
    const swatchX = COL_X + 8, swatchY = top + 8, swatchS = NODE_H - 16;
    if (step) {
      ctx.fillStyle = clampColor(step.rgb);
      ctx.fillRect(swatchX, swatchY, swatchS, swatchS);
      ctx.strokeStyle = "#555";
      ctx.lineWidth = 1;
      ctx.strokeRect(swatchX, swatchY, swatchS, swatchS);
    }

    // 节点序号 + 中文名
    ctx.fillStyle = "#dcdce2";
    ctx.font = "12px monospace";
    ctx.fillText(`${i + 1}. ${info.label}`, swatchX + swatchS + 8, top + NODE_H / 2 - 2);

    // RGB 数值(小字)
    if (step) {
      ctx.fillStyle = "#8a8a92";
      ctx.font = "10px monospace";
      ctx.fillText(
        `${fmt(step.rgb[0])}, ${fmt(step.rgb[1])}, ${fmt(step.rgb[2])}`,
        swatchX + swatchS + 8, top + NODE_H / 2 + 12,
      );
    }
  }

  return totalH;
}

/**
 * 渲染右侧/下方的信息面板(节点说明 + 探针像素在该节点的完整数值)。
 * infoEl 为一个普通 HTML 容器,内容用中文渲染。
 */
export function renderDagInfoPanel(
  infoEl: HTMLElement,
  trace: TraceStep[],
  index: number | null,
  probeInput: [number, number, number] | null,
): void {
  if (index === null) {
    infoEl.innerHTML = `<p class="note">悬浮或点击左侧节点,查看该步骤的中文说明与探针像素数值。${
      probeInput ? "" : "当前未选中图像像素,使用默认中灰 0.18 作为探针。"
    }</p>`;
    return;
  }
  const info = TRACE_NODE_INFO[index];
  const step = trace[index];
  if (!info || !step) { infoEl.innerHTML = ""; return; }

  const swatch = clampColor(step.rgb);
  let scalarsHtml = "";
  if (step.scalars) {
    const rows = Object.entries(step.scalars)
      .map(([k, v]) => `<tr><td>${k}</td><td>${fmt(v)}</td></tr>`)
      .join("");
    scalarsHtml = `<table><thead><tr><th>关键标量</th><th>数值</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  const nf = NODE_FORMULAS[info.id];
  const probeStr = probeInput
    ? `${fmt(probeInput[0])}, ${fmt(probeInput[1])}, ${fmt(probeInput[2])}`
    : "默认中灰 0.18, 0.18, 0.18";

  // 先用 innerHTML 铺基础结构(含公式占位),再用 KaTeX 渲染公式占位。
  const formulaPlaceholders = nf
    ? nf.formula.map((_, i) => `<div class="formula-block" data-fi="${i}"></div>`).join("")
    : "";
  const theoryHtml = nf
    ? `<div class="section-label">原理讲解</div><div class="theory-text">${nf.theory}</div>` +
      (nf.vars ? `<div class="vars-note">${nf.vars}</div>` : "")
    : "";
  const formulaSection = nf
    ? `<div class="section-label">公式(与内核逐行对应)</div>${formulaPlaceholders}`
    : "";

  infoEl.innerHTML = `
    <h3>${index + 1}. ${info.label}</h3>
    <p class="note">${info.desc}</p>
    <div style="display:flex;align-items:center;gap:10px;margin:8px 0;">
      <div style="width:28px;height:28px;border:1px solid #555;background:${swatch};"></div>
      <span style="font-family:monospace;font-size:12px;color:#dcdce2;">
        RGB = ${fmt(step.rgb[0])}, ${fmt(step.rgb[1])}, ${fmt(step.rgb[2])}
      </span>
    </div>
    ${scalarsHtml}
    <p class="note" style="margin-top:8px;">
      探针输入(scene-linear)= ${probeStr}
    </p>
    ${formulaSection}
    ${theoryHtml}
  `;

  // KaTeX 渲染公式占位(若 CDN 未就绪则降级纯文本)。
  if (nf) {
    const holders = infoEl.querySelectorAll<HTMLElement>(".formula-block[data-fi]");
    holders.forEach((h) => {
      const fi = parseInt(h.getAttribute("data-fi") || "0", 10);
      renderKatex(h, nf.formula[fi]);
    });
  }
}
