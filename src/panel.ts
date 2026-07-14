// 参数面板:拆成「源」组(Input Gamut + Input OETF)与「OpenDRT」组(Look/Display + 全部分组参数)。
// 改动触发 onChange(重绘当前视图)。参数对象为单一真源。
// 【全参数暴露】OpenDRT 面板按官方分组渲染:可折叠、滑块带官方 tooltip、组开关控制子组显隐。

import {
  LOOKS, DISPLAYS, IN_GAMUTS, IN_OETFS,
  PARAM_GROUPS, CWP_OPTIONS, IN_GAMUT_LABELS,
  LOOK_PRESETS, TONESCALE_PRESETS, TONESCALE_PRESET_VALUES,
  type DrtParams, type ParamGroup, type LookName, type TonescalePresetName,
} from "./params";

// 选 look:把该 look 的 63 个 DrtParams 字段(逐字来自 DCTL)填入 params。
// 若已选了非 None 的 tonescale preset,再叠加覆盖 11 个 tn_ 参数(DCTL 顺序:先 look 后 tonescale)。
function applyLookPreset(params: DrtParams, look: LookName): void {
  params.look = look;
  Object.assign(params, LOOK_PRESETS[look]);
  if (params.tonescalePreset !== "None") {
    const tv = TONESCALE_PRESET_VALUES[params.tonescalePreset];
    if (tv) Object.assign(params, tv);
  }
}

// 选 tonescale preset:None=回到当前 look 的 tn_ 值(重放 look preset 后不叠加);其余覆盖 11 个 tn_ 参数。
function applyTonescalePreset(params: DrtParams, name: TonescalePresetName): void {
  params.tonescalePreset = name;
  // 先把当前 look 的基准 tn_ 值恢复,再按需叠加,避免不同 preset 间残留。
  Object.assign(params, LOOK_PRESETS[params.look]);
  if (name !== "None") {
    const tv = TONESCALE_PRESET_VALUES[name];
    if (tv) Object.assign(params, tv);
  }
}

function makeSelect(
  label: string,
  options: readonly string[],
  value: string,
  onChange: (v: string) => void,
  labelMap?: Record<string, string>,
): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const span = document.createElement("span");
  span.textContent = label;
  const sel = document.createElement("select");
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = labelMap?.[opt] ?? opt;
    if (opt === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => onChange(sel.value));
  wrap.append(span, sel);
  return wrap;
}

function appendSelects(
  root: HTMLElement,
  params: DrtParams,
  onChange: () => void,
  enums: Array<[string, readonly string[], keyof DrtParams, Record<string, string>?]>,
): void {
  for (const [label, opts, key, labelMap] of enums) {
    root.appendChild(
      makeSelect(label, opts, params[key] as string, (v) => {
        (params[key] as string) = v;
        onChange();
      }, labelMap),
    );
  }
}

/** 源色彩空间组:Input Gamut(源色域)+ Input OETF(transform curve)。 */
export function buildSourcePanel(
  root: HTMLElement,
  params: DrtParams,
  onChange: () => void,
): void {
  root.innerHTML = "";
  appendSelects(root, params, onChange, [
    ["Input Gamut", IN_GAMUTS, "inGamut", IN_GAMUT_LABELS],
    ["Transform Curve (Input OETF)", IN_OETFS, "inOetf"],
  ]);
}

// 单个滑块控件
function makeSlider(
  params: DrtParams,
  key: keyof DrtParams,
  label: string,
  min: number,
  max: number,
  step: number,
  tip: string,
  onChange: () => void,
): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "field field-slider";
  if (tip) wrap.title = tip;
  const span = document.createElement("span");
  const valSpan = document.createElement("b");
  valSpan.textContent = String(params[key]);
  span.append(document.createTextNode(label + " "), valSpan);
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(params[key]);
  slider.addEventListener("input", () => {
    const v = parseFloat(slider.value);
    (params[key] as number) = v;
    valSpan.textContent = String(v);
    onChange();
  });
  wrap.append(span, slider);
  return wrap;
}

// 单个开关控件(0/1)
function makeToggle(
  params: DrtParams,
  key: keyof DrtParams,
  label: string,
  tip: string,
  onChange: () => void,
): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "field field-toggle";
  if (tip) wrap.title = tip;
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = (params[key] as number) !== 0;
  cb.addEventListener("change", () => {
    (params[key] as number) = cb.checked ? 1 : 0;
    onChange();
  });
  const span = document.createElement("span");
  span.textContent = label;
  wrap.append(cb, span);
  return wrap;
}

// 渲染一个可折叠分组
function renderGroup(
  root: HTMLElement,
  g: ParamGroup,
  params: DrtParams,
  onChange: () => void,
  afterHeader?: (details: HTMLElement) => void,
): void {
  const details = document.createElement("details");
  details.className = "param-group";
  if (!g.defaultCollapsed) details.open = true;

  const summary = document.createElement("summary");
  summary.textContent = g.title;
  if (g.desc) summary.title = g.desc;
  details.appendChild(summary);

  if (g.desc) {
    const desc = document.createElement("p");
    desc.className = "group-desc";
    desc.textContent = g.desc;
    details.appendChild(desc);
  }

  // 组开关(每个 toggle 控制内核 *_enable)
  if (g.toggles) {
    for (const [key, label, tip] of g.toggles) {
      details.appendChild(makeToggle(params, key, label, tip, onChange));
    }
  }

  // 滑块
  for (const [key, label, min, max, step, tip] of g.sliders) {
    details.appendChild(makeSlider(params, key, label, min, max, step, tip, onChange));
  }

  // 可选:在组内顶部(summary/desc 之后)插入额外控件(如 tonescale preset 下拉)。
  if (afterHeader) afterHeader(details);

  root.appendChild(details);
}

/** OpenDRT 组:Look / Display + Creative White 下拉 + 全部分组参数。
 *  rebuild:选 look/tonescale preset 后需要刷新所有滑块 DOM(值被 preset 改了),
 *  故重新调用本函数重建面板;onChange 只重绘视图。 */
export function buildOpenDrtPanel(
  root: HTMLElement,
  params: DrtParams,
  onChange: () => void,
  rebuild: () => void,
): void {
  root.innerHTML = "";

  // Look 下拉:选中后套用 preset(自动更改所有滑块)并重建面板 + 重绘。
  root.appendChild(
    makeSelect("Look", LOOKS, params.look, (v) => {
      applyLookPreset(params, v as LookName);
      rebuild();
      onChange();
    }),
  );

  appendSelects(root, params, onChange, [
    ["Display", DISPLAYS, "display"],
  ]);

  // Creative White 是索引枚举(cwp 0..5),单独一个下拉。
  root.appendChild(
    makeSelect(
      "Creative White (cwp)",
      CWP_OPTIONS,
      CWP_OPTIONS[params.cwp] ?? "D65",
      (v) => {
        params.cwp = CWP_OPTIONS.indexOf(v as (typeof CWP_OPTIONS)[number]);
        onChange();
      },
    ),
  );

  // 全部官方分组（在 Tonescale 组顶部插入 tonescale preset 下拉）
  for (const g of PARAM_GROUPS) {
    if (g.id === "tonescale") {
      renderGroup(root, g, params, onChange, (details) => {
        // 在该组内部顶部(summary 之后)插入 tonescale preset 下拉
        const sel = makeSelect(
          "Tonescale Preset", TONESCALE_PRESETS, params.tonescalePreset,
          (v) => {
            applyTonescalePreset(params, v as TonescalePresetName);
            rebuild();
            onChange();
          },
        );
        // 插入到 summary(及可能的 desc)之后、首个控件之前
        const anchor = details.querySelector("p.group-desc") ?? details.querySelector("summary");
        anchor?.after(sel);
      });
    } else {
      renderGroup(root, g, params, onChange);
    }
  }
}
