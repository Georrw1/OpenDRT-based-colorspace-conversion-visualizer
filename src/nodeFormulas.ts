// 25 个 DAG 节点的公式 + 原理讲解。
// 【忠实性】所有公式严格从 src/drt.ts 的 evaluateCPUTrace 逐行转写(不自编、不简化)。
//   LaTeX 里的符号与代码变量一一对应,行号见注释,便于你对照内核。
//   theory 是色彩科学层面的"为什么这么做",帮助学习,不影响计算。
//
// KaTeX 渲染:formula 里每个字符串是一条独立公式(display 模式)。

export interface NodeFormula {
  formula: string[];   // LaTeX 公式(可多条)
  theory: { zh: string; en: string; };      // 原理讲解(中文,HTML 片段允许)
  vars?: { zh: string; en: string; };       // 变量说明(可选)
}

// 供查表用:id -> NodeFormula
export const NODE_FORMULAS: Record<string, NodeFormula> = {
  input: {
    formula: [String.raw`\mathbf{c}_{in} = (R,\,G,\,B)_{\text{encoded}}`],
    theory: { zh: "原始输入,尚处于编码态(可能是 log 曲线或伽马编码)。此时的数值不是线性光,不能直接做加减乘除运算——必须先线性化。", en: "Raw input, still in encoded state (could be log or gamma encoded). These values are not linear light and cannot be directly multiplied or added—they must be linearized first." },
  },
  linearize: {
    formula: [String.raw`c' = \mathrm{OETF}^{-1}(c)`],
    theory: { zh: "按你选的 Input OETF(transform curve)做<b>逆解码</b>,把编码值还原成场景线性光(scene-linear)。例如 ACEScct、ARRI LogC、S-Log3 各有不同的解码分段函数。只有回到线性域,后续的矩阵变换和色调映射才在物理上成立。", en: "Applies the inverse of the selected Input OETF (transform curve) to convert encoded values back to scene-linear light. For example, ACEScct, ARRI LogC, and S-Log3 have different decoding piecewise functions. Subsequent matrix and tonescale operations are only physically valid in the linear domain." },
    vars: { zh: "OETF⁻¹ 为分段函数,见 linearizeScalar(drt.ts 198 行)。", en: "OETF⁻¹ is a piecewise function, see linearizeScalar (drt.ts line 198)." },
  },
  in_gamut_to_xyz: {
    formula: [String.raw`\mathbf{c}_{XYZ} = M_{\text{in}\to XYZ}\;\mathbf{c}'`],
    theory: { zh: "把输入色域(如 ACEScg/Rec.709/E-Gamut2)的 RGB 用 3×3 矩阵变换到设备无关的 <b>CIE XYZ(D65)</b>。XYZ 是一切色彩空间的\"中转站\"——先进 XYZ,才能再转到任意目标空间。矩阵由输入色域的三原色 + 白点唯一确定。", en: "Transforms RGB from the input gamut (e.g., ACEScg/Rec.709/E-Gamut2) to device-independent CIE XYZ (D65) using a 3×3 matrix. XYZ is the universal 'hub' for all color spaces—you must enter XYZ to convert to any target space." },
    vars: { zh: "M 为 INPUT_GAMUT_MATRICES[in_gamut]。", en: "M is INPUT_GAMUT_MATRICES[in_gamut]." },
  },
  xyz_to_p3d65: {
    formula: [String.raw`\mathbf{c}_{rs} = M_{XYZ\to P3D65}\;\mathbf{c}_{XYZ}`],
    theory: { zh: "从 XYZ 转到 OpenDRT 的<b>内部渲染色域 P3-D65</b>。所有色调映射与色域压缩都在这个空间里进行。选 P3-D65 是折中:比 Rec.709 宽(能容纳更多饱和色),又比 Rec.2020 收敛(数值行为更稳)。", en: "Transforms from XYZ to OpenDRT's internal rendering gamut, P3-D65. All tonescale mapping and gamut compression occur in this space. P3-D65 is chosen as a compromise: wider than Rec.709 (accommodates more saturated colors) but more constrained than Rec.2020 (more stable numerical behavior)." },
  },
  render_desaturate: {
    formula: [
      String.raw`w = (rs_{rw},\;1-rs_{rw}-rs_{bw},\;rs_{bw})`,
      String.raw`L = \mathbf{c}\cdot w`,
      String.raw`\mathbf{c} \leftarrow L\cdot rs_{sa} + \mathbf{c}\,(1-rs_{sa})`,
    ],
    theory: { zh: "朝加权亮度 L 方向做<b>部分去饱和</b>。这是 OpenDRT 的关键设计:在压缩<i>之前</i>先适度降低饱和度,可以抑制高饱和色(如纯红激光、霓虹)在色调映射时产生的\"断层/溢出\"。rs_sa 控制去饱和量,rs_rw/rs_bw 控制红蓝通道权重。", en: "Applies partial desaturation towards the weighted luminance L. This is a key OpenDRT design: slightly reducing saturation before compression prevents highly saturated colors (like pure red lasers or neon) from 'clipping/breaking' during tone mapping." },
    vars: { zh: "rs_sa=色彩对比量, rs_rw/rs_bw=红/蓝权重。", en: "rs_sa=color contrast amount, rs_rw/rs_bw=red/blue weight." },
  },
  offset: {
    formula: [String.raw`\mathbf{c} \leftarrow \mathbf{c} + tn_{\text{off}}`],
    theory: { zh: "加一个很小的黑位偏移。作用有二:①避免后面除以范数时出现除零;②控制暗部行为——正偏移能把暗部细节稍微提亮,增加阴影层次(类似相机 DRT 的做法)。官方强调 offset 不应为负。", en: "Adds a tiny black level offset. It serves two purposes: ① prevents divide-by-zero errors later when dividing by the norm; ② controls shadow behavior—a positive offset slightly lifts shadow details, increasing shadow gradation. The official spec emphasizes offset should not be negative." },
  },
  norm: {
    formula: [String.raw`tsn_0 = \frac{\sqrt{R^2+G^2+B^2}}{\sqrt{3}}`],
    theory: { zh: "计算 RGB 向量的<b>范数 tsn₀</b>,作为这个像素的\"整体亮度大小\"信号。除以 √3 是归一化:让中性灰 (x,x,x) 的范数正好等于 x。后续所有 tonescale(色调映射)都作用在这个标量上,而不是直接作用在 RGB——这样能<b>把亮度压缩和色彩方向解耦</b>。", en: "Calculates the norm tsn₀ of the RGB vector, representing the 'overall brightness magnitude' of this pixel. Dividing by √3 normalizes it so that a neutral gray (x,x,x) has exactly a norm of x. All subsequent tonescale operations apply to this scalar, decoupling brightness compression from color direction." },
  },
  ratios: {
    formula: [String.raw`\mathbf{r} = \dfrac{\mathbf{c}}{tsn_0}`],
    theory: { zh: "把 RGB 除以范数,得到<b>色度方向(比值)</b>。现在 r 只携带\"颜色朝哪个方向\",亮度大小已被抽出到 tsn₀。这是 OpenDRT 的核心策略:<b>亮度归亮度、颜色归颜色</b>,分别处理,最后再乘回来(见 multiply_back 节点)。", en: "Divides RGB by the norm to obtain the chromaticity direction (ratios). Now 'r' only carries 'which direction the color points to', while the brightness magnitude is isolated in tsn₀. This is OpenDRT's core strategy: separate brightness and color, process them independently, and multiply them back later." },
  },
  opponent_hue: {
    formula: [
      String.raw`o_0 = r_R - r_B,\quad o_1 = r_G - \tfrac{r_R+r_B}{2}`,
      String.raw`ach_d = 1.25\cdot\mathrm{toe}\!\left(\tfrac{\sqrt{o_0^2+o_1^2}}{2},\,0.25\right)`,
      String.raw`hue = \mathrm{atan2}(o_0,\,o_1)+\pi+1.10714931`,
    ],
    theory: { zh: "构建<b>对立色空间</b>(opponent):o₀≈红-蓝,o₁≈绿-品红,模拟人眼的红绿/黄蓝对立通道。由此算出:<b>色相角 hue</b>(颜色的方向)和 <b>ach_d 无色度量</b>(离灰轴多远=有多\"彩\")。后面的 brilliance、hue shift、purity 都靠这两个量来\"认色相、判饱和\"。", en: "Constructs an opponent color space: o₀ ≈ Red-Blue, o₁ ≈ Green-Magenta, simulating human eye opponent channels. From this, it calculates hue angle (color direction) and ach_d achromatic distance (how 'colorful' it is). Subsequent steps rely on these to identify hue and saturation." },
    vars: { zh: "toe(x,0.25)=二次趾部压缩; atan2 常数为色相对齐偏移。", en: "toe(x,0.25)=quadratic toe compression; atan2 constant is hue alignment offset." },
  },
  brilliance: {
    formula: [
      String.raw`tsf = \left(\tfrac{tsn}{tsn+1}\right)^{1-brl_{rng}}`,
      String.raw`exf = (brl + brl_R\,h_R + brl_G\,h_G + brl_B\,h_B)\cdot ach_d^{\,1/brl_{st}}`,
      String.raw`tsn \leftarrow tsn\cdot 2^{\,exf\cdot(exf<0\,?\,tsf:1-tsf)}`,
    ],
    theory: { zh: "按<b>色相</b>(h_R/G/B 是色相高斯窗)和<b>饱和度</b>(ach_d)对亮度 tsn 做局部增益。目的:让某些色相(如天空蓝、肤色)在<b>不改变颜色</b>的前提下更明亮或更沉。指数里的 tsf 让效果随亮度平滑过渡,正/负增益走不同分支保证单调。", en: "Applies local gain to the brightness tsn based on hue and saturation (ach_d). Purpose: to make certain hues (like sky blue, skin tones) appear brighter or deeper without changing their color. The tsf exponent ensures a smooth transition across brightness levels." },
    vars: { zh: "h_R/G/B=ha_rgb 色相权重; 默认 brl=0(总量为 0,仅分通道微调)。", en: "h_R/G/B=ha_rgb hue weights; default brl=0 (total is 0, only fine-tune per channel)." },
  },
  hyperbolic_compress: {
    formula: [
      String.raw`f(x;s,p) = \left(\dfrac{x}{x+s}\right)^{p}`,
      String.raw`tsn \leftarrow f(tsn;\,ts_{s},\,ts_{p})`,
    ],
    theory: { zh: "<b>tonescale 的核心非线性</b>。双曲线 x/(x+s) 把 [0,∞) 的场景光压进 [0,1) 的显示范围:s 决定\"肩部\"位置(高光何时开始压)、幂 p 决定对比度斜率。你调的 <b>tn_sh</b> 通过 solveConstants 影响 s,<b>tn_con</b> 影响 p。同时算出 tsn_pt、tsn_const 两个副本供后续色彩处理复用。", en: "The core non-linearity of the tonescale. A hyperbolic curve x/(x+s) compresses scene light from [0,∞) into the display range [0,1). 's' determines the 'shoulder' (when highlights start to compress), and 'p' determines the contrast slope. Generates tsn_pt and tsn_const copies for later use." },
    vars: { zh: "ts_s,ts_p 由 solveConstants 从 tn_sh/tn_con/tn_Lp/tn_Lg 求解。", en: "ts_s,ts_p are solved by solveConstants from tn_sh/tn_con/tn_Lp/tn_Lg." },
  },
  hue_contrast: {
    formula: [
      String.raw`t = 1-tsn_{const},\quad c = t(1-ach_d)+ach_d(1-t)`,
      String.raw`f = hc_R\big(c' - 2c'\,t^{1/hc_{rrng}}\big)+1`,
      String.raw`(G,B) \leftarrow (G\cdot f,\;B\cdot f)`,
    ],
    theory: { zh: "只在<b>红色相区</b>施加对比调制(c' 里乘了红色相窗 h_R)。它按亮度 t 对 G、B 通道做增减,从而改变红色区域的色彩对比感——比如让暗红更浓、亮红更透。R 通道不动,保证红色主方向稳定。", en: "Applies contrast modulation exclusively in the red hue region. It adjusts the G and B channels based on brightness 't', altering the perceived contrast of red areas—making dark reds richer and bright reds more translucent, without shifting the primary red direction." },
  },
  hue_shift_rgb: {
    formula: [
      String.raw`s_k = h^{hs}_k\cdot ach_d\cdot tsn_{pt}^{\,1/rng_k}`,
      String.raw`f = (s_R\,hs_R,\,-s_G\,hs_G,\,-s_B\,hs_B)`,
      String.raw`\mathbf{r}\leftarrow\mathbf{r}+(f_B{-}f_G,\,f_R{-}f_B,\,f_G{-}f_R)`,
    ],
    theory: { zh: "在 R/G/B 主色相方向做<b>色相偏移</b>。真实胶片/感光在高光处色相会漂移(如红色高光偏橙),这一步<b>刻意引入受控的色相偏移</b>来复现讨喜的\"电影感\",并修正压缩带来的色相失真。偏移量随饱和度 ach_d 和亮度 tsn_pt 调制,暗部/灰部几乎不受影响。", en: "Applies hue shifts along the primary R/G/B directions. Real film/sensors exhibit hue shifts in highlights (e.g., red highlights turning orange). This step intentionally introduces controlled hue shifts to replicate pleasing 'film-like' aesthetics and correct compression-induced hue distortion." },
    vars: { zh: "h^hs=ha_rgb_hs 色相窗; rng_k=hs_r/g/b_rng 范围。", en: "h^hs=ha_rgb_hs hue window; rng_k=hs_r/g/b_rng range." },
  },
  hue_shift_cmy: {
    formula: [
      String.raw`s_k = h^{cmy}_k\cdot ach_d\cdot(1-tsn_{pt})^{1/rng_k}`,
      String.raw`f = (-s_C\,hs_C,\,s_M\,hs_M,\,s_Y\,hs_Y)`,
      String.raw`\mathbf{r}\leftarrow\mathbf{r}+(f_B{-}f_G,\,f_R{-}f_B,\,f_G{-}f_R)`,
    ],
    theory: { zh: "与上一步对称,但作用在 <b>C/M/Y 补色方向</b>,且用 (1−tsn_pt) 调制(偏向暗部/中调)。RGB 与 CMY 两步合起来,能对整个色相环做精细塑形,是 OpenDRT 色相响应\"讨喜\"的关键。", en: "Symmetrical to the previous step, but operates along the secondary C/M/Y complementary directions, modulated by (1−tsn_pt) to favor shadows/midtones. Together, the RGB and CMY shifts precisely sculpt the entire hue ring." },
  },
  purity_limit: {
    formula: [
      String.raw`p_{low} = 1+4(1-tsn_{pt})\,(pt_{lml}+\textstyle\sum pt_{lml,k}h_k)`,
      String.raw`ptf = \big(1-tsn_{pt}^{\,p_{low}}\big)^{p_{high}}\cdot f_{mid}`,
    ],
    theory: { zh: "计算<b>纯度保留系数 ptf∈[0,1]</b>——这是 chroma/purity 压缩曲线的来源。ptf 越小,颜色越被拉向白色(高光去饱和)。Low 段控制随亮度的整体纯度衰减,High 段按饱和度 ach_d 再调制,Mid 段(可选)微调中间调纯度。物理动机:真实高光会\"漂白\",纯度限制让高光自然地去饱和而非溢出成硬色块。", en: "Calculates the purity preservation factor ptf∈[0,1]—the source of the chroma/purity compression curve. A smaller ptf pulls the color closer to white (highlight desaturation). Physical motivation: real highlights 'bleach' out; purity limits allow highlights to naturally desaturate instead of clipping into solid colored blocks." },
    vars: { zh: "p_high 与 f_mid 见 drt.ts 716–725 行。", en: "p_high and f_mid see drt.ts lines 716–725." },
  },
  lerp_to_one: {
    formula: [String.raw`\mathbf{r}\leftarrow \mathbf{r}\cdot ptf + (1-ptf)`],
    theory: { zh: "把色度方向 r 与<b>纯白 (1,1,1)</b> 按 ptf 线性插值,<b>正式应用</b>上一步算出的纯度压缩。ptf=1 保持原色,ptf=0 完全变白。这一步之后,高光处的高饱和色就被自然地\"洗\"向白色。", en: "Linearly interpolates the chromaticity direction 'r' with pure white (1,1,1) using ptf, officially applying the purity compression calculated in the previous step. ptf=1 keeps the original color, ptf=0 turns it completely white." },
  },
  inverse_render_space: {
    formula: [
      String.raw`L = \mathbf{c}\cdot w`,
      String.raw`\mathbf{c}\leftarrow \dfrac{L\cdot rs_{sa}-\mathbf{c}}{rs_{sa}-1}`,
    ],
    theory: { zh: "<b>撤销</b> render_desaturate 那一步的去饱和(数学上的逆运算)。之前去饱和是为了让压缩过程更稳,现在压缩已完成,把饱和度还原回来,恢复应有的色彩表达。这是一对\"先降后升\"的操作。", en: "Undoes the desaturation from the earlier render_desaturate step (mathematical inverse). The prior desaturation stabilized the compression process; now that compression is done, saturation is restored to its proper expression." },
  },
  display_gamut_wp: {
    formula: [
      String.raw`\mathbf{c}\leftarrow M_{P3D65\to display}\;\big(\mathrm{CAT}_{cwp}(\mathbf{c})\big)`,
      String.raw`cwp_f = tsn_{const}^{\,2\,cwp_{lm}}`,
    ],
    theory: { zh: "变换到<b>目标显示色域</b>(Rec.709/P3/Rec.2020…),并施加<b>创意白点(cwp)</b>。通过色适应变换(CAT)把白点从 D65 挪向 D50/D60 等,可让画面整体偏暖/偏冷。cwp_lm 限制影响范围——比如只让高光偏暖、中间调保持中性。", en: "Transforms to the target display gamut (Rec.709/P3/Rec.2020...) and applies the creative white point (cwp). A Chromatic Adaptation Transform (CAT) shifts the white point from D65 towards D50/D60, warming or cooling the image." },
    vars: { zh: "CAT=Bradford 类色适应矩阵; 见 displayGamutWhitepoint(drt.ts 247)。", en: "CAT=Bradford-like chromatic adaptation matrix; see displayGamutWhitepoint(drt.ts 247)." },
  },
  post_brilliance: {
    formula: [
      String.raw`ach_d' = 1.1\cdot\dfrac{d^2}{d+0.1},\ \ d=\tfrac{\sqrt{o_0^2+o_1^2}}{4}`,
      String.raw`m = brlp+\textstyle\sum brlp_k\,ach_d\,h_k`,
      String.raw`\mathbf{c}\leftarrow \mathbf{c}\cdot 2^{\,m\cdot ach_d'\cdot tsn}`,
    ],
    theory: { zh: "在<b>显示空间</b>做第二次明亮度调制(与前面的 brilliance 呼应,但基于显示后的对立色重新算 ach_d')。用于对高光区域的色彩表现做最后修饰,让特定色相的高光更\"透亮\"或更收敛。", en: "Applies a second brightness modulation in the display space (echoing the earlier brilliance, but recalculating ach_d' based on post-display opponent colors). Used for final touches on highlight color rendition." },
  },
  softplus: {
    formula: [
      String.raw`\mathrm{sp}(x;s)=s\,\ln\!\big(1+e^{x/s}\big)`,
      String.raw`(R,G,B)\leftarrow\big(\mathrm{sp}(R;ptl_C),\mathrm{sp}(G;ptl_M),\mathrm{sp}(B;ptl_Y)\big)`,
    ],
    theory: { zh: "对每个通道做 <b>softplus 平滑限幅</b>。softplus 是 ReLU 的光滑版:能<b>防止负值</b>(负光无物理意义),又不像硬 clamp 那样产生突变,而是柔和地把接近 0 的值\"抬\"起来。ptl_c/m/y 控制三通道各自的柔化强度。", en: "Applies softplus smooth clipping to each channel. Softplus is a smooth version of ReLU: it prevents negative values (negative light is physically meaningless) while softly lifting near-zero values without the abrupt changes of a hard clamp." },
  },
  final_tonescale: {
    formula: [
      String.raw`tsn\leftarrow tsn\cdot ts_{m2}`,
      String.raw`tsn\leftarrow \mathrm{toe}(tsn,\,tn_{toe})`,
      String.raw`tsn\leftarrow tsn\cdot ts_{dsc}`,
    ],
    theory: { zh: "组装<b>最终要乘回颜色的亮度标量</b>。ts_m2 是压缩系统求解出的主缩放;<b>toe(趾部)</b>压缩深暗部、平滑过渡到显示黑;ts_dsc 是显示缩放(把 [0,1] 映射到目标峰值 nits 的归一因子,SDR 下=100/Lp)。你调的 <b>tn_toe</b> 就作用在这里。", en: "Assembles the final brightness scalar to be multiplied back into the color. Applies the main scaling ts_m2, compresses the deep shadows using a toe function to smoothly transition to display black, and applies the display scale ts_dsc." },
    vars: { zh: "ts_m2,ts_dsc 由 solveConstants 求解。", en: "ts_m2,ts_dsc are solved by solveConstants." },
  },
  multiply_back: {
    formula: [String.raw`\mathbf{c}_{disp}=\mathbf{r}\cdot tsn`],
    theory: { zh: "把处理好的<b>色度方向 r</b> 乘回<b>最终亮度 tsn</b>,重新合成出显示线性颜色。这一步兑现了 ratios 节点\"亮度色彩解耦\"的承诺——颜色和亮度各自独立处理完,现在合体。", en: "Multiplies the processed chromaticity direction 'r' back with the final brightness 'tsn', reconstructing the display-linear color. This fulfills the promise of the ratios node—brightness and color are now recombined." },
  },
  rec2020_limit: {
    formula: [String.raw`\mathbf{c}\leftarrow M_{P3\to Rec2020}\,\max(\mathbf{c},0)\quad(\text{仅 }dg{=}2)`],
    theory: { zh: "仅当显示目标是 Rec.2020(display_gamut==2)时执行:先钳掉负值,再从 P3 变换到 Rec.2020,把超出 P3 的色域限制住。默认的 Rec.1886/sRGB 目标不走这一步。", en: "Executed only when the display target is Rec.2020: clamps negative values and transforms from P3 to Rec.2020, restricting the gamut to within P3 limits. Default Rec.1886/sRGB targets skip this step." },
  },
  clamp: {
    formula: [String.raw`\mathbf{c}\leftarrow \mathrm{clamp}(\mathbf{c},\,0,\,1)`],
    theory: { zh: "把 RGB 硬钳到 [0,1](仅当 clamp 开启)。这是显示编码前的安全兜底——显示器无法表现超出 [0,1] 的值。经过前面的 softplus 和纯度限制,到这里通常已经几乎没有需要钳的值了。", en: "Hard clamps RGB to [0,1] (only if clamp is enabled). A safety fallback before display encoding, as displays cannot represent values outside [0,1]. Usually, softplus and purity limits handle this naturally." },
  },
  inverse_eotf: {
    formula: [
      String.raw`p = 2.0 + eotf\cdot 0.2`,
      String.raw`\mathbf{c}_{out}=\mathbf{c}^{\,1/p}\quad(0<eotf<4)`,
    ],
    theory: { zh: "<b>最终编码步</b>:施加显示 EOTF 的逆(即 OETF),把显示线性值编码成显示器实际接收的信号。例如 Rec.1886 约等于 2.4 伽马、sRGB 约 2.2。编码后的值就是你在屏幕上看到的最终像素。PQ/HLG(eotf 4/5)走另外的曲线,本配置不触及。", en: "The final encoding step: applies the inverse of the display EOTF (i.e., OETF) to encode display-linear values into the actual signal received by the monitor (e.g., ~2.4 gamma for Rec.1886, ~2.2 for sRGB). This encoded value is what you finally see on the screen." },
    vars: { zh: "p 为等效伽马; 见 drt.ts 797 行。", en: "p is the equivalent gamma; see drt.ts line 797." },
  },
};
