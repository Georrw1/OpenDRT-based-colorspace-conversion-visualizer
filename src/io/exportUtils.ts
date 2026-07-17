import JSZip from "jszip";
import { resolveConfig, evaluateCPU } from "../drt";
import type { DrtParams } from "../params";
import { decodeSceneLinear, type LoadedSource } from "./loadImage";

/**
 * [EN] Export native resolution image
 * [ZH] 导出原分辨率图像 (Native Resolution Image Export)
 * [EN] Renders the full image offscreen using CPU evaluateCPU, supporting 4K+ resolution
 * [ZH] 基于 CPU evaluateCPU 渲染全图，支持 4K+ 级别
 */
export async function exportNativeResolutionImage(
  source: LoadedSource,
  params: DrtParams,
  onProgress?: (progress: number) => void
): Promise<void> {
  const { width, height } = source;
  const lin = decodeSceneLinear(source, params.inOetf);
  const config = resolveConfig(params);

  const offscreenCanvas = document.createElement("canvas");
  offscreenCanvas.width = width;
  offscreenCanvas.height = height;
  const ctx = offscreenCanvas.getContext("2d");
  if (!ctx) throw new Error("无法创建离屏 Canvas 上下文"); // [EN] Failed to create offscreen Canvas context

  const imageData = ctx.createImageData(width, height);
  const d = imageData.data;

  // [EN] Process in chunks to prevent blocking the main thread
  // [ZH] 分片处理，防止阻塞主线程
  const totalPixels = width * height;
  let p = 0;

  return new Promise((resolve) => {
    function processChunk() {
      const startTime = performance.now();
      while (p < totalPixels) {
        const si = p * 4;
        const out = evaluateCPU(config, [lin[si], lin[si + 1], lin[si + 2]]);
        
        d[si + 0] = Math.round(Math.min(Math.max(out[0], 0), 1) * 255);
        d[si + 1] = Math.round(Math.min(Math.max(out[1], 0), 1) * 255);
        d[si + 2] = Math.round(Math.min(Math.max(out[2], 0), 1) * 255);
        d[si + 3] = 255;

        p++;
        if (p % 10000 === 0 && performance.now() - startTime > 16) {
          if (onProgress) onProgress(p / totalPixels);
          requestAnimationFrame(processChunk);
          return;
        }
      }

      ctx!.putImageData(imageData, 0, 0);
      offscreenCanvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `OpenDRT_Render_${width}x${height}.png`;
          a.click();
          URL.revokeObjectURL(url);
        }
        // [EN] Clean up offscreen resources
        // [ZH] 清理
        offscreenCanvas.width = 0;
        offscreenCanvas.height = 0;
        resolve();
      }, "image/png", 1.0);
    }
    processChunk();
  });
}

/**
 * [EN] Asynchronously compute and generate 3D LUT (.cube) in chunks
 * [ZH] 异步分片计算并生成 3D LUT (.cube)
 */
export async function generateCubeLut(
  params: DrtParams,
  size: number,
  onProgress?: (progress: number) => void
): Promise<string> {
  return new Promise((resolve) => {
    const config = resolveConfig(params);
    let cubeStr = `TITLE "OpenDRT_Web_Export"\nLUT_3D_SIZE ${size}\n\n`;
    const data: string[] = [];

    // [EN] Process in chunks to prevent blocking the main thread
    // [ZH] 分片处理，防止阻塞主线程
    let b = 0;

    function processChunk() {
      const startTime = performance.now();

      while (b < size) {
        const fb = b / (size - 1);
        for (let g = 0; g < size; g++) {
          const fg = g / (size - 1);
          for (let r = 0; r < size; r++) {
            const fr = r / (size - 1);
            const out = evaluateCPU(config, [fr, fg, fb]);
            data.push(`${out[0].toFixed(6)} ${out[1].toFixed(6)} ${out[2].toFixed(6)}`);
          }
        }
        b++;

        if (performance.now() - startTime > 16) {
          if (onProgress) onProgress(b / size);
          requestAnimationFrame(processChunk);
          return;
        }
      }

      cubeStr += data.join("\n");
      if (onProgress) onProgress(1.0);
      resolve(cubeStr);
    }

    processChunk();
  });
}

/**
 * [EN] Export 3D LUT
 * [ZH] 导出 3D LUT
 */
export async function exportCube(
  params: DrtParams,
  size: number,
  onProgress?: (progress: number) => void
): Promise<void> {
  const cubeStr = await generateCubeLut(params, size, onProgress);
  const blob = new Blob([cubeStr], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "OpenDRT_Custom.cube";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * [EN] Get OCIO 2.0 config template and inject custom content
 * [ZH] 获取 OCIO 2.0 配置模板并注入自定义内容
 */
export function getOcioConfig(customCubeName: string): string {
  return `ocio_profile_version: 2.0

search_path: ""
strictparsing: true
luma: [0.2126, 0.7152, 0.0722]

description: OpenDRT Web Custom Export - Hybrid OCIO 2.0

roles:
  color_picking: linear
  color_timing: tlog_egamut
  compositing_log: tlog_egamut
  data: non-colour data
  default: linear
  matte_paint: cineonlog_rec709
  rendering: linear
  scene_linear: linear
  texture_paint: linear
  mari_monitor: rec709_display
  mari_scalar_monitor: rec709_display
  mari_color_picker: rec709_display
  mari_working: linear
  mari_int8: srgb_encoding
  mari_int16: srgb_encoding
  mari_int_scalar: non-colour data
  mari_scalar8: non-colour data
  mari_float: linear
  reference: lin_xyz
  srgb_linear: linear
  srgb_texture: srgb_encoding
  substance_3d_painter_standard_srgb: srgb_encoding
  substance_3d_painter_bitmap_import_8bit: srgb_encoding
  substance_3d_painter_bitmap_import_16bit: srgb_encoding
  substance_3d_painter_bitmap_import_floating: linear
  substance_3d_painter_substance_material: srgb_encoding
  substance_3d_painter_bitmap_export_8bit: srgb_encoding
  substance_3d_painter_bitmap_export_16bit: srgb_encoding
  substance_3d_painter_bitmap_export_floating: linear

displays:
  default:
    - !<View> {name: Web_OpenDRT_Custom, colorspace: OpenDRT_Custom_Output}
    - !<View> {name: Display Encoding, colorspace: rec709_display}
    - !<View> {name: Log, colorspace: cineonlog_rec709}
    - !<View> {name: None, colorspace: non-colour data}

active_displays: [default]
active_views: [Web_OpenDRT_Custom, Display Encoding, Log, None]

colorspaces:
  - !<ColorSpace>
    name: linear
    family: SceneReferred
    bitdepth: 32f
    description: Linear - Rec.709 - D65
    to_reference: !<MatrixTransform> {matrix: [0.4338873456, 0.3762240091, 0.1898886453, 0.0000000000, 0.2126390059, 0.7151686788, 0.0721923154, 0.0000000000, 0.0177500401, 0.1094476209, 0.8728023391, 0.0000000000, 0.0000000000, 0.0000000000, 0.0000000000, 1.0000000000]}
    allocation: lg2
    allocationvars: [-10, 7, 0.0056065625]

  - !<ColorSpace>
    name: cineonlog_rec709
    family: SceneReferred
    bitdepth: 32f
    description: Cineon Log - Rec.709 - D65
    to_reference: !<GroupTransform>
      children:
        - !<FileTransform> {src: CineonLog_2_Linear.spi1d, interpolation: linear}
        - !<MatrixTransform> {matrix: [0.4338873456, 0.3762240091, 0.1898886453, 0.0000000000, 0.2126390059, 0.7151686788, 0.0721923154, 0.0000000000, 0.0177500401, 0.1094476209, 0.8728023391, 0.0000000000, 0.0000000000, 0.0000000000, 0.0000000000, 1.0000000000]}

  - !<ColorSpace>
    name: tlog_egamut
    family: SceneReferred
    bitdepth: 32f
    description: FilmLight - T-Log - E-Gamut - D65
    to_reference: !<GroupTransform>
      children:
        - !<FileTransform> {src: TLog_2_Linear.spi1d, interpolation: linear}
        - !<MatrixTransform> {matrix: [0.7421668170, 0.1725922514, 0.0852409316, 0.0000000000, 0.2801307241, 0.8202066415, -0.1003373656, 0.0000000000, -0.0952947734, -0.0669452625, 1.1622400359, 0.0000000000, 0.0000000000, 0.0000000000, 0.0000000000, 1.0000000000]}

  - !<ColorSpace>
    name: lin_xyz
    family: SceneReferred
    bitdepth: 32f
    description: CIE - Linear - XYZ - D65
    allocation: lg2
    allocationvars: [-10, 7, 0.0056065625]

  - !<ColorSpace>
    name: aces
    family: SceneReferred
    bitdepth: 32f
    description: ACES 2065-1 - Linear - AP0 - ACES White Point (~D60)
    to_reference: !<MatrixTransform> {matrix: [0.9875586253, -0.0060412276, 0.0184826022, 0.0000000000, 0.3380935950, 0.7272139028, -0.0653074978, 0.0000000000, 0.0006639882, 0.0007515137, 0.9985844981, 0.0000000000, 0.0000000000, 0.0000000000, 0.0000000000, 1.0000000000]}
    allocation: lg2
    allocationvars: [-10, 7, 0.0056065625]

  - !<ColorSpace>
    name: acescg
    family: SceneReferred
    bitdepth: 32f
    description: ACEScg - Linear - AP1 - ACES White Point (~D60)
    to_reference: !<MatrixTransform> {matrix: [0.6864271126, 0.1338093876, 0.1797634998, 0.0000000000, 0.2680640592, 0.6724644790, 0.0594714618, 0.0000000000, -0.0050226248, 0.0047589763, 1.0002636486, 0.0000000000, 0.0000000000, 0.0000000000, 0.0000000000, 1.0000000000]}
    allocation: lg2
    allocationvars: [-10, 7, 0.0056065625]

  - !<ColorSpace>
    name: OpenDRT_Custom_Output
    family: DisplayReferred
    bitdepth: 32f
    description: Custom OpenDRT Bake from Web UI
    isdata: false
    from_scene_reference: !<GroupTransform>
      children:
        - !<ColorSpaceTransform> {src: lin_xyz, dst: tlog_egamut}
        - !<FileTransform> {src: ${customCubeName}, interpolation: tetrahedral}

  - !<ColorSpace>
    name: non-colour data
    family: Utility
    bitdepth: 32f
    description: No operation
    isdata: true
    allocation: uniform
    allocationvars: [0, 1]

  - !<ColorSpace>
    name: srgb_encoding
    family: Utility
    bitdepth: 32f
    description: sRGB Piecewise Function - Rec.709 - D65
    from_reference: !<GroupTransform>
      children:
        - !<MatrixTransform> {matrix: [0.4338873456, 0.3762240091, 0.1898886453, 0.0000000000, 0.2126390059, 0.7151686788, 0.0721923154, 0.0000000000, 0.0177500401, 0.1094476209, 0.8728023391, 0.0000000000, 0.0000000000, 0.0000000000, 0.0000000000, 1.0000000000], direction: inverse}
        - !<FileTransform> {src: linear_to_sRGB.spi1d, interpolation: linear}
    allocation: uniform
    allocationvars: [0, 1]

  - !<ColorSpace>
    name: rec709_display
    family: Utility
    bitdepth: 32f
    description: Gamma 2.4 - Rec.709 - D65
    from_reference: !<GroupTransform>
      children:
        - !<MatrixTransform> {matrix: [0.4338873456, 0.3762240091, 0.1898886453, 0.0000000000, 0.2126390059, 0.7151686788, 0.0721923154, 0.0000000000, 0.0177500401, 0.1094476209, 0.8728023391, 0.0000000000, 0.0000000000, 0.0000000000, 0.0000000000, 1.0000000000], direction: inverse}
        - !<FileTransform> {src: linear_to_rec1886.spi1d, interpolation: linear}
    allocation: uniform
    allocationvars: [0, 1]

looks:
  - !<Look>
    name: Contrast CDL
    process_space: linear
    description: A contrast boost using a CDL transform
    transform: !<CDLTransform> {slope: [1.3, 1.3, 1.3], power: [1.2, 1.2, 1.2], sat: 1}

  - !<Look>
    name: Warmy CDL
    process_space: linear
    description: A slightly washed out and warm CDL transform
    transform: !<CDLTransform> {slope: [1.2, 1, 0.8], power: [0.9, 0.9, 0.9], sat: 1.2}
`;
}

/**
 * [EN] Export OCIO 2.0 bundle
 * [ZH] 导出 OCIO 2.0 打包
 */
export async function exportOcioBundle(
  params: DrtParams,
  size: number,
  onProgress?: (progress: number) => void
): Promise<void> {
  const cubeStr = await generateCubeLut(params, size, onProgress);
  const cubeName = "OpenDRT_Custom.cube";
  const ocioString = getOcioConfig(cubeName);

  const zip = new JSZip();
  zip.file("config.ocio", ocioString);
  zip.file(cubeName, cubeStr);

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "OpenDRT_OCIO_Package.zip";
  a.click();
  URL.revokeObjectURL(url);
}
