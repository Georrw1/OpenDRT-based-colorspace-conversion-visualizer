#version 300 es
// [EN] OpenDRT v1.1.0 - GLSL Kernel. Faithfully ported from opendrt_v110.py _transform() full pipeline.
// [ZH] OpenDRT v1.1.0 —— GLSL 内核。忠实移植 opendrt_v110.py 的 _transform() 完整链路。
//
// [EN] Port fidelity (PORT_SPEC): Matrix constants copied directly; "weird" patterns like spowf/sdivf/toe preserved;
// [ZH] 移植忠实性(PORT_SPEC):矩阵常数直接复制自内核;spowf/sdivf/toe 等"奇怪写法"原样保留;
// [EN] No operations merged or reordered.
// [ZH] 不合并、不改运算顺序。本步支持 config = Standard look + rec1886 + egamut2 + linear。
// [EN] Standard look fixed parameters = LOOK_PRESETS["Standard"] (copied as GLSL constants).
// [ZH] Standard look 固定参数 = LOOK_PRESETS["Standard"](作为 GLSL 常量,直接复制);
// [EN] Solved constants / display config / in_gamut matrix passed as uniforms (TS solveConstants re-computes them).
// [ZH] 求解常数 / display 配置 / in_gamut 矩阵 作为 uniform 传入(TS 侧 solveConstants 复算)。
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;

// 求解常数(TS solveConstants,公式与 _solve_constants 完全一致)
uniform float u_ts_x0;
uniform float u_ts_s;
uniform float u_ts_s1;
uniform float u_ts_p;
uniform float u_ts_m2;
uniform float u_ts_dsc;
uniform float u_s_Lp100;

// display 配置
uniform int   u_in_oetf;        // 0=linear(本步)
uniform mat3  u_inMtx;          // in_gamut -> XYZ(column-major,u_inMtx * v = M @ v)
uniform int   u_display_gamut;  // 0=Rec709 ...
uniform int   u_eotf;           // 2=Rec1886
uniform int   u_cwp;            // 2=D65
uniform int   u_clamp;
uniform float u_cwp_norm;       // creative whitepoint 归一化常数(_CWP_NORM 查表结果)

const float SQRT3 = 1.73205080756887729353;
const float PI = 3.14159265358979323846;

// ---- Standard look 固定参数(LOOK_PRESETS["Standard"] + OpenDRTParams 默认,直接复制) ----
const float tn_toe = 0.003;
const float tn_off = 0.005;
const float cwp_lm = 0.25;
const float rs_sa = 0.35, rs_rw = 0.25, rs_bw = 0.55;
const float pt_lml = 0.25, pt_lml_r = 0.5, pt_lml_g = 0.0, pt_lml_b = 0.1;
const float pt_lmh = 0.25, pt_lmh_r = 0.5, pt_lmh_b = 0.0;
const float ptl_c = 0.06, ptl_m = 0.08, ptl_y = 0.06;
const float ptm_low = 0.4, ptm_low_rng = 0.25, ptm_low_st = 0.5;
const float ptm_high = -0.8, ptm_high_rng = 0.35, ptm_high_st = 0.4;
const float brl = 0.0, brl_r = -2.5, brl_g = -1.5, brl_b = -1.5, brl_rng = 0.5, brl_st = 0.35;
const float brlp = -0.5, brlp_r = -1.25, brlp_g = -1.25, brlp_b = -0.25;
const float hc_r = 1.0, hc_r_rng = 0.3;
const float hs_r = 0.6, hs_r_rng = 0.6, hs_g = 0.35, hs_g_rng = 1.0, hs_b = 0.66, hs_b_rng = 1.0;
const float hs_c = 0.25, hs_c_rng = 1.0, hs_m = 0.0, hs_m_rng = 1.0, hs_y = 0.0, hs_y_rng = 1.0;
// enable 标志(Standard 全部启用;tn_lcon/tn_hcon 禁用)
const int brl_enable = 1, brlp_enable = 1, hc_enable = 1;
const int hs_rgb_enable = 1, hs_cmy_enable = 1, ptm_enable = 1, ptl_enable = 1;
// Contrast Low/High:Standard 关闭(与 CPU 内核一致)。此 GLSL 路径为遗留代码,
// 实际渲染走 CPU evaluateCPU;此处保留忠实结构,enable=0 时下方模块为 no-op。
const int tn_lcon_enable = 0, tn_hcon_enable = 0;
const float tn_lcon = 0.0, tn_lcon_w = 0.5, tn_hcon = 0.0, tn_hcon_pv = 1.0, tn_hcon_st = 4.0;

// ---- 矩阵常数(column-major,由 opendrt_v110.py 直接生成,m * v = M @ v) ----
const mat3 M_XYZ_TO_P3D65 = mat3(2.4934969119414254,-0.8294889695615747,0.03584583024378445, -0.9313836179191238,1.7626640603183465,-0.0761723892680418, -0.40271078445071684,0.023624685841943594,0.9568845240076873);
const mat3 M_P3D65_TO_XYZ = mat3(0.48657094864821615,0.22897456406974875,-4e-17, 0.265667693169093,0.6917385218365062,0.04511338185890262, 0.19821728523436247,0.07928691409374498,1.0439443689009757);
const mat3 M_XYZ_TO_REC709 = mat3(3.2409699419045235,-0.9692436362808795,0.055630079696993635, -1.5373831775700944,1.87596750150772,-0.2039769588889765, -0.49861076029300355,0.041555057407175584,1.0569715142428782);
const mat3 M_P3_TO_REC2020 = mat3(0.7538330343617222,0.045743848965358214,-0.001210340354518394, 0.19859736905261643,0.9417772198116936,0.017601717301089993, 0.047569596585661844,0.012478931222948113,0.9836086230534288);
const mat3 M_CAT_D65_TO_DCI = mat3(0.9910855889320374,-0.0191021915525198,-8.0550322309136e-05, -0.027362287044525146,1.025837779045105,-0.001959888264536858, -0.018395662307739258,-0.00705372542142868,0.8782384395599365);
const mat3 M_CAT_D65_TO_D93 = mat3(0.9570342302322388,-0.017929695546627045,0.001275891438126564, -0.024717150256037712,0.9900198578834534,0.004279190674424171, 0.06240285933017731,0.02481195330619812,1.2934571504592896);
const mat3 M_CAT_D65_TO_D75 = mat3(0.981001079082489,-0.008434880524873734,0.000552809564396739, -0.011661925353109837,0.9965060949325562,0.001798408105969429, 0.02656140923500061,0.010569654405117035,1.1237472295761108);
const mat3 M_CAT_D65_TO_D60 = mat3(1.0118224620819092,0.005616828333586454,-0.000335735734552145, 0.007788793183863163,1.0015064477920532,-0.001050950028002262, -0.015778303146362305,-0.006285175681114197,0.9273666739463806);
const mat3 M_CAT_D65_TO_D55 = mat3(1.0258508920669556,0.012913385406136513,-0.000719940289855003, 0.017943982034921646,1.0021477937698364,-0.002181068062782288, -0.0332137793302536,-0.013242103159427643,0.8486801385879517);
const mat3 M_CAT_D65_TO_D50 = mat3(1.0425740480422974,0.022193536162376404,-0.001164883142337203, 0.03089117631316185,1.0018566846847534,-0.003420527093112469, -0.052812620997428894,-0.021073762327432632,0.761789083480835);
const mat3 M_CAT_D60_TO_D93 = mat3(0.9460569024085999,-0.023197969421744347,0.001692034304141998, -0.03195030242204666,0.9887458086013794,0.005723287351429462, 0.08317014575004578,0.03306175023317337,1.3948310613632202);
const mat3 M_CAT_D60_TO_D75 = mat3(0.9696599841117859,-0.013854577206075191,0.000931452261283994, -0.019138311967253685,0.9951338171958923,0.003060081973671913, 0.045009955763816833,0.017906226217746735,1.211798071861267);
const mat3 M_CAT_D60_TO_D65 = mat3(0.9883639216423035,-0.005540961865335703,0.000351537019014359, -0.007669100537896156,0.9985461235046387,0.001128837466239929, 0.016764163970947266,0.006673321127891541,1.0783357620239258);
const mat3 M_CAT_D60_TO_D55 = mat3(1.0138028860092163,0.007205651607364416,-0.000401133671402931, 0.010013150982558727,1.0005768537521362,-0.001214349642395973, -0.018498346209526062,-0.00737529993057251,0.9151356816291809);
const mat3 M_CAT_D60_TO_D50 = mat3(1.0302526950836182,0.016376648098230362,-0.00086457678116858, 0.022791046649217606,1.0002059936523438,-0.002546684816479683, -0.03926569223403931,-0.015666823834180832,0.8214220404624939);
const mat3 M_CAT_DCI_TO_D65 = mat3(1.0095160007476807,0.018799103796482086,0.000134543282911181, 0.026967544108629227,0.9753303527832031,0.002179034985601902, 0.021362081170082092,0.008227333426475525,1.138663649559021);
const mat3 M_CAT_DCI_TO_D93 = mat3(0.9656850099563599,0.000514572137035429,0.001542504876852036, 0.001837452407926321,0.9651667475700378,0.007026517763733864, 0.0912967324256897,0.036014653742313385,1.4728747606277466);
const mat3 M_CAT_DCI_TO_D75 = mat3(0.9901207685470581,0.010219721123576164,0.000743072712793946, 0.015138947404921055,0.9717181324958801,0.004217634908854961, 0.051104769110679626,0.020053662359714508,1.2795965671539307);
const mat3 M_CAT_DCI_TO_D60 = mat3(1.0215952396392822,0.024496877565979958,-0.00023391586728394, 0.03484867885708809,0.9769372344017029,0.000986687839031219, 0.003712520003318787,0.001203015446662903,1.0559426546096802);
const mat3 M_CAT_DCI_TO_D55 = mat3(1.0359457731246948,0.03187406808137894,-0.000653609400615096, 0.045093756169080734,0.9777445197105408,-0.000297372229397297, -0.015757381916046143,-0.006557449698448181,0.9663277864456177);
const mat3 M_CAT_DCI_TO_D50 = mat3(1.05306875705719,0.041235942393541336,-0.001137776765972376, 0.05812973156571388,0.9776936769485474,-0.001707592979073524, -0.03761008381843567,-0.015279222279787064,0.8673683404922485);

// ---- 数学辅助(忠实移植 DCTL 语义) ----
float sdivf(float a, float b) { return b == 0.0 ? 0.0 : a / b; }
float spowf(float a, float b) { return a <= 0.0 ? a : pow(a, b); }

float ctq(float x, float toe, int inv) {
  if (toe == 0.0) return x;
  if (inv != 0) return (x + sqrt(max(0.0, x * (4.0 * toe + x)))) / 2.0;
  return sdivf(spowf(x, 2.0), x + toe);
}
float chp(float x, float s, float p) { return spowf(sdivf(x, x + s), p); }
// 忠实移植自 OpenDRT_v110.dctl 518-530(Contrast Low 用)。
float compress_toe_cubic(float x, float m, float w, int inv) {
  if (m == 1.0) return x;
  float x2 = x * x;
  if (inv == 0) {
    return x * (x2 + m * w) / (x2 + w);
  } else {
    float p0 = x2 - 3.0 * m * w;
    float p1 = 2.0 * x2 + 27.0 * w - 9.0 * m * w;
    float p2 = pow(sqrt(x2 * p1 * p1 - 4.0 * p0 * p0 * p0) / 2.0 + x * p1 / 2.0, 1.0 / 3.0);
    return p0 / (3.0 * p2) + p2 / 3.0 + x / 3.0;
  }
}
// 忠实移植自 OpenDRT_v110.dctl 542-557(Contrast High 用)。
float contrast_high(float x, float p, float pv, float pv_lx, int inv) {
  float x0 = 0.18 * pow(2.0, pv);
  if (x < x0 || p == 1.0) return x;
  float o = x0 - x0 / p;
  float s0 = pow(x0, 1.0 - p) / p;
  float x1 = x0 * pow(2.0, pv_lx);
  float k1 = p * s0 * pow(x1, p) / x1;
  float y1 = s0 * pow(x1, p) + o;
  if (inv == 1)
    return x > y1 ? (x - y1) / k1 + x1 : pow((x - o) / s0, 1.0 / p);
  else
    return x > x1 ? k1 * (x - x1) + y1 : s0 * pow(x, p) + o;
}
float gauss_window(float x, float w) { return exp((-x * x) / w); }
float hue_offset(float h, float o) { return mod(h - o + PI, 2.0 * PI) - PI; }
// 内核原式:s * log(1 + exp(x/s))。float32 精度加固(不改算法,数学等价):
// 极负 x 时 exp(x/s) 极小,`1.0 + 极小` 在 float32 下发生吸收(1+ε 舍入回 1)使结果塌陷为 0;
// 该 0 经末端逆 EOTF pow(·,1/2.4) 的零点无穷斜率放大为 ~1e-4 输出误差(近黑通道)。
// 用 Kahan log1p 恒等式 log(1+y)=y*log(1+y)/((1+y)-1) 计算同一数学值,规避吸收。
// exp(x/s)>=0 恒成立,原 max(0,·) 恒为无操作。float64 下与原式一致,仅 float32 行为不同。
float softplus_c(float x, float s) {
  if (s < 1e-4) return x;
  if (x > 10.0 * s) return x;
  float y = exp(x / s);
  float u = 1.0 + y;
  float l1p = (u == 1.0) ? y : log(u) * (y / (u - 1.0));
  return s * l1p;
}

// display_gamut_whitepoint(DCTL 593-732)。rgb: P3D65 线性 ratios;tsn: tsn_const。
vec3 display_gamut_whitepoint(vec3 rgb, float tsn) {
  rgb = M_P3D65_TO_XYZ * rgb;
  vec3 cwp_neutral = rgb;
  float cwp_f = pow(tsn, 2.0 * cwp_lm);
  int dg = u_display_gamut;
  int cwp = u_cwp;
  if (dg < 3) {
    if (cwp == 0) rgb = M_CAT_D65_TO_D93 * rgb;
    else if (cwp == 1) rgb = M_CAT_D65_TO_D75 * rgb;
    else if (cwp == 3) rgb = M_CAT_D65_TO_D60 * rgb;
    else if (cwp == 4) rgb = M_CAT_D65_TO_D55 * rgb;
    else if (cwp == 5) rgb = M_CAT_D65_TO_D50 * rgb;
  } else if (dg == 3) {
    if (cwp == 0) rgb = M_CAT_D60_TO_D93 * rgb;
    else if (cwp == 1) rgb = M_CAT_D60_TO_D75 * rgb;
    else if (cwp == 2) rgb = M_CAT_D60_TO_D65 * rgb;
    else if (cwp == 4) rgb = M_CAT_D60_TO_D55 * rgb;
    else if (cwp == 5) rgb = M_CAT_D60_TO_D50 * rgb;
  } else {
    cwp_neutral = M_CAT_DCI_TO_D65 * rgb;
    if (cwp == 0) rgb = M_CAT_DCI_TO_D93 * rgb;
    else if (cwp == 1) rgb = M_CAT_DCI_TO_D75 * rgb;
    else if (cwp == 2) rgb = cwp_neutral;
    else if (cwp == 3) rgb = M_CAT_DCI_TO_D60 * rgb;
    else if (cwp == 4) rgb = M_CAT_DCI_TO_D55 * rgb;
    else if (cwp == 5) rgb = M_CAT_DCI_TO_D50 * rgb;
  }
  rgb = rgb * cwp_f + cwp_neutral * (1.0 - cwp_f);
  if (dg == 0) rgb = M_XYZ_TO_REC709 * rgb;
  else if (dg == 5) rgb = M_CAT_D65_TO_DCI * rgb;
  else rgb = M_XYZ_TO_P3D65 * rgb;
  rgb = rgb * (u_cwp_norm * cwp_f + 1.0 - cwp_f);
  return rgb;
}

float linearize(float v) {
  // 本步仅支持 linear(u_in_oetf == 0);其余 OETF 后续扩展。
  return v;
}

vec3 opendrt(vec3 rgbIn) {
  vec3 rgb = vec3(linearize(rgbIn.r), linearize(rgbIn.g), linearize(rgbIn.b));

  // 输入 gamut -> XYZ -> P3D65
  rgb = u_inMtx * rgb;
  rgb = M_XYZ_TO_P3D65 * rgb;

  // Render space desaturate (SatW)
  vec3 rs_w = vec3(rs_rw, 1.0 - rs_rw - rs_bw, rs_bw);
  float satL = dot(rgb, rs_w);
  rgb = vec3(satL) * rs_sa + rgb * (1.0 - rs_sa);

  // Offset
  rgb = rgb + tn_off;

  // Norm
  float tsn0 = sqrt(max(0.0, rgb.r * rgb.r + rgb.g * rgb.g + rgb.b * rgb.b)) / SQRT3;

  // Ratios
  rgb = vec3(sdivf(rgb.r, tsn0), sdivf(rgb.g, tsn0), sdivf(rgb.b, tsn0));

  // Opponent + achromatic
  float opp0 = rgb.r - rgb.b;
  float opp1 = rgb.g - (rgb.r + rgb.b) / 2.0;
  float ach_d_raw = sqrt(max(0.0, opp0 * opp0 + opp1 * opp1)) / 2.0;
  float ach_d = 1.25 * ctq(ach_d_raw, 0.25, 0);

  // Hue
  float hue = mod(atan(opp0, opp1) + PI + 1.10714931, 2.0 * PI);
  vec3 ha_rgb = vec3(
    gauss_window(hue_offset(hue, 0.1), 0.66),
    gauss_window(hue_offset(hue, 4.3), 0.66),
    gauss_window(hue_offset(hue, 2.3), 0.66));
  vec3 ha_rgb_hs = vec3(
    gauss_window(hue_offset(hue, -0.4), 0.66),
    ha_rgb.g,
    gauss_window(hue_offset(hue, 2.5), 0.66));
  vec3 ha_cmy = vec3(
    gauss_window(hue_offset(hue, 3.3), 0.5),
    gauss_window(hue_offset(hue, 1.3), 0.5),
    gauss_window(hue_offset(hue, -1.15), 0.5));

  float tsn = tsn0;
  // Brilliance
  if (brl_enable != 0) {
    float brl_tsf = pow(tsn / (tsn + 1.0), 1.0 - brl_rng);
    float brl_exf = (brl + brl_r * ha_rgb.r + brl_g * ha_rgb.g + brl_b * ha_rgb.b) * pow(ach_d, 1.0 / brl_st);
    float brl_ex = pow(2.0, brl_exf * (brl_exf < 0.0 ? brl_tsf : 1.0 - brl_tsf));
    tsn = tsn * brl_ex;
  }

  // Contrast Low(忠实移植自 DCTL 1024-1036)
  if (tn_lcon_enable == 1) {
    float lcon_m = pow(2.0, -tn_lcon);
    float lcon_w = tn_lcon_w / 4.0;
    lcon_w *= lcon_w;
    float lcon_cnst_sc = compress_toe_cubic(u_ts_x0, lcon_m, lcon_w, 1) / u_ts_x0;
    tsn *= lcon_cnst_sc;
    tsn = compress_toe_cubic(tsn, lcon_m, lcon_w, 0);
  }
  // Contrast High(忠实移植自 DCTL 1038-1044)
  if (tn_hcon_enable == 1) {
    float hcon_p = pow(2.0, tn_hcon);
    tsn = contrast_high(tsn, hcon_p, tn_hcon_pv, tn_hcon_st, 0);
  }

  // Hyperbolic Compression
  float tsn_pt = chp(tsn, u_ts_s1, u_ts_p);
  float tsn_const = chp(tsn, u_s_Lp100, u_ts_p);
  tsn = chp(tsn, u_ts_s, u_ts_p);

  // Hue Contrast R
  if (hc_enable != 0) {
    float hc_ts = 1.0 - tsn_const;
    float hc_c = hc_ts * (1.0 - ach_d) + ach_d * (1.0 - hc_ts);
    hc_c = hc_c * ach_d * ha_rgb.r;
    hc_ts = pow(hc_ts, 1.0 / hc_r_rng);
    float hc_f = hc_r * (hc_c - 2.0 * hc_c * hc_ts) + 1.0;
    rgb = vec3(rgb.r, rgb.g * hc_f, rgb.b * hc_f);
  }

  // Hue Shift RGB
  if (hs_rgb_enable != 0) {
    vec3 hs_rgb = vec3(
      ha_rgb_hs.r * ach_d * pow(tsn_pt, 1.0 / hs_r_rng),
      ha_rgb_hs.g * ach_d * pow(tsn_pt, 1.0 / hs_g_rng),
      ha_rgb_hs.b * ach_d * pow(tsn_pt, 1.0 / hs_b_rng));
    vec3 hsf = vec3(hs_rgb.r * hs_r, hs_rgb.g * -hs_g, hs_rgb.b * -hs_b);
    hsf = vec3(hsf.b - hsf.g, hsf.r - hsf.b, hsf.g - hsf.r);
    rgb = rgb + hsf;
  }

  // Hue Shift CMY
  if (hs_cmy_enable != 0) {
    float compl_ = 1.0 - tsn_pt;
    vec3 hs_cmy = vec3(
      ha_cmy.r * ach_d * pow(compl_, 1.0 / hs_c_rng),
      ha_cmy.g * ach_d * pow(compl_, 1.0 / hs_m_rng),
      ha_cmy.b * ach_d * pow(compl_, 1.0 / hs_y_rng));
    vec3 hsf = vec3(hs_cmy.r * -hs_c, hs_cmy.g * hs_m, hs_cmy.b * hs_y);
    hsf = vec3(hsf.b - hsf.g, hsf.r - hsf.b, hsf.g - hsf.r);
    rgb = rgb + hsf;
  }

  // Purity Limit Low
  float pt_lml_p = 1.0 + 4.0 * (1.0 - tsn_pt) * (pt_lml + pt_lml_r * ha_rgb_hs.r + pt_lml_g * ha_rgb_hs.g + pt_lml_b * ha_rgb_hs.b);
  float ptf = 1.0 - pow(tsn_pt, pt_lml_p);

  // Purity Limit High
  float pt_lmh_p = (1.0 - ach_d * (pt_lmh_r * ha_rgb_hs.r + pt_lmh_b * ha_rgb_hs.b)) * (1.0 - pt_lmh * ach_d);
  ptf = pow(ptf, pt_lmh_p);

  // Mid purity
  if (ptm_enable != 0) {
    float ptm_low_f = (ptm_low_st == 0.0 || ptm_low_rng == 0.0) ? 1.0
      : 1.0 + ptm_low * exp((-2.0 * ach_d * ach_d) / ptm_low_st) * pow(1.0 - tsn_const, 1.0 / ptm_low_rng);
    float ptm_high_f = (ptm_high_st == 0.0 || ptm_high_rng == 0.0) ? 1.0
      : 1.0 + ptm_high * exp((-2.0 * ach_d * ach_d) / ptm_high_st) * pow(tsn_pt, 1.0 / (4.0 * ptm_high_rng));
    ptf = ptf * ptm_low_f * ptm_high_f;
  }

  // Lerp to one
  rgb = rgb * ptf + (1.0 - ptf);

  // Inverse render space
  satL = dot(rgb, rs_w);
  rgb = (vec3(satL) * rs_sa - rgb) / (rs_sa - 1.0);

  // Display gamut + creative whitepoint
  rgb = display_gamut_whitepoint(rgb, tsn_const);

  // Post Brilliance
  if (brlp_enable != 0) {
    float bo0 = rgb.r - rgb.b;
    float bo1 = rgb.g - (rgb.r + rgb.b) / 2.0;
    float brlp_ach_d = sqrt(max(0.0, bo0 * bo0 + bo1 * bo1)) / 4.0;
    brlp_ach_d = 1.1 * ((brlp_ach_d * brlp_ach_d) / (brlp_ach_d + 0.1));
    vec3 brlp_ha_rgb = vec3(ach_d) * ha_rgb;
    float brlp_m = brlp + brlp_r * brlp_ha_rgb.r + brlp_g * brlp_ha_rgb.g + brlp_b * brlp_ha_rgb.b;
    float brlp_ex = pow(2.0, brlp_m * brlp_ach_d * tsn);
    rgb = rgb * brlp_ex;
  }

  // Softplus per channel
  if (ptl_enable != 0) {
    rgb = vec3(softplus_c(rgb.r, ptl_c), softplus_c(rgb.g, ptl_m), softplus_c(rgb.b, ptl_y));
  }

  // Final tonescale
  tsn = tsn * u_ts_m2;
  tsn = ctq(tsn, tn_toe, 0);
  tsn = tsn * u_ts_dsc;

  // Multiply back
  rgb = rgb * tsn;

  // Rec2020 (P3 limited)
  if (u_display_gamut == 2) {
    rgb = max(rgb, 0.0);
    rgb = M_P3_TO_REC2020 * rgb;
  }

  // Clamp
  if (u_clamp != 0) rgb = clamp(rgb, 0.0, 1.0);

  // Inverse EOTF
  float eotf_p = 2.0 + float(u_eotf) * 0.2;
  if (u_eotf > 0 && u_eotf < 4) {
    rgb = vec3(spowf(rgb.r, 1.0 / eotf_p), spowf(rgb.g, 1.0 / eotf_p), spowf(rgb.b, 1.0 / eotf_p));
  }
  // eotf 4/5 (PQ/HLG) 本 config 不触及。

  return rgb;
}

void main() {
  vec3 rgbIn = texture(u_input, v_uv).rgb;
  fragColor = vec4(opendrt(rgbIn), 1.0);
}
