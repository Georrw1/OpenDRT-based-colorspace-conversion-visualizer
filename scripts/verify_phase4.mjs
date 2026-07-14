// 阶段4 Playwright 截图验收:
// 1. 曲线视图:拖 tn_sh 前后两张截图,确认 tonescale 肩部形状(含高光放大插图)变化可见。
// 2. DAG 流程图:上传测试图,在图像预览点一个像素,截图确认 DAG 显示该像素逐节点值。
// swiftshader 软件 GL,截图前 waitForTimeout + 轻推滑块触发重绘。
//
// 已确认的环境背景(见 PHASE4_REPORT.md「偏离/已知限制」一节):
// 本沙箱的 swiftshader 软件 GL 在"新建页面→创建 WebGL2 上下文→上传大纹理"这条路径上,
// 本身就有偶发 CONTEXT_LOST_WEBGL 的概率(实测对完全未改动的阶段3代码重复测试同样出现,
// 约 1/6 的概率),与本次阶段4新增代码无关。这里做的是"遇到就换一个新页面重试",
// 而不是重新设计任何渲染逻辑。
import { chromium } from "playwright";

const URL = "http://localhost:4173/";
const OUT = "/home/user/workspace/web";
const UPLOAD_IMG = "/home/user/workspace/uploaded_attachments/e42e0ce9f2774b98b872782a322f6282/image.jpg";

const log = [];
function ok(name, cond, extra = "") { log.push(`${cond ? "PASS" : "FAIL"} · ${name}${extra ? " · " + extra : ""}`); }

const browser = await chromium.launch({
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

async function newDiagnosticPage() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on("pageerror", (e) => page.__errors?.push(String(e)));
  page.__errors = [];
  page.on("console", (m) => { if (m.type() === "error") page.__errors.push(m.text()); });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const c = document.getElementById("view-image");
    window.__ctxLostFlag = false;
    c.addEventListener("webglcontextlost", () => { window.__ctxLostFlag = true; });
  });
  return page;
}

async function isCtxLost(page) {
  return page.evaluate(() => window.__ctxLostFlag === true);
}

/** 上传测试图并等待 WebGL 画布出现非全黑内容;若遇到 CONTEXT_LOST(环境偶发),换新页面重试。 */
async function uploadAndWaitRender(maxPageRetries = 4) {
  for (let attempt = 0; attempt < maxPageRetries; attempt++) {
    const page = await newDiagnosticPage();
    await page.click('.tab[data-tab="image"]');
    await page.waitForTimeout(300);
    await page.setInputFiles("#file-input", UPLOAD_IMG);
    await page.waitForTimeout(1200);

    const sliders = await page.$$("#panel-opendrt input[type=range]");
    const anySlider = sliders[0];
    let nz = 0;
    for (let tries = 0; tries < 6; tries++) {
      if (await isCtxLost(page)) break;
      nz = await page.evaluate(() => {
        const c = document.getElementById("view-image");
        const gl = c.getContext("webgl2");
        if (!gl || gl.isContextLost()) return 0;
        const pixels = new Uint8Array(c.width * c.height * 4);
        gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let n = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 5) n++;
        return n;
      });
      if (nz > 1000) return { page, sliders, ok: true };
      await anySlider.evaluate((el) => { el.dispatchEvent(new Event("input", { bubbles: true })); });
      await page.waitForTimeout(350);
    }
    log.push(`INFO · 第${attempt + 1}次页面尝试渲染失败(nz=${nz}, ctxLost=${await isCtxLost(page)}),换新页面重试`);
    await page.close();
  }
  return { page: null, sliders: null, ok: false };
}

// ---- 1. 曲线视图:tn_sh 变化前后对比(用独立页面,不受下面的重试逻辑影响) ----
const curvesPage = await newDiagnosticPage();
await curvesPage.click('.tab[data-tab="curves"]');
await curvesPage.waitForTimeout(300);
const curvesVisible = await curvesPage.isVisible("#view-curves");
ok("曲线视图可见", curvesVisible);

const shSelector = "#panel-opendrt input[type=range]"; // 第4个是 tnSh(见 SLIDERS 顺序)
const curvesSliders = await curvesPage.$$(shSelector);
ok("找到滑块", curvesSliders.length >= 4, `count=${curvesSliders.length}`);
const shSlider = curvesSliders[3];

await shSlider.evaluate((el) => { el.value = "0.2"; el.dispatchEvent(new Event("input", { bubbles: true })); });
await curvesPage.waitForTimeout(300);
await curvesPage.screenshot({ path: `${OUT}/phase4_curves_tnsh_low.png` });

await shSlider.evaluate((el) => { el.value = "0.8"; el.dispatchEvent(new Event("input", { bubbles: true })); });
await curvesPage.waitForTimeout(300);
await curvesPage.screenshot({ path: `${OUT}/phase4_curves_tnsh_high.png` });
ok("已保存 tn_sh 前后两张曲线截图(含高光肩部放大插图)", true);
const curvesErrors = curvesPage.__errors;
await curvesPage.close();

// ---- 2. 图像预览:上传图片 + 像素探针 + DAG(带 CONTEXT_LOST 重试) ----
const { page, sliders, ok: renderOk } = await uploadAndWaitRender();
ok("WebGL 画布已渲染出非黑内容(必要时已自动换页重试)", renderOk);

if (renderOk) {
  const imgCanvasBox = await page.$("#view-image").then((h) => h.boundingBox());
  ok("图像预览 canvas 有尺寸", imgCanvasBox && imgCanvasBox.width > 0);

  const clickX = imgCanvasBox.x + imgCanvasBox.width * 0.5;
  const clickY = imgCanvasBox.y + imgCanvasBox.height * 0.4;
  await page.mouse.move(clickX, clickY);
  await page.waitForTimeout(200);
  await page.mouse.click(clickX, clickY);
  await page.waitForTimeout(300);

  const probeText = await page.textContent("#probe-info");
  ok("像素探针信息已更新", probeText && probeText.includes("源图坐标"), probeText);
  await page.screenshot({ path: `${OUT}/phase4_image_probe.png` });

  // ---- 切到 DAG,确认显示探针逐节点值 ----
  await page.click('.tab[data-tab="dag"]');
  await page.waitForTimeout(400);
  const dagVisible = await page.isVisible("#view-dag");
  ok("DAG 视图可见", dagVisible);

  const dagCanvasBox = await page.$("#dag-canvas").then((h) => h.boundingBox());
  await page.mouse.move(dagCanvasBox.x + 100, dagCanvasBox.y + 45);
  await page.waitForTimeout(300);
  const dagInfoText1 = await page.textContent("#dag-info");
  ok("DAG 悬浮第1节点显示说明+RGB", dagInfoText1 && dagInfoText1.includes("RGB ="), (dagInfoText1 || "").slice(0, 80));

  const nodeIndex = 10; // 0-based,第11个节点:双曲线压缩(核心 tonescale)
  const nodeY = dagCanvasBox.y + 30 + nodeIndex * (40 + 22) + 20;
  await page.mouse.click(dagCanvasBox.x + 100, nodeY);
  await page.waitForTimeout(300);
  const dagInfoText2 = await page.textContent("#dag-info");
  ok("DAG 点击深层节点显示探针数值", dagInfoText2 && dagInfoText2.includes("RGB ="), (dagInfoText2 || "").slice(0, 120));
  await page.screenshot({ path: `${OUT}/phase4_dag_probe.png`, fullPage: false });

  const allErrors = [...curvesErrors, ...page.__errors];
  ok("无 console/page 错误", allErrors.length === 0, allErrors.slice(0, 5).join(" | "));
  await page.close();
} else {
  ok("图像预览 canvas 有尺寸", false, "因 WebGL 上下文反复丢失未能验证(环境问题,见报告)");
}

console.log(log.join("\n"));
await browser.close();
process.exit(log.some((l) => l.startsWith("FAIL")) ? 1 : 0);
