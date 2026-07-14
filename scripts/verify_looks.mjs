// Look 回归对拍:对 7 个 look preset(Standard/Arriba/Sylvan/Colorful/Aery/Dystopic/Umbra),
// 用前端 applyLookPreset 等价逻辑(DEFAULT_PARAMS + Object.assign(LOOK_PRESETS[look]))跑 CPU 内核,
// 与 Python 参考内核(scripts/gen_looks_baseline.py 生成的 public/looks_baseline.json)逐像素比对。
// 覆盖 look 参数 + contrast_high/compress_toe_cubic(Dystopic/Umbra 启用 contrast)。
import { build } from "esbuild";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;

const entry = `
import { resolveConfig, evaluateCPU } from "${join(root, "src/drt.ts")}";
import { DEFAULT_PARAMS, LOOK_PRESETS } from "${join(root, "src/params.ts")}";
export { resolveConfig, evaluateCPU, DEFAULT_PARAMS, LOOK_PRESETS };
`;

const outdir = mkdtempSync(join(tmpdir(), "drtlooks-"));
const outfile = join(outdir, "bundle.mjs");
await build({
  stdin: { contents: entry, resolveDir: root, loader: "ts" },
  bundle: true, format: "esm", platform: "node", outfile, logLevel: "warning",
});
const { resolveConfig, evaluateCPU, DEFAULT_PARAMS, LOOK_PRESETS } = await import(pathToFileURL(outfile).href);

const py = JSON.parse(readFileSync(join(root, "public/looks_baseline.json"), "utf8"));
const grid = py._grid;
const looks = ["Standard", "Arriba", "Sylvan", "Colorful", "Aery", "Dystopic", "Umbra"];

let maxErr = 0, worst = "";
for (const lk of looks) {
  // 与 Python dump 一致:ap0 输入 / rec1886(tn_su=1, display_gamut=0, eotf=2)
  const p = { ...DEFAULT_PARAMS, display: "rec1886", inGamut: "ap0", inOetf: "linear" };
  Object.assign(p, LOOK_PRESETS[lk]);
  const c = resolveConfig(p);
  const exp = py[lk];
  let lookMax = 0;
  for (let i = 0; i < grid.length; i++) {
    const out = evaluateCPU(c, grid[i]);
    for (let k = 0; k < 3; k++) {
      const e = Math.abs(out[k] - exp[i][k]);
      if (e > lookMax) lookMax = e;
      if (e > maxErr) { maxErr = e; worst = `${lk} row${i} ch${k}`; }
    }
  }
  console.log(`${lk.padEnd(10)} maxErr=${lookMax.toExponential(3)}`);
}
const ok = maxErr < 1e-9;
console.log(`\nLOOKS MAX ABS ERR = ${maxErr.toExponential(6)} ${ok ? "PASS" : "FAIL"} (worst: ${worst})`);
process.exit(ok ? 0 : 1);
