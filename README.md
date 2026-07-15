# OpenDRT Web Visualizer (OpenDRT 网页版步骤可视化工具)

## 1. 项目背景与核心目标 (Project Background)

本项目是一个基于现代 Web 技术的 **色彩管理（Color Management）与显示渲染变换（DRT）可视化工具**，其核心算法基于 Jed Smith 提出的开源项目 **OpenDRT v1.1.0**。

项目的核心目标是为色彩科学（Color Science）从业者、TD（Technical Director）和后期制作人员打造一个**“以图像为中心”的调试与学习工具**。通过直观的 2D 图表、3D 色域体积和节点流向图，清晰呈现场景线性（Scene-linear）HDR 数据如何被压缩并完美映射到不同显示器色域（如 SDR/Rec.709）的完整数学过程。

在底层实现上，本项目坚持**极度忠实于官方原版 DCTL/Python 代码**。通过严格的回归测试与对拍验证，我们确保了其核心算法与原版保持逐位（bit-accurate）对齐（CPU 端双精度浮点运算误差严格控制在 `6.1e-16` 以内）。

## 2. 核心特性与功能 (Core Features)

- **完整的 OpenDRT v1.1.0 移植**：包含全部矩阵常数、10 种相机 OETF、完整的色调映射（Tonemap）、高光褪白（Path-to-white）与色相漂移控制。
- **参数与预设联动**：暴露了 14 组、57 个控制滑块与 9 个开关；内置 7 个 Look Presets（自动联动更改 63 个参数）与 13 个 Tonescale Presets。
- **图像为中心的交互**：支持标准图像（JPG/PNG）与真实高动态范围图像（HDR/EXR）加载。底层解决了 WebGL2 纹理上传的 Y 轴翻转等兼容性问题。
- **节点流向图 (DAG) 与像素探针**：可逐节点点击查看色彩流动状态，配合 KaTeX 公式引擎展示与内核对应的数学公式，并提供精准的单像素 RGB 输入/输出探针。
- **多维可视化图表**：
  - **2D CIE 1931 色度图**：展示源像素与目标像素的散点分布及其向 D65 白点收拢的过程。
  - **3D 色域体积 (Three.js)**：支持 Clip、Tonemap 及 Raw 模式（突破 4.0 限制的自然延伸）的像素点云展示，精准重构 Path-to-white 轨迹。

## 3. 技术栈 (Tech Stack)

- **前端架构**：原生 HTML + TypeScript + Vite
- **核心计算层**：
  - **GPU 端**：WebGL2 / GLSL (`float32`) —— 实现高性能像素级处理，通过 `log1p` 解决 `softplus` 的单精度塌陷问题。
  - **CPU 端**：TypeScript (`Float64`) —— 高精度运算内核，提供严格的对拍验证基准。
- **可视化渲染**：Three.js（3D 视图） / KaTeX（数学公式渲染）

## 4. 项目结构 (Project Structure)

```text
colorspace_web_full/
├── public/                 # 静态资源与测试基准数据
│   ├── baseline.json       # 核心算法测试基准数据
│   └── looks_baseline.json # Look 预设测试基准数据
├── scripts/                # 自动化测试与验证脚本
│   ├── verify_looks.mjs    # JS 预设对拍测试脚本 (MAX ERR 6.1e-16)
│   ├── gen_looks_baseline.py # 用于生成 Python 端测试基准的脚本
│   ├── verify_trace.mjs    # DAG 节点追踪验证脚本
│   └── ...                 # 其他底层精度诊断与自检脚本
├── src/                    # 源代码核心目录
│   ├── gl/                 # WebGL2 封装层
│   │   ├── context.ts      # WebGL 上下文初始化
│   │   ├── fullscreenPass.ts # 全屏后处理与渲染管线
│   │   └── program.ts      # 着色器程序编译与管理
│   ├── io/                 # 文件读写与解析
│   │   └── loadImage.ts    # 图像加载逻辑 (JPG/PNG/EXR/HDR)
│   ├── shaders/            # GPU 着色器代码
│   │   └── opendrt.frag    # 核心 DRT GLSL 片段着色器
│   ├── views/              # 视图与可视化组件层
│   │   ├── ciePlot.ts      # 2D CIE 1931 色度图渲染逻辑
│   │   ├── gamut3d.ts      # Three.js 3D RGB 色域立方体与点云渲染
│   │   ├── dagFlow.ts      # 节点流向图组件 (DAG)
│   │   ├── curves.ts       # Tonescale 曲线绘制
│   │   ├── imagePreview.ts # 核心图像预览组件
│   │   └── regression.ts   # 回归测试面板逻辑
│   ├── drt.ts              # 核心！OpenDRT 算法的 CPU/TS 实现层
│   ├── nodeFormulas.ts     # 节点对应的 KaTeX 数学公式定义
│   ├── params.ts           # 核心参数定义与 Preset 预设配置管理
│   ├── panel.ts            # UI 控制面板与滑块联动逻辑
│   └── main.ts             # 应用程序入口
├── index.html              # Web 应用入口 HTML
├── vite.config.ts          # Vite 构建配置
├── package.json            # 项目依赖 (Three.js, KaTeX, 等)
└── tsconfig.json           # TypeScript 编译配置
```

## 5. 快速开始 (Quick Start)

### 依赖安装
首先，克隆项目并安装相关依赖（包括前端构建工具和 Three.js 等可视化依赖）：
```bash
npm install
```

### 启动开发服务器
运行 Vite 本地开发服务器，以实时热更新方式进行开发：
```bash
npm run dev
```

### 生产构建
打包项目以便部署到生产环境：
```bash
npm run build
```

## 6. 开发规范与贡献指南 (Development Guidelines)

在接手并对本项目进行二次开发时，请务必遵守以下规范：

1. **核心算法的极度忠实原则**：
   在修改 `src/drt.ts` 或涉及底层算法改动时，必须保证其结果与 `pytest` 和逐像素对拍脚本（如 `verify_looks.mjs`）保持一致。最大绝对误差（MAX ABS ERR）不得超过 `6.1e-16`。**绝对禁止**引入会破坏中性轴（Neutral Axis）或违背原版 DCTL 源码预期的主观改动。
2. **坐标系与节点映射的安全性**：
   OpenDRT 在 `ratios` 节点会将 RGB 除以范数转化为纯方向（提取标量亮度到 `tsn`）。在提取轨迹并进行 3D 可视化时，必须时刻警惕当前数据所处的色彩空间（Scene-linear、XYZ、渲染空间等）。**切勿**将非 RGB 空间数据直接传入 Three.js 3D 立方体中，否则会导致渲染结果错乱。
3. **GPU 单精度兼容**：
   GLSL 着色器中的运算为 `float32`，涉及极限数值运算（如 `softplus`）时请使用项目中已有的安全数学恒等式（如 `log1p`）替换，避免精度塌陷。

## 7. 更新路线图 (Roadmap - Phase 6)

当前项目正处于向 Phase 6 迈进的阶段，接下来的核心开发任务包括：

- [ ] **多 DRT 对比功能**：实现同时加载并切换多个不同的显示渲染变换算法（DRT），支持以 Split-screen 等形式进行算法效果的并排对比。
- [ ] **.cube LUT 导出**：支持将 Web 端通过滑块调试好的 OpenDRT 完整流程（含定制参数）烘焙并导出为 3D LUT 文件，打通 Houdini、Nuke、DaVinci 等工业级后期软件的工作流。
- [ ] **ACES 接入**：在 OpenDRT 的基础上，引入 ACES（Academy Color Encoding System）渲染管线，实现更广维度的行业标准对比。
- [ ] **前置 Gamut Compress 模块**：引入色域压缩前置处理模块，专门解决极高亮度自发光物体（如光剑、霓虹灯）产生的物理色彩溢出（Out-of-gamut）问题。
