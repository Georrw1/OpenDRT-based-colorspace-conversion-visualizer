import { chromium } from "playwright";
import { PNG } from "pngjs";
import fs from "node:fs";
const IMG = "/home/user/workspace/uploaded_attachments/e42e0ce9f2774b98b872782a322f6282/image.jpg";
const URL = "http://localhost:4173/";
const dump = (page, out) => page.evaluate(() => {
  const s = document.querySelector('#panel-opendrt input[type=range]');
  s.dispatchEvent(new Event('input', { bubbles: true }));
  const c = document.getElementById("view-image"); const gl = c.getContext("webgl2");
  const w=c.width,h=c.height; const px=new Uint8Array(w*h*4); gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);
  return { w, h, data: Array.from(px) };
}).then(({w,h,data}) => {
  // readPixels is bottom-up; PNG is top-down → flip rows so saved PNG matches on-screen orientation.
  const png = new PNG({ width: w, height: h });
  for (let y=0;y<h;y++){ const src=(h-1-y)*w*4, dst=y*w*4; for(let k=0;k<w*4;k++) png.data[dst+k]=data[src+k]; }
  fs.writeFileSync(out, PNG.sync.write(png));
});
const browser = await chromium.launch({ args:["--use-gl=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport:{width:1400,height:900} });
await page.goto(URL,{waitUntil:"networkidle"}); await page.waitForTimeout(400);
await dump(page, "/tmp/preview_synthetic.png");
await page.setInputFiles("#file-input", IMG); await page.waitForTimeout(700);
await dump(page, "/tmp/preview_upload.png");
await browser.close();
console.log("wrote /tmp/preview_synthetic.png /tmp/preview_upload.png");
