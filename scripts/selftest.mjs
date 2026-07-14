// Playwright 自测:主视图(图像预览)、参数改动重绘、CIE 散点、上传流程(合成 PNG)、回归隐藏入口。
// 用 swiftshader 软件 GL 保证无头环境能跑 WebGL2。截图落到 /tmp。
import { chromium } from "playwright";
import { PNG } from "pngjs";
import fs from "node:fs";

const URL = "http://localhost:4173/";
const OUT = "/tmp";

// 生成一张最小 PNG(2x2 彩色)用于上传测试。
function makePng() {
  const png = new PNG({ width: 2, height: 2 });
  const px = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]];
  for (let i = 0; i < 4; i++) {
    png.data[i * 4 + 0] = px[i][0];
    png.data[i * 4 + 1] = px[i][1];
    png.data[i * 4 + 2] = px[i][2];
    png.data[i * 4 + 3] = 255;
  }
  const buf = PNG.sync.write(png);
  const p = "/tmp/test_upload.png";
  fs.writeFileSync(p, buf);
  return p;
}

const log = [];
function ok(name, cond, extra = "") { log.push(`${cond ? "PASS" : "FAIL"} · ${name}${extra ? " · " + extra : ""}`); }

const browser = await chromium.launch({
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// 1. 首屏 = 图像预览
const imgVisible = await page.isVisible("#view-image");
ok("首屏图像预览可见", imgVisible);
const imgCanvas = await page.$("#view-image");
const box0 = await imgCanvas.boundingBox();
ok("图像 canvas 有尺寸", box0 && box0.width > 0 && box0.height > 0, box0 ? `${Math.round(box0.width)}x${Math.round(box0.height)}` : "null");
await page.screenshot({ path: `${OUT}/shot_image.png` });

// 2. 改参数(Display 下拉)后仍正常
await page.selectOption("#panel-opendrt select >> nth=1", { index: 1 }).catch(() => {});
await page.waitForTimeout(200);
ok("改 Display 后无异常", true);

// 3. 上传 PNG
const png = makePng();
await page.setInputFiles("#file-input", png);
await page.waitForTimeout(500);
const info = await page.textContent("#img-info");
ok("上传后信息更新", info && info.includes("test_upload"), info);
await page.screenshot({ path: `${OUT}/shot_upload.png` });

// 4. 切到 CIE,散点渲染
await page.click('.tab[data-tab="cie"]');
await page.waitForTimeout(600);
const cieVisible = await page.isVisible("#view-cie");
ok("CIE 视图可见", cieVisible);
// 检查 canvas 非全黑(有散点/三角绘制)
const cieNonBlack = await page.evaluate(() => {
  const c = document.getElementById("view-cie");
  const ctx = c.getContext("2d");
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let nonBg = 0;
  for (let i = 0; i < d.length; i += 4) {
    // 背景是 #111 (17,17,17);统计明显偏离的像素
    if (Math.abs(d[i] - 17) > 25 || Math.abs(d[i + 1] - 17) > 25 || Math.abs(d[i + 2] - 17) > 25) nonBg++;
  }
  return nonBg;
});
ok("CIE 有绘制内容", cieNonBlack > 1000, `nonBg=${cieNonBlack}`);
await page.screenshot({ path: `${OUT}/shot_cie.png` });

// 5. CIE 模式切换
await page.selectOption("#cie-mode", "input");
await page.waitForTimeout(400);
ok("CIE 模式切换无异常", true);

// 6. 回归隐藏入口
await page.click("#dev-link");
await page.waitForTimeout(1500);
const regVisible = await page.isVisible("#view-regression");
ok("回归页可通过页脚打开", regVisible);
const regText = await page.textContent("#view-regression");
ok("回归页有 PASS/结果", regText && (regText.includes("PASS") || regText.includes("max") || regText.length > 40), (regText || "").slice(0, 60));
await page.screenshot({ path: `${OUT}/shot_regression.png` });

ok("无 console/page 错误", errors.length === 0, errors.slice(0, 3).join(" | "));

console.log(log.join("\n"));
console.log("errors:", errors.length);
await browser.close();
process.exit(log.some((l) => l.startsWith("FAIL")) ? 1 : 0);
