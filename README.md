# OpenDRT Web Visualizer

[Read in English](#english) | [中文阅读](#chinese)

---

<a id="english"></a>
## English

### 1. Project Background

This project is a modern Web-based **Color Management and Display Render Transform (DRT) Visualizer**. Its core algorithm is based on the open-source project **OpenDRT v1.1.0** proposed by Jed Smith.

The primary goal is to provide color scientists, Technical Directors (TDs), and post-production professionals with an **"image-centric" debugging and learning tool**. Through intuitive 2D plots, 3D gamut volumes, and node flowcharts (DAG), it clearly demonstrates the complete mathematical process of how scene-linear HDR data is compressed and perfectly mapped to various display gamuts (e.g., SDR/Rec.709).

At the foundational level, this project strictly adheres to the **official original DCTL/Python code**. Through rigorous regression testing and bit-matching, we ensure that the core algorithms align exactly with the original (CPU-side double-precision floating-point errors are strictly controlled within `6.1e-16`).

### 2. Core Features

- **Complete OpenDRT v1.1.0 Port**: Includes all matrix constants, 10 camera OETFs, complete tonemapping, path-to-white handling, and hue shift controls.
- **Parameter & Preset Linkage**: Exposes 14 groups, 57 control sliders, and 9 toggles. Includes 7 Look Presets (automatically driving 63 parameters) and 13 Tonescale Presets.
- **Image-Centric Interaction**: Supports loading standard images (JPG/PNG) and true HDR formats (HDR/EXR). Solves WebGL2 texture Y-axis flipping compatibility issues natively.
- **Native Resolution Image Export**: Utilizes Offscreen Canvas / Framebuffer for high-precision WebGL rendering, supporting image exports that perfectly match the absolute resolution of the user's uploaded source image, completely bypassing UI viewport resolution limits.
- **3D LUT (.cube) Export**: High-precision 3D LUT baking powered by the Float64 CPU computation engine.
- **Hybrid OCIO 2.0 Config Generation**: Dynamically bundles and generates OCIO 2.0 configurations. It not only registers the custom OpenDRT transform as the default View but also integrates complex ColorSpace and Roles settings required by industrial DCC software (Nuke, Mari, Substance Painter), ensuring seamless pipeline integration.
- **Node Flowchart (DAG) & Pixel Probe**: Click node by node to view the state of color flow, combined with KaTeX formula rendering to show the exact mathematical operations corresponding to the kernel. Provides a highly accurate single-pixel RGB input/output probe.
- **Multi-Dimensional Visualization**:
  - **2D CIE 1931 Chromaticity Diagram**: Displays the scatter distribution of source and target pixels and their convergence towards the D65 white point.
  - **3D Gamut Volume (Three.js)**: Supports Clip, Tonemap, and Raw modes (unclamped true HDR extension breaking the 4.0 limit) for pixel point clouds, accurately reconstructing path-to-white trajectories.

### 3. Tech Stack

- **Frontend Architecture**: Native HTML + TypeScript + Vite
- **Core Computation Layer**:
  - **GPU**: WebGL2 / GLSL (`float32`) — High-performance pixel-level processing. Resolves `softplus` single-precision collapse using the `log1p` mathematical identity.
  - **CPU**: TypeScript (`Float64`) — High-precision computation kernel providing a strict baseline for validation.
- **Visualization**: Three.js (3D Views) / KaTeX (Mathematical Formulas) / JSZip (OCIO bundling)

### 4. Project Structure

```text
colorspace_web_full/
├── public/                 # Static assets and test baseline data
├── scripts/                # Automated testing and validation scripts
├── src/                    # Source code directory
│   ├── gl/                 # WebGL2 wrappers
│   ├── io/                 # File I/O, Image loading, and Export utilities (LUT/OCIO)
│   ├── locales/            # i18n dictionaries (English/Chinese)
│   ├── shaders/            # GPU GLSL shaders
│   ├── views/              # View and visualization components (CIE, Gamut3D, DAG, etc.)
│   ├── drt.ts              # CORE! CPU/TS implementation of the OpenDRT algorithm
│   ├── nodeFormulas.ts     # KaTeX math formula definitions for nodes
│   ├── params.ts           # Core parameters and preset management
│   ├── panel.ts            # UI control panel and slider logic
│   └── main.ts             # Application entry point
├── index.html              # Web App Entry HTML
└── package.json            # Project dependencies
```

### 5. Quick Start

**Install Dependencies:**
```bash
npm install
```

**Start Development Server:**
```bash
npm run dev
```

**Production Build:**
```bash
npm run build
```

### 6. Development Guidelines

1. **Extreme Fidelity to Core Algorithms**: When modifying `src/drt.ts` or underlying algorithms, results must perfectly match the `pytest` and pixel-matching scripts (`verify_looks.mjs`). MAX ABS ERR must not exceed `6.1e-16`. Subjective modifications that break the neutral axis or deviate from the original DCTL intentions are strictly prohibited.
2. **Coordinate Systems & Node Mapping**: OpenDRT converts RGB to pure directions in the `ratios` node (extracting scalar brightness into `tsn`). When extracting trajectories for 3D visualization, always be aware of the current color space (Scene-linear, XYZ, Render Space). Do not feed non-RGB space data directly into the Three.js 3D cube.
3. **GPU Single-Precision Compatibility**: GLSL shaders operate in `float32`. For extreme numerical operations (like `softplus`), use safe mathematical identities (like `log1p`) to prevent precision collapse.

### 7. Roadmap

- [ ] **Multi-DRT Comparison**: Support loading and switching between multiple Display Render Transforms (DRTs) with split-screen functionality for side-by-side algorithm comparisons.
- [ ] **ACES Integration**: Integrate the ACES (Academy Color Encoding System) rendering pipeline for broader industry-standard comparisons.
- [ ] **Pre-Gamut Compress Module**: Introduce a gamut compression pre-processing module specifically to address out-of-gamut physical colors generated by extremely bright self-illuminating objects (e.g., lightsabers, neon lights).

---

<a id="chinese"></a>
## 中文阅读

### 1. 项目背景与核心目标

本项目是一个基于现代 Web 技术的 **色彩管理（Color Management）与显示渲染变换（DRT）可视化工具**，其核心算法基于 Jed Smith 提出的开源项目 **OpenDRT v1.1.0**。

项目的核心目标是为色彩科学（Color Science）从业者、TD（Technical Director）和后期制作人员打造一个**“以图像为中心”的调试与学习工具**。通过直观的 2D 图表、3D 色域体积和节点流向图，清晰呈现场景线性（Scene-linear）HDR 数据如何被压缩并完美映射到不同显示器色域（如 SDR/Rec.709）的完整数学过程。

在底层实现上，本项目坚持**极度忠实于官方原版 DCTL/Python 代码**。通过严格的回归测试与对拍验证，我们确保了其核心算法与原版保持逐位（bit-accurate）对齐（CPU 端双精度浮点运算误差严格控制在 `6.1e-16` 以内）。

### 2. 核心特性与功能

- **完整的 OpenDRT v1.1.0 移植**：包含全部矩阵常数、10 种相机 OETF、完整的色调映射（Tonemap）、高光褪白（Path-to-white）与色相漂移控制。
- **参数与预设联动**：暴露了 14 组、57 个控制滑块与 9 个开关；内置 7 个 Look Presets（自动联动更改 63 个参数）与 13 个 Tonescale Presets。
- **图像为中心的交互**：支持标准图像（JPG/PNG）与真实高动态范围图像（HDR/EXR）加载。底层解决了 WebGL2 纹理上传的 Y 轴翻转等兼容性问题。
- **原分辨率图像导出 (Native Resolution Image Export)**：基于 Offscreen Canvas / Framebuffer 的高精度 WebGL 渲染，支持导出与用户上传原图尺寸绝对一致的高质量图像，彻底解决 UI 视口分辨率限制。
- **3D LUT (.cube) 导出**：基于 Float64 CPU 引擎的高精度 3D LUT 烘焙。
- **OCIO 2.0 混合配置生成 (Hybrid OCIO 2.0 Config)**：动态打包生成的 OCIO 2.0 配置，不仅支持将自定义的 OpenDRT 变换注册为默认 View，还融合了 Nuke、Mari、Substance Painter 等工业软件所需的各种复杂 ColorSpace 和 Roles 设定，实现与工业管线的无缝对接。
- **节点流向图 (DAG) 与像素探针**：可逐节点点击查看色彩流动状态，配合 KaTeX 公式引擎展示与内核对应的数学公式，并提供精准的单像素 RGB 输入/输出探针。
- **多维可视化图表**：
  - **2D CIE 1931 色度图**：展示源像素与目标像素的散点分布及其向 D65 白点收拢的过程。
  - **3D 色域体积 (Three.js)**：支持 Clip、Tonemap 及 Raw 模式（突破 4.0 限制的自然延伸）的像素点云展示，精准重构 Path-to-white 轨迹。

### 3. 技术栈

- **前端架构**：原生 HTML + TypeScript + Vite
- **核心计算层**：
  - **GPU 端**：WebGL2 / GLSL (`float32`) —— 实现高性能像素级处理，通过 `log1p` 解决 `softplus` 的单精度塌陷问题。
  - **CPU 端**：TypeScript (`Float64`) —— 高精度运算内核，提供严格的对拍验证基准。
- **可视化与工具**：Three.js（3D 视图） / KaTeX（数学公式渲染） / JSZip（OCIO 压缩打包）

### 4. 项目结构

```text
colorspace_web_full/
├── public/                 # 静态资源与测试基准数据
├── scripts/                # 自动化测试与验证脚本
├── src/                    # 源代码核心目录
│   ├── gl/                 # WebGL2 封装层
│   ├── io/                 # 文件读写、图像加载与导出工具 (LUT/OCIO)
│   ├── locales/            # 国际化多语言字典 (i18n)
│   ├── shaders/            # GPU 着色器代码
│   ├── views/              # 视图与可视化组件层
│   ├── drt.ts              # 核心！OpenDRT 算法的 CPU/TS 实现层
│   ├── nodeFormulas.ts     # 节点对应的 KaTeX 数学公式定义
│   ├── params.ts           # 核心参数定义与 Preset 预设配置管理
│   ├── panel.ts            # UI 控制面板与滑块联动逻辑
│   └── main.ts             # 应用程序入口
├── index.html              # Web 应用入口 HTML
└── package.json            # 项目依赖
```

### 5. 快速开始

**依赖安装：**
```bash
npm install
```

**启动开发服务器：**
```bash
npm run dev
```

**生产构建：**
```bash
npm run build
```

### 6. 开发规范与贡献指南

1. **核心算法的极度忠实原则**：
   在修改 `src/drt.ts` 或涉及底层算法改动时，必须保证其结果与 `pytest` 和逐像素对拍脚本（如 `verify_looks.mjs`）保持一致。最大绝对误差（MAX ABS ERR）不得超过 `6.1e-16`。**绝对禁止**引入会破坏中性轴（Neutral Axis）或违背原版 DCTL 源码预期的主观改动。
2. **坐标系与节点映射的安全性**：
   OpenDRT 在 `ratios` 节点会将 RGB 除以范数转化为纯方向（提取标量亮度到 `tsn`）。在提取轨迹并进行 3D 可视化时，必须时刻警惕当前数据所处的色彩空间（Scene-linear、XYZ、渲染空间等）。**切勿**将非 RGB 空间数据直接传入 Three.js 3D 立方体中，否则会导致渲染结果错乱。
3. **GPU 单精度兼容**：
   GLSL 着色器中的运算为 `float32`，涉及极限数值运算（如 `softplus`）时请使用项目中已有的安全数学恒等式（如 `log1p`）替换，避免精度塌陷。

### 7. 更新路线图 (Phase 6)

- [ ] **多 DRT 对比功能**：实现同时加载并切换多个不同的显示渲染变换算法（DRT），支持以 Split-screen 等形式进行算法效果的并排对比。
- [ ] **ACES 接入**：在 OpenDRT 的基础上，引入 ACES（Academy Color Encoding System）渲染管线，实现更广维度的行业标准对比。
- [ ] **前置 Gamut Compress 模块**：引入色域压缩前置处理模块，专门解决极高亮度自发光物体（如光剑、霓虹灯）产生的物理色彩溢出（Out-of-gamut）问题。
