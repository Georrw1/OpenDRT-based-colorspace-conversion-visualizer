// float32 精度诊断:用 Math.fround 逐运算模拟 GLSL highp float(IEEE-754 单精度),
// 与 float64 参考逐节点对拍,定位误差放大节点。不改移植公式,只做数值实验。
//
// 用法:node scripts/diag_f32.mjs
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const baseline = JSON.parse(readFileSync(new URL("../public/baseline.json", import.meta.url)));

// 载入 drt.ts 的 resolveConfig 以取得与生产一致的 config/solve 常数(float64)。
const bundle = await build({
  entryPoints: [new URL("../src/drt.ts", import.meta.url).pathname],
  bundle: true, format: "esm", write: false, platform: "node",
});
const mod = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const { resolveConfig, INPUT_GAMUT_MATRICES } = mod;

const params = {
  look: baseline.config.look, display: baseline.config.display,
  inGamut: baseline.config.in_gamut, inOetf: baseline.config.in_oetf,
  tnLp: baseline.config.tn_Lp, tnLg: baseline.config.tn_Lg,
  tnCon: baseline.config.tn_con, tnSh: baseline.config.tn_sh,
};
const C = resolveConfig(params);

const SQRT3 = 1.73205080756887729353;
const PI = 3.14159265358979323846;

// 矩阵(与 GLSL const 一致,行主序)。
const M_XYZ_TO_P3D65 = [[2.49349691194142542,-0.93138361791912383,-0.402710784450716841],[-0.829488969561574696,1.76266406031834655,0.0236246858419435941],[0.0358458302437844531,-0.0761723892680418041,0.956884524007687309]];
const M_P3D65_TO_XYZ = [[0.486570948648216151,0.265667693169093,0.198217285234362467],[0.228974564069748754,0.691738521836506193,0.079286914093744984],[-4.0e-17,0.0451133818589026167,1.04394436890097575]];
const M_XYZ_TO_REC709 = [[3.24096994190452348,-1.53738317757009435,-0.498610760293003552],[-0.969243636280879506,1.87596750150771996,0.0415550574071755843],[0.0556300796969936354,-0.20397695888897649,1.05697151424287816]];

// mode: f => 恒等(float64);f => Math.fround(float32)。
function makePipeline(R) {
  // R: rounding fn. 所有算术结果与常数读入都过 R。
  const k = (x) => R(x);
  const add = (a, b) => R(a + b);
  const sub = (a, b) => R(a - b);
  const mul = (a, b) => R(a * b);
  const div = (a, b) => R(a / b);
  const sdivf = (a, b) => (b === 0 ? 0 : R(a / b));
  const pw = (a, b) => R(Math.pow(a, b));
  const spw = (a, b) => (a <= 0 ? a : R(Math.pow(a, b)));
  const sq = (x) => R(Math.sqrt(x));
  const ex = (x) => R(Math.exp(x));
  const lg = (x) => R(Math.log(x));
  const atan2 = (y, x) => R(Math.atan2(y, x));
  const mx = Math.max, mn = Math.min;
  const modp = (a, m) => sub(a, mul(m, Math.floor(R(a / m))));
  const mat = (M, v) => {
    const m = M.map((row) => row.map(R));
    return [
      add(add(mul(m[0][0], v[0]), mul(m[0][1], v[1])), mul(m[0][2], v[2])),
      add(add(mul(m[1][0], v[0]), mul(m[1][1], v[1])), mul(m[1][2], v[2])),
      add(add(mul(m[2][0], v[0]), mul(m[2][1], v[1])), mul(m[2][2], v[2])),
    ];
  };
  const ctq = (x, toe, inv) => {
    if (toe === 0) return x;
    if (inv) return div(add(x, sq(mx(0, mul(x, add(mul(k(4.0), toe), x))))), k(2.0));
    return sdivf(spw(x, k(2.0)), add(x, toe));
  };
  const chp = (x, s, p) => spw(sdivf(x, add(x, s)), p);
  const gw = (x, w) => ex(div(mul(-x, x), w));
  const hoff = (h, o) => sub(modp(add(sub(h, o), k(PI)), mul(k(2.0), k(PI))), k(PI));
  const softplus = (x, s) => {
    if (s < 1e-4) return x;
    if (x > mul(k(10.0), s)) return x;
    return mul(s, lg(mx(0, add(k(1.0), ex(div(x, s))))));
  };

  // 常数(f32 时 fround)
  const c = {};
  for (const key of ["tn_off","cwp_lm","rs_sa","rs_rw","rs_bw","pt_lml","pt_lml_r","pt_lml_g","pt_lml_b","pt_lmh","pt_lmh_r","pt_lmh_b","ptl_c","ptl_m","ptl_y","ptm_low","ptm_low_rng","ptm_low_st","ptm_high","ptm_high_rng","ptm_high_st","brl","brl_r","brl_g","brl_b","brl_rng","brl_st","brlp","brlp_r","brlp_g","brlp_b","hc_r","hc_r_rng","hs_r","hs_r_rng","hs_g","hs_g_rng","hs_b","hs_b_rng","hs_c","hs_c_rng","hs_m","hs_m_rng","hs_y","hs_y_rng","tn_toe","ts_x0","ts_s","ts_s1","ts_p","ts_m2","ts_dsc","s_Lp100"]) {
    c[key] = k(C[key]);
  }
  const cwp_norm = k(mod.cwpNorm(C.display_gamut, C.cwp));

  const trace = {};
  const rec = (name, v) => { trace[name] = Array.isArray(v) ? v.slice() : v; return v; };

  function run(input) {
    let rgb = input.map(R);
    // in_gamut -> XYZ -> P3D65
    rgb = mat(INPUT_GAMUT_MATRICES[C.in_gamut], rgb);
    rgb = mat(M_XYZ_TO_P3D65, rgb); rec("afterP3D65", rgb);
    // SatW
    const rs_w = [c.rs_rw, sub(sub(k(1.0), c.rs_rw), c.rs_bw), c.rs_bw];
    let satL = add(add(mul(rgb[0], rs_w[0]), mul(rgb[1], rs_w[1])), mul(rgb[2], rs_w[2]));
    rgb = rgb.map((v) => add(mul(satL, c.rs_sa), mul(v, sub(k(1.0), c.rs_sa))));
    // Offset
    rgb = rgb.map((v) => add(v, c.tn_off));
    // Norm
    const tsn0 = div(sq(mx(0, add(add(mul(rgb[0],rgb[0]), mul(rgb[1],rgb[1])), mul(rgb[2],rgb[2])))), k(SQRT3));
    rec("tsn0", tsn0);
    // Ratios
    rgb = [sdivf(rgb[0], tsn0), sdivf(rgb[1], tsn0), sdivf(rgb[2], tsn0)]; rec("ratios", rgb);
    // Opponent + ach
    const opp0 = sub(rgb[0], rgb[2]);
    const opp1 = sub(rgb[1], div(add(rgb[0], rgb[2]), k(2.0)));
    const ach_d_raw = div(sq(mx(0, add(mul(opp0,opp0), mul(opp1,opp1)))), k(2.0));
    const ach_d = mul(k(1.25), ctq(ach_d_raw, k(0.25), 0)); rec("ach_d", ach_d);
    // Hue
    const hue = modp(add(add(atan2(opp0, opp1), k(PI)), k(1.10714931)), mul(k(2.0), k(PI)));
    const ha_rgb = [gw(hoff(hue, k(0.1)), k(0.66)), gw(hoff(hue, k(4.3)), k(0.66)), gw(hoff(hue, k(2.3)), k(0.66))];
    const ha_rgb_hs = [gw(hoff(hue, k(-0.4)), k(0.66)), ha_rgb[1], gw(hoff(hue, k(2.5)), k(0.66))];
    const ha_cmy = [gw(hoff(hue, k(3.3)), k(0.5)), gw(hoff(hue, k(1.3)), k(0.5)), gw(hoff(hue, k(-1.15)), k(0.5))];
    let tsn = tsn0;
    // Brilliance
    {
      const brl_tsf = pw(div(tsn, add(tsn, k(1.0))), sub(k(1.0), c.brl_rng));
      const brl_exf = mul(add(add(add(c.brl, mul(c.brl_r, ha_rgb[0])), mul(c.brl_g, ha_rgb[1])), mul(c.brl_b, ha_rgb[2])), pw(ach_d, div(k(1.0), c.brl_st)));
      const brl_ex = pw(k(2.0), mul(brl_exf, (brl_exf < 0 ? brl_tsf : sub(k(1.0), brl_tsf))));
      tsn = mul(tsn, brl_ex);
    }
    rec("tsn_brl", tsn);
    // Hyperbolic
    const tsn_pt = chp(tsn, c.ts_s1, c.ts_p); rec("tsn_pt", tsn_pt);
    const tsn_const = chp(tsn, c.s_Lp100, c.ts_p); rec("tsn_const", tsn_const);
    tsn = chp(tsn, c.ts_s, c.ts_p); rec("tsn_hyp", tsn);
    // Hue Contrast R
    {
      let hc_ts = sub(k(1.0), tsn_const);
      let hc_c = add(mul(hc_ts, sub(k(1.0), ach_d)), mul(ach_d, sub(k(1.0), hc_ts)));
      hc_c = mul(mul(hc_c, ach_d), ha_rgb[0]);
      hc_ts = pw(hc_ts, div(k(1.0), c.hc_r_rng));
      const hc_f = add(mul(c.hc_r, sub(hc_c, mul(mul(k(2.0), hc_c), hc_ts))), k(1.0));
      rgb = [rgb[0], mul(rgb[1], hc_f), mul(rgb[2], hc_f)];
    }
    // Hue Shift RGB
    {
      const hs_rgb = [mul(mul(ha_rgb_hs[0], ach_d), pw(tsn_pt, div(k(1.0), c.hs_r_rng))), mul(mul(ha_rgb_hs[1], ach_d), pw(tsn_pt, div(k(1.0), c.hs_g_rng))), mul(mul(ha_rgb_hs[2], ach_d), pw(tsn_pt, div(k(1.0), c.hs_b_rng)))];
      let hsf = [mul(hs_rgb[0], c.hs_r), mul(hs_rgb[1], -c.hs_g), mul(hs_rgb[2], -c.hs_b)];
      hsf = [sub(hsf[2], hsf[1]), sub(hsf[0], hsf[2]), sub(hsf[1], hsf[0])];
      rgb = [add(rgb[0], hsf[0]), add(rgb[1], hsf[1]), add(rgb[2], hsf[2])];
    }
    // Hue Shift CMY
    {
      const compl = sub(k(1.0), tsn_pt);
      const hs_cmy = [mul(mul(ha_cmy[0], ach_d), pw(compl, div(k(1.0), c.hs_c_rng))), mul(mul(ha_cmy[1], ach_d), pw(compl, div(k(1.0), c.hs_m_rng))), mul(mul(ha_cmy[2], ach_d), pw(compl, div(k(1.0), c.hs_y_rng)))];
      let hsf = [mul(hs_cmy[0], -c.hs_c), mul(hs_cmy[1], c.hs_m), mul(hs_cmy[2], c.hs_y)];
      hsf = [sub(hsf[2], hsf[1]), sub(hsf[0], hsf[2]), sub(hsf[1], hsf[0])];
      rgb = [add(rgb[0], hsf[0]), add(rgb[1], hsf[1]), add(rgb[2], hsf[2])];
    }
    rec("ratios_shifted", rgb);
    // Purity Limit Low
    const pt_lml_p = add(k(1.0), mul(mul(k(4.0), sub(k(1.0), tsn_pt)), add(add(add(c.pt_lml, mul(c.pt_lml_r, ha_rgb_hs[0])), mul(c.pt_lml_g, ha_rgb_hs[1])), mul(c.pt_lml_b, ha_rgb_hs[2]))));
    let ptf = sub(k(1.0), pw(tsn_pt, pt_lml_p));
    // Purity Limit High
    const pt_lmh_p = mul(sub(k(1.0), mul(ach_d, add(mul(c.pt_lmh_r, ha_rgb_hs[0]), mul(c.pt_lmh_b, ha_rgb_hs[2])))), sub(k(1.0), mul(c.pt_lmh, ach_d)));
    ptf = pw(ptf, pt_lmh_p);
    // Mid purity
    {
      const ptm_low_f = add(k(1.0), mul(mul(c.ptm_low, ex(div(mul(mul(k(-2.0), ach_d), ach_d), c.ptm_low_st))), pw(sub(k(1.0), tsn_const), div(k(1.0), c.ptm_low_rng))));
      const ptm_high_f = add(k(1.0), mul(mul(c.ptm_high, ex(div(mul(mul(k(-2.0), ach_d), ach_d), c.ptm_high_st))), pw(tsn_pt, div(k(1.0), mul(k(4.0), c.ptm_high_rng)))));
      ptf = mul(mul(ptf, ptm_low_f), ptm_high_f);
    }
    rec("ptf", ptf);
    // Lerp to one
    rgb = rgb.map((v) => add(mul(v, ptf), sub(k(1.0), ptf))); rec("afterLerp", rgb);
    // Inverse render space
    satL = add(add(mul(rgb[0], rs_w[0]), mul(rgb[1], rs_w[1])), mul(rgb[2], rs_w[2]));
    rgb = rgb.map((v) => div(sub(mul(satL, c.rs_sa), v), sub(c.rs_sa, k(1.0)))); rec("afterInvRS", rgb);
    // Display gamut + creative whitepoint
    {
      let x = mat(M_P3D65_TO_XYZ, rgb);
      const cwp_neutral = x.slice();
      const cwp_f = pw(c_tsn(tsn_const), mul(k(2.0), c.cwp_lm));
      // dg=0, cwp=2 -> 无 CAT 分支;lerp 到 neutral 恒等;XYZ->REC709;归一化
      x = x.map((v, i) => add(mul(v, cwp_f), mul(cwp_neutral[i], sub(k(1.0), cwp_f))));
      x = mat(M_XYZ_TO_REC709, x);
      const nf = add(sub(mul(cwp_norm, cwp_f), cwp_f), k(1.0));
      rgb = x.map((v) => mul(v, nf));
    }
    rec("afterDisplay", rgb);
    // Post Brilliance
    {
      const bo0 = sub(rgb[0], rgb[2]);
      const bo1 = sub(rgb[1], div(add(rgb[0], rgb[2]), k(2.0)));
      let bad = div(sq(mx(0, add(mul(bo0,bo0), mul(bo1,bo1)))), k(4.0));
      bad = mul(k(1.1), div(mul(bad, bad), add(bad, k(0.1))));
      const bh = [mul(ach_d, ha_rgb[0]), mul(ach_d, ha_rgb[1]), mul(ach_d, ha_rgb[2])];
      const brlp_m = add(add(add(c.brlp, mul(c.brlp_r, bh[0])), mul(c.brlp_g, bh[1])), mul(c.brlp_b, bh[2]));
      const brlp_ex = pw(k(2.0), mul(mul(brlp_m, bad), tsn));
      rgb = rgb.map((v) => mul(v, brlp_ex));
    }
    rec("afterPostBrl", rgb);
    // Softplus
    rgb = [softplus(rgb[0], c.ptl_c), softplus(rgb[1], c.ptl_m), softplus(rgb[2], c.ptl_y)];
    rec("afterSoftplus", rgb);
    // Final tonescale
    tsn = mul(tsn, c.ts_m2);
    tsn = ctq(tsn, c.tn_toe, 0);
    tsn = mul(tsn, c.ts_dsc); rec("tsn_final", tsn);
    // Multiply back
    rgb = rgb.map((v) => mul(v, tsn)); rec("afterMul", rgb);
    // Clamp (dg=0, no rec2020)
    rgb = rgb.map((v) => mn(mx(v, 0), 1)); rec("afterClamp", rgb);
    // Inverse EOTF
    const eotf_p = add(k(2.0), mul(k(C.eotf), k(0.2)));
    rgb = rgb.map((v) => spw(v, div(k(1.0), eotf_p))); rec("afterEOTF", rgb);
    return { out: rgb, trace: { ...trace } };
  }
  function c_tsn(v) { return v; } // tsn_const 传入(已 rec)
  return run;
}

const idf = (x) => x;
const f32 = Math.fround;

const runF64 = makePipeline(idf);
const runF32 = makePipeline(f32);

function pickSample(label) { return baseline.samples.find((s) => s.label === label); }

const target = process.argv[2] || "cyan_+2st";
const s = pickSample(target);
const r64 = runF64(s.in);
const r32 = runF32(s.in);

const fmt = (v) => Array.isArray(v) ? "[" + v.map((x) => x.toExponential(6)).join(", ") + "]" : v.toExponential(6);
console.log(`=== node-by-node f32 vs f64 · ${target} · in=${JSON.stringify(s.in)} ===`);
const nodes = Object.keys(r64.trace);
for (const n of nodes) {
  const a = r64.trace[n], b = r32.trace[n];
  let d;
  if (Array.isArray(a)) d = Math.max(...a.map((x, i) => Math.abs(x - b[i])));
  else d = Math.abs(a - b);
  console.log(`${n.padEnd(16)} f64=${fmt(a)}\n${" ".repeat(16)} f32=${fmt(b)}  Δmax=${d.toExponential(3)}`);
}
console.log("\nexpected out =", JSON.stringify(s.out));
console.log("f64 out      =", fmt(r64.out));
console.log("f32 out      =", fmt(r32.out));
const errF32 = Math.max(...r32.out.map((x, i) => Math.abs(x - s.out[i])));
const errF64 = Math.max(...r64.out.map((x, i) => Math.abs(x - s.out[i])));
console.log(`f64 vs baseline max err = ${errF64.toExponential(4)}`);
console.log(`f32 vs baseline max err = ${errF32.toExponential(4)}`);

// 全量:f32 vs baseline
let worst = [];
for (const smp of baseline.samples) {
  const o = runF32(smp.in).out;
  const e = Math.max(...o.map((x, i) => Math.abs(x - smp.out[i])));
  worst.push({ label: smp.label, e, o, exp: smp.out });
}
worst.sort((a, b) => b.e - a.e);
console.log(`\n=== f32 emulation vs baseline (all ${baseline.samples.length}) ===`);
console.log(`MAX ABS ERR = ${worst[0].e.toExponential(4)}`);
for (const w of worst.slice(0, 8)) console.log(`  ${w.label.padEnd(14)} err=${w.e.toExponential(3)}  out=[${w.o.map((x)=>x.toFixed(6)).join(", ")}] exp=[${w.exp.map((x)=>x.toFixed(6)).join(", ")}]`);
