// 全屏三角形渲染管线:把输入纹理(scene-linear RGB)喂给 opendrt.frag。
// 支持两种输出:renderToCanvas(图像预览)与 runToFloat(回归浮点读回)。

import { createProgram, type Program } from "./program";
import type { GLUniformValues } from "../drt";
import fragSrc from "../shaders/opendrt.frag?raw";

const VERT = `#version 300 es
// 全屏三角形(无 VBO,gl_VertexID 生成)。v_uv 覆盖 [0,1]^2。
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const UNIFORM_NAMES = [
  "u_input", "u_ts_x0", "u_ts_s", "u_ts_s1", "u_ts_p", "u_ts_m2", "u_ts_dsc", "u_s_Lp100",
  "u_in_oetf", "u_inMtx", "u_display_gamut", "u_eotf", "u_cwp", "u_clamp", "u_cwp_norm",
];

export class FullscreenPass {
  private gl: WebGL2RenderingContext;
  private prog: Program;
  private vao: WebGLVertexArrayObject;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.prog = createProgram(gl, VERT, fragSrc, UNIFORM_NAMES);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("createVertexArray 失败");
    this.vao = vao;
  }

  private applyUniforms(u: GLUniformValues) {
    const { gl } = this;
    const un = this.prog.uniforms;
    gl.uniform1i(un.u_input, 0);
    gl.uniform1f(un.u_ts_x0, u.ts_x0);
    gl.uniform1f(un.u_ts_s, u.ts_s);
    gl.uniform1f(un.u_ts_s1, u.ts_s1);
    gl.uniform1f(un.u_ts_p, u.ts_p);
    gl.uniform1f(un.u_ts_m2, u.ts_m2);
    gl.uniform1f(un.u_ts_dsc, u.ts_dsc);
    gl.uniform1f(un.u_s_Lp100, u.s_Lp100);
    gl.uniform1i(un.u_in_oetf, u.in_oetf);
    gl.uniformMatrix3fv(un.u_inMtx, false, u.inMtx);
    gl.uniform1i(un.u_display_gamut, u.display_gamut);
    gl.uniform1i(un.u_eotf, u.eotf);
    gl.uniform1i(un.u_cwp, u.cwp);
    gl.uniform1i(un.u_clamp, u.clamp);
    gl.uniform1f(un.u_cwp_norm, u.cwp_norm);
  }

  /**
   * 创建输入纹理(scene-linear)。data 为 RGBA float32,长度 = w*h*4。
   * 内部用 RGBA16F(HALF_FLOAT):在 WebGL2 里 half-float 纹理是核心可采样格式,
   * 不依赖 OES_texture_float_linear——比 RGBA32F 在真实 GPU 上兼容性好得多
   * (部分真实 GPU 采样 RGBA32F 纹理会得到全黑)。scene-linear 值域完全落在 half-float 范围内。
   * 注:回归用的 runToFloat 仍保留 RGBA32F(需精确浮点读回,已验证通过)。
   */
  createFloatTexture(width: number, height: number, data: Float32Array, use16f = true): WebGLTexture {
    const { gl } = this;
    const tex = gl.createTexture();
    if (!tex) throw new Error("createTexture 失败");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // 图像数据行0=顶,而 WebGL 纹理行0→画布底部;上传时翻转行序使显示正立。
    // 对回归的 n×1 纹理(height=1)为空操作,不影响逐点映射。
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    // 图像预览 use16f=true:RGBA16F(HALF_FLOAT) 真实 GPU 兼容好。
    // 回归 use16f=false:RGBA32F 保留精确浮点输入(需 3.77e-6 量级)。
    const internal = use16f ? gl.RGBA16F : gl.RGBA32F;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, gl.FLOAT, data);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** 释放纹理(图像预览换源/换 OETF 时回收旧纹理)。 */
  deleteTexture(tex: WebGLTexture) {
    this.gl.deleteTexture(tex);
  }

  /** 渲染到默认 framebuffer(canvas),用于图像预览。 */
  renderToCanvas(inputTex: WebGLTexture, u: GLUniformValues) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(this.prog.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTex);
    this.applyUniforms(u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /**
   * 渲染到 RGBA32F framebuffer 并读回。用于回归:输入 w*h 个采样,返回同尺寸 RGBA float。
   * 需 EXT_color_buffer_float。
   */
  runToFloat(inputTex: WebGLTexture, width: number, height: number, u: GLUniformValues): Float32Array {
    const { gl } = this;
    const outTex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!outTex || !fbo) throw new Error("创建离屏目标失败");
    gl.bindTexture(gl.TEXTURE_2D, outTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("浮点 framebuffer 不完整(EXT_color_buffer_float 可能不可用)。");
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.prog.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTex);
    this.applyUniforms(u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = new Float32Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, out);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(outTex);
    return out;
  }
}
