// WebGL2 上下文初始化。需 EXT_color_buffer_float 支持浮点渲染(回归读回浮点结果)。

export interface GLContext {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  floatRenderable: boolean;
}

export function createGLContext(canvas: HTMLCanvasElement): GLContext {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) {
    throw new Error("无法创建 WebGL2 上下文:浏览器不支持 WebGL2。");
  }
  // 浮点纹理线性过滤(可选)与浮点渲染(回归必需)。
  const floatRenderable = !!gl.getExtension("EXT_color_buffer_float");
  gl.getExtension("OES_texture_float_linear");
  return { gl, canvas, floatRenderable };
}
