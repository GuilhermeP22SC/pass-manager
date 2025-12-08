const AUTOFILL_KEY = 'autofillPausedSites';
const PM_ICON_URL = chrome.runtime.getURL('icons/logo.png');
const SCAN_DEBOUNCE = 500;
let scannerTimeout = null;

const REGEX = {
  user: /user|name|login|mail|id|conta|usuario/i,
  submit: /login|sign|entrar|acessar|submit/i,
  cc: {
    num: /card.?number|numero.?cartao|pan|cc.?num/i,
    name: /card.?holder|nome.?titular|owner/i,
    cvv: /cvv|cvc|security.?code|codigo.?seguranca/i,
    exp: /expir|valid|vencimento|month|year/i
  }
};

// Estilos injetados via JS
const STYLES = `
  .pm-selector-menu { position: absolute; z-index: 2147483647; background: #fff; border: 1px solid #d1d5db; border-radius: 6px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); min-width: 200px; animation: pmFade 0.1s ease-out; font-family: sans-serif; }
  .pm-selector-item { padding: 10px 14px; cursor: pointer; border-bottom: 1px solid #f3f4f6; display: flex; flex-direction: column; }
  .pm-selector-item:hover { background: #f9fafb; }
  .pm-sel-main { font-weight: 600; font-size: 13px; color: #111827; }
  .pm-sel-sub { font-size: 11px; color: #6b7280; }
  @keyframes pmFade { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
`;
const styleEl = document.createElement('style');
styleEl.textContent = STYLES;
document.head.appendChild(styleEl);

(async () => {
  if (await isAutofillPaused(window.location.hostname)) return;
  runScan();
  new MutationObserver(ms => {
    if (ms.some(m => m.addedNodes.length || m.type === 'attributes')) {
      clearTimeout(scannerTimeout);
      scannerTimeout = setTimeout(runScan, SCAN_DEBOUNCE);
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
})();

async function runScan() {
  const inputs = deepQueryAll('input:not([type="hidden"]):not([type="submit"]), select');
  
  // 1. Scan de Login
  inputs.filter(el => el.type === 'password' && !el.dataset.pmProc).forEach(pass => {
    const user = findUserField(pass, inputs);
    pass.dataset.pmProc = 'true';
    if (user) user.dataset.pmProc = 'true';

    // Handler de Login
    const loginHandler = async (icon) => {
      const all = await chrome.runtime.sendMessage({ type: 'GET_LOGIN', url: window.location.href });
      const logins = all.filter(i => !i.type || i.type === 'login');
      handleSelection(icon, logins, (item) => fillFields(user, pass, item), 
        i => `<span class="pm-sel-main">${esc(i.username)}</span><span class="pm-sel-sub">${esc(i.site)}</span>`);
    };

    attachIcon(pass, loginHandler);
    if (user) attachIcon(user, loginHandler);
    attachTrafficListeners(pass, user);
  });

  // 2. Scan de Cartão
  inputs.filter(el => !el.dataset.pmProc && calcCCScore(el) >= 20).forEach(ccInput => {
    const group = findCCGroup(ccInput, inputs);
    Object.values(group).filter(el => el).forEach(el => el.dataset.pmProc = 'true');

    // Handler de Cartão
    attachIcon(group.number, async (icon) => {
      const all = await chrome.runtime.sendMessage({ type: 'GET_LOGIN', url: 'CARD_REQUEST' });
      const cards = all.filter(i => i.type === 'card');
      handleSelection(icon, cards, (item) => fillCard(group, item),
        i => `<span class="pm-sel-main">Cartão **** ${i.cardNumber.slice(-4)}</span><span class="pm-sel-sub">${esc(i.cardHolder)}</span>`);
    });
  });

  checkPendingSave();
}

// --- UI GENÉRICA (Reduzida) ---

function attachIcon(input, actionCallback) {
  if (!input || input.dataset.pmIcon) return;
  
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:relative; display:${getComputedStyle(input).display}; width:${input.offsetWidth}px; vertical-align:${getComputedStyle(input).verticalAlign}`;
  input.parentElement.insertBefore(wrap, input);
  wrap.appendChild(input);
  input.dataset.pmIcon = 'true';

  const icon = document.createElement('img');
  icon.src = PM_ICON_URL;
  icon.style.cssText = 'position:absolute; width:18px; top:50%; right:10px; transform:translateY(-50%); cursor:pointer; opacity:0.5; transition:0.2s; z-index:100;';
  icon.onmouseover = () => icon.style.opacity = '1';
  icon.onmouseout = () => icon.style.opacity = '0.5';
  icon.onclick = (e) => { e.preventDefault(); e.stopPropagation(); actionCallback(icon); };
  wrap.appendChild(icon);
}

function handleSelection(icon, items, onSelect, renderItem) {
  if (!items.length) return shake(icon);
  if (items.length === 1) return onSelect(items[0]);

  document.querySelector('.pm-selector-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'pm-selector-menu';
  
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'pm-selector-item';
    el.innerHTML = renderItem(item);
    el.onclick = (e) => { e.stopPropagation(); onSelect(item); menu.remove(); };
    menu.appendChild(el);
  });

  document.body.appendChild(menu);
  const rect = icon.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY + 5}px`;
  menu.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 220)}px`;

  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
}

// --- PREENCHIMENTO ---

function setVal(el, val) {
  if (!el || !val) return;
  el.value = val;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function fillFields(user, pass, data) {
  setVal(user, data.username);
  setVal(pass, data.password);
}

function fillCard(g, d) {
  setVal(g.number, d.cardNumber);
  setVal(g.name, d.cardHolder);
  setVal(g.cvv, d.cvv);
  if (d.expiry) {
    const [m, y] = d.expiry.split('/');
    if (g.expMonth && g.expYear) {
      setVal(g.expMonth, m.replace(/^0/, '')); // Remove zero líder se necessário
      setVal(g.expYear, y.length === 2 ? '20' + y : y);
    } else {
      setVal(g.expiry, d.expiry);
    }
  }
}

// --- HELPERS E DETECÇÃO ---

function findUserField(pass, all) {
  const idx = all.indexOf(pass);
  return all.slice(Math.max(0, idx - 3), idx).reverse().find(el => 
    el.type !== 'password' && isVisible(el) && (REGEX.user.test(el.name||el.id||'') || el.type === 'email')
  ) || (all[idx-1]?.type === 'text' ? all[idx-1] : null);
}

function findCCGroup(num, all) {
  const range = all.slice(Math.max(0, all.indexOf(num) - 10), all.indexOf(num) + 10);
  const g = { number: num };
  range.forEach(el => {
    if (el === num) return;
    const str = (el.name + el.id + el.placeholder).toLowerCase();
    if (!g.name && REGEX.cc.name.test(str)) g.name = el;
    if (!g.cvv && REGEX.cc.cvv.test(str) && el.maxLength < 5) g.cvv = el;
    if (el.tagName === 'SELECT') {
      if (str.includes('month') || el.options.length === 12) g.expMonth = el;
      else if (str.includes('year')) g.expYear = el;
    } else if (!g.expiry && REGEX.cc.exp.test(str) && el.maxLength < 6) g.expiry = el;
  });
  return g;
}

function calcCCScore(el) {
  if (el.type === 'password' || el.autocomplete === 'cc-number') return 50;
  let score = 0;
  const str = (el.name + el.id + el.placeholder).toLowerCase();
  if (REGEX.cc.num.test(str)) score += 30;
  if (el.type === 'tel' && el.maxLength > 12) score += 10;
  return score;
}

function deepQueryAll(sel, root = document) {
  let res = Array.from(root.querySelectorAll(sel));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    if (walker.currentNode.shadowRoot) res = res.concat(deepQueryAll(sel, walker.currentNode.shadowRoot));
  }
  return res;
}

function attachTrafficListeners(pass, user) {
  if (pass.dataset.pmListen) return;
  pass.dataset.pmListen = 'true';
  const save = () => {
    setTimeout(async () => {
      if (!pass.value) return;
      const exists = await chrome.runtime.sendMessage({ type: 'CHECK_CREDENTIALS_EXIST', url: location.href, username: user?.value });
      if (!exists) chrome.runtime.sendMessage({ type: 'CACHE_TEMP_CREDENTIALS', url: location.href, username: user?.value, password: pass.value });
    }, 100);
  };
  pass.closest('form')?.addEventListener('submit', save);
  pass.addEventListener('keydown', e => e.key === 'Enter' && save());
  // Botão submit genérico
  const btn = pass.closest('form')?.querySelector('[type="submit"]') || 
              Array.from(document.querySelectorAll('button')).find(b => REGEX.submit.test(b.innerText) && pass.contains(b));
  btn?.addEventListener('click', save);
}

async function checkPendingSave() {
  const pending = await chrome.runtime.sendMessage({ type: 'CHECK_PENDING_TO_SAVE', url: location.href });
  if (pending && !(await chrome.runtime.sendMessage({ type: 'CHECK_CREDENTIALS_EXIST', url: pending.url, username: pending.username }))) {
    showSavePrompt(pending);
  }
}

function showSavePrompt(data) {
  const host = document.createElement('div');
  host.attachShadow({mode:'open'}).innerHTML = `
    <style>
      .card{position:fixed;top:20px;right:20px;z-index:99999;background:#fff;padding:15px;border-radius:8px;box-shadow:0 5px 15px rgba(0,0,0,0.2);font-family:sans-serif;width:300px;border:1px solid #ddd;}
      h3{margin:0 0 10px;font-size:16px;color:#0e4e55;} p{font-size:13px;color:#555;}
      .btns{display:flex;justify-content:flex-end;gap:10px;margin-top:15px;}
      button{padding:8px 12px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;}
      .save{background:#0e4e55;color:#fff;} .cancel{background:none;color:#777;}
    </style>
    <div class="card">
      <h3>Salvar Senha?</h3>
      <p>Salvar acesso de <b>${esc(data.username)}</b>?</p>
      <div class="btns"><button class="cancel">Não</button><button class="save">Salvar</button></div>
    </div>`;
  document.body.appendChild(host);
  const shadow = host.shadowRoot;
  shadow.querySelector('.save').onclick = () => {
    chrome.runtime.sendMessage({ type: 'SAVE_CREDENTIALS', url: location.href, username: data.username, password: data.password });
    host.remove();
  };
  shadow.querySelector('.cancel').onclick = () => host.remove();
  setTimeout(() => host.remove(), 15000);
}

async function isAutofillPaused(domain) {
  const data = await chrome.storage.local.get([AUTOFILL_KEY]);
  return (data[AUTOFILL_KEY] || []).some(s => domain.endsWith(s.replace(/^www\./,'')));
}

const esc = (t) => t ? t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") : '';
const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
const shake = (el) => { el.style.transform = 'translateX(2px)'; setTimeout(()=>el.style.transform='translateX(0)', 100); };