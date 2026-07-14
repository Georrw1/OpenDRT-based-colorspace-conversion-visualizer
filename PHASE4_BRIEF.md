# 阶段 4 实现任务:像素探针 + tonescale/chroma 曲线 + DAG 可视流程图

## 背景与铁律(必须遵守)
本项目是「以图像为中心」的 OpenDRT 色彩管理可视化工具(原生 TS + Vite,WebGL2 GLSL 内核)。
- **移植忠实性**:GLSL 内核 `src/shaders/opendrt.frag` 与 CPU 参考 `src/drt.ts` 的 `evaluateCPU` 已严格移植自 `/home/user/workspace/opendrt/opendrt_v110.py`,CPU 对拍 Python = 6.1e-16,GPU 回归 3.77e-6。**绝对禁止修改 `evaluateCPU`、`resolveConfig`、`solveConstants`、GLSL 内核算法、任何矩阵常数、`opendrt/` 下任何文件**。
- 你只能**新增**代码,不能改动已验证的求值路径。
- 全程中文注释。所有 UI 文案中文。

## 任务总览(三个子任务,都在 `/home/user/workspace/web/` 内)

### 4-A. 逐节点探针内核 `evaluateCPUTrace`(数据基础,先做)
在 `src/drt.ts` **末尾新增**导出函数 `evaluateCPUTrace(c: ResolvedConfig, input: [number,number,number]): TraceStep[]`。
它是 `evaluateCPU`(第287-459行)的**逐节点插桩副本**:完全照抄同样的计算,但在每个主要节点后把中间量 push 进一个 `TraceStep[]` 数组返回。
**做法**:直接复制 `evaluateCPU` 的函数体,在关键节点后插入 `steps.push({...})`。因为在 drt.ts 内部,所有 helper(sdivf/spowf/compress_*/vdot/gauss_window 等)和矩阵常数都在作用域内可直接用——**不要新建文件复制矩阵**。
节点顺序(严格照 evaluateCPU 现有顺序,每个 push 一个 step):
1. `input` — 原始输入 RGB(编码态)
2. `linearize` — OETF 逆解码到线性(linearizeScalar)
3. `in_gamut_to_xyz` — 输入 gamut → XYZ(vdot inMtx)
4. `xyz_to_p3d65` — → P3D65 渲染空间(vdot M_XYZ_TO_P3D65)
5. `render_desaturate` — Render space SatW 去饱和
6. `offset` — + tn_off
7. `norm` — 计算 tsn0(范数),step 里记 rgb 和标量 tsn0
8. `ratios` — rgb / tsn0
9. `opponent_hue` — 记 opp0/opp1/ach_d/hue(标量)
10. `brilliance` — Brilliance(记 tsn 变化)
11. `hyperbolic_compress` — 记 tsn、tsn_pt、tsn_const(核心 tonescale 压缩)
12. `hue_contrast` — Hue Contrast R
13. `hue_shift_rgb` — Hue Shift RGB
14. `hue_shift_cmy` — Hue Shift CMY
15. `purity_limit` — Purity Limit Low+High+Mid(记 ptf)
16. `lerp_to_one` — rgb*ptf + (1-ptf)
17. `inverse_render_space` — 逆渲染空间
18. `display_gamut_wp` — displayGamutWhitepoint(显示 gamut + 创意白点)
19. `post_brilliance` — Post Brilliance
20. `softplus` — Softplus per channel
21. `final_tonescale` — tsn*ts_m2 → toe → *ts_dsc(记最终 tsn 标量)
22. `multiply_back` — rgb * tsn
23. `rec2020_limit` — (仅 display_gamut==2)
24. `clamp` — (仅 c.clamp)
25. `inverse_eotf` — 逆 EOTF → 最终显示编码值(输出)

`TraceStep` 类型:
```ts
export interface TraceStep {
  id: string;          // 上面的节点名
  label: string;       // 中文标签,如 "输入 gamut → XYZ"
  rgb: [number, number, number];   // 该节点后的 RGB
  scalars?: Record<string, number>; // 可选:该节点关键标量(tsn/tsn_pt/ach_d/hue/ptf 等)
}
```
**验证 4-A**:写个临时脚本对同一输入 [0.18,0.18,0.18] 跑 `evaluateCPUTrace`,确认最后一个 step 的 rgb 与 `evaluateCPU` 返回值**逐分量完全相等**(误差 0,因为是同一份计算)。跑几个随机输入都要相等。这是硬性验收:trace 的终点必须 === evaluateCPU。

### 4-B. tonescale + chroma 曲线视图 `src/views/curves.ts`
新增 Canvas2D 视图,导出 `renderCurves(canvas, params)`,随参数实时重画:
- **图1 Tonescale 曲线**:横轴 = log2 曝光(scene-linear,-8..+8 stop,以 0.18 中灰为参考),纵轴 = 输出(0..1 显示编码)。对一系列中性灰输入 [x,x,x] 跑 evaluateCPU 取输出亮度(可取输出 rgb 的最大分量或 luma),画出曲线。**关键:拖 tn_sh(shoulder)时曲线肩部形状要肉眼可见变化**——这是本任务核心目的(tn_sh 之前"看不见")。同时画 tn_con/tn_Lg 的影响。标注中灰点 0.18。
- **图2 Chroma/Purity 压缩曲线**:横轴 = 输入饱和度(用 ach_d 或输入 purity),纵轴 = 输出饱和度或 purity factor ptf。展示 DRT 如何随亮度/饱和度压缩纯度。可用固定几个色相扫描。
- 两张图上下排列或并排,中文轴标签+标题。用与 CIE 图一致的深色背景(#0e0e10)。

### 4-C. 像素探针 + DAG 可视流程图
- **像素探针**:在「图像预览」视图上支持鼠标 hover/click 取像素。用现有 `decodeSceneLinear`(见 src/io/loadImage.ts)拿到该像素 scene-linear RGB,喂 `evaluateCPUTrace` 得到逐节点值。
  - 注意:图像预览是 WebGL canvas。取鼠标位置对应的源图像素坐标(考虑 canvas 显示尺寸 vs 源尺寸缩放,以及之前修的 Y 翻转——源数据行0=顶)。
  - 在预览图上画一个十字准星标记选中像素。
- **DAG 可视流程图** `src/views/dagFlow.ts`:Nuke 风格纵向节点图,把上面 25 个节点画成方块 + 连线(自上而下)。每个节点显示中文名。
  - 点/hover 某节点:高亮,并显示"该节点作用"的一句话中文说明 + 当前探针像素在该节点的 RGB 值(来自 trace)。
  - 若未选像素,用默认中灰 0.18 走一遍 trace 填充。
  - 节点方块可用当前 trace 的 rgb 值做一个小色块预览(clamp 到 0..1 显示)。
- **接入 main.ts**:新增两个 tab「曲线」和「流程图(DAG)」,或把曲线并入某处、DAG 单独 tab——你决定最清晰的布局。探针选中的像素状态要能驱动 DAG 流程图和(可选)一个数值列表。

## 集成与验收
1. `cd /home/user/workspace/web && npm run build` 必须通过(TS 严格模式,注意 noUnusedLocals)。
2. 用 Playwright(`--use-gl=swiftshader`)截图验证:
   - 曲线视图:拖 tn_sh 前后两张截图,确认 tonescale 肩部形状变化可见。
   - DAG 流程图:上传 `/home/user/workspace/uploaded_attachments/e42e0ce9f2774b98b872782a322f6282/image.jpg`,在预览点一个像素,截图确认 DAG 显示该像素逐节点值。
   - swiftshader 陷阱:图像预览 WebGL 截图前需 waitForTimeout + 轻推滑块触发重绘,否则可能空白。
3. `git add -A && git commit`(git 身份用 `git -c user.email=dev@local -c user.name=dev commit`)。
4. **不要调用 deploy_website / publish_website**(那是主 agent 的事)。完成后报告:改了/新增了哪些文件、4-A 的 trace===evaluateCPU 验证结果、三个视图的截图路径。

## 关键文件索引
- `src/drt.ts`:CPU 内核(evaluateCPU 第287-459行,helper 127-153行,矩阵 37-59行)。**只在末尾新增 evaluateCPUTrace,不改现有。**
- `src/io/loadImage.ts`:`decodeSceneLinear(src, oetf)` 返回 Float32Array(RGBA,行0=顶),`LoadedSource` 类型。
- `src/params.ts`:`DrtParams`、`SLIDERS`。
- `src/views/ciePlot.ts`:参考它的 Canvas2D 风格(深色背景/中文图例/坐标轴)。
- `src/main.ts`:tab 切换与 rerender 接线在此。
- `src/panel.ts`:侧栏参数面板构建。
