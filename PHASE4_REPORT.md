# 阶段4完成报告:探针 + 曲线 + DAG

commit: `bf8a769f55c874412f21ef14f3ec1c20054bc548`(`git -c user.email=dev@local -c user.name=dev commit`)

## 一、改动/新增文件清单

### 新增文件

| 文件 | 说明 |
| --- | --- |
| `src/views/curves.ts` | 曲线视图:tonescale 曲线(log2曝光→输出,附高光肩部放大插图)+ chroma/purity 压缩曲线。数据全部来自 `evaluateCPU`/`evaluateCPUTrace`,本文件只做采样与 Canvas2D 画图,不含任何新色彩数学。 |
| `src/views/dagFlow.ts` | Nuke 风格纵向 25 节点 DAG。导出 `renderDag`(画节点图)、`renderDagInfoPanel`(节点说明面板)、`hitTestNode`(命中测试)、`computeProbeTrace`(包装 `resolveConfig`+`evaluateCPUTrace`,无探针时默认中灰 0.18)。 |
| `scripts/verify_trace.mjs` | 4-A 验证脚本:对拍 `evaluateCPUTrace` 终点与 `evaluateCPU` 返回值。 |
| `scripts/verify_phase4.mjs` | Playwright 端到端验收脚本(曲线截图、图像像素探针、DAG 探针交互),截图输出到 `web/` 下。 |

### 修改文件(仅新增代码,未删除/改动任何已验证求值逻辑)

| 文件 | 改动内容 |
| --- | --- |
| `src/drt.ts` | 在文件**末尾**新增 `TraceStep` 接口、`TRACE_NODE_INFO`(25节点中文名+说明)、`evaluateCPUTrace` 函数。`evaluateCPU`/`resolveConfig`/`solveConstants` 原函数体逐字节未动(`git diff` 确认对 `drt.ts` 只有 `+281` 行新增,`0` 行删除)。 |
| `src/main.ts` | 新增 `Tab` 类型分支(`"curves"`/`"dag"`)、探针状态(`probePixel`/`dagState`)、十字准星绘制、像素拾取(`pickPixelAt`,内部调用未改动的 `decodeSceneLinear`)、DAG hover/click 事件绑定。 |
| `index.html` | 新增两个 tab 按钮(「曲线」「流程图(DAG)」)、`#view-curves`/`#view-dag`/`#dag-canvas`/`#dag-info`/`#probe-overlay`/`#probe-info` 等容器与配套深色风格 CSS。**顺带修复一处遗留 bug**:原 CSS `#view-cie, #view-image, #view-regression { display:none }` 会直接把图像画布本身设为不可见,与新增的 `#image-wrap` 包装层双重控制冲突;移除 `#view-image` 后,可见性统一由 `main.ts` 的 `showTab()` 控制外层 `#image-wrap`。 |

未触碰:`resolveConfig`、`solveConstants`、`src/shaders/opendrt.frag`、任何矩阵常数、`opendrt/` 目录——已用 `git diff HEAD -- src/shaders/ opendrt/` 确认零改动。

## 二、4-A 验证结果:evaluateCPUTrace === evaluateCPU

运行 `npx tsx scripts/verify_trace.mjs`:

```
PASS: 所有测试输入 trace终点 === evaluateCPU,且节点数=25
```

测试覆盖 4 组固定输入 + 20 组随机输入(共 24 组),每组均确认:
- `evaluateCPUTrace` 返回恰好 25 步(`TraceStep[]`,顺序与任务书一致:输入→线性化→输入色域转XYZ→XYZ转P3D65渲染空间→渲染空间去饱和→偏移→范数→比值→对立色/色相→brilliance→双曲线压缩→hue contrast→hue shift rgb→hue shift cmy→purity limit→lerp to one→反渲染空间→显示色域白点→post brilliance→softplus→最终tonescale→乘回→rec2020限制→clamp→逆EOTF)。
- trace 最后一步的 `rgb` 与直接调用 `evaluateCPU` 的返回值**逐分量完全相等,误差为 0**(非近似容差判断,是严格 `===`)。

`npm run build` 复验:TS 严格模式(`tsc && vite build`)通过,19 个模块,无告警。

## 三、三个视图截图路径

全部保存在 `/home/user/workspace/web/` 下:

1. **曲线视图 — tn_sh=0.2**:`phase4_curves_tnsh_low.png`
2. **曲线视图 — tn_sh=0.8**:`phase4_curves_tnsh_high.png`
   - 两图对比可见 tonescale 主曲线整体形状一致,但右上角新增的「高光肩部放大插图」(+2..+8档,纵轴局部放大到 0.82–1.02)中,两个 tn_sh 值下的曲线在高光区的爬升位置/陡峭程度有肉眼可辨的差异——这正是任务书强调的核心验收点。
3. **图像预览像素探针**:`phase4_image_probe.png`(点击图像后十字准星锁定像素,底部状态栏显示源图坐标与 scene-linear RGB)
4. **DAG 流程图探针交互**:`phase4_dag_probe.png`(点击「双曲线压缩(核心 tonescale)」节点,右侧信息面板显示中文说明 + 该像素在此节点的 RGB 值 + 关键标量 `tsn`/`tsn_pt`/`tsn_const` + 色块)

Playwright 端到端验收(`node scripts/verify_phase4.mjs`)全部断言通过(曲线可见、滑块可操作、WebGL 画布非黑、像素探针信息更新、DAG 悬浮/点击均正确显示说明+RGB、无 console/page 报错)。

## 四、偏离任务书之处 / 已知限制

1. **曲线视图增加了高光肩部放大插图(任务书未明确要求,但为满足"肉眼可见"硬性要求而新增)**。
   实测发现:仅用主曲线(0..1 满量程、-8..+8档)展示时,tn_sh=0.2 与 0.8 之间的差异在中灰附近仅约 0.0002,在 +8 档处约 0.007(1.0000 vs 0.9931)——数值上真实存在,但在 900px 宽的主图上肉眼很难分辨。为了忠实满足任务书"这是本任务核心目的"这一要求,在主图右上角加了一个局部放大子图(+2..+8档 × 0.82..1.02 纵轴),将同样的曲线数据重新映射到更敏感的坐标系里绘制——不涉及任何新色彩数学,只是同一批 `evaluateCPU` 采样结果的另一种可视化映射。加入后两张截图里插图曲线的位置/形状差异清晰可辨。

2. **验收脚本发现并规避了一个环境级(非代码缺陷)的偶发问题**:
   本沙箱的 `swiftshader` 软件 GL 在"新建浏览器页面 → 创建 WebGL2 上下文 → 上传大尺寸浮点纹理"这条路径上,存在约 1/6 概率的 `CONTEXT_LOST_WEBGL`。经过对照实验确认——**在完全未改动的阶段3代码上重复相同操作,同样以类似概率复现该问题**,证明这是本沙箱驱动层面的随机性,与阶段4新增代码无关(未新增任何 WebGL 上下文创建、未修改 `src/gl/context.ts`/`src/gl/fullscreenPass.ts`/`src/views/imagePreview.ts`)。`scripts/verify_phase4.mjs` 中为此增加了"监听 `webglcontextlost` 事件,一旦发生自动换一个新页面重试"的健壮性逻辑,重试后验收 100% 稳定通过(本次报告前连续 3 次完整运行全部 PASS)。这不是对产品代码的修改,只是让验收脚本对已知的环境噪声更稳健。

3. `PHASE4_BRIEF.md`(任务书本身)与调试过程中产生的 `tmp_orig_screenshot.png`(与阶段3原版对照用的诊断截图,非四张正式交付截图之一)一并被 `git add -A` 带入了提交——按工作区"不删除任何文件"的约定保留,不影响四个正式交付物的完整性。

## 五、验证命令汇总(供复查)

```bash
cd /home/user/workspace/web
npm run build                          # TS 严格模式 + vite build
npx tsx scripts/verify_trace.mjs       # 4-A 对拍验证
node scripts/verify_phase4.mjs         # Playwright 端到端截图验收(预览服务器需运行在 4173 端口)
```
