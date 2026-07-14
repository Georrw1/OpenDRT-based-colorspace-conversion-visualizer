// 回归对拍:用 CPU 参考(src/drt.ts,与 GLSL 逐节点等价)跑 baseline.json 的 119 个输入,
// 与 Python 内核 out 比对。esbuild 打包 TS -> 临时 ESM -> 动态 import。
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;

const entry = `
import { resolveConfig, evaluateCPU } from "${join(root, "src/drt.ts")}";
import { DEFAULT_PARAMS } from "${join(root, "src/params.ts")}";
export { resolveConfig, evaluateCPU, DEFAULT_PARAMS };
`;

const outdir = mkdtempSync(join(tmpdir(), "drtverify-"));
const outfile = join(outdir, "bundle.mjs");
await build({
  stdin: { contents: entry, resolveDir: root, loader: "ts" },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
  logLevel: "warning",
});

const { resolveConfig, evaluateCPU, DEFAULT_PARAMS } = await import(pathToFileURL(outfile).href);

const baseline = JSON.parse(readFileSync(join(root, "public/baseline.json"), "utf8"));
const cfg = baseline.config;

// baseline config -> DrtParams(以 DEFAULT_PARAMS 为全字段基底,避免 partial 导致 undefined 清掉 STANDARD)
const params = {
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

const resolved = resolveConfig(params);

let maxErr = 0;
const rows = [];
for (const s of baseline.samples) {
  const out = evaluateCPU(resolved, s.in);
  const err = Math.max(
    Math.abs(out[0] - s.out[0]),
    Math.abs(out[1] - s.out[1]),
    Math.abs(out[2] - s.out[2]),
  );
  if (Number.isNaN(err)) maxErr = Infinity; // NaN 视为失败,不得静默通过
  else if (err > maxErr) maxErr = err;
  rows.push({ label: s.label, err, actual: out, expected: s.out });
}

rows.sort((a, b) => b.err - a.err);
console.log("resolved solve constants:", {
  ts_x0: resolved.ts_x0, ts_s: resolved.ts_s, ts_s1: resolved.ts_s1,
  ts_p: resolved.ts_p, ts_m2: resolved.ts_m2, ts_dsc: resolved.ts_dsc, s_Lp100: resolved.s_Lp100,
});
console.log("\nWorst 10 samples:");
for (const r of rows.slice(0, 10)) {
  console.log(
    `  ${r.label.padEnd(14)} err=${r.err.toExponential(3)}  ` +
    `act=[${r.actual.map((v) => v.toFixed(6)).join(",")}]  ` +
    `exp=[${r.expected.map((v) => v.toFixed(6)).join(",")}]`
  );
}
console.log("\nMAX ABS ERR =", maxErr.toExponential(6), maxErr < 1e-4 ? "PASS" : "FAIL");
process.exit(maxErr < 1e-4 ? 0 : 1);
