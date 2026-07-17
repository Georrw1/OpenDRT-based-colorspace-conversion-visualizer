// 3D 色域体积视图(Three.js)。
// 目标(用户需求):在 RGB 立方体里同时看到——
//   ① 图像像素点云:clip 模式(原始 scene-linear 硬钳到 [0,1],高光撞墙成硬块)
//                    vs tonemap 模式(过完 OpenDRT,高光沿曲线柔和收拢)。
//   ② 色域线框(gamut hull):单位立方体 = 显示 [0,1] 边界;并标注 R/G/B 轴。
//   ③ path to white:探针像素经 evaluateCPUTrace 各步在立方体中的移动折线,终点趋白。
//
// 【忠实性】所有坐标数值来自内核:clip 点=decodeSceneLinear 后原值钳制;
//   tonemap 点=evaluateCPU(display 输出);轨迹=evaluateCPUTrace 逐节点 RGB。
//   本文件只做「取内核数值 → 摆进 3D 场景」的可视化,不改任何算法。

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { resolveConfig, evaluateCPU, evaluateCPUTrace, TRACE_NODE_INFO, type ResolvedConfig } from "../drt";
import type { DrtParams } from "../params";
import { t } from "../locales/i18n";


export type G3dMode = "both" | "clip" | "tonemap" | "raw";

export interface Gamut3dOptions {
  mode: G3dMode;
  showHull: boolean;
  showPtw: boolean;
}

// 后期节点(已在显示编码域)直接用;早/中期在线性/渲染空间,加显示 gamma 便于同一立方体观察。
// 与 dagFlow.renderNodeImage 采用同一约定:inverse_eotf(最后一个,索引 24)之后视为已编码。
const EOTF_DONE_FROM = 24;
const DISPLAY_GAMMA = 1 / 2.4;

// path to white 轨迹从哪个节点开始画(前 4 个是 scene-linear/XYZ,不是 RGB)。
// 从 render_desaturate(index 4)起,均在 P3 渲染/显示空间。
const PTW_START = 4;
// 比值(ratio)域节点:index 7(ratios)~20(final_tonescale)的 rgb 是归一化方向,
// 亮度单独存在标量 tsn 里。重构真实颜色 = ratio × tsn
// (已验证 ratio×tsn 逐位等于内核的 multiply_back 输出,属于忠实重组,非自编)。
const RATIO_DOMAIN_START = 7;   // ratios
const RATIO_DOMAIN_END = 20;    // final_tonescale (之后 multiply_back 已乘回)

function toViewable(rgb: [number, number, number], nodeIndex: number): [number, number, number] {
  const enc = nodeIndex >= EOTF_DONE_FROM;
  const f = (v: number) => {
    let x = Math.max(0, v);
    if (!enc) x = Math.pow(x, DISPLAY_GAMMA); // 线性→显示 gamma,仅为观察
    return Math.min(1, x);
  };
  return [f(rgb[0]), f(rgb[1]), f(rgb[2])];
}

// ---- 场景状态(单例,tab 切换时复用) ----
interface Scene3d {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  clipPoints: THREE.Points | null;
  tonePoints: THREE.Points | null;
  rawPoints: THREE.Points | null;
  ptwLine: THREE.Line | null;
  ptwStart: THREE.Mesh | null;
  ptwEnd: THREE.Mesh | null;
  raf: number | null;
  disposed: boolean;
}

let S: Scene3d | null = null;

/** 初始化(仅一次):建 renderer/scene/camera/controls + 立方体线框 + 坐标轴。 */
function ensureScene(canvas: HTMLCanvasElement): Scene3d {
  if (S && !S.disposed) return S;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setClearColor(0x08080a, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
  camera.position.set(2.1, 1.8, 2.4);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0.5, 0.5, 0.5); // 立方体中心

  // 单位立方体线框(显示 [0,1] 边界 = gamut hull)
  const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
  const edges = new THREE.EdgesGeometry(cubeGeo);
  const cubeLines = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x555560 }),
  );
  cubeLines.position.set(0.5, 0.5, 0.5);
  scene.add(cubeLines);

  // 坐标轴:R=红(x)、G=绿(y)、B=蓝(z),从原点画粗一点的彩色线
  const axis = (dir: THREE.Vector3, color: number) => {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), dir]);
    scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color })));
  };
  axis(new THREE.Vector3(1.15, 0, 0), 0xff4444); // R
  axis(new THREE.Vector3(0, 1.15, 0), 0x44ff44); // G
  axis(new THREE.Vector3(0, 0, 1.15), 0x4488ff); // B

  // 轴标签(sprite)
  const label = (text: string, pos: THREE.Vector3, color: string) => {
    const cv = document.createElement("canvas");
    cv.width = 64; cv.height = 64;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = color; ctx.font = "bold 44px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, 32, 34);
    const tex = new THREE.CanvasTexture(cv);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sp.position.copy(pos);
    sp.scale.set(0.16, 0.16, 0.16);
    scene.add(sp);
  };
  label("R", new THREE.Vector3(1.28, 0, 0), "#ff6666");
  label("G", new THREE.Vector3(0, 1.28, 0), "#66ff66");
  label("B", new THREE.Vector3(0, 0, 1.28), "#66aaff");
  // 白点角标(1,1,1)
  const whiteDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.02, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  whiteDot.position.set(1, 1, 1);
  scene.add(whiteDot);

  S = {
    renderer, scene, camera, controls,
    clipPoints: null, tonePoints: null, rawPoints: null, ptwLine: null, ptwStart: null, ptwEnd: null,
    raf: null, disposed: false,
  };

  const animate = () => {
    if (!S || S.disposed) return;
    S.controls.update();
    S.renderer.render(S.scene, S.camera);
    S.raf = requestAnimationFrame(animate);
  };
  S.raf = requestAnimationFrame(animate);

  return S;
}

/** 按当前 canvas 显示尺寸设置 renderer/相机像素比。 */
export function resizeGamut3d(canvas: HTMLCanvasElement): void {
  if (!S || S.disposed) return;
  const w = canvas.clientWidth || 800;
  const h = canvas.clientHeight || 560;
  S.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  S.renderer.setSize(w, h, false);
  S.camera.aspect = w / h;
  S.camera.updateProjectionMatrix();
}

function disposeObj(obj: THREE.Object3D | null): void {
  if (!obj || !S) return;
  S.scene.remove(obj);
  const anyObj = obj as any;
  if (anyObj.geometry) anyObj.geometry.dispose();
  if (anyObj.material) {
    if (Array.isArray(anyObj.material)) anyObj.material.forEach((m: any) => m.dispose());
    else anyObj.material.dispose();
  }
}

// 从源图(scene-linear RGBA float)均匀采样最多 maxPts 个像素索引。
function sampleIndices(pixelCount: number, maxPts: number): number[] {
  if (pixelCount <= maxPts) {
    const all: number[] = [];
    for (let i = 0; i < pixelCount; i++) all.push(i);
    return all;
  }
  const step = pixelCount / maxPts;
  const idx: number[] = [];
  for (let k = 0; k < maxPts; k++) idx.push(Math.floor(k * step));
  return idx;
}

const MAX_POINTS = 12000;

/**
 * 更新点云 + path to white。
 * @param linear scene-linear RGBA(长度 w*h*4),来自 decodeSceneLinear(输入色域)。
 * @param probeInput 探针像素的 scene-linear RGB;null 时 path to white 用中灰 0.18。
 */
export function updateGamut3d(
  canvas: HTMLCanvasElement,
  params: DrtParams,
  linear: Float32Array,
  probeInput: [number, number, number] | null,
  opts: Gamut3dOptions,
): void {
  const s = ensureScene(canvas);
  resizeGamut3d(canvas);

  const cfg: ResolvedConfig = resolveConfig(params);
  const pixelCount = Math.floor(linear.length / 4);
  const indices = sampleIndices(pixelCount, MAX_POINTS);
  const n = indices.length;

  // ---- clip 点云:原始 scene-linear 直接钳到 [0,1](不经 tonemap) ----
  disposeObj(s.clipPoints); s.clipPoints = null;
  if (opts.mode === "clip" || opts.mode === "both") {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const p = indices[k] * 4;
      const r = Math.min(1, Math.max(0, linear[p]));
      const g = Math.min(1, Math.max(0, linear[p + 1]));
      const b = Math.min(1, Math.max(0, linear[p + 2]));
      pos[k * 3] = r; pos[k * 3 + 1] = g; pos[k * 3 + 2] = b;
      // 点颜色用显示 gamma 后的自身色,便于肉眼辨认
      col[k * 3] = Math.pow(r, DISPLAY_GAMMA);
      col[k * 3 + 1] = Math.pow(g, DISPLAY_GAMMA);
      col[k * 3 + 2] = Math.pow(b, DISPLAY_GAMMA);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: opts.mode === "both" ? 0.008 : 0.010,
      vertexColors: true, transparent: true, opacity: opts.mode === "both" ? 0.45 : 0.85,
    });
    s.clipPoints = new THREE.Points(geo, mat);
    s.scene.add(s.clipPoints);
  }

  // ---- tonemap 点云:过完 OpenDRT 的显示输出(display RGB, 已在 [0,1]) ----
  disposeObj(s.tonePoints); s.tonePoints = null;
  if (opts.mode === "tonemap" || opts.mode === "both") {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const p = indices[k] * 4;
      const out = evaluateCPU(cfg, [linear[p], linear[p + 1], linear[p + 2]]);
      const r = Math.min(1, Math.max(0, out[0]));
      const g = Math.min(1, Math.max(0, out[1]));
      const b = Math.min(1, Math.max(0, out[2]));
      pos[k * 3] = r; pos[k * 3 + 1] = g; pos[k * 3 + 2] = b;
      col[k * 3] = r; col[k * 3 + 1] = g; col[k * 3 + 2] = b; // 已是显示编码色
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: opts.mode === "both" ? 0.010 : 0.010,
      vertexColors: true, transparent: true, opacity: 0.9,
    });
    s.tonePoints = new THREE.Points(geo, mat);
    s.scene.add(s.tonePoints);
  }

  // ---- raw 点云:原始 scene-linear 不钳不压,点可伸出立方体外(真实延伸) ----
  disposeObj(s.rawPoints); s.rawPoints = null;
  if (opts.mode === "raw") {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    // 真正不钳不压:位置直接用原始 scene-linear 值(可任意 >1),
    // 超亮点能飞多远飞多远。不做任何位置钳制——之前的 RAW_POS_CAP
    // 把超亮点铉在 4.0 平面上,反而造成一面“直角墙”,那本身就是一种 clip,
    // 违背了 raw 的本意。现已彻底去除。
    for (let k = 0; k < n; k++) {
      const p = indices[k] * 4;
      const lr = Math.max(0, linear[p]);
      const lg = Math.max(0, linear[p + 1]);
      const lb = Math.max(0, linear[p + 2]);
      pos[k * 3] = lr;
      pos[k * 3 + 1] = lg;
      pos[k * 3 + 2] = lb;
      // 颜色用钳到[0,1]+显示 gamma 的自身色,便于辨认(仅颜色钳,位置不钳)
      col[k * 3] = Math.pow(Math.min(1, lr), DISPLAY_GAMMA);
      col[k * 3 + 1] = Math.pow(Math.min(1, lg), DISPLAY_GAMMA);
      col[k * 3 + 2] = Math.pow(Math.min(1, lb), DISPLAY_GAMMA);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.010, vertexColors: true, transparent: true, opacity: 0.85,
    });
    s.rawPoints = new THREE.Points(geo, mat);
    s.scene.add(s.rawPoints);
  }

  // ---- path to white:探针经各节点的移动折线 ----
  disposeObj(s.ptwLine); s.ptwLine = null;
  disposeObj(s.ptwStart); s.ptwStart = null;
  disposeObj(s.ptwEnd); s.ptwEnd = null;
  if (opts.showPtw) {
    const input = probeInput ?? [0.18, 0.18, 0.18];
    const trace = evaluateCPUTrace(cfg, input);
    // 只画渲染空间内的节点(index>=PTW_START):前 4 个是 scene-linear/XYZ,
    // 不是 RGB,硬塞进立方体会乱跳。从 render_desaturate(index 4)起,
    // 都在 P3 渲染/显示空间,同一坐标系可比,轨迹才连贯弯曲。
    const pts: THREE.Vector3[] = [];
    let runTsn = 1; // 运行中的亮度标量(各节点记录时更新,未记录则沿用)
    for (let i = PTW_START; i < trace.length; i++) {
      const st = trace[i];
      // norm 节点记录 tsn0(压缩前亮度),作为比值域初始亮度;
      // 后续 brilliance/hyperbolic/final_tonescale 记录 tsn(压缩中/后亮度)依次更新。
      if (st.scalars && typeof st.scalars.tsn0 === "number") runTsn = st.scalars.tsn0;
      if (st.scalars && typeof st.scalars.tsn === "number") runTsn = st.scalars.tsn;
      let rgb = st.rgb;
      // 比值域节点:rgb 是归一化方向,乘回运行亮度得到真实颜色(忠实重组)。
      if (i >= RATIO_DOMAIN_START && i <= RATIO_DOMAIN_END) {
        rgb = [st.rgb[0] * runTsn, st.rgb[1] * runTsn, st.rgb[2] * runTsn];
      }
      const v = toViewable(rgb, i);
      pts.push(new THREE.Vector3(v[0], v[1], v[2]));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    s.ptwLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffcc33 }));
    s.scene.add(s.ptwLine);
    // 起点(输入,青)/ 终点(输出,橙)标记球
    const mkDot = (v: THREE.Vector3, color: number) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 12, 12),
        new THREE.MeshBasicMaterial({ color }),
      );
      m.position.copy(v);
      return m;
    };
    if (pts.length) {
      s.ptwStart = mkDot(pts[0], 0x33ddff);
      s.ptwEnd = mkDot(pts[pts.length - 1], 0xff8833);
      s.scene.add(s.ptwStart);
      s.scene.add(s.ptwEnd);
    }
  }

  // 立方体线框显隐
  // (线框始终有意义,这里让开关控制它。找到 cubeLines 不方便,改为整体透明度控制:
  //  简单起见,线框恒显——若需隐藏,通过 opts.showHull 控制其 visible。)
  s.scene.traverse((o) => {
    if (o instanceof THREE.LineSegments) o.visible = opts.showHull;
  });
}

/** 图例 HTML(说明各元素含义)。 */
export function gamut3dLegendHtml(mode: G3dMode, probeInput: [number, number, number] | null): string {
  const parts: string[] = [t("g3d.legend.title")];
  parts.push(`<div><span class="sw" style="background:#555560"></span>${t("g3d.legend.hull_desc")}</div>`);
  parts.push(`<div><span class="sw" style="background:#ff4444"></span>${t("g3d.legend.axis")}</div>`);
  if (mode === "clip" || mode === "both") {
    parts.push(`<div style="margin-top:6px"><span class="sw" style="background:#888"></span>${t("g3d.legend.clip_desc")}</div>`);
  }
  if (mode === "tonemap" || mode === "both") {
    parts.push(`<div><span class="sw" style="background:#ccc"></span>${t("g3d.legend.tonemap_desc")}</div>`);
  }
  if (mode === "raw") {
    parts.push(`<div style="margin-top:6px"><span class="sw" style="background:#aaa"></span>${t("g3d.legend.raw_desc")}</div>`);
  }
  parts.push(`<div style="margin-top:6px"><span class="sw" style="background:#ffcc33"></span>${t("g3d.legend.ptw_desc")}</div>`);
  parts.push(`<div><span class="sw" style="background:#33ddff"></span>${t("g3d.legend.ptw_start_end")}</div>`);
  const probeStr = probeInput
    ? `${probeInput[0].toFixed(4)}, ${probeInput[1].toFixed(4)}, ${probeInput[2].toFixed(4)}`
    : t("dag.default_probe");
  const ptwCount = TRACE_NODE_INFO.length - 4; // 只画渲染空间节点(跳过前4个)
  parts.push(`<div class="hint">${t("g3d.legend.ptw")} ${probeStr}<br>${t("g3d.legend.hint1", ptwCount)}<br><br>${t("g3d.legend.hint2")}<br>${t("g3d.legend.hint3")}</div>`);
  return parts.join("");
}
