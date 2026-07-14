import { defineConfig } from "vite";

// 原生 TS + Vite,无框架。GLSL 以 ?raw 文本导入。
export default defineConfig({
  base: "./",
  server: { port: 5173, open: false },
  build: { outDir: "dist", target: "es2020", sourcemap: true },
});
