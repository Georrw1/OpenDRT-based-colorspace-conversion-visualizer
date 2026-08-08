// CPU OpenDRT image rendering off the UI thread. The main thread keeps at most
// one request in flight and replaces its queued request with the newest params.

import { evaluateCPU, resolveConfig } from "../drt";
import type { DrtParams } from "../params";
import type { RenderQuality } from "../renderQuality";

interface SourceLevel {
  width: number;
  height: number;
  linear: Float32Array;
}

interface SetSourceMessage {
  type: "source";
  sourceId: number;
  full: SourceLevel;
  interactive: SourceLevel;
}

interface RenderMessage {
  type: "render";
  requestId: number;
  sourceId: number;
  quality: RenderQuality;
  params: DrtParams;
  recycle?: ArrayBuffer;
}

type WorkerRequest = SetSourceMessage | RenderMessage;

interface RenderResult {
  type: "result";
  requestId: number;
  sourceId: number;
  quality: RenderQuality;
  width: number;
  height: number;
  durationMs: number;
  pixels: ArrayBuffer;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: RenderResult, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
let activeSourceId = -1;
let full: SourceLevel | null = null;
let interactive: SourceLevel | null = null;

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "source") {
    activeSourceId = message.sourceId;
    full = message.full;
    interactive = message.interactive;
    return;
  }

  if (message.sourceId !== activeSourceId || !full || !interactive) return;

  const started = performance.now();
  const level = message.quality === "interactive" ? interactive : full;
  const byteLength = level.width * level.height * 4;
  const pixels = message.recycle?.byteLength === byteLength
    ? new Uint8ClampedArray(message.recycle)
    : new Uint8ClampedArray(byteLength);
  const config = resolveConfig(message.params);

  for (let p = 0; p < level.width * level.height; p++) {
    const i = p * 4;
    const out = evaluateCPU(config, [level.linear[i], level.linear[i + 1], level.linear[i + 2]]);
    pixels[i] = Math.round(Math.min(Math.max(out[0], 0), 1) * 255);
    pixels[i + 1] = Math.round(Math.min(Math.max(out[1], 0), 1) * 255);
    pixels[i + 2] = Math.round(Math.min(Math.max(out[2], 0), 1) * 255);
    pixels[i + 3] = 255;
  }

  const result: RenderResult = {
    type: "result",
    requestId: message.requestId,
    sourceId: message.sourceId,
    quality: message.quality,
    width: level.width,
    height: level.height,
    durationMs: performance.now() - started,
    pixels: pixels.buffer,
  };
  scope.postMessage(result, [pixels.buffer]);
};
