# 阶段 3 Web 原型 · GLSL 移植简报(给实现者)

## 背景与红线
本项目把已验证的 Python 内核 `/home/user/workspace/opendrt/opendrt_v110.py`(OpenDRT v1.1.0 显示渲染变换)搬进浏览器,用 **WebGL2 / GLSL fragment shader** 在 GPU 上实时运行。

**移植忠实性(PORT_SPEC,不可违反):**
1. 矩阵常数**直接从 `opendrt_v110.py` 复制**数值,禁止自己推导/重算。
2. 内核里"奇怪的写法"**原样保留**,禁止优化、禁止合并、禁止改运算顺序。
3. 禁止参考任何旧简化原型(如 `opendrt_pipeline.py`、`opendrt_prototype.cube`)。
4. **回归失败时修移植,不放宽阈值。**

## 已就绪(不要重写)
- `package.json` / `tsconfig.json` / `vite.config.ts` — 工程配置(原生 TS + Vite,无框架)。
- `src/params.ts` — 参数 schema,枚举与内核一一对应,含 `DEFAULT_PARAMS`、`SLIDERS`、`DISPLAY_ENCODING`。
- `public/baseline.json` — **回归基准**,由 Python 内核生成(config=Standard/rec1886/egamut2/linear,119 个采样,每条含 `in`(输入gamut线性RGB)与 `out`(最终显示编码RGB))。GLSL 输出必须逐像素对齐,`max abs err < 1e-4`。

## 要实现的文件
1. `src/shaders/opendrt.frag` — **GLSL 内核**。忠实移植 `opendrt_v110.py` 的 `_transform()` 完整链路(Input→Linearize→InGamut→ColorMatrix→SatW→Offset→Norm→Ratios→Opponent→Hue windows→Brilliance→Contrast→Hyperbolic→HueContrast/Shift→Purity→LerpToOne→SatWInverse→DisplayGamut→PostBrilliance→Softplus→Toe→Multiply→Rec2020→Clamp→InverseEOTF)。
   - 本步**只需支持 config = Standard look + rec1886 + egamut2 + linear**(即 baseline.json 的 config),其余枚举可后续扩。但算法节点**一个都不能省**。
   - 所有辅助函数(linearize/vdot/sdivf3f/hypotf3/opponent/gauss_window/hue_offset/compress_toe_quadratic/compress_toe_cubic/contrast_high/compress_hyperbolic_power/display_gamut_whitepoint/softplus/spowf3/eotf 等)按 Python 定义逐一移植成 GLSL 函数。
   - 求解常数(ts_x0/ts_x1/ts_y1/ts_s/ts_s1/ts_p/ts_m2/ts_dsc/s_Lp100 等 `_solve_constants()` 的产物)可在 TS 侧用 JS 复算后作为 uniform 传入,或在 shader 里复算 —— 二选一,但公式必须与 Python `_solve_constants()` 完全一致。
   - Standard look 的固定参数(rs_rw/rs_bw/rs_sa/tn_off/各 enable 标志/hs_*/pt_*/ptm_* 等)从内核 `LOOK_PRESETS["Standard"]` 与 `OpenDRTParams` 默认值读出,作为 GLSL 常量或 uniform。
2. `src/gl/context.ts` — WebGL2 上下文初始化(需 `EXT_color_buffer_float` 支持浮点渲染,失败给出提示)。
3. `src/gl/program.ts` — shader 编译/链接封装,附带清晰的编译错误日志。
4. `src/gl/fullscreenPass.ts` — 全屏三角形渲染管线(把输入纹理或输入坐标喂给 frag)。
5. `src/panel.ts` — 参数面板:用 `params.ts` 的 `LOOKS/DISPLAYS/IN_GAMUTS/IN_OETFS` 生成下拉,`SLIDERS` 生成滑块;改动触发回调(重绘)。
6. `src/views/regression.ts` — **回归校验页**:读 `baseline.json`,把 119 个 `in` 打包成纹理喂 GLSL,读回输出与 `out` 逐点比对,渲染一张表(label / in / expected / actual / abs err),`max err<1e-4` 显示绿色 PASS,否则红色 FAIL 并列出最差 10 个点。
7. `src/views/ciePlot.ts` — CIE 1931 色度图:Canvas2D 画静态背景(光谱轨迹+三层色域三角 egamut2/p3d65/rec709+D65),叠加至少一条 primaries 射线的 path-to-white(可用 GLSL 或 TS 复算多档曝光后投影到 xy;xy 投影用 DisplayGamut 节点)。射线随参数变化实时重画。
8. `src/views/imagePreview.ts` — 图像预览:对一张内置测试图(可程序生成一个 HDR 渐变/彩条 float 纹理)整图应用 GLSL DRT,显示结果 canvas。参数改动实时更新。
9. `src/main.ts` — 入口:tab 切换(回归 / CIE / 图像预览)+ 左侧参数面板;参数对象为单一真源,改动驱动当前视图重绘。
10. `index.html` — 单页骨架:左面板 + 右视图区 + tab。UI 简陋可接受(纯自用调试工具)。

## 验收
- `npm install && npm run build` 通过(tsc 无错)。
- 回归校验页:GLSL vs Python baseline `max abs err < 1e-4`(全绿 PASS)。这是**硬门槛**。
- 三视图都能渲染,参数改动实时联动。

## 参考读法
- 主链路:`opendrt_v110.py` 第 1258-1492 行 `_transform()`。
- 辅助函数:第 271-680 行左右(vdot/spowf/hypot/oetf_*/compress_*/opponent/gauss_window/display_gamut_whitepoint/softplus/eotf_pq/eotf_hlg 等)。
- 求解常数:第 1221-1246 行 `_solve_constants()`。
- 矩阵常数:第 51-270 行。
- 用 `python export_baseline.py` 可重新生成基准(或生成新 config 的基准做扩展测试)。
