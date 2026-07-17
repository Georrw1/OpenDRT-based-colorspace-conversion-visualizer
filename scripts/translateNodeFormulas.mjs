import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'src/nodeFormulas.ts');
let content = fs.readFileSync(file, 'utf-8');

const translations = {
  "input": "Raw input, still in encoded state (could be log or gamma encoded). These values are not linear light and cannot be directly multiplied or added—they must be linearized first.",
  "linearize": "Applies the inverse of the selected Input OETF (transform curve) to convert encoded values back to scene-linear light. For example, ACEScct, ARRI LogC, and S-Log3 have different decoding piecewise functions. Subsequent matrix and tonescale operations are only physically valid in the linear domain.",
  "in_gamut_to_xyz": "Transforms RGB from the input gamut (e.g., ACEScg/Rec.709/E-Gamut2) to device-independent CIE XYZ (D65) using a 3×3 matrix. XYZ is the universal 'hub' for all color spaces—you must enter XYZ to convert to any target space.",
  "xyz_to_p3d65": "Transforms from XYZ to OpenDRT's internal rendering gamut, P3-D65. All tonescale mapping and gamut compression occur in this space. P3-D65 is chosen as a compromise: wider than Rec.709 (accommodates more saturated colors) but more constrained than Rec.2020 (more stable numerical behavior).",
  "render_desaturate": "Applies partial desaturation towards the weighted luminance L. This is a key OpenDRT design: slightly reducing saturation before compression prevents highly saturated colors (like pure red lasers or neon) from 'clipping/breaking' during tone mapping.",
  "offset": "Adds a tiny black level offset. It serves two purposes: ① prevents divide-by-zero errors later when dividing by the norm; ② controls shadow behavior—a positive offset slightly lifts shadow details, increasing shadow gradation. The official spec emphasizes offset should not be negative.",
  "norm": "Calculates the norm tsn₀ of the RGB vector, representing the 'overall brightness magnitude' of this pixel. Dividing by √3 normalizes it so that a neutral gray (x,x,x) has exactly a norm of x. All subsequent tonescale operations apply to this scalar, decoupling brightness compression from color direction.",
  "ratios": "Divides RGB by the norm to obtain the chromaticity direction (ratios). Now 'r' only carries 'which direction the color points to', while the brightness magnitude is isolated in tsn₀. This is OpenDRT's core strategy: separate brightness and color, process them independently, and multiply them back later.",
  "opponent_hue": "Constructs an opponent color space: o₀ ≈ Red-Blue, o₁ ≈ Green-Magenta, simulating human eye opponent channels. From this, it calculates hue angle (color direction) and ach_d achromatic distance (how 'colorful' it is). Subsequent steps rely on these to identify hue and saturation.",
  "brilliance": "Applies local gain to the brightness tsn based on hue and saturation (ach_d). Purpose: to make certain hues (like sky blue, skin tones) appear brighter or deeper without changing their color. The tsf exponent ensures a smooth transition across brightness levels.",
  "hyperbolic_compress": "The core non-linearity of the tonescale. A hyperbolic curve x/(x+s) compresses scene light from [0,∞) into the display range [0,1). 's' determines the 'shoulder' (when highlights start to compress), and 'p' determines the contrast slope. Generates tsn_pt and tsn_const copies for later use.",
  "hue_contrast": "Applies contrast modulation exclusively in the red hue region. It adjusts the G and B channels based on brightness 't', altering the perceived contrast of red areas—making dark reds richer and bright reds more translucent, without shifting the primary red direction.",
  "hue_shift_rgb": "Applies hue shifts along the primary R/G/B directions. Real film/sensors exhibit hue shifts in highlights (e.g., red highlights turning orange). This step intentionally introduces controlled hue shifts to replicate pleasing 'film-like' aesthetics and correct compression-induced hue distortion.",
  "hue_shift_cmy": "Symmetrical to the previous step, but operates along the secondary C/M/Y complementary directions, modulated by (1−tsn_pt) to favor shadows/midtones. Together, the RGB and CMY shifts precisely sculpt the entire hue ring.",
  "purity_limit": "Calculates the purity preservation factor ptf∈[0,1]—the source of the chroma/purity compression curve. A smaller ptf pulls the color closer to white (highlight desaturation). Physical motivation: real highlights 'bleach' out; purity limits allow highlights to naturally desaturate instead of clipping into solid colored blocks.",
  "lerp_to_one": "Linearly interpolates the chromaticity direction 'r' with pure white (1,1,1) using ptf, officially applying the purity compression calculated in the previous step. ptf=1 keeps the original color, ptf=0 turns it completely white.",
  "inverse_render_space": "Undoes the desaturation from the earlier render_desaturate step (mathematical inverse). The prior desaturation stabilized the compression process; now that compression is done, saturation is restored to its proper expression.",
  "display_gamut_wp": "Transforms to the target display gamut (Rec.709/P3/Rec.2020...) and applies the creative white point (cwp). A Chromatic Adaptation Transform (CAT) shifts the white point from D65 towards D50/D60, warming or cooling the image.",
  "post_brilliance": "Applies a second brightness modulation in the display space (echoing the earlier brilliance, but recalculating ach_d' based on post-display opponent colors). Used for final touches on highlight color rendition.",
  "softplus": "Applies softplus smooth clipping to each channel. Softplus is a smooth version of ReLU: it prevents negative values (negative light is physically meaningless) while softly lifting near-zero values without the abrupt changes of a hard clamp.",
  "final_tonescale": "Assembles the final brightness scalar to be multiplied back into the color. Applies the main scaling ts_m2, compresses the deep shadows using a toe function to smoothly transition to display black, and applies the display scale ts_dsc.",
  "multiply_back": "Multiplies the processed chromaticity direction 'r' back with the final brightness 'tsn', reconstructing the display-linear color. This fulfills the promise of the ratios node—brightness and color are now recombined.",
  "rec2020_limit": "Executed only when the display target is Rec.2020: clamps negative values and transforms from P3 to Rec.2020, restricting the gamut to within P3 limits. Default Rec.1886/sRGB targets skip this step.",
  "clamp": "Hard clamps RGB to [0,1] (only if clamp is enabled). A safety fallback before display encoding, as displays cannot represent values outside [0,1]. Usually, softplus and purity limits handle this naturally.",
  "inverse_eotf": "The final encoding step: applies the inverse of the display EOTF (i.e., OETF) to encode display-linear values into the actual signal received by the monitor (e.g., ~2.4 gamma for Rec.1886, ~2.2 for sRGB). This encoded value is what you finally see on the screen."
};

let output = content;

// Replace interface definition
output = output.replace('theory: string;', 'theory: { zh: string; en: string; };');

// Manually replace each key
for (const [key, enText] of Object.entries(translations)) {
  const nodeStart = output.indexOf(`${key}: {`);
  if (nodeStart === -1) continue;
  const theoryIndex = output.indexOf('theory: "', nodeStart);
  if (theoryIndex === -1) continue;
  const quoteStart = theoryIndex + 8; // 'theory: ' length is 8
  
  // Find the end of the string. Need to handle escaped quotes, but since we know it's a double quote string:
  let quoteEnd = -1;
  for (let i = quoteStart + 1; i < output.length; i++) {
    if (output[i] === '"' && output[i-1] !== '\\') {
      quoteEnd = i;
      break;
    }
  }
  if (quoteEnd !== -1) {
    const zhString = output.substring(quoteStart, quoteEnd + 1);
    const replacement = `{ zh: ${zhString}, en: ${JSON.stringify(enText)} }`;
    output = output.substring(0, theoryIndex + 8) + replacement + output.substring(quoteEnd + 1);
  }
}

fs.writeFileSync(file, output);
console.log('Done rewriting.');