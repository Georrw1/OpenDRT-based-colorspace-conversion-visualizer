// Image preview: CPU OpenDRT evaluation runs in a module worker so range input
// does not wait for the full-image transform. Dragging uses a smaller source;
// pointer/keyboard release requests full quality. Only newest queued params run.

import type { DrtParams } from "../params";
import type { RenderQuality } from "../renderQuality";
import { decodeSceneLinear, type LoadedSource } from "../io/loadImage";
import { evaluateCPU, resolveConfig } from "../drt";

const FULL_MAX_VIEW = 1024;
const INTERACTIVE_MAX_VIEW = 256;

interface LinearLevel {
  width: number;
  height: number;
  linear: Float32Array;
}

interface SourceCache {
  source: LoadedSource;
  oetf: string;
  sourceId: number;
  fullWidth: number;
  fullHeight: number;
}

interface QueuedRender {
  requestId: number;
  sourceId: number;
  quality: RenderQuality;
  params: DrtParams;
  source: LoadedSource;
  canvas: HTMLCanvasElement;
}

interface WorkerResult {
  type: "result";
  requestId: number;
  sourceId: number;
  quality: RenderQuality;
  width: number;
  height: number;
  durationMs: number;
  pixels: ArrayBuffer;
}

let worker: Worker | null = null;
let workerFailed = false;
let sourceCache: SourceCache | null = null;
let sourceSequence = 0;
let requestSequence = 0;
let latestRequestId = 0;
let inFlight = false;
let activeRequest: QueuedRender | null = null;
let queuedRequest: QueuedRender | null = null;
let recycledPixels: ArrayBuffer | undefined;
let stagingCanvas: HTMLCanvasElement | null = null;

function downsample(
  linear: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  maxView: number,
  forceCopy = false,
): LinearLevel {
  const scale = Math.min(1, maxView / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  if (width === sourceWidth && height === sourceHeight) {
    return { width, height, linear: forceCopy ? new Float32Array(linear) : linear };
  }

  const output = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y / height) * sourceHeight));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x / width) * sourceWidth));
      const dst = (y * width + x) * 4;
      const src = (sourceY * sourceWidth + sourceX) * 4;
      output[dst] = linear[src];
      output[dst + 1] = linear[src + 1];
      output[dst + 2] = linear[src + 2];
      output[dst + 3] = 1;
    }
  }
  return { width, height, linear: output };
}

function ensureWorker(): Worker | null {
  if (workerFailed) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("../workers/imagePreview.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = handleWorkerMessage;
    worker.onerror = handleWorkerError;
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

function ensureSource(source: LoadedSource, oetf: string): SourceCache {
  if (sourceCache?.source === source && sourceCache.oetf === oetf) return sourceCache;

  const decoded = decodeSceneLinear(source, oetf);
  const full = downsample(decoded, source.width, source.height, FULL_MAX_VIEW);
  // Always allocate an independent buffer because both levels are transferred.
  const interactive = downsample(
    full.linear,
    full.width,
    full.height,
    INTERACTIVE_MAX_VIEW,
    true,
  );
  const sourceId = ++sourceSequence;

  const activeWorker = ensureWorker();
  if (activeWorker) {
    activeWorker.postMessage({
      type: "source",
      sourceId,
      full,
      interactive,
    }, [full.linear.buffer, interactive.linear.buffer]);
  }

  sourceCache = {
    source,
    oetf,
    sourceId,
    fullWidth: full.width,
    fullHeight: full.height,
  };
  return sourceCache;
}

function commitResult(
  request: QueuedRender,
  result: WorkerResult,
  backend = "worker",
): void {
  const canvas = request.canvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (!stagingCanvas) stagingCanvas = document.createElement("canvas");
  stagingCanvas.width = result.width;
  stagingCanvas.height = result.height;
  const stagingContext = stagingCanvas.getContext("2d");
  if (!stagingContext) return;

  const pixels = new Uint8ClampedArray(result.pixels);
  stagingContext.putImageData(new ImageData(pixels, result.width, result.height), 0, 0);
  ctx.imageSmoothingEnabled = result.quality === "interactive";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(stagingCanvas, 0, 0, canvas.width, canvas.height);

  canvas.dataset.renderBackend = backend;
  canvas.dataset.renderQuality = result.quality;
  canvas.dataset.workerMs = result.durationMs.toFixed(2);
  canvas.dataset.renderedRequestId = String(result.requestId);
  canvas.dispatchEvent(new CustomEvent("opendrt-preview-rendered", {
    detail: {
      backend,
      quality: result.quality,
      workerMs: result.durationMs,
      requestId: result.requestId,
    },
  }));
}

function handleWorkerMessage(event: MessageEvent<WorkerResult>): void {
  const result = event.data;
  const request = activeRequest;
  inFlight = false;
  activeRequest = null;

  if (
    request
    && result.requestId === latestRequestId
    && result.requestId === request.requestId
    && result.sourceId === sourceCache?.sourceId
  ) {
    commitResult(request, result);
  }

  // putImageData/drawImage copied the pixels, so the buffer can be recycled by
  // the next worker job instead of allocating a fresh output on every update.
  recycledPixels = result.pixels;
  dispatchQueued();
}

function handleWorkerError(): void {
  workerFailed = true;
  worker?.terminate();
  worker = null;
  inFlight = false;
  const fallback = queuedRequest ?? activeRequest;
  activeRequest = null;
  queuedRequest = null;
  recycledPixels = undefined;
  if (fallback && fallback.requestId === latestRequestId) renderOnMainThread(fallback);
}

function renderOnMainThread(request: QueuedRender): void {
  const decoded = decodeSceneLinear(request.source, request.params.inOetf);
  const maxView = request.quality === "interactive" ? INTERACTIVE_MAX_VIEW : FULL_MAX_VIEW;
  const level = downsample(decoded, request.source.width, request.source.height, maxView);
  const started = performance.now();
  const pixels = new Uint8ClampedArray(level.width * level.height * 4);
  const config = resolveConfig(request.params);
  for (let p = 0; p < level.width * level.height; p++) {
    const i = p * 4;
    const out = evaluateCPU(config, [level.linear[i], level.linear[i + 1], level.linear[i + 2]]);
    pixels[i] = Math.round(Math.min(Math.max(out[0], 0), 1) * 255);
    pixels[i + 1] = Math.round(Math.min(Math.max(out[1], 0), 1) * 255);
    pixels[i + 2] = Math.round(Math.min(Math.max(out[2], 0), 1) * 255);
    pixels[i + 3] = 255;
  }
  const result: WorkerResult = {
    type: "result",
    requestId: request.requestId,
    sourceId: request.sourceId,
    quality: request.quality,
    width: level.width,
    height: level.height,
    durationMs: performance.now() - started,
    pixels: pixels.buffer,
  };
  commitResult(request, result, "main-thread-fallback");
}

function dispatchQueued(): void {
  if (inFlight || !queuedRequest) return;
  const request = queuedRequest;
  queuedRequest = null;
  const activeWorker = ensureWorker();
  if (!activeWorker) {
    renderOnMainThread(request);
    return;
  }

  inFlight = true;
  activeRequest = request;
  const message = {
    type: "render",
    requestId: request.requestId,
    sourceId: request.sourceId,
    quality: request.quality,
    params: request.params,
    recycle: recycledPixels,
  };
  const transfer = recycledPixels ? [recycledPixels] : [];
  recycledPixels = undefined;
  activeWorker.postMessage(message, transfer);
}

/**
 * Queue an asynchronous preview. Repeated calls replace the queued work with
 * the newest params; at most one stale worker job can be running.
 */
export function renderImage(
  canvas: HTMLCanvasElement,
  _pass: unknown,
  params: DrtParams,
  source: LoadedSource,
  quality: RenderQuality = "final",
): void {
  const cached = ensureSource(source, params.inOetf);
  if (canvas.width !== cached.fullWidth) canvas.width = cached.fullWidth;
  if (canvas.height !== cached.fullHeight) canvas.height = cached.fullHeight;

  const requestId = ++requestSequence;
  latestRequestId = requestId;
  queuedRequest = {
    requestId,
    sourceId: cached.sourceId,
    quality,
    params: { ...params },
    source,
    canvas,
  };
  canvas.dataset.requestedQuality = quality;
  canvas.dataset.requestedRequestId = String(requestId);
  dispatchQueued();
}

export function disposeImagePreview(_pass?: unknown): void {
  worker?.terminate();
  worker = null;
  workerFailed = false;
  sourceCache = null;
  activeRequest = null;
  queuedRequest = null;
  recycledPixels = undefined;
  inFlight = false;
}
