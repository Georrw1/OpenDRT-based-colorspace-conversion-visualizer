// Vite ?raw 文本导入的类型声明(tsconfig types:[] 未引入 vite/client)。
declare module "*?raw" {
  const src: string;
  export default src;
}
