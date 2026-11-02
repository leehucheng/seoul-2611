// The screen shown when the app has no connection settings: a box to paste the full link the friends were given.
// Needed on an iPhone's home-screen app (its own storage, opens `./` without the #a=..&k=.. part) and after Safari
// clears site data. showSetup(el, {storage, onConfig}): `el` is the full-screen #fatal box; onConfig(cfg) runs once the
// pasted text carried a usable id and key (already saved by configFromInput) and the app can start.
import { configFromInput } from '../config.js';
import { clear, h, icon } from './dom.js';

export function showSetup(el, { storage, onConfig }) {
  const input = h('input', {
    class: 'field', id: 'setup-input', type: 'text', inputmode: 'url', enterkeyhint: 'go',
    autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
    placeholder: 'https://…', 'aria-describedby': 'setup-error',
  });
  const error = h('p', { class: 'field-error', id: 'setup-error', role: 'alert' });

  const submit = (e) => {
    e.preventDefault();
    const cfg = configFromInput(input.value, storage);
    if (!cfg) {
      error.textContent = '這個網址不對。請把朋友分享的整段連結貼上來。';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    clear(el);
    el.hidden = true;
    onConfig(cfg);
  };
  input.addEventListener('input', () => { error.textContent = ''; input.removeAttribute('aria-invalid'); });

  clear(el).append(h('div', { class: 'fatal-box' },
    icon('i-pin', 'fatal-ico'),
    h('h1', { class: 'fatal-title' }, '請用分享給你的完整網址開啟'),
    h('p', { class: 'fatal-msg' }, '這個網頁要用朋友分享給你的完整連結才能連到資料。把那個連結整段貼在下面。'),
    h('form', { class: 'setup-form', onsubmit: submit, novalidate: true },
      h('label', { class: 'field-label', for: 'setup-input' }, '貼上分享給你的完整網址'),
      input,
      error,
      h('button', { class: 'btn btn--primary', type: 'submit' }, '確定'))));
  el.hidden = false;
}
