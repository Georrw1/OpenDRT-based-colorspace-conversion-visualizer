// 入口:图像为主角。侧栏 = 上传 → 源色彩空间 → OpenDRT;主视图 = 图像预览 / CIE 色度图 / 曲线 / DAG 流程图。
// 回归校验页降级:仅通过页脚「开发者 / 回归校验」链接或 URL #regression 打开。
// 参数对象为单一真源;上传的源(或默认合成图)驱动图像预览与 CIE 散点重绘。
//
// 阶段4新增:图像预览上的像素探针(hover/click 取像素 → decodeSceneLinear → evaluateCPUTrace),
// 探针像素驱动「曲线」与「流程图(DAG)」两个新 tab。

import { DEFAULT_PARAMS, type DrtParams } from "./params";
import { buildSourcePanel, buildOpenDrtPanel } from "./panel";
import type { RenderQuality } from "./renderQuality";
import { setLang, getLang, t, updateDomTranslations } from "./locales/i18n";
import { createGLContext, type GLContext } from "./gl/context";
import { FullscreenPass } from "./gl/fullscreenPass";
import { renderRegression } from "./views/regression";
import { renderCie, type CieScatterMode } from "./views/ciePlot";
import { renderImage } from "./views/imagePreview";
import { renderCurves } from "./views/curves";
import { renderDag, renderDagInfoPanel, hitTestNode, computeProbeTrace, renderNodeImage, DAG_IMG_MAX, type DagState } from "./views/dagFlow";
import { loadImageFile, syntheticSource, decodeSceneLinear, type LoadedSource } from "./io/loadImage";
import { updateGamut3d, resizeGamut3d, gamut3dLegendHtml, type G3dMode } from "./views/gamut3d";
import { exportNativeResolutionImage, exportCube, exportOcioBundle } from "./io/exportUtils";

type Tab = "image" | "cie" | "regression" | "curves" | "dag" | "gamut3d";

const params: DrtParams = { ...DEFAULT_PARAMS };
let activeTab: Tab = "image";
let source: LoadedSource = syntheticSource();
let cieMode: CieScatterMode = "shift";
let ciePtw = false;

// 像素探针状态:选中的源图像素坐标(源图坐标系,行0=顶)与对应 scene-linear RGB。
// 未选中时为 null,曲线/DAG 视图会回退到默认中灰 0.18。
let probePixel: { x: number; y: number; rgb: [number, number, number] } | null = null;
const dagState: DagState = { hoverIndex: null, selectedIndex: null };

const sourceRoot = document.getElementById("panel-source")!;
const opendrtRoot = document.getElementById("panel-opendrt")!;
const regDiv = document.getElementById("view-regression")!;
const cieCanvas = document.getElementById("view-cie") as HTMLCanvasElement;
const imageWrap = document.getElementById("image-wrap")!;
const glCanvas = document.getElementById("view-image") as HTMLCanvasElement;
const probeOverlay = document.getElementById("probe-overlay") as HTMLCanvasElement;
const curvesViewDiv = document.getElementById("view-curves")!;
const curvesCanvas = document.getElementById("curves-canvas") as HTMLCanvasElement;
const dagViewDiv = document.getElementById("view-dag")!;
const dagCanvas = document.getElementById("dag-canvas") as HTMLCanvasElement;
const dagImage = document.getElementById("dag-image") as HTMLCanvasElement;
const dagInfo = document.getElementById("dag-info")!;
const gamut3dViewDiv = document.getElementById("view-gamut3d")!;
const gamut3dCanvas = document.getElementById("gamut3d-canvas") as HTMLCanvasElement;
const g3dLegend = document.getElementById("g3d-legend")!;
const g3dControls = document.getElementById("g3d-controls")!;
const g3dModeSel = document.getElementById("g3d-mode") as HTMLSelectElement;
const g3dHullChk = document.getElementById("g3d-hull") as HTMLInputElement;
const g3dPtwChk = document.getElementById("g3d-ptw") as HTMLInputElement;
let g3dMode: G3dMode = "both";
const errBox = document.getElementById("errbox")!;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const imgInfo = document.getElementById("img-info")!;
const probeInfo = document.getElementById("probe-info")!;
const cieControls = document.getElementById("cie-controls")!;
const cieModeSel = document.getElementById("cie-mode") as HTMLSelectElement;
const ciePtwChk = document.getElementById("cie-ptw") as HTMLInputElement;
const curvesControls = document.getElementById("curves-controls")!;
const curvesModeSel = document.getElementById("curves-mode") as HTMLSelectElement;
let curvesMode: any = "tonescale_purity";
const imageControls = document.getElementById("image-controls")!;
const exportImgBtn = document.getElementById("export-img-btn") as HTMLButtonElement;
const lutSizeSel = document.getElementById("lut-size-sel") as HTMLSelectElement;
const exportCubeBtn = document.getElementById("export-cube-btn") as HTMLButtonElement;
const exportOcioBtn = document.getElementById("export-ocio-btn") as HTMLButtonElement;
const devLink = document.getElementById("dev-link")!;

let glctx: GLContext | null = null;
let pass: FullscreenPass | null = null;
let glError = "";

// 图像预览改为 CPU 渲染(2D canvas),GLSL 仅用于回归的离屏浮点读回(runToFloat)。
// 故 WebGL 上下文建在一个隐藏的离屏 canvas 上,不再占用可见的 #view-image。
try {
  const glOffscreen = document.createElement("canvas");
  glOffscreen.width = 256;
  glOffscreen.height = 1;
  glctx = createGLContext(glOffscreen);
  if (!glctx.floatRenderable) {
    glError = "警告:EXT_color_buffer_float 不可用,回归浮点读回可能失败。";
  }
  pass = new FullscreenPass(glctx.gl);
} catch (e) {
  glError = `WebGL 初始化失败(仅影响回归页):${(e as Error).message}`;
}

function updateImgInfo() {
  const kindLabel = source.kind === "exr" ? t("img.info.exr") : source.kind === "sdr" ? t("img.info.sdr") : "";
  const name = source.kind === "synthetic" ? t("img.info.synthetic" as any) || "Synthetic Image" : source.name;
  imgInfo.textContent = kindLabel
    ? `${name} · ${source.width}×${source.height} · ${kindLabel}`
    : `${name} · ${source.width}×${source.height}`;
}

function updateProbeInfo() {
  if (!probePixel) {
    probeInfo.textContent = t("probe.unselected");
  } else {
    const { x, y, rgb } = probePixel;
    probeInfo.textContent = t("probe.selected", x, y, `${rgb[0].toFixed(4)}, ${rgb[1].toFixed(4)}, ${rgb[2].toFixed(4)}`);
  }
}

function showTab(tab: Tab) {
  activeTab = tab;
  regDiv.style.display = tab === "regression" ? "block" : "none";
  cieCanvas.style.display = tab === "cie" ? "block" : "none";
  imageWrap.style.display = tab === "image" ? "inline-block" : "none";
  curvesViewDiv.style.display = tab === "curves" ? "flex" : "none";
  dagViewDiv.style.display = tab === "dag" ? "flex" : "none";
  gamut3dViewDiv.style.display = tab === "gamut3d" ? "flex" : "none";
  cieControls.style.display = tab === "cie" ? "inline" : "none";
  curvesControls.style.display = tab === "curves" ? "inline" : "none";
  g3dControls.style.display = tab === "gamut3d" ? "inline" : "none";
  imageControls.style.display = tab === "image" ? "inline" : "none";
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  }
  rerender();
}

/** 在探针 overlay 上画十字准星(canvas 显示坐标系,与 glCanvas 尺寸一致)。 */
function drawCrosshair(dispX: number, dispY: number) {
  const octx = probeOverlay.getContext("2d");
  if (!octx) return;
  octx.clearRect(0, 0, probeOverlay.width, probeOverlay.height);
  octx.strokeStyle = "#ffd23c";
  octx.lineWidth = 1.5;
  const r = 9;
  octx.beginPath();
  octx.moveTo(dispX - r, dispY); octx.lineTo(dispX + r, dispY);
  octx.moveTo(dispX, dispY - r); octx.lineTo(dispX, dispY + r);
  octx.stroke();
  octx.strokeStyle = "rgba(255,210,60,0.5)";
  octx.beginPath();
  octx.arc(dispX, dispY, r + 3, 0, Math.PI * 2);
  octx.stroke();
}

function clearCrosshair() {
  const octx = probeOverlay.getContext("2d");
  if (!octx) return;
  octx.clearRect(0, 0, probeOverlay.width, probeOverlay.height);
}

/** 把鼠标在 glCanvas 上的显示坐标映射为源图像素坐标,取出该像素的 scene-linear RGB。 */
function pickPixelAt(dispX: number, dispY: number): { x: number; y: number; rgb: [number, number, number] } | null {
  if (glCanvas.width <= 0 || glCanvas.height <= 0) return null;
  const rect = glCanvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  // dispX/dispY 已是相对于 glCanvas 左上角、drawingBuffer 像素坐标系(见事件处理里的换算)。
  const u = dispX / glCanvas.width;
  const v = dispY / glCanvas.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  // 源图坐标:数据行0=顶,与显示方向一致(不需要额外翻转 —— 显示已是正立)。
  const sx = Math.min(source.width - 1, Math.max(0, Math.floor(u * source.width)));
  const sy = Math.min(source.height - 1, Math.max(0, Math.floor(v * source.height)));
  const lin = decodeSceneLinear(source, params.inOetf);
  const i = (sy * source.width + sx) * 4;
  const rgb: [number, number, number] = [lin[i], lin[i + 1], lin[i + 2]];
  return { x: sx, y: sy, rgb };
}

function syncProbeOverlaySize() {
  probeOverlay.width = glCanvas.width;
  probeOverlay.height = glCanvas.height;
}

// 「整图中间态」用的降采样 scene-linear 缓存(按 源+OETF 缓存,避免每次点节点都重解码/重采样)。
let dagImgCache: { key: string; w: number; h: number; lin: Float32Array } | null = null;
function getDagDownsampled(): { w: number; h: number; lin: Float32Array } {
  const key = `${source.name}|${source.kind}|${source.width}x${source.height}|${params.inOetf}`;
  if (dagImgCache && dagImgCache.key === key) return dagImgCache;
  const full = decodeSceneLinear(source, params.inOetf);
  const scale = Math.min(1, DAG_IMG_MAX / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const lin = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(source.height - 1, Math.floor((y / h) * source.height));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(source.width - 1, Math.floor((x / w) * source.width));
      const di = (y * w + x) * 4;
      const si = (sy * source.width + sx) * 4;
      lin[di] = full[si]; lin[di + 1] = full[si + 1]; lin[di + 2] = full[si + 2]; lin[di + 3] = 1;
    }
  }
  dagImgCache = { key, w, h, lin };
  return dagImgCache;
}

function rerenderDag(quality: RenderQuality = "final") {
  const trace = computeProbeTrace(params, probePixel?.rgb);
  const totalH = renderDag(dagCanvas, trace, dagState);
  if (dagCanvas.height !== totalH) dagCanvas.height = totalH;
  // 高度变化后需要再画一次(canvas resize 会清空内容)。
  renderDag(dagCanvas, trace, dagState);
  const idx = dagState.selectedIndex ?? dagState.hoverIndex;
  renderDagInfoPanel(dagInfo, trace, idx, probePixel?.rgb ?? null);
  // The 25-stage whole-image trace is intentionally deferred until release.
  // During drag the graph/probe still updates, but the ~200ms image pass does not
  // block pointer feedback on the main thread.
  if (quality === "final") {
    const ds = getDagDownsampled();
    renderNodeImage(dagImage, ds.lin, ds.w, ds.h, params, idx);
  }
}

function rerender(quality: RenderQuality = "final") {
  // glError 仅与回归页相关(GLSL 只用于回归);其他页不因 WebGL 初始化警告而报错。
  const showErr = glError && activeTab === "regression";
  errBox.textContent = showErr ? glError : "";
  errBox.style.display = showErr ? "block" : "none";
  if (activeTab === "regression") {
    if (!pass) { regDiv.innerHTML = `<p class="fail">${glError || "WebGL 不可用"}</p>`; return; }
    void renderRegression(regDiv, pass);
  } else if (activeTab === "cie") {
    renderCie(cieCanvas, params, source, { mode: cieMode, showPtw: ciePtw });
  } else if (activeTab === "curves") {
    renderCurves(curvesCanvas, params, curvesMode, probePixel);
  } else if (activeTab === "dag") {
    rerenderDag(quality);
  } else if (activeTab === "gamut3d") {
    rerenderGamut3d();
  } else {
    renderImage(glCanvas, pass, params, source, quality);
    syncProbeOverlaySize();
    if (probePixel) {
      const dispX = ((probePixel.x + 0.5) / source.width) * glCanvas.width;
      const dispY = ((probePixel.y + 0.5) / source.height) * glCanvas.height;
      drawCrosshair(dispX, dispY);
    } else {
      clearCrosshair();
    }
  }
}

// Range inputs can emit far more often than the display refresh rate. Merge all
// changes in the same frame; a final request always supersedes interactive work.
let renderFrame: number | null = null;
let pendingQuality: RenderQuality | null = null;
function requestRerender(quality: RenderQuality = "final") {
  if (quality === "final" || pendingQuality === null) pendingQuality = quality;
  if (renderFrame !== null) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    const nextQuality = pendingQuality ?? "final";
    pendingQuality = null;
    rerender(nextQuality);
  });
}

buildSourcePanel(sourceRoot, params, requestRerender);
// 选 look / tonescale preset 会改所有滑块值，需重建面板 DOM 以反映新值。
function rebuildOpenDrtPanel(): void {
  buildOpenDrtPanel(opendrtRoot, params, requestRerender, rebuildOpenDrtPanel);
}
rebuildOpenDrtPanel();
updateImgInfo();
updateProbeInfo();

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  imgInfo.textContent = t("img.decoding", file.name);
  try {
    source = await loadImageFile(file);
    probePixel = null;
    updateImgInfo();
    updateProbeInfo();
    if (activeTab === "regression") showTab("image");
    else rerender();
  } catch (e) {
    imgInfo.textContent = `解码失败:${(e as Error).message}`;
  }
});

cieModeSel.addEventListener("change", () => {
  cieMode = cieModeSel.value as CieScatterMode;
  if (activeTab === "cie") rerender();
});

curvesModeSel.addEventListener("change", () => {
  curvesMode = curvesModeSel.value;
  if (activeTab === "curves") rerender();
});

// 3D 色域:复用「整图中间态」的降采样缓存做点云采样源(scene-linear,输入色域)。
function rerenderGamut3d() {
  const ds = getDagDownsampled();
  updateGamut3d(gamut3dCanvas, params, ds.lin, probePixel?.rgb ?? null, {
    mode: g3dMode,
    showHull: g3dHullChk.checked,
    showPtw: g3dPtwChk.checked,
  });
  g3dLegend.innerHTML = gamut3dLegendHtml(g3dMode, probePixel?.rgb ?? null);
}

g3dModeSel.addEventListener("change", () => {
  g3dMode = g3dModeSel.value as G3dMode;
  if (activeTab === "gamut3d") rerender();
});
g3dHullChk.addEventListener("change", () => { if (activeTab === "gamut3d") rerender(); });
g3dPtwChk.addEventListener("change", () => { if (activeTab === "gamut3d") rerender(); });
window.addEventListener("resize", () => { if (activeTab === "gamut3d") resizeGamut3d(gamut3dCanvas); });

ciePtwChk.addEventListener("change", () => {
  ciePtw = ciePtwChk.checked;
  if (activeTab === "cie") rerender();
});

// ---- 图像预览像素探针:hover 显示准星,click 锁定探针像素(驱动曲线/DAG)。----
function eventToCanvasPx(ev: MouseEvent): { x: number; y: number } {
  const rect = glCanvas.getBoundingClientRect();
  const cx = ((ev.clientX - rect.left) / rect.width) * glCanvas.width;
  const cy = ((ev.clientY - rect.top) / rect.height) * glCanvas.height;
  return { x: cx, y: cy };
}

glCanvas.addEventListener("mousemove", (ev) => {
  if (activeTab !== "image") return;
  const { x, y } = eventToCanvasPx(ev);
  drawCrosshair(x, y);
});

glCanvas.addEventListener("mouseleave", () => {
  if (activeTab !== "image") return;
  if (probePixel) {
    const dispX = ((probePixel.x + 0.5) / source.width) * glCanvas.width;
    const dispY = ((probePixel.y + 0.5) / source.height) * glCanvas.height;
    drawCrosshair(dispX, dispY);
  } else {
    clearCrosshair();
  }
});

glCanvas.addEventListener("click", (ev) => {
  if (activeTab !== "image") return;
  const { x, y } = eventToCanvasPx(ev);
  const picked = pickPixelAt(x, y);
  if (picked) {
    probePixel = picked;
    updateProbeInfo();
    drawCrosshair(x, y);
  }
});

// ---- DAG 节点 hover / click 交互 ----
function dagEventToLocal(ev: MouseEvent): { x: number; y: number } {
  const rect = dagCanvas.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

dagCanvas.addEventListener("mousemove", (ev) => {
  const { x, y } = dagEventToLocal(ev);
  const idx = hitTestNode(y, x);
  if (idx !== dagState.hoverIndex) {
    dagState.hoverIndex = idx;
    if (activeTab === "dag") rerenderDag();
  }
});

dagCanvas.addEventListener("mouseleave", () => {
  dagState.hoverIndex = null;
  if (activeTab === "dag") rerenderDag();
});

dagCanvas.addEventListener("click", (ev) => {
  const { x, y } = dagEventToLocal(ev);
  const idx = hitTestNode(y, x);
  dagState.selectedIndex = idx;
  if (activeTab === "dag") rerenderDag();
});

for (const btn of document.querySelectorAll<HTMLButtonElement>(".tab")) {
  btn.addEventListener("click", () => showTab(btn.dataset.tab as Tab));
}

// 导出功能
exportImgBtn.addEventListener("click", async () => {
  exportImgBtn.textContent = t("image.exporting");
  exportImgBtn.disabled = true;
  try {
    await exportNativeResolutionImage(source, params, (p) => {
      exportImgBtn.textContent = `${t("image.exporting")} ${Math.round(p * 100)}%`;
    });
  } catch (e) {
    alert(`${t("image.export_fail")}${(e as Error).message}`);
  }
  exportImgBtn.textContent = t("image.export");
  exportImgBtn.disabled = false;
});

exportCubeBtn.addEventListener("click", async () => {
  const size = parseInt(lutSizeSel.value, 10);
  exportCubeBtn.textContent = t("export.generating_lut");
  exportCubeBtn.disabled = true;
  await exportCube(params, size, (p) => {
    exportCubeBtn.textContent = `${t("export.generating_lut")} ${Math.round(p * 100)}%`;
  });
  exportCubeBtn.textContent = t("sidebar.export_cube");
  exportCubeBtn.disabled = false;
});

exportOcioBtn.addEventListener("click", async () => {
  const size = parseInt(lutSizeSel.value, 10);
  exportOcioBtn.textContent = t("export.packing_ocio");
  exportOcioBtn.disabled = true;
  await exportOcioBundle(params, size, (p) => {
    exportOcioBtn.textContent = `${t("export.packing_ocio")} ${Math.round(p * 100)}%`;
  });
  exportOcioBtn.textContent = t("sidebar.export_ocio");
  exportOcioBtn.disabled = false;
});

const langBtn = document.getElementById("lang-btn")!;

function rerenderAllComponents() {
  if (pass) {
    void renderRegression(regDiv, pass);
  }
  renderImage(glCanvas, pass, params, source, "final");
  renderCie(cieCanvas, params, source, { mode: cieMode, showPtw: ciePtw });
  renderCurves(curvesCanvas, params, curvesMode, probePixel);
  rerenderDag();
  rerenderGamut3d();
}

langBtn.addEventListener("click", () => {
  setLang(getLang() === 'en' ? 'zh' : 'en');
  updateProbeInfo();
  updateImgInfo();
  rerenderAllComponents();
});

// Initialize translation on startup
updateDomTranslations();

devLink.addEventListener("click", () => {
  location.hash = "regression";
  showTab("regression");
});

if (location.hash === "#regression") showTab("regression");
else showTab("image");
