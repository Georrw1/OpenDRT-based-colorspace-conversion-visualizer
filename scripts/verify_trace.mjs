// 阶段4 4-A 验收脚本:验证 evaluateCPUTrace 的终点 rgb 与 evaluateCPU 返回值逐分量完全相等。
// 用法: node scripts/verify_trace.mjs (需先 npx tsc 或用 tsx 直接跑 ts;这里用 esbuild-register 风格简单方案:
// 直接调用编译后的 dist 不方便,改用 ts-node 不在依赖里,故用 vite-node 风格 —— 实际用 node + esm loader 太复杂,
// 简化为:用 npx tsx 执行(若无 tsx 则用 node --loader）。见下方实际实现。
import { resolveConfig, evaluateCPU, evaluateCPUTrace } from "../src/drt.ts";
import { DEFAULT_PARAMS } from "../src/params.ts";

function randIn(min, max) { return min + Math.random() * (max - min); }

function approxEqualArr(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const params = { ...DEFAULT_PARAMS };
const c = resolveConfig(params);

const testInputs = [
  [0.18, 0.18, 0.18],
  [0.0, 0.0, 0.0],
  [1.0, 0.5, 0.2],
  [2.5, 0.01, 0.9],
];
for (let i = 0; i < 20; i++) {
  testInputs.push([randIn(0, 4), randIn(0, 4), randIn(0, 4)]);
}

let allPass = true;
for (const input of testInputs) {
  const direct = evaluateCPU(c, input);
  const trace = evaluateCPUTrace(c, input);
  const last = trace[trace.length - 1];
  const eq = approxEqualArr(direct, last.rgb);
  if (!eq) {
    allPass = false;
    console.log(`FAIL input=${JSON.stringify(input)} direct=${JSON.stringify(direct)} trace末=${JSON.stringify(last.rgb)}`);
  }
  // 也检查 step 数量应为 25
  if (trace.length !== 25) {
    allPass = false;
    console.log(`FAIL step数量 = ${trace.length},应为25`);
  }
}

console.log(allPass ? "PASS: 所有测试输入 trace终点 === evaluateCPU,且节点数=25" : "存在FAIL,见上");
process.exit(allPass ? 0 : 1);
