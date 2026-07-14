// 图像预览主视图:把上传的图像(或内置合成图)解码为 scene-linear,整图应用 OpenDRT。
// 源 gamut / transform curve(OETF)/ 所有 OpenDRT 参数改动都触发重绘。
//
// 【CPU 渲染】原先用 GLSL 渲染到 canvas,但 RGBA32F/RGBA16F 浮点纹理在部分真实 GPU 上
//   采样后得到全黑(swiftshader 正常、真实 GPU 黑屏)。改为复用已验证与 GLSL 内核 bit 级一致的
//   CPU evaluateCPU(回归 max abs err ~8e-7)逐像素渲染 → putImageData,跨所有 GPU/环境稳定可靠。
//   忠实性:数值完全来自 evaluateCPU;SDR 的 OETF 反解码已在 decodeSceneLinear 完成(scene-linear 输入)。
//
// 性能:整图在 MAX_VIEW 下采样后逐像素跑内核。自用调试工具,交互可接受;结果缓存按 源+OETF+参数 键。

import { resolveConfig, evaluateCPU, type ResolvedConfig } from "../drt";
import type { DrtParams } from "../params";
import { decodeSceneLinear, type LoadedSource } from "../io/loadImage";

const MAX_VIEW = 1024; // canvas 最长边(绘制像素上限);CPU 逐像素,较 GLSL 时代略降以保交互

// 缓存下采样后的 scene-linear 输入,按「源 + OETF」为键;换源/换曲线才重解码重采样。
interface LinCache {
  key: string;
  w: number;
  h: number;
  lin: Float32Array; // RGBA,scene-linear,行0=顶
}
let linCache: LinCache | null = null;

function sourceKey(src: LoadedSource, oetf: string): string {
  return `${src.name}|${src.kind}|${src.width}x${src.height}|${src.isLinear ? "lin" : oetf}`;
}

function ensureDownsampled(src: LoadedSource, oetf: string): LinCache {
  const key = sourceKey(src, oetf);
  if (linCache && linCache.key === key) return linCache;
  const full = decodeSceneLinear(src, oetf);
  const scale = Math.min(1, MAX_VIEW / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const lin = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y / h) * src.height));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x / w) * src.width));
      const di = (y * w + x) * 4;
      const si = (sy * src.width + sx) * 4;
      lin[di] = full[si];
      lin[di + 1] = full[si + 1];
      lin[di + 2] = full[si + 2];
      lin[di + 3] = 1;
    }
  }
  linCache = { key, w, h, lin };
  return linCache;
}

/**
 * CPU 渲染整图预览到 2D canvas。evaluateCPU 输出已是显示编码 [0,1](经逆 EOTF),直接 ×255。
 * pass 参数保留以兼容旧签名(现已不用 WebGL 渲染预览)。
 */
export function renderImage(
  canvas: HTMLCanvasElement,
  _pass: unknown,
  params: DrtParams,
  source: LoadedSource,
): void {
  const ds = ensureDownsampled(source, params.inOetf);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (canvas.width !== ds.w) canvas.width = ds.w;
  if (canvas.height !== ds.h) canvas.height = ds.h;

  const c: ResolvedConfig = resolveConfig(params);
  const img = ctx.createImageData(ds.w, ds.h);
  const d = img.data;
  for (let p = 0; p < ds.w * ds.h; p++) {
    const si = p * 4;
    const out = evaluateCPU(c, [ds.lin[si], ds.lin[si + 1], ds.lin[si + 2]]);
    d[si + 0] = Math.round(Math.min(Math.max(out[0], 0), 1) * 255);
    d[si + 1] = Math.round(Math.min(Math.max(out[1], 0), 1) * 255);
    d[si + 2] = Math.round(Math.min(Math.max(out[2], 0), 1) * 255);
    d[si + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** 兼容旧接口:CPU 渲染无 GPU 纹理需释放。 */
export function disposeImagePreview(_pass?: unknown): void {
  linCache = null;
}
