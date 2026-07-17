// [EN] OpenDRT v1.1.0 - Parameter parsing / constant solving / uniform building / CPU reference implementation.
// [ZH] OpenDRT v1.1.0 —— 参数解析 / 求解常数 / uniform 构建 / CPU 参考实现。
//
// [EN] Faithfully ported from opendrt_v110.py. Matrix constants are directly copied, formulas and control flow preserved.
// [ZH] 忠实移植自 opendrt_v110.py。矩阵常数直接复制,公式与控制流原样保留。
// [EN] CPU reference (evaluateCPU) and GLSL kernel (opendrt.frag) are node-for-node equivalent for regression testing.
// [ZH] CPU 参考(evaluateCPU)与 GLSL 内核(opendrt.frag)逐节点等价,用于回归对拍。
//
// [EN] This configuration supports standard looks + rec1886 + egamut2 + linear inputs.
// [ZH] 本步支持 config = Standard look + rec1886 + egamut2 + linear(baseline.json)。
// [EN] Other enum fields retain their structure, panels can toggle in_gamut/display.
// [ZH] 其余枚举字段保留结构,面板可切换 in_gamut/display(cwp 固定 Standard=2)。

import type { DrtParams } from "./params";
import { DISPLAY_ENCODING, IN_OETFS } from "./params";

export const SQRT3 = 1.73205080756887729353;
export const PI = 3.14159265358979323846;

// ---- [EN] Input gamut -> XYZ D65 Matrix (row-major, vdot = M @ v). Directly copied from kernel ----
// ---- [ZH] 输入 gamut -> XYZ D65 矩阵(行主序,vdot = M @ v)。直接复制自内核 ----
// [EN] Used for CPU reference; passed as column-major uniform to GLSL side (see gamutMatrixColMajor).
// [ZH] 用于 CPU 参考;GLSL 侧以 column-major uniform 传入(见 gamutMatrixColMajor)。
type Mat3 = number[][]; // 3 行 x 3 列

export const INPUT_GAMUT_MATRICES: Record<string, Mat3 | null> = {
  xyz: null,
  ap0: [[0.938630948750273197, -0.00574192055037397141, 0.017566898851772296], [0.338093594922021567, 0.72721390281143572, -0.0653074977334571899], [0.000723121511341165988, 0.000818441849244731985, 1.08751618739929268]],
  ap1: [[0.652418717671912951, 0.127179925537538263, 0.170857283842220459], [0.268064059194271287, 0.672464478992617742, 0.0594714618131108388], [-0.0054699285104975676, 0.00518279997697511721, 1.08934487929340107]],
  p3d65: [[0.486570948648216151, 0.265667693169093, 0.198217285234362467], [0.228974564069748754, 0.691738521836506193, 0.079286914093744984], [-4.0e-17, 0.0451133818589026167, 1.04394436890097575]],
  rec2020: [[0.636958048301290991, 0.144616903586208406, 0.168880975164172054], [0.26270021201126692, 0.677998071518871148, 0.0593017164698619384], [4.9999999999999999e-17, 0.0280726930490874452, 1.06098505771079066]],
  rec709: [[0.412390799265959229, 0.357584339383878125, 0.180480788401834347], [0.212639005871510217, 0.71516867876775625, 0.0721923153607337414], [0.0193308187155918181, 0.119194779794626018, 0.950532152249661033]],
  awg3: [[0.638007619284, 0.214703856337, 0.097744451431], [0.291953779, 0.823841041511, -0.11579482051], [0.002798279032, -0.067034235689, 1.15329370742]],
  awg4: [[0.704858320407231953, 0.129760295170463003, 0.115837311473976537], [0.254524176404026969, 0.781477732712002049, -0.0360019091160290391], [0.0, 0.0, 1.08905775075987843]],
  rwg: [[0.735275245905858799, 0.0686094106139610721, 0.14657127053185201], [0.286694099499934962, 0.842979134016975662, -0.129673233516910319], [-0.0796808568783676785, -0.347343216994429771, 1.51608182463267593]],
  sgamut3: [[0.706482713192318812, 0.12880104979055762, 0.115172164068795255], [0.270979670813492168, 0.786606411220905466, -0.0575860820343976273], [-0.00967784538619615754, 0.00460003749251991934, 1.09413555865355483]],
  sgamut3cine: [[0.599083920758327171, 0.248925516115423628, 0.102446490177920776], [0.215075820115587457, 0.88506850174372842, -0.100144321859315821], [-0.0320658495445057951, -0.0276583906794915374, 1.1487819909838759]],
  vgamut: [[0.679644469878, 0.15221141244, 0.118600044733], [0.26068555009, 0.77489446333, -0.03558001342], [-0.009310198218, -0.004612467044, 1.10298041602]],
  egamut: [[0.705396850087770755, 0.164041328309919021, 0.0810177486539819941], [0.280130724091105898, 0.820206641549595106, -0.100337365640700782], [-0.103781511569163279, -0.0729072570266306313, 1.26574651935567273]],
  egamut2: [[0.736477700183697404, 0.130739651086660136, 0.0832385757813140781], [0.275069984405959256, 0.828017790215514138, -0.103087774621473588], [-0.124225154247852534, -0.0871597673911067433, 1.30044267239883782]],
  davinciwg: [[0.700622392093671609, 0.148774815123196763, 0.101058719834803246], [0.274118510906649016, 0.873631895940436665, -0.147750406847085763], [-0.0989629128832311411, -0.137895325075543307, 1.32591598871865268]],
};

const M_XYZ_TO_P3D65: Mat3 = [[2.49349691194142542, -0.93138361791912383, -0.402710784450716841], [-0.829488969561574696, 1.76266406031834655, 0.0236246858419435941], [0.0358458302437844531, -0.0761723892680418041, 0.956884524007687309]];
const M_P3D65_TO_XYZ: Mat3 = [[0.486570948648216151, 0.265667693169093, 0.198217285234362467], [0.228974564069748754, 0.691738521836506193, 0.079286914093744984], [-4.0e-17, 0.0451133818589026167, 1.04394436890097575]];
const M_XYZ_TO_REC709: Mat3 = [[3.24096994190452348, -1.53738317757009435, -0.498610760293003552], [-0.969243636280879506, 1.87596750150771996, 0.0415550574071755843], [0.0556300796969936354, -0.20397695888897649, 1.05697151424287816]];
const M_XYZ_TO_P3D65b: Mat3 = M_XYZ_TO_P3D65;
const M_CAT_D65_TO_DCI: Mat3 = [[0.991085588932037354, -0.0273622870445251465, -0.0183956623077392578], [-0.0191021915525197983, 1.02583777904510498, -0.00705372542142868042], [-8.05503223091359977e-05, -0.00195988826453685804, 0.878238439559936523]];
const M_P3_TO_REC2020: Mat3 = [[0.753833034361722221, 0.198597369052616435, 0.0475695965856618441], [0.0457438489653582137, 0.9417772198116936, 0.0124789312229481135], [-0.0012103403545183941, 0.0176017173010899926, 0.983608623053428777]];
// CAT 矩阵(cwp != 2 分支 / display 3,5 分支用)。本步 config 不触及,保留供扩展。
const M_CAT_D65_TO_D93: Mat3 = [[0.95703423023223877, -0.0247171502560377121, 0.0624028593301773071], [-0.0179296955466270447, 0.990019857883453369, 0.0248119533061981201], [0.00127589143812656403, 0.00427919067442417058, 1.29345715045928955]];
const M_CAT_D65_TO_D75: Mat3 = [[0.981001079082489014, -0.0116619253531098366, 0.0265614092350006104], [-0.00843488052487373352, 0.996506094932556152, 0.0105696544051170349], [0.000552809564396739006, 0.00179840810596942902, 1.12374722957611084]];
const M_CAT_D65_TO_D60: Mat3 = [[1.01182246208190918, 0.00778879318386316299, -0.0157783031463623047], [0.00561682833358645439, 1.00150644779205322, -0.00628517568111419678], [-0.000335735734552145004, -0.0010509500280022619, 0.927366673946380615]];
const M_CAT_D65_TO_D55: Mat3 = [[1.02585089206695557, 0.0179439820349216461, -0.0332137793302536011], [0.0129133854061365128, 1.00214779376983643, -0.0132421031594276428], [-0.000719940289855003032, -0.00218106806278228803, 0.84868013858795166]];
const M_CAT_D65_TO_D50: Mat3 = [[1.04257404804229736, 0.03089117631316185, -0.052812620997428894], [0.0221935361623764038, 1.00185668468475342, -0.0210737623274326324], [-0.00116488314233720303, -0.00342052709311246915, 0.761789083480834961]];
const M_CAT_D60_TO_D93: Mat3 = [[0.946056902408599854, -0.0319503024220466614, 0.0831701457500457764], [-0.0231979694217443466, 0.988745808601379395, 0.0330617502331733704], [0.00169203430414199807, 0.00572328735142946243, 1.39483106136322021]];
const M_CAT_D60_TO_D75: Mat3 = [[0.969659984111785889, -0.019138311967253685, 0.0450099557638168335], [-0.0138545772060751915, 0.995133817195892334, 0.0179062262177467346], [0.000931452261283994046, 0.00306008197367191315, 1.21179807186126709]];
const M_CAT_D60_TO_D65: Mat3 = [[0.988363921642303467, -0.00766910053789615631, 0.0167641639709472656], [-0.0055409618653357029, 0.998546123504638672, 0.00667332112789154139], [0.000351537019014359008, 0.00112883746623992898, 1.07833576202392578]];
const M_CAT_D60_TO_D55: Mat3 = [[1.01380288600921631, 0.0100131509825587273, -0.018498346209526062], [0.00720565160736441612, 1.00057685375213623, -0.00737529993057250977], [-0.000401133671402930997, -0.00121434964239597299, 0.915135681629180908]];
const M_CAT_D60_TO_D50: Mat3 = [[1.03025269508361816, 0.0227910466492176056, -0.0392656922340393066], [0.0163766480982303619, 1.00020599365234375, -0.0156668238341808319], [-0.000864576781168579947, -0.00254668481647968292, 0.821422040462493896]];
const M_CAT_DCI_TO_D65: Mat3 = [[1.00951600074768066, 0.0269675441086292267, 0.0213620811700820923], [0.0187991037964820862, 0.975330352783203125, 0.0082273334264755249], [0.000134543282911180989, 0.00217903498560190201, 1.138663649559021]];
const M_CAT_DCI_TO_D93: Mat3 = [[0.965685009956359863, 0.00183745240792632103, 0.0912967324256896973], [0.000514572137035429044, 0.965166747570037842, 0.036014653742313385], [0.00154250487685203596, 0.00702651776373386383, 1.47287476062774658]];
const M_CAT_DCI_TO_D75: Mat3 = [[0.990120768547058105, 0.0151389474049210548, 0.0511047691106796265], [0.0102197211235761642, 0.971718132495880127, 0.0200536623597145081], [0.000743072712793946049, 0.0042176349088549614, 1.27959656715393066]];
const M_CAT_DCI_TO_D60: Mat3 = [[1.02159523963928223, 0.034848678857088089, 0.00371252000331878705], [0.0244968775659799576, 0.976937234401702881, 0.00120301544666290305], [-0.00023391586728393999, 0.000986687839031219049, 1.05594265460968018]];
const M_CAT_DCI_TO_D55: Mat3 = [[1.03594577312469482, 0.0450937561690807343, -0.0157573819160461426], [0.0318740680813789368, 0.977744519710540771, -0.00655744969844818115], [-0.000653609400615095984, -0.000297372229397297014, 0.966327786445617676]];
const M_CAT_DCI_TO_D50: Mat3 = [[1.05306875705718994, 0.0581297315657138824, -0.0376100838184356689], [0.0412359423935413361, 0.977693676948547363, -0.0152792222797870636], [-0.00113777676597237609, -0.00170759297907352404, 0.867368340492248535]];

// creative whitepoint 归一化常数(DCTL 658-726 内联),键 (display_gamut, cwp)。
const CWP_NORM: Record<string, number> = {
  "0,0": 0.744192699063, "0,1": 0.873470832146, "0,3": 0.955936992163, "0,4": 0.905671332781, "0,5": 0.850004385027,
  "1,0": 0.762687057298, "1,1": 0.884054083328, "1,3": 0.964320186739, "1,4": 0.923076518860, "1,5": 0.876572837784,
  "2,0": 0.762687057298, "2,1": 0.884054083328, "2,3": 0.964320186739, "2,4": 0.923076518860, "2,5": 0.876572837784,
  "3,0": 0.704956321013, "3,1": 0.816715709816, "3,2": 0.923382193663, "3,4": 0.956138500287, "3,5": 0.906801453023,
  "4,0": 0.665336141225, "4,1": 0.770397131382, "4,2": 0.870572343302, "4,3": 0.891354547503, "4,4": 0.855327825187, "4,5": 0.814566436117,
  "5,0": 0.707142784007, "5,1": 0.815561082617, "5,2": 0.916555279740, "5,3": 0.916555279740, "5,4": 0.916555279740, "5,5": 0.916555279740,
};

// ---- LOOK_PRESETS["Standard"] 完整镜像 + OpenDRTParams 相关默认(DCTL) ----
export interface ResolvedConfig {
  // 全局
  tn_Lp: number; tn_gb: number; pt_hdr: number; tn_Lg: number;
  // tonescale
  tn_con: number; tn_sh: number; tn_toe: number; tn_off: number;
  tn_hcon_enable: number; tn_hcon: number; tn_hcon_pv: number; tn_hcon_st: number;
  tn_lcon_enable: number; tn_lcon: number; tn_lcon_w: number;
  // creative white
  cwp: number; cwp_lm: number;
  // render space
  rs_sa: number; rs_rw: number; rs_bw: number;
  // purity limit
  pt_lml: number; pt_lml_r: number; pt_lml_g: number; pt_lml_b: number;
  pt_lmh: number; pt_lmh_r: number; pt_lmh_b: number;
  // purity softclip
  ptl_enable: number; ptl_c: number; ptl_m: number; ptl_y: number;
  // mid purity
  ptm_enable: number; ptm_low: number; ptm_low_rng: number; ptm_low_st: number;
  ptm_high: number; ptm_high_rng: number; ptm_high_st: number;
  // brilliance
  brl_enable: number; brl: number; brl_r: number; brl_g: number; brl_b: number; brl_rng: number; brl_st: number;
  // brilliance post
  brlp_enable: number; brlp: number; brlp_r: number; brlp_g: number; brlp_b: number;
  // hue contrast R
  hc_enable: number; hc_r: number; hc_r_rng: number;
  // hueshift RGB
  hs_rgb_enable: number; hs_r: number; hs_r_rng: number; hs_g: number; hs_g_rng: number; hs_b: number; hs_b_rng: number;
  // hueshift CMY
  hs_cmy_enable: number; hs_c: number; hs_c_rng: number; hs_m: number; hs_m_rng: number; hs_y: number; hs_y_rng: number;
  // output
  clamp: number; tn_su: number; display_gamut: number; eotf: number;
  in_gamut: string; in_oetf: string;
  // 求解常数
  ts_x0: number; ts_s: number; ts_s1: number; ts_p: number; ts_m2: number; ts_dsc: number; s_Lp100: number;
}

const STANDARD = {
  tn_con: 1.66, tn_sh: 0.5, tn_toe: 0.003, tn_off: 0.005,
  tn_hcon_enable: 0, tn_hcon: 0.0, tn_hcon_pv: 1.0, tn_hcon_st: 4.0,
  tn_lcon_enable: 0, tn_lcon: 0.0, tn_lcon_w: 0.5,
  cwp: 2, cwp_lm: 0.25,
  rs_sa: 0.35, rs_rw: 0.25, rs_bw: 0.55,
  pt_lml: 0.25, pt_lml_r: 0.5, pt_lml_g: 0.0, pt_lml_b: 0.1,
  pt_lmh: 0.25, pt_lmh_r: 0.5, pt_lmh_b: 0.0,
  ptl_enable: 1, ptl_c: 0.06, ptl_m: 0.08, ptl_y: 0.06,
  ptm_enable: 1, ptm_low: 0.4, ptm_low_rng: 0.25, ptm_low_st: 0.5,
  ptm_high: -0.8, ptm_high_rng: 0.35, ptm_high_st: 0.4,
  brl_enable: 1, brl: 0.0, brl_r: -2.5, brl_g: -1.5, brl_b: -1.5, brl_rng: 0.5, brl_st: 0.35,
  brlp_enable: 1, brlp: -0.5, brlp_r: -1.25, brlp_g: -1.25, brlp_b: -0.25,
  hc_enable: 1, hc_r: 1.0, hc_r_rng: 0.3,
  hs_rgb_enable: 1, hs_r: 0.6, hs_r_rng: 0.6, hs_g: 0.35, hs_g_rng: 1.0, hs_b: 0.66, hs_b_rng: 1.0,
  hs_cmy_enable: 1, hs_c: 0.25, hs_c_rng: 1.0, hs_m: 0.0, hs_m_rng: 1.0, hs_y: 0.0, hs_y_rng: 1.0,
};

// ---- 标量数学辅助(忠实移植 DCTL 语义) ----
function sdivf(a: number, b: number): number { return b === 0.0 ? 0.0 : a / b; }
function spowf(a: number, b: number): number { return a <= 0.0 ? a : Math.pow(a, b); }
function modp(a: number, m: number): number { return a - m * Math.floor(a / m); }

function compress_toe_quadratic(x: number, toe: number, inv: number): number {
  if (toe === 0.0) return x;
  if (inv !== 0) return (x + Math.sqrt(Math.max(0.0, x * (4.0 * toe + x)))) / 2.0;
  return sdivf(spowf(x, 2.0), x + toe);
}
function compress_hyperbolic_power(x: number, s: number, p: number): number {
  return spowf(sdivf(x, x + s), p);
}
// 忠实移植自 OpenDRT_v110.dctl 518-530(Contrast Low 用)。
function compress_toe_cubic(x: number, m: number, w: number, inv: number): number {
  if (m === 1.0) return x;
  const x2 = x * x;
  if (inv === 0) {
    return (x * (x2 + m * w)) / (x2 + w);
  } else {
    const p0 = x2 - 3.0 * m * w;
    const p1 = 2.0 * x2 + 27.0 * w - 9.0 * m * w;
    const p2 = Math.pow(Math.sqrt(x2 * p1 * p1 - 4 * p0 * p0 * p0) / 2.0 + (x * p1) / 2.0, 1.0 / 3.0);
    return p0 / (3.0 * p2) + p2 / 3.0 + x / 3.0;
  }
}
// 忠实移植自 OpenDRT_v110.dctl 542-557(Contrast High 用)。
function contrast_high(x: number, p: number, pv: number, pv_lx: number, inv: number): number {
  const x0 = 0.18 * Math.pow(2.0, pv);
  if (x < x0 || p === 1.0) return x;
  const o = x0 - x0 / p;
  const s0 = Math.pow(x0, 1.0 - p) / p;
  const x1 = x0 * Math.pow(2.0, pv_lx);
  const k1 = (p * s0 * Math.pow(x1, p)) / x1;
  const y1 = s0 * Math.pow(x1, p) + o;
  if (inv === 1)
    return x > y1 ? (x - y1) / k1 + x1 : Math.pow((x - o) / s0, 1.0 / p);
  else
    return x > x1 ? k1 * (x - x1) + y1 : s0 * Math.pow(x, p) + o;
}
function gauss_window(x: number, w: number): number { return Math.exp((-x * x) / w); }
function hue_offset(h: number, o: number): number { return modp(h - o + PI, 2.0 * PI) - PI; }
function softplus(x: number, s: number): number {
  if (s < 1e-4) return x;
  if (x > 10.0 * s) return x;
  return s * Math.log(Math.max(0.0, 1.0 + Math.exp(x / s)));
}
function vdot(m: Mat3, v: [number, number, number]): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

// ---- 求解常数(_solve_constants 逐行) ----
export function solveConstants(c: {
  tn_sh: number; tn_Lp: number; tn_off: number; tn_Lg: number; tn_gb: number;
  tn_toe: number; tn_con: number; tn_su: number; eotf: number; pt_hdr: number;
}) {
  const ts_x1 = Math.pow(2.0, 6.0 * c.tn_sh + 4.0);
  const ts_y1 = c.tn_Lp / 100.0;
  const ts_x0 = 0.18 + c.tn_off;
  const ts_y0 = (c.tn_Lg / 100.0) * (1.0 + c.tn_gb * Math.log2(ts_y1));
  const ts_s0 = compress_toe_quadratic(ts_y0, c.tn_toe, 1);
  const ts_p = c.tn_con / (1.0 + c.tn_su * 0.05);
  const ts_s10 = ts_x0 * (Math.pow(ts_s0, -1.0 / c.tn_con) - 1.0);
  const ts_m1 = ts_y1 / Math.pow(ts_x1 / (ts_x1 + ts_s10), c.tn_con);
  const ts_m2 = compress_toe_quadratic(ts_m1, c.tn_toe, 1);
  const ts_s = ts_x0 * (Math.pow(ts_s0 / ts_m2, -1.0 / c.tn_con) - 1.0);
  const ts_dsc = c.eotf === 4 ? 0.01 : c.eotf === 5 ? 0.1 : 100.0 / c.tn_Lp;
  const pt_cmp_Lf = c.pt_hdr * Math.min(1.0, (c.tn_Lp - 100.0) / 900.0);
  const s_Lp100 = ts_x0 * (Math.pow(c.tn_Lg / 100.0, -1.0 / c.tn_con) - 1.0);
  const ts_s1 = ts_s * pt_cmp_Lf + s_Lp100 * (1.0 - pt_cmp_Lf);
  return { ts_x0, ts_s, ts_s1, ts_p, ts_m2, ts_dsc, s_Lp100 };
}

// ---- DrtParams -> ResolvedConfig(合并 Standard look + display encoding + 全局) ----
export function resolveConfig(p: DrtParams): ResolvedConfig {
  const enc = DISPLAY_ENCODING[p.display];
  const tn_su = enc[0], display_gamut = enc[1], eotf = enc[2];
  // 【纯透传扩展】每个字段读 p.,DEFAULT_PARAMS 默认值 == STANDARD 原值,
  // 故不动滑块时下面所有值与旧硬编码逐位相同(见 params.ts DEFAULT_PARAMS)。
  // 不改任何算法/常数/矩阵/solveConstants/evaluateCPU。tn_su 仍由 display 预设决定(不被 param 覆盖)。
  const base = {
    ...STANDARD,
    // 全局
    tn_Lp: p.tnLp, tn_gb: p.tnGb, pt_hdr: p.ptHdr, tn_Lg: p.tnLg,
    // tonescale
    tn_con: p.tnCon, tn_sh: p.tnSh, tn_toe: p.tnToe, tn_off: p.tnOff,
    tn_hcon_enable: p.tnHconEnable, tn_hcon: p.tnHcon, tn_hcon_pv: p.tnHconPv, tn_hcon_st: p.tnHconSt,
    tn_lcon_enable: p.tnLconEnable, tn_lcon: p.tnLcon, tn_lcon_w: p.tnLconW,
    // creative white
    cwp: p.cwp, cwp_lm: p.cwpLm,
    // render space
    rs_sa: p.rsSa, rs_rw: p.rsRw, rs_bw: p.rsBw,
    // purity limit
    pt_lml: p.ptLml, pt_lml_r: p.ptLmlR, pt_lml_g: p.ptLmlG, pt_lml_b: p.ptLmlB,
    pt_lmh: p.ptLmh, pt_lmh_r: p.ptLmhR, pt_lmh_b: p.ptLmhB,
    // purity softclip
    ptl_enable: p.ptlEnable, ptl_c: p.ptlC, ptl_m: p.ptlM, ptl_y: p.ptlY,
    // mid purity
    ptm_enable: p.ptmEnable, ptm_low: p.ptmLow, ptm_low_rng: p.ptmLowRng, ptm_low_st: p.ptmLowSt,
    ptm_high: p.ptmHigh, ptm_high_rng: p.ptmHighRng, ptm_high_st: p.ptmHighSt,
    // brilliance
    brl_enable: p.brlEnable, brl: p.brl, brl_r: p.brlR, brl_g: p.brlG, brl_b: p.brlB, brl_rng: p.brlRng, brl_st: p.brlSt,
    // brilliance post
    brlp_enable: p.brlpEnable, brlp: p.brlp, brlp_r: p.brlpR, brlp_g: p.brlpG, brlp_b: p.brlpB,
    // hue contrast R
    hc_enable: p.hcEnable, hc_r: p.hcR, hc_r_rng: p.hcRRng,
    // hueshift RGB
    hs_rgb_enable: p.hsRgbEnable, hs_r: p.hsR, hs_r_rng: p.hsRRng, hs_g: p.hsG, hs_g_rng: p.hsGRng, hs_b: p.hsB, hs_b_rng: p.hsBRng,
    // hueshift CMY
    hs_cmy_enable: p.hsCmyEnable, hs_c: p.hsC, hs_c_rng: p.hsCRng, hs_m: p.hsM, hs_m_rng: p.hsMRng, hs_y: p.hsY, hs_y_rng: p.hsYRng,
    // output
    clamp: 1, tn_su, display_gamut, eotf,
    in_gamut: p.inGamut, in_oetf: p.inOetf,
  };
  const sc = solveConstants({
    tn_sh: base.tn_sh, tn_Lp: base.tn_Lp, tn_off: base.tn_off, tn_Lg: base.tn_Lg,
    tn_gb: base.tn_gb, tn_toe: base.tn_toe, tn_con: base.tn_con, tn_su: base.tn_su,
    eotf: base.eotf, pt_hdr: base.pt_hdr,
  });
  return { ...base, ...sc };
}

// ---- OETF 线性化(编码域 -> scene-linear)。忠实移植内核 opendrt_v110.py 的
// oetf_* 函数(DCTL 378-404),tf 索引与 params.ts 的 IN_OETFS 顺序一一对应(0..9)。
// 不自写曲线:公式逐行照抄内核。exp2(y) = pow(2,y)。图像上传的 SDR 反解码复用此函数。
export function linearizeScalar(v: number, tf: number): number {
  const x = v;
  switch (tf) {
    case 0: // linear
      return x;
    case 1: // davinci_intermediate
      return x <= 0.02740668 ? x / 10.44426855 : Math.pow(2.0, x / 0.07329248 - 7.0) - 0.0075;
    case 2: // filmlight_tlog
      return x < 0.075
        ? (x - 0.075) / 16.184376489665897
        : Math.exp((x - 0.5520126568606655) / 0.09232902596577353) - 0.0057048244042473785;
    case 3: // acescct
      return x <= 0.155251141552511
        ? (x - 0.0729055341958355) / 10.5402377416545
        : Math.pow(2.0, x * 17.52 - 9.72);
    case 4: { // arri_logc3
      const thr = 5.367655 * 0.010591 + 0.092809;
      return x < thr
        ? (x - 0.092809) / 5.367655
        : (Math.pow(10.0, (x - 0.385537) / 0.247190) - 0.052272) / 5.555556;
    }
    case 5: // arri_logc4
      return x < -0.7774983977293537
        ? x * 0.3033266726886969 - 0.7774983977293537
        : (Math.pow(2.0, 14.0 * (x - 0.09286412512218964) / 0.9071358748778103 + 6.0) - 64.0) / 2231.8263090676883;
    case 6: // redlog3g10
      return x < 0.0
        ? (x / 15.1927) - 0.01
        : (Math.pow(10.0, x / 0.224282) - 1.0) / 155.975327 - 0.01;
    case 7: // panasonic_vlog
      return x < 0.181
        ? (x - 0.125) / 5.6
        : Math.pow(10.0, (x - 0.598206) / 0.241514) - 0.00873;
    case 8: { // sony_slog3
      const thr = 171.2102946929 / 1023.0;
      return x < thr
        ? (x * 1023.0 - 95.0) * 0.01125 / (171.2102946929 - 95.0)
        : (Math.pow(10.0, ((x * 1023.0 - 420.0) / 261.5)) * (0.18 + 0.01) - 0.01);
    }
    case 9: // fuji_flog2
      return x < 0.100686685370811
        ? (x - 0.092864) / 8.799461
        : (Math.pow(10.0, ((x - 0.384316) / 0.245281)) / 5.555556 - 0.064829 / 5.555556);
    default:
      return x;
  }
}

// ---- display_gamut_whitepoint(CPU 参考) ----
function displayGamutWhitepoint(rgbIn: [number, number, number], tsn: number, c: ResolvedConfig): [number, number, number] {
  let rgb = vdot(M_P3D65_TO_XYZ, rgbIn);
  let cwp_neutral: [number, number, number] = rgb;
  const cwp_f = Math.pow(tsn, 2.0 * c.cwp_lm);
  const dg = c.display_gamut, cwp = c.cwp;
  if (dg < 3) {
    if (cwp === 0) rgb = vdot(M_CAT_D65_TO_D93, rgb);
    else if (cwp === 1) rgb = vdot(M_CAT_D65_TO_D75, rgb);
    else if (cwp === 3) rgb = vdot(M_CAT_D65_TO_D60, rgb);
    else if (cwp === 4) rgb = vdot(M_CAT_D65_TO_D55, rgb);
    else if (cwp === 5) rgb = vdot(M_CAT_D65_TO_D50, rgb);
  } else if (dg === 3) {
    if (cwp === 0) rgb = vdot(M_CAT_D60_TO_D93, rgb);
    else if (cwp === 1) rgb = vdot(M_CAT_D60_TO_D75, rgb);
    else if (cwp === 2) rgb = vdot(M_CAT_D60_TO_D65, rgb);
    else if (cwp === 4) rgb = vdot(M_CAT_D60_TO_D55, rgb);
    else if (cwp === 5) rgb = vdot(M_CAT_D60_TO_D50, rgb);
  } else {
    cwp_neutral = vdot(M_CAT_DCI_TO_D65, rgb);
    if (cwp === 0) rgb = vdot(M_CAT_DCI_TO_D93, rgb);
    else if (cwp === 1) rgb = vdot(M_CAT_DCI_TO_D75, rgb);
    else if (cwp === 2) rgb = cwp_neutral;
    else if (cwp === 3) rgb = vdot(M_CAT_DCI_TO_D60, rgb);
    else if (cwp === 4) rgb = vdot(M_CAT_DCI_TO_D55, rgb);
    else if (cwp === 5) rgb = vdot(M_CAT_DCI_TO_D50, rgb);
  }
  rgb = [
    rgb[0] * cwp_f + cwp_neutral[0] * (1.0 - cwp_f),
    rgb[1] * cwp_f + cwp_neutral[1] * (1.0 - cwp_f),
    rgb[2] * cwp_f + cwp_neutral[2] * (1.0 - cwp_f),
  ];
  if (dg === 0) rgb = vdot(M_XYZ_TO_REC709, rgb);
  else if (dg === 5) rgb = vdot(M_CAT_D65_TO_DCI, rgb);
  else rgb = vdot(M_XYZ_TO_P3D65b, rgb);
  const cwp_norm = CWP_NORM[`${dg},${cwp}`] ?? 1.0;
  const nf = cwp_norm * cwp_f + 1.0 - cwp_f;
  return [rgb[0] * nf, rgb[1] * nf, rgb[2] * nf];
}

// ---- 完整 CPU 参考变换(逐节点等价 GLSL / Python _transform) ----
export function evaluateCPU(c: ResolvedConfig, input: [number, number, number]): [number, number, number] {
  const tf = IN_OETFS.indexOf(c.in_oetf as any);
  let rgb: [number, number, number] = [
    linearizeScalar(input[0], tf), linearizeScalar(input[1], tf), linearizeScalar(input[2], tf),
  ];

  // 输入 gamut -> XYZ -> P3D65
  const inMtx = INPUT_GAMUT_MATRICES[c.in_gamut];
  if (inMtx) rgb = vdot(inMtx, rgb);
  rgb = vdot(M_XYZ_TO_P3D65, rgb);

  // Render space desaturate (SatW)
  const rs_w: [number, number, number] = [c.rs_rw, 1.0 - c.rs_rw - c.rs_bw, c.rs_bw];
  let satL = rgb[0] * rs_w[0] + rgb[1] * rs_w[1] + rgb[2] * rs_w[2];
  rgb = [satL * c.rs_sa + rgb[0] * (1.0 - c.rs_sa), satL * c.rs_sa + rgb[1] * (1.0 - c.rs_sa), satL * c.rs_sa + rgb[2] * (1.0 - c.rs_sa)];

  // Offset
  rgb = [rgb[0] + c.tn_off, rgb[1] + c.tn_off, rgb[2] + c.tn_off];

  // Norm
  const tsn0 = Math.sqrt(Math.max(0.0, rgb[0] * rgb[0] + rgb[1] * rgb[1] + rgb[2] * rgb[2])) / SQRT3;

  // Ratios
  rgb = [sdivf(rgb[0], tsn0), sdivf(rgb[1], tsn0), sdivf(rgb[2], tsn0)];

  // Opponent + achromatic
  const opp0 = rgb[0] - rgb[2];
  const opp1 = rgb[1] - (rgb[0] + rgb[2]) / 2.0;
  const ach_d_raw = Math.sqrt(Math.max(0.0, opp0 * opp0 + opp1 * opp1)) / 2.0;
  const ach_d = 1.25 * compress_toe_quadratic(ach_d_raw, 0.25, 0);

  // Hue
  const hue = modp(Math.atan2(opp0, opp1) + PI + 1.10714931, 2.0 * PI);
  const ha_rgb: [number, number, number] = [
    gauss_window(hue_offset(hue, 0.1), 0.66),
    gauss_window(hue_offset(hue, 4.3), 0.66),
    gauss_window(hue_offset(hue, 2.3), 0.66),
  ];
  const ha_rgb_hs: [number, number, number] = [
    gauss_window(hue_offset(hue, -0.4), 0.66),
    ha_rgb[1],
    gauss_window(hue_offset(hue, 2.5), 0.66),
  ];
  const ha_cmy: [number, number, number] = [
    gauss_window(hue_offset(hue, 3.3), 0.5),
    gauss_window(hue_offset(hue, 1.3), 0.5),
    gauss_window(hue_offset(hue, -1.15), 0.5),
  ];

  let tsn = tsn0;
  // Brilliance
  if (c.brl_enable) {
    const brl_tsf = Math.pow(tsn / (tsn + 1.0), 1.0 - c.brl_rng);
    const brl_exf = (c.brl + c.brl_r * ha_rgb[0] + c.brl_g * ha_rgb[1] + c.brl_b * ha_rgb[2]) * Math.pow(ach_d, 1.0 / c.brl_st);
    const brl_ex = Math.pow(2.0, brl_exf * (brl_exf < 0.0 ? brl_tsf : 1.0 - brl_tsf));
    tsn = tsn * brl_ex;
  }

  // Contrast Low(忠实移植自 DCTL 1024-1036)
  if (c.tn_lcon_enable) {
    const lcon_m = Math.pow(2.0, -c.tn_lcon);
    let lcon_w = c.tn_lcon_w / 4.0;
    lcon_w *= lcon_w;
    const lcon_cnst_sc = compress_toe_cubic(c.ts_x0, lcon_m, lcon_w, 1) / c.ts_x0;
    tsn = tsn * lcon_cnst_sc;
    tsn = compress_toe_cubic(tsn, lcon_m, lcon_w, 0);
  }
  // Contrast High(忠实移植自 DCTL 1038-1044)
  if (c.tn_hcon_enable) {
    const hcon_p = Math.pow(2.0, c.tn_hcon);
    tsn = contrast_high(tsn, hcon_p, c.tn_hcon_pv, c.tn_hcon_st, 0);
  }

  // Hyperbolic Compression
  const tsn_pt = compress_hyperbolic_power(tsn, c.ts_s1, c.ts_p);
  const tsn_const = compress_hyperbolic_power(tsn, c.s_Lp100, c.ts_p);
  tsn = compress_hyperbolic_power(tsn, c.ts_s, c.ts_p);

  // Hue Contrast R
  if (c.hc_enable) {
    let hc_ts = 1.0 - tsn_const;
    let hc_c = hc_ts * (1.0 - ach_d) + ach_d * (1.0 - hc_ts);
    hc_c = hc_c * ach_d * ha_rgb[0];
    hc_ts = Math.pow(hc_ts, 1.0 / c.hc_r_rng);
    const hc_f = c.hc_r * (hc_c - 2.0 * hc_c * hc_ts) + 1.0;
    rgb = [rgb[0], rgb[1] * hc_f, rgb[2] * hc_f];
  }

  // Hue Shift RGB
  if (c.hs_rgb_enable) {
    const hs_rgb: [number, number, number] = [
      ha_rgb_hs[0] * ach_d * Math.pow(tsn_pt, 1.0 / c.hs_r_rng),
      ha_rgb_hs[1] * ach_d * Math.pow(tsn_pt, 1.0 / c.hs_g_rng),
      ha_rgb_hs[2] * ach_d * Math.pow(tsn_pt, 1.0 / c.hs_b_rng),
    ];
    let hsf: [number, number, number] = [hs_rgb[0] * c.hs_r, hs_rgb[1] * -c.hs_g, hs_rgb[2] * -c.hs_b];
    hsf = [hsf[2] - hsf[1], hsf[0] - hsf[2], hsf[1] - hsf[0]];
    rgb = [rgb[0] + hsf[0], rgb[1] + hsf[1], rgb[2] + hsf[2]];
  }

  // Hue Shift CMY
  if (c.hs_cmy_enable) {
    const compl = 1.0 - tsn_pt;
    const hs_cmy: [number, number, number] = [
      ha_cmy[0] * ach_d * Math.pow(compl, 1.0 / c.hs_c_rng),
      ha_cmy[1] * ach_d * Math.pow(compl, 1.0 / c.hs_m_rng),
      ha_cmy[2] * ach_d * Math.pow(compl, 1.0 / c.hs_y_rng),
    ];
    let hsf: [number, number, number] = [hs_cmy[0] * -c.hs_c, hs_cmy[1] * c.hs_m, hs_cmy[2] * c.hs_y];
    hsf = [hsf[2] - hsf[1], hsf[0] - hsf[2], hsf[1] - hsf[0]];
    rgb = [rgb[0] + hsf[0], rgb[1] + hsf[1], rgb[2] + hsf[2]];
  }

  // Purity Limit Low
  const pt_lml_p = 1.0 + 4.0 * (1.0 - tsn_pt) * (c.pt_lml + c.pt_lml_r * ha_rgb_hs[0] + c.pt_lml_g * ha_rgb_hs[1] + c.pt_lml_b * ha_rgb_hs[2]);
  let ptf = 1.0 - Math.pow(tsn_pt, pt_lml_p);

  // Purity Limit High
  const pt_lmh_p = (1.0 - ach_d * (c.pt_lmh_r * ha_rgb_hs[0] + c.pt_lmh_b * ha_rgb_hs[2])) * (1.0 - c.pt_lmh * ach_d);
  ptf = Math.pow(ptf, pt_lmh_p);

  // Mid purity
  if (c.ptm_enable) {
    const ptm_low_f = (c.ptm_low_st === 0.0 || c.ptm_low_rng === 0.0) ? 1.0
      : 1.0 + c.ptm_low * Math.exp((-2.0 * ach_d * ach_d) / c.ptm_low_st) * Math.pow(1.0 - tsn_const, 1.0 / c.ptm_low_rng);
    const ptm_high_f = (c.ptm_high_st === 0.0 || c.ptm_high_rng === 0.0) ? 1.0
      : 1.0 + c.ptm_high * Math.exp((-2.0 * ach_d * ach_d) / c.ptm_high_st) * Math.pow(tsn_pt, 1.0 / (4.0 * c.ptm_high_rng));
    ptf = ptf * ptm_low_f * ptm_high_f;
  }

  // Lerp to one
  rgb = [rgb[0] * ptf + 1.0 - ptf, rgb[1] * ptf + 1.0 - ptf, rgb[2] * ptf + 1.0 - ptf];

  // Inverse render space
  satL = rgb[0] * rs_w[0] + rgb[1] * rs_w[1] + rgb[2] * rs_w[2];
  rgb = [
    (satL * c.rs_sa - rgb[0]) / (c.rs_sa - 1.0),
    (satL * c.rs_sa - rgb[1]) / (c.rs_sa - 1.0),
    (satL * c.rs_sa - rgb[2]) / (c.rs_sa - 1.0),
  ];

  // Display gamut + creative whitepoint
  rgb = displayGamutWhitepoint(rgb, tsn_const, c);

  // Post Brilliance
  if (c.brlp_enable) {
    const bo0 = rgb[0] - rgb[2];
    const bo1 = rgb[1] - (rgb[0] + rgb[2]) / 2.0;
    let brlp_ach_d = Math.sqrt(Math.max(0.0, bo0 * bo0 + bo1 * bo1)) / 4.0;
    brlp_ach_d = 1.1 * ((brlp_ach_d * brlp_ach_d) / (brlp_ach_d + 0.1));
    const bh0 = ach_d * ha_rgb[0], bh1 = ach_d * ha_rgb[1], bh2 = ach_d * ha_rgb[2];
    const brlp_m = c.brlp + c.brlp_r * bh0 + c.brlp_g * bh1 + c.brlp_b * bh2;
    const brlp_ex = Math.pow(2.0, brlp_m * brlp_ach_d * tsn);
    rgb = [rgb[0] * brlp_ex, rgb[1] * brlp_ex, rgb[2] * brlp_ex];
  }

  // Softplus per channel
  if (c.ptl_enable) {
    rgb = [softplus(rgb[0], c.ptl_c), softplus(rgb[1], c.ptl_m), softplus(rgb[2], c.ptl_y)];
  }

  // Final tonescale
  tsn = tsn * c.ts_m2;
  tsn = compress_toe_quadratic(tsn, c.tn_toe, 0);
  tsn = tsn * c.ts_dsc;

  // Multiply back
  rgb = [rgb[0] * tsn, rgb[1] * tsn, rgb[2] * tsn];

  // Rec2020 (P3 limited)
  if (c.display_gamut === 2) {
    rgb = [Math.max(rgb[0], 0.0), Math.max(rgb[1], 0.0), Math.max(rgb[2], 0.0)];
    rgb = vdot(M_P3_TO_REC2020, rgb);
  }

  // Clamp
  if (c.clamp) rgb = [Math.min(Math.max(rgb[0], 0.0), 1.0), Math.min(Math.max(rgb[1], 0.0), 1.0), Math.min(Math.max(rgb[2], 0.0), 1.0)];

  // Inverse EOTF
  const eotf_p = 2.0 + c.eotf * 0.2;
  if (c.eotf > 0 && c.eotf < 4) rgb = [spowf(rgb[0], 1.0 / eotf_p), spowf(rgb[1], 1.0 / eotf_p), spowf(rgb[2], 1.0 / eotf_p)];
  // eotf 4/5 (PQ/HLG) 本 config 不触及

  return rgb;
}

// ---- GLSL uniform 构建 ----
export function cwpNorm(displayGamut: number, cwp: number): number {
  return CWP_NORM[`${displayGamut},${cwp}`] ?? 1.0;
}

export interface GLUniformValues {
  ts_x0: number; ts_s: number; ts_s1: number; ts_p: number; ts_m2: number; ts_dsc: number; s_Lp100: number;
  in_oetf: number; display_gamut: number; eotf: number; cwp: number; clamp: number; cwp_norm: number;
  inMtx: Float32Array;
}

export function glUniformValues(c: ResolvedConfig): GLUniformValues {
  return {
    ts_x0: c.ts_x0, ts_s: c.ts_s, ts_s1: c.ts_s1, ts_p: c.ts_p,
    ts_m2: c.ts_m2, ts_dsc: c.ts_dsc, s_Lp100: c.s_Lp100,
    in_oetf: IN_OETFS.indexOf(c.in_oetf as any),
    display_gamut: c.display_gamut, eotf: c.eotf, cwp: c.cwp, clamp: c.clamp,
    cwp_norm: cwpNorm(c.display_gamut, c.cwp),
    inMtx: gamutMatrixColMajor(c.in_gamut),
  };
}

export function gamutMatrixColMajor(inGamut: string): Float32Array {
  const m = INPUT_GAMUT_MATRICES[inGamut];
  // identity(xyz)
  if (!m) return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  // column-major: col j = (M[0][j], M[1][j], M[2][j])
  return new Float32Array([
    m[0][0], m[1][0], m[2][0],
    m[0][1], m[1][1], m[2][1],
    m[0][2], m[1][2], m[2][2],
  ]);
}

// ==========================================================================
// 阶段 4 新增:逐节点探针内核 evaluateCPUTrace。
// 铁律:这是 evaluateCPU(第287-459行)的逐节点插桩副本 —— 计算逻辑完全照抄,
// 不改动任何公式/矩阵/常数,只在关键节点后 push 中间量。用于像素探针 + DAG 可视化。
// 硬性验收:trace 最后一步的 rgb 必须与 evaluateCPU 返回值逐分量完全相等(误差 0)。
// ==========================================================================

/** 单个 DAG 节点的探针快照:节点 id/中文说明/该节点后的 RGB/可选关键标量。 */
export interface TraceStep {
  id: string;                         // 节点名(英文,用作 DAG 内部 key)
  label: string;                      // 中文标签,用于 UI 展示
  rgb: [number, number, number];      // 该节点计算后的 RGB
  scalars?: Record<string, number>;   // 可选:该节点关键标量(tsn/ach_d/hue/ptf 等)
}

/** 25 个节点的中文说明(用于 DAG 悬浮提示),与下方插桩顺序严格一致。 */
export const TRACE_NODE_INFO: Array<{ id: string; label: string; desc: string }> = [
  { id: "input", label: "输入", desc: "原始输入 RGB(编码态,尚未线性化)。" },
  { id: "linearize", label: "线性化", desc: "按所选 Input OETF 反解码,从编码域回到 scene-linear。" },
  { id: "in_gamut_to_xyz", label: "输入色域→XYZ", desc: "输入 gamut 矩阵变换到 CIE XYZ(D65)。" },
  { id: "xyz_to_p3d65", label: "XYZ→P3D65 渲染空间", desc: "变换到 OpenDRT 内部渲染色域 P3D65。" },
  { id: "render_desaturate", label: "渲染空间去饱和", desc: "按 rs_sa/rs_rw/rs_bw 权重朝亮度方向部分去饱和,抑制强饱和色的溢出。" },
  { id: "offset", label: "偏移 (+tn_off)", desc: "加一个小的黑位偏移,避免除零并控制暗部行为。" },
  { id: "norm", label: "范数 (tsn0)", desc: "计算 RGB 向量的范数 tsn0,作为后续色调映射的整体亮度信号。" },
  { id: "ratios", label: "比值 (rgb/tsn0)", desc: "把 RGB 归一化为相对比值,分离\"色度方向\"与\"亮度大小\"。" },
  { id: "opponent_hue", label: "对立色/色相/无色度量", desc: "计算对立色信号 opp0/opp1、色相角 hue、无色度量 ach_d。" },
  { id: "brilliance", label: "Brilliance 明亮度", desc: "按色相与无色度对 tsn 做局部增益,让特定色相在保持颜色的同时更明亮。" },
  { id: "hyperbolic_compress", label: "双曲线压缩(核心 tonescale)", desc: "对 tsn 做双曲线幂函数压缩,这是 tonescale 的核心非线性,tn_sh/tn_con 都作用于此。" },
  { id: "hue_contrast", label: "Hue Contrast R", desc: "按红色相区域的对比度调制,增强/减弱红色区域的色彩对比。" },
  { id: "hue_shift_rgb", label: "Hue Shift RGB", desc: "在 R/G/B 主色相方向做色相偏移,修正高光区域的色相漂移。" },
  { id: "hue_shift_cmy", label: "Hue Shift CMY", desc: "在 C/M/Y 补色方向做色相偏移,进一步塑形色相响应曲线。" },
  { id: "purity_limit", label: "纯度限制 Low+High+Mid", desc: "根据亮度/无色度计算纯度保留系数 ptf,是 chroma/purity 压缩曲线的来源。" },
  { id: "lerp_to_one", label: "向白色插值 (Lerp to 1)", desc: "按 ptf 把 RGB 与全白(1,1,1)插值,实现纯度压缩的最终应用。" },
  { id: "inverse_render_space", label: "逆渲染空间去饱和", desc: "撤销之前的渲染空间去饱和,回到未去饱和的色彩表达。" },
  { id: "display_gamut_wp", label: "显示色域 + 创意白点", desc: "变换到目标显示色域,并按创意白点(cwp)做色适应混合。" },
  { id: "post_brilliance", label: "Post Brilliance", desc: "在显示空间做第二次明亮度调制,进一步修饰高光区域的色彩表现。" },
  { id: "softplus", label: "Softplus 逐通道软限幅", desc: "对每个通道做 softplus 平滑限幅,防止负值并柔化通道极值。" },
  { id: "final_tonescale", label: "最终 Tonescale 标量", desc: "把 tsn 乘以 ts_m2、做 toe 压缩、乘 ts_dsc,得到最终要乘回颜色的标量亮度。" },
  { id: "multiply_back", label: "乘回亮度", desc: "把最终 tonescale 标量乘回 RGB 比值,得到显示线性颜色。" },
  { id: "rec2020_limit", label: "Rec.2020 限定(仅 P3 限定模式)", desc: "display_gamut==2 时,先钳正再变换到 Rec.2020,限制超出 P3 的色域。" },
  { id: "clamp", label: "Clamp 钳位", desc: "把 RGB 钳制到 [0,1] 范围(仅当 clamp 开启)。" },
  { id: "inverse_eotf", label: "逆 EOTF → 显示编码", desc: "按目标 EOTF 做最终编码变换,得到可直接显示的编码值(最终输出)。" },
];

/**
 * evaluateCPU 的逐节点插桩副本。计算逻辑与 evaluateCPU 完全一致(不做任何修改),
 * 仅在每个主要节点后记录中间 RGB(及部分关键标量)到 steps 数组。
 * 硬性验收:steps 最后一项的 rgb 必须与 evaluateCPU(c, input) 的返回值逐分量完全相等。
 */
export function evaluateCPUTrace(c: ResolvedConfig, input: [number, number, number]): TraceStep[] {
  const steps: TraceStep[] = [];
  const push = (id: string, rgb: [number, number, number], scalars?: Record<string, number>) => {
    const info = TRACE_NODE_INFO.find((n) => n.id === id);
    steps.push({ id, label: info ? info.label : id, rgb: [rgb[0], rgb[1], rgb[2]], scalars });
  };

  // 1. input —— 原始输入 RGB(编码态)
  push("input", input);

  const tf = IN_OETFS.indexOf(c.in_oetf as any);
  let rgb: [number, number, number] = [
    linearizeScalar(input[0], tf), linearizeScalar(input[1], tf), linearizeScalar(input[2], tf),
  ];
  // 2. linearize —— OETF 逆解码到线性
  push("linearize", rgb);

  // 输入 gamut -> XYZ -> P3D65
  const inMtx = INPUT_GAMUT_MATRICES[c.in_gamut];
  if (inMtx) rgb = vdot(inMtx, rgb);
  // 3. in_gamut_to_xyz —— 输入 gamut → XYZ
  push("in_gamut_to_xyz", rgb);

  rgb = vdot(M_XYZ_TO_P3D65, rgb);
  // 4. xyz_to_p3d65 —— → P3D65 渲染空间
  push("xyz_to_p3d65", rgb);

  // Render space desaturate (SatW)
  const rs_w: [number, number, number] = [c.rs_rw, 1.0 - c.rs_rw - c.rs_bw, c.rs_bw];
  let satL = rgb[0] * rs_w[0] + rgb[1] * rs_w[1] + rgb[2] * rs_w[2];
  rgb = [satL * c.rs_sa + rgb[0] * (1.0 - c.rs_sa), satL * c.rs_sa + rgb[1] * (1.0 - c.rs_sa), satL * c.rs_sa + rgb[2] * (1.0 - c.rs_sa)];
  // 5. render_desaturate —— Render space SatW 去饱和
  push("render_desaturate", rgb);

  // Offset
  rgb = [rgb[0] + c.tn_off, rgb[1] + c.tn_off, rgb[2] + c.tn_off];
  // 6. offset —— + tn_off
  push("offset", rgb);

  // Norm
  const tsn0 = Math.sqrt(Math.max(0.0, rgb[0] * rgb[0] + rgb[1] * rgb[1] + rgb[2] * rgb[2])) / SQRT3;
  // 7. norm —— 计算 tsn0(范数),记 rgb 和标量 tsn0
  push("norm", rgb, { tsn0 });

  // Ratios
  rgb = [sdivf(rgb[0], tsn0), sdivf(rgb[1], tsn0), sdivf(rgb[2], tsn0)];
  // 8. ratios —— rgb / tsn0
  push("ratios", rgb);

  // Opponent + achromatic
  const opp0 = rgb[0] - rgb[2];
  const opp1 = rgb[1] - (rgb[0] + rgb[2]) / 2.0;
  const ach_d_raw = Math.sqrt(Math.max(0.0, opp0 * opp0 + opp1 * opp1)) / 2.0;
  const ach_d = 1.25 * compress_toe_quadratic(ach_d_raw, 0.25, 0);

  // Hue
  const hue = modp(Math.atan2(opp0, opp1) + PI + 1.10714931, 2.0 * PI);
  const ha_rgb: [number, number, number] = [
    gauss_window(hue_offset(hue, 0.1), 0.66),
    gauss_window(hue_offset(hue, 4.3), 0.66),
    gauss_window(hue_offset(hue, 2.3), 0.66),
  ];
  const ha_rgb_hs: [number, number, number] = [
    gauss_window(hue_offset(hue, -0.4), 0.66),
    ha_rgb[1],
    gauss_window(hue_offset(hue, 2.5), 0.66),
  ];
  const ha_cmy: [number, number, number] = [
    gauss_window(hue_offset(hue, 3.3), 0.5),
    gauss_window(hue_offset(hue, 1.3), 0.5),
    gauss_window(hue_offset(hue, -1.15), 0.5),
  ];
  // 9. opponent_hue —— 记 opp0/opp1/ach_d/hue(标量),rgb 不变(仍是比值)
  push("opponent_hue", rgb, { opp0, opp1, ach_d, hue });

  let tsn = tsn0;
  // Brilliance
  if (c.brl_enable) {
    const brl_tsf = Math.pow(tsn / (tsn + 1.0), 1.0 - c.brl_rng);
    const brl_exf = (c.brl + c.brl_r * ha_rgb[0] + c.brl_g * ha_rgb[1] + c.brl_b * ha_rgb[2]) * Math.pow(ach_d, 1.0 / c.brl_st);
    const brl_ex = Math.pow(2.0, brl_exf * (brl_exf < 0.0 ? brl_tsf : 1.0 - brl_tsf));
    tsn = tsn * brl_ex;
  }
  // 10. brilliance —— 记 tsn 变化(rgb 比值本身此处未变,tsn 单独记录)
  push("brilliance", rgb, { tsn });

  // Contrast Low(忠实移植自 DCTL 1024-1036)
  if (c.tn_lcon_enable) {
    const lcon_m = Math.pow(2.0, -c.tn_lcon);
    let lcon_w = c.tn_lcon_w / 4.0;
    lcon_w *= lcon_w;
    const lcon_cnst_sc = compress_toe_cubic(c.ts_x0, lcon_m, lcon_w, 1) / c.ts_x0;
    tsn = tsn * lcon_cnst_sc;
    tsn = compress_toe_cubic(tsn, lcon_m, lcon_w, 0);
  }
  // Contrast High(忠实移植自 DCTL 1038-1044)
  if (c.tn_hcon_enable) {
    const hcon_p = Math.pow(2.0, c.tn_hcon);
    tsn = contrast_high(tsn, hcon_p, c.tn_hcon_pv, c.tn_hcon_st, 0);
  }

  // Hyperbolic Compression
  const tsn_pt = compress_hyperbolic_power(tsn, c.ts_s1, c.ts_p);
  const tsn_const = compress_hyperbolic_power(tsn, c.s_Lp100, c.ts_p);
  tsn = compress_hyperbolic_power(tsn, c.ts_s, c.ts_p);
  // 11. hyperbolic_compress —— 记 tsn、tsn_pt、tsn_const(核心 tonescale 压缩)
  push("hyperbolic_compress", rgb, { tsn, tsn_pt, tsn_const });

  // Hue Contrast R
  if (c.hc_enable) {
    let hc_ts = 1.0 - tsn_const;
    let hc_c = hc_ts * (1.0 - ach_d) + ach_d * (1.0 - hc_ts);
    hc_c = hc_c * ach_d * ha_rgb[0];
    hc_ts = Math.pow(hc_ts, 1.0 / c.hc_r_rng);
    const hc_f = c.hc_r * (hc_c - 2.0 * hc_c * hc_ts) + 1.0;
    rgb = [rgb[0], rgb[1] * hc_f, rgb[2] * hc_f];
  }
  // 12. hue_contrast —— Hue Contrast R
  push("hue_contrast", rgb);

  // Hue Shift RGB
  if (c.hs_rgb_enable) {
    const hs_rgb: [number, number, number] = [
      ha_rgb_hs[0] * ach_d * Math.pow(tsn_pt, 1.0 / c.hs_r_rng),
      ha_rgb_hs[1] * ach_d * Math.pow(tsn_pt, 1.0 / c.hs_g_rng),
      ha_rgb_hs[2] * ach_d * Math.pow(tsn_pt, 1.0 / c.hs_b_rng),
    ];
    let hsf: [number, number, number] = [hs_rgb[0] * c.hs_r, hs_rgb[1] * -c.hs_g, hs_rgb[2] * -c.hs_b];
    hsf = [hsf[2] - hsf[1], hsf[0] - hsf[2], hsf[1] - hsf[0]];
    rgb = [rgb[0] + hsf[0], rgb[1] + hsf[1], rgb[2] + hsf[2]];
  }
  // 13. hue_shift_rgb —— Hue Shift RGB
  push("hue_shift_rgb", rgb);

  // Hue Shift CMY
  if (c.hs_cmy_enable) {
    const compl = 1.0 - tsn_pt;
    const hs_cmy: [number, number, number] = [
      ha_cmy[0] * ach_d * Math.pow(compl, 1.0 / c.hs_c_rng),
      ha_cmy[1] * ach_d * Math.pow(compl, 1.0 / c.hs_m_rng),
      ha_cmy[2] * ach_d * Math.pow(compl, 1.0 / c.hs_y_rng),
    ];
    let hsf: [number, number, number] = [hs_cmy[0] * -c.hs_c, hs_cmy[1] * c.hs_m, hs_cmy[2] * c.hs_y];
    hsf = [hsf[2] - hsf[1], hsf[0] - hsf[2], hsf[1] - hsf[0]];
    rgb = [rgb[0] + hsf[0], rgb[1] + hsf[1], rgb[2] + hsf[2]];
  }
  // 14. hue_shift_cmy —— Hue Shift CMY
  push("hue_shift_cmy", rgb);

  // Purity Limit Low
  const pt_lml_p = 1.0 + 4.0 * (1.0 - tsn_pt) * (c.pt_lml + c.pt_lml_r * ha_rgb_hs[0] + c.pt_lml_g * ha_rgb_hs[1] + c.pt_lml_b * ha_rgb_hs[2]);
  let ptf = 1.0 - Math.pow(tsn_pt, pt_lml_p);

  // Purity Limit High
  const pt_lmh_p = (1.0 - ach_d * (c.pt_lmh_r * ha_rgb_hs[0] + c.pt_lmh_b * ha_rgb_hs[2])) * (1.0 - c.pt_lmh * ach_d);
  ptf = Math.pow(ptf, pt_lmh_p);

  // Mid purity
  if (c.ptm_enable) {
    const ptm_low_f = (c.ptm_low_st === 0.0 || c.ptm_low_rng === 0.0) ? 1.0
      : 1.0 + c.ptm_low * Math.exp((-2.0 * ach_d * ach_d) / c.ptm_low_st) * Math.pow(1.0 - tsn_const, 1.0 / c.ptm_low_rng);
    const ptm_high_f = (c.ptm_high_st === 0.0 || c.ptm_high_rng === 0.0) ? 1.0
      : 1.0 + c.ptm_high * Math.exp((-2.0 * ach_d * ach_d) / c.ptm_high_st) * Math.pow(tsn_pt, 1.0 / (4.0 * c.ptm_high_rng));
    ptf = ptf * ptm_low_f * ptm_high_f;
  }
  // 15. purity_limit —— Purity Limit Low+High+Mid(记 ptf)
  push("purity_limit", rgb, { ptf });

  // Lerp to one
  rgb = [rgb[0] * ptf + 1.0 - ptf, rgb[1] * ptf + 1.0 - ptf, rgb[2] * ptf + 1.0 - ptf];
  // 16. lerp_to_one —— rgb*ptf + (1-ptf)
  push("lerp_to_one", rgb);

  // Inverse render space
  satL = rgb[0] * rs_w[0] + rgb[1] * rs_w[1] + rgb[2] * rs_w[2];
  rgb = [
    (satL * c.rs_sa - rgb[0]) / (c.rs_sa - 1.0),
    (satL * c.rs_sa - rgb[1]) / (c.rs_sa - 1.0),
    (satL * c.rs_sa - rgb[2]) / (c.rs_sa - 1.0),
  ];
  // 17. inverse_render_space —— 逆渲染空间
  push("inverse_render_space", rgb);

  // Display gamut + creative whitepoint
  rgb = displayGamutWhitepoint(rgb, tsn_const, c);
  // 18. display_gamut_wp —— displayGamutWhitepoint(显示 gamut + 创意白点)
  push("display_gamut_wp", rgb);

  // Post Brilliance
  if (c.brlp_enable) {
    const bo0 = rgb[0] - rgb[2];
    const bo1 = rgb[1] - (rgb[0] + rgb[2]) / 2.0;
    let brlp_ach_d = Math.sqrt(Math.max(0.0, bo0 * bo0 + bo1 * bo1)) / 4.0;
    brlp_ach_d = 1.1 * ((brlp_ach_d * brlp_ach_d) / (brlp_ach_d + 0.1));
    const bh0 = ach_d * ha_rgb[0], bh1 = ach_d * ha_rgb[1], bh2 = ach_d * ha_rgb[2];
    const brlp_m = c.brlp + c.brlp_r * bh0 + c.brlp_g * bh1 + c.brlp_b * bh2;
    const brlp_ex = Math.pow(2.0, brlp_m * brlp_ach_d * tsn);
    rgb = [rgb[0] * brlp_ex, rgb[1] * brlp_ex, rgb[2] * brlp_ex];
  }
  // 19. post_brilliance —— Post Brilliance
  push("post_brilliance", rgb);

  // Softplus per channel
  if (c.ptl_enable) {
    rgb = [softplus(rgb[0], c.ptl_c), softplus(rgb[1], c.ptl_m), softplus(rgb[2], c.ptl_y)];
  }
  // 20. softplus —— Softplus per channel
  push("softplus", rgb);

  // Final tonescale
  tsn = tsn * c.ts_m2;
  tsn = compress_toe_quadratic(tsn, c.tn_toe, 0);
  tsn = tsn * c.ts_dsc;
  // 21. final_tonescale —— tsn*ts_m2 → toe → *ts_dsc(记最终 tsn 标量)
  push("final_tonescale", rgb, { tsn });

  // Multiply back
  rgb = [rgb[0] * tsn, rgb[1] * tsn, rgb[2] * tsn];
  // 22. multiply_back —— rgb * tsn
  push("multiply_back", rgb);

  // Rec2020 (P3 limited)
  if (c.display_gamut === 2) {
    rgb = [Math.max(rgb[0], 0.0), Math.max(rgb[1], 0.0), Math.max(rgb[2], 0.0)];
    rgb = vdot(M_P3_TO_REC2020, rgb);
  }
  // 23. rec2020_limit —— (仅 display_gamut==2)
  push("rec2020_limit", rgb);

  // Clamp
  if (c.clamp) rgb = [Math.min(Math.max(rgb[0], 0.0), 1.0), Math.min(Math.max(rgb[1], 0.0), 1.0), Math.min(Math.max(rgb[2], 0.0), 1.0)];
  // 24. clamp —— (仅 c.clamp)
  push("clamp", rgb);

  // Inverse EOTF
  const eotf_p = 2.0 + c.eotf * 0.2;
  if (c.eotf > 0 && c.eotf < 4) rgb = [spowf(rgb[0], 1.0 / eotf_p), spowf(rgb[1], 1.0 / eotf_p), spowf(rgb[2], 1.0 / eotf_p)];
  // eotf 4/5 (PQ/HLG) 本 config 不触及
  // 25. inverse_eotf —— 逆 EOTF → 最终显示编码值(输出)
  push("inverse_eotf", rgb);

  return steps;
}
