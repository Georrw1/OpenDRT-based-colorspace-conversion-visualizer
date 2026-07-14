// 回归校验页:读 baseline.json,把 119 个 in 打包成纹理喂 GLSL,读回输出与 out 逐点比对。
// max err < 1e-4 → 绿色 PASS,否则红色 FAIL 并列出最差 10 个点。
//
// 回归固定使用 baseline.config(Standard/rec1886/egamut2/linear),不随面板改变,
// 以确保测试的是基准所对应的 config。

import type { FullscreenPass } from "../gl/fullscreenPass";
import { resolveConfig, glUniformValues } from "../drt";
import { DEFAULT_PARAMS, type DrtParams } from "../params";

interface Sample { label: string; in: number[]; out: number[]; }
interface Baseline { config: any; count: number; samples: Sample[]; }

let cached: Baseline | null = null;

async function loadBaseline(): Promise<Baseline> {
  if (cached) return cached;
  const res = await fetch("./baseline.json");
  if (!res.ok) throw new Error(`加载 baseline.json 失败:${res.status}`);
  cached = (await res.json()) as Baseline;
  return cached;
}

function paramsFromBaselineConfig(cfg: any): DrtParams {
  // 以 DEFAULT_PARAMS 为基底(全字段),再用 baseline 配置覆盖已知项。
  // 纯透传后 baseline 只提供这几项,其余默认值==STANDARD,回归不受影响。
  return {
    ...DEFAULT_PARAMS,
    look: cfg.look,
    display: cfg.display,
    inGamut: cfg.in_gamut,
    inOetf: cfg.in_oetf,
    tnLp: cfg.tn_Lp,
    tnLg: cfg.tn_Lg,
    tnCon: cfg.tn_con,
    tnSh: cfg.tn_sh,
  };
}

export async function renderRegression(container: HTMLElement, pass: FullscreenPass): Promise<void> {
  container.innerHTML = '<p class="note">运行回归中…</p>';
  let baseline: Baseline;
  try {
    baseline = await loadBaseline();
  } catch (e) {
    container.innerHTML = `<p class="fail">${(e as Error).message}</p>`;
    return;
  }

  const n = baseline.count;
  const data = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const s = baseline.samples[i];
    data[i * 4 + 0] = s.in[0];
    data[i * 4 + 1] = s.in[1];
    data[i * 4 + 2] = s.in[2];
    data[i * 4 + 3] = 1.0;
  }

  const params = paramsFromBaselineConfig(baseline.config);
  const u = glUniformValues(resolveConfig(params));

  let out: Float32Array;
  try {
    const tex = pass.createFloatTexture(n, 1, data, false); // 回归需 RGBA32F 精确输入
    out = pass.runToFloat(tex, n, 1, u);
  } catch (e) {
    container.innerHTML = `<p class="fail">GLSL 执行失败:${(e as Error).message}</p>`;
    return;
  }

  interface Row { label: string; inp: number[]; expected: number[]; actual: number[]; err: number; }
  const rows: Row[] = [];
  let maxErr = 0;
  for (let i = 0; i < n; i++) {
    const s = baseline.samples[i];
    const actual = [out[i * 4], out[i * 4 + 1], out[i * 4 + 2]];
    const err = Math.max(
      Math.abs(actual[0] - s.out[0]),
      Math.abs(actual[1] - s.out[1]),
      Math.abs(actual[2] - s.out[2]),
    );
    if (err > maxErr) maxErr = err;
    rows.push({ label: s.label, inp: s.in, expected: s.out, actual, err });
  }

  const pass_ = maxErr < 1e-4;
  const worst = [...rows].sort((a, b) => b.err - a.err).slice(0, 10);

  const fmt = (v: number[]) => v.map((x) => x.toFixed(5)).join(", ");
  const banner = `<div class="banner ${pass_ ? "pass" : "fail"}">`
    + `${pass_ ? "PASS" : "FAIL"} · max abs err = ${maxErr.toExponential(4)} `
    + `(阈值 1e-4) · config=${baseline.config.look}/${baseline.config.display}/`
    + `${baseline.config.in_gamut}/${baseline.config.in_oetf}</div>`;

  const worstTable = `<h3>最差 10 个采样点</h3><table><thead><tr>`
    + `<th>label</th><th>in</th><th>expected</th><th>actual</th><th>abs err</th></tr></thead><tbody>`
    + worst.map((r) =>
      `<tr class="${r.err < 1e-4 ? "" : "fail"}"><td>${r.label}</td><td>${fmt(r.inp)}</td>`
      + `<td>${fmt(r.expected)}</td><td>${fmt(r.actual)}</td><td>${r.err.toExponential(3)}</td></tr>`,
    ).join("")
    + `</tbody></table>`;

  const fullTable = `<h3>全部 ${n} 个采样点</h3><table><thead><tr>`
    + `<th>label</th><th>in</th><th>expected</th><th>actual</th><th>abs err</th></tr></thead><tbody>`
    + rows.map((r) =>
      `<tr class="${r.err < 1e-4 ? "" : "fail"}"><td>${r.label}</td><td>${fmt(r.inp)}</td>`
      + `<td>${fmt(r.expected)}</td><td>${fmt(r.actual)}</td><td>${r.err.toExponential(3)}</td></tr>`,
    ).join("")
    + `</tbody></table>`;

  container.innerHTML = banner + worstTable + fullTable;
}
