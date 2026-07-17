import { zh, type I18nKeys } from './zh';
import { en } from './en';

type Lang = 'zh' | 'en';

let currentLang: Lang = 'en';

if (navigator.language.toLowerCase().startsWith('zh')) {
  currentLang = 'zh';
}

const dicts = { zh, en };

export function setLang(lang: Lang) {
  currentLang = lang;
  updateDomTranslations();
  // We can also trigger a custom event so other components can re-render if needed
  window.dispatchEvent(new Event('languagechange'));
}

export function getLang(): Lang {
  return currentLang;
}

export function t(key: I18nKeys, ...args: (string | number)[]): string {
  let str = dicts[currentLang][key] || key;
  for (let i = 0; i < args.length; i++) {
    str = str.replace(`{${i}}`, String(args[i]));
  }
  return str;
}

export function updateDomTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n') as I18nKeys;
    if (key) {
      // If it's an input/button with value, we might need different handling, but textContent is usually fine
      if (el.tagName === 'OPTION') {
        (el as HTMLOptionElement).textContent = t(key);
      } else {
        el.textContent = t(key);
      }
    }
  });
}
