// 图像上传 + 解码为 scene-linear RGBA float。
//
// SDR(PNG/JPG):画到离屏 canvas → getImageData 取 8bit [0,1] 编码值 → 按所选 Input OETF
//   用内核 linearize() 的移植(drt.ts linearizeScalar)反解码回 scene-linear。
// EXR(scene-linear HDR):parse-exr(three EXRLoader 的独立版,纯 JS + fflate)解出 Float32 RGBA,
//   已是线性,不做曲线反解;仍按所选 Input Gamut 走矩阵(在 GLSL / CIE 里做)。
// 无图:回退内置合成测试图(曝光渐变 × 色相条),空状态也能演示。
//
// 忠实性:OETF 反解码复用内核定义(linearizeScalar),不另写一套曲线。

import parseExr from "parse-exr";
import { linearizeScalar } from "../drt";
import { IN_OETFS } from "../params";

const FloatType = 1015; // parse-exr:请求 Float32Array(而非 HalfFloat)

export type SourceKind = "sdr" | "exr" | "synthetic";

// 上传后缓存的“原始源”。SDR 保存编码域 [0,1](随 OETF 变化重解码);EXR 直接线性。
export interface LoadedSource {
  width: number;
  height: number;
  encoded: Float32Array; // RGBA,length = w*h*4。SDR: [0,1] 编码;EXR/合成: scene-linear
  isLinear: boolean;     // true → decodeSceneLinear 跳过 OETF 反解
  name: string;
  kind: SourceKind;
}

const MAX_DIM = 2048; // 纹理最长边上限,保证 GPU 性能与 CPU 解码耗时可控

/** 把源解码为 scene-linear RGBA float(供 GLSL 纹理 / CIE 散点)。 */
export function decodeSceneLinear(src: LoadedSource, oetf: string): Float32Array {
  const n = src.width * src.height * 4;
  const out = new Float32Array(n);
  if (src.isLinear) {
    out.set(src.encoded.subarray(0, n));
    return out;
  }
  const tf = IN_OETFS.indexOf(oetf as (typeof IN_OETFS)[number]);
  for (let i = 0; i < n; i += 4) {
    out[i + 0] = linearizeScalar(src.encoded[i + 0], tf);
    out[i + 1] = linearizeScalar(src.encoded[i + 1], tf);
    out[i + 2] = linearizeScalar(src.encoded[i + 2], tf);
    out[i + 3] = 1.0;
  }
  return out;
}

/** 主入口:根据文件后缀/类型分派 SDR 或 EXR 解码。 */
export async function loadImageFile(file: File): Promise<LoadedSource> {
  const isExr = /\.exr$/i.test(file.name) || file.type === "image/x-exr";
  if (isExr) return loadExr(file);
  return loadSdr(file);
}

async function loadSdr(file: File): Promise<LoadedSource> {
  const bitmap = await createImageBitmap(file);
  let w = bitmap.width;
  let h = bitmap.height;
  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法创建 2D 上下文用于图像解码");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const img = ctx.getImageData(0, 0, w, h);

  const encoded = new Float32Array(w * h * 4);
  for (let i = 0; i < encoded.length; i++) encoded[i] = img.data[i] / 255;

  return { width: w, height: h, encoded, isLinear: false, name: file.name, kind: "sdr" };
}

async function loadExr(file: File): Promise<LoadedSource> {
  const buffer = await file.arrayBuffer();
  const exr = parseExr(buffer, FloatType);
  const srcData = exr.data as Float32Array;
  const rgba = exr.format === 1023; // 1023 = RGBA,1028 = 单通道 Red
  const stride = rgba ? 4 : 1;

  let w = exr.width;
  let h = exr.height;
  // 下采样(整数步长)以控制纹理尺寸。
  const step = Math.max(1, Math.ceil(Math.max(w, h) / MAX_DIM));
  const ow = Math.ceil(w / step);
  const oh = Math.ceil(h / step);
  const encoded = new Float32Array(ow * oh * 4);
  let o = 0;
  // parse-exr(沿用 three EXRLoader)输出为 GL 纹理朝向(行0=底部)。本工具所有
  //   源统一约定「行0=视觉顶部」(SDR 经 drawImage 即如此),供 2D canvas putImageData /
  //   探针坐标 / CIE 一致使用。故此处对 EXR 做垂直翻转:读源行 (h-1-y)。
  for (let y = 0; y < h; y += step) {
    const srcY = h - 1 - y;
    for (let x = 0; x < w; x += step) {
      const si = (srcY * w + x) * stride;
      if (rgba) {
        encoded[o + 0] = srcData[si + 0];
        encoded[o + 1] = srcData[si + 1];
        encoded[o + 2] = srcData[si + 2];
      } else {
        const v = srcData[si];
        encoded[o + 0] = v;
        encoded[o + 1] = v;
        encoded[o + 2] = v;
      }
      encoded[o + 3] = 1.0;
      o += 4;
    }
  }
  return { width: ow, height: oh, encoded, isLinear: true, name: file.name, kind: "exr" };
}

// ---- 内置合成测试图(scene-linear):曝光渐变 × 色相条。空状态默认。 ----
const SYN_W = 640;
const SYN_H = 360;
const SYN_BARS: Array<[number, number, number]> = [
  [1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 0],
];

export function syntheticSource(): LoadedSource {
  const data = new Float32Array(SYN_W * SYN_H * 4);
  const nBars = SYN_BARS.length;
  for (let y = 0; y < SYN_H; y++) {
    const bar = SYN_BARS[Math.min(nBars - 1, Math.floor((y / SYN_H) * nBars))];
    for (let x = 0; x < SYN_W; x++) {
      const st = (x / (SYN_W - 1)) * 14 - 7; // -7..+7 档
      const e = 0.18 * Math.pow(2, st);
      const i = (y * SYN_W + x) * 4;
      data[i + 0] = bar[0] * e;
      data[i + 1] = bar[1] * e;
      data[i + 2] = bar[2] * e;
      data[i + 3] = 1.0;
    }
  }
  return { width: SYN_W, height: SYN_H, encoded: data, isLinear: true, name: "合成测试图", kind: "synthetic" };
}
