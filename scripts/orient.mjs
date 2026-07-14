import { chromium } from "playwright";
import fs from "node:fs";

const IMG = "/home/user/workspace/uploaded_attachments/e42e0ce9f2774b98b872782a322f6282/image.jpg";
const URL = "http://localhost:4173/";

// Read the preview WebGL backbuffer by forcing a SYNCHRONOUS redraw (dispatch slider input),
// then readPixels in the same JS turn before the compositor clears it.
const readPreview = (page) => page.evaluate(() => {
  const s = document.querySelector('#panel-opendrt input[type=range]');
  s.dispatchEvent(new Event('input', { bubbles: true })); // app redraws synchronously
  const c = document.getElementById("view-image");
  const gl = c.getContext("webgl2");
  const w = c.width, h = c.height;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  // readPixels origin = bottom-left: row y=0 is SCREEN BOTTOM, y=h-1 is SCREEN TOP.
  let topL = 0, botL = 0, ntop = 0, nbot = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; const l = px[i]*0.299 + px[i+1]*0.587 + px[i+2]*0.114;
    if (y >= h/2) { topL += l; ntop++; } else { botL += l; nbot++; }
  }
  return { w, h, screenTop: topL/ntop, screenBot: botL/nbot };
});

const browser = await chromium.launch({ args: ["--use-gl=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; page.on("pageerror", e => errs.push(String(e)));
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// Synthetic (default) orientation baseline
const synBefore = await readPreview(page);
console.log("SYNTHETIC screenTop/Bot luma:", synBefore.screenTop.toFixed(1), synBefore.screenBot.toFixed(1));

// Ground truth of the jpg: top vs bottom luma via in-page decode (same path as app: createImageBitmap)
const b64 = fs.readFileSync(IMG).toString("base64");
const gt = await page.evaluate(async (b64) => {
  const res = await fetch("data:image/jpeg;base64," + b64);
  const bmp = await createImageBitmap(await res.blob());
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext("2d"); ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0,0,bmp.width,bmp.height).data;
  const w = bmp.width, h = bmp.height; let t=0,b=0,nt=0,nb=0;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){ const i=(y*w+x)*4; const l=d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
    if (y<h/2){t+=l;nt++;} else {b+=l;nb++;} }
  return { srcTop: t/nt, srcBot: b/nb };
}, b64);

await page.setInputFiles("#file-input", IMG);
await page.waitForTimeout(700);
const prev = await readPreview(page);
await page.screenshot({ path: "/tmp/shot_orient_upload.png" });

const srcTopBrighter = gt.srcTop > gt.srcBot;
const screenTopBrighter = prev.screenTop > prev.screenBot;
console.log("SOURCE  top/bot luma:", gt.srcTop.toFixed(1), gt.srcBot.toFixed(1), "topBrighter=", srcTopBrighter);
console.log("PREVIEW top/bot luma:", prev.screenTop.toFixed(1), prev.screenBot.toFixed(1), "topBrighter=", screenTopBrighter);
console.log(srcTopBrighter === screenTopBrighter ? "PASS · 上传图正立(与源同向)" : "FAIL · 上传图上下翻转");

// Synthetic unchanged after we came from default (compare same page reload)
const p2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await p2.goto(URL, { waitUntil: "networkidle" }); await p2.waitForTimeout(400);
const syn2 = await readPreview(p2);
await p2.screenshot({ path: "/tmp/shot_orient_synth.png" });
console.log("SYNTHETIC(reload) screenTop/Bot:", syn2.screenTop.toFixed(1), syn2.screenBot.toFixed(1),
  Math.abs(syn2.screenTop - synBefore.screenTop) < 1 ? "· 与首屏一致" : "· 变化!");
console.log("errs", errs);
await browser.close();
