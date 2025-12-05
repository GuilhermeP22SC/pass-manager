// script.js - Detecção Empresarial (Ícones em todos os campos)

const AUTOFILL_STORAGE_KEY = 'autofillPausedSites';
const PM_ICON_URL = chrome.runtime.getURL('icons/logo.png');

// Configuração de Debounce para o Observer
let scannerTimeout = null;
const SCAN_DEBOUNCE_MS = 500;

// Regex para Heurística
const USERNAME_REGEX = /user|name|login|mail|id|conta|usuario|utilizador/i;
const SUBMIT_REGEX = /login|sign|entrar|acessar|logon|submit/i;

// --- INICIALIZAÇÃO ---
(async () => {
  const hostname = window.location.hostname;
  
  const autofillPaused = await isAutofillPaused(hostname);
  if (autofillPaused) return;

  runEnterpriseScan();

  const observer = new MutationObserver((mutations) => {
    const shouldScan = mutations.some(m => m.addedNodes.length > 0 || m.type === 'attributes');
    if (shouldScan) {
      clearTimeout(scannerTimeout);
      scannerTimeout = setTimeout(runEnterpriseScan, SCAN_DEBOUNCE_MS);
    }
  });

  observer.observe(document.body, { 
    childList: true, 
    subtree: true, 
    attributes: true, 
    attributeFilter: ['style', 'class', 'hidden', 'type'] 
  });
})();

// --- NÚCLEO DE DETECÇÃO (ENGINE) ---

async function runEnterpriseScan() {
  const allInputs = deepQuerySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])');
  
  // Identifica campos de senha
  const passwordInputs = allInputs.filter(el => el.type === 'password' || el.name?.toLowerCase().includes('password'));

  if (passwordInputs.length === 0) return;

  for (const passInput of passwordInputs) {
    // Se o par já foi processado completamente, pula.
    // Mas verificamos individualmente a injeção de ícones abaixo.
    if (passInput.dataset.pmProcessed) continue;

    // Encontra o campo de utilizador associado
    const userInput = findRelatedUsernameField(passInput, allInputs);

    // Marca o par como "conhecido" para evitar re-análise de relacionamento
    passInput.dataset.pmProcessed = 'true';
    if (userInput) userInput.dataset.pmProcessed = 'true';

    // --- MUDANÇA: Injeta ícones em AMBOS os campos ---
    
    // 1. Injeta no campo de Senha
    injectIcon(passInput, userInput, passInput);

    // 2. Injeta no campo de Usuário (se existir)
    if (userInput) {
      injectIcon(userInput, userInput, passInput);
    }

    // Configura Listeners de Captura (Enter e Submit)
    attachTrafficListeners(passInput, userInput);
    
    // Tenta Autofill inicial (apenas uma vez para o par)
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_LOGIN', url: window.location.href });
      if (response) {
        fillFields(userInput, passInput, response);
      }
    } catch (e) {}
  }

  checkPendingCredentials();
}

// --- TRAVERSAL & HEURÍSTICA ---

function deepQuerySelectorAll(selector, root = document) {
  let results = Array.from(root.querySelectorAll(selector));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.shadowRoot) {
      results = results.concat(deepQuerySelectorAll(selector, node.shadowRoot));
    }
  }
  return results;
}

function findRelatedUsernameField(passInput, allInputs) {
  const index = allInputs.indexOf(passInput);
  if (index <= 0) return null;

  const candidates = allInputs.slice(Math.max(0, index - 3), index).reverse();

  let bestCandidate = null;
  let maxScore = -1;

  for (const input of candidates) {
    if (input.type === 'password') continue;
    if (!isVisible(input)) continue;

    const score = calculateUsernameScore(input);
    if (score > maxScore) {
      maxScore = score;
      bestCandidate = input;
    }
  }

  if (!bestCandidate && candidates.length > 0) {
    const immediate = candidates[0];
    if (immediate.type === 'text' || immediate.type === 'email') {
      return immediate;
    }
  }

  return bestCandidate;
}

function calculateUsernameScore(input) {
  let score = 0;
  const attrString = `${input.name} ${input.id} ${input.placeholder} ${input.getAttribute('aria-label')}`.toLowerCase();

  if (input.autocomplete === 'username' || input.autocomplete === 'email') score += 20;
  if (input.type === 'email') score += 10;
  if (USERNAME_REGEX.test(attrString)) score += 5;
  
  if (input.type === 'search') score -= 10;
  if (input.type === 'date') score -= 20;

  return score;
}

function isVisible(el) {
  if (!el) return false;
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

// --- LISTENERS E CAPTURA ---

function attachTrafficListeners(passInput, userInput) {
  const inputs = [passInput, userInput].filter(Boolean);
  
  inputs.forEach(input => {
    // Evita duplicar listeners se a função for chamada novamente
    if (input.dataset.pmListenerAttached) return;
    input.dataset.pmListenerAttached = 'true';

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleCredentialCapture(userInput, passInput);
      }
    }, true);
  });

  const submitBtn = findSubmitButton(passInput);
  if (submitBtn && !submitBtn.dataset.pmListenerAttached) {
    submitBtn.dataset.pmListenerAttached = 'true';
    submitBtn.addEventListener('click', () => {
      handleCredentialCapture(userInput, passInput);
    }, true);
  } else {
    const parentForm = passInput.closest('form');
    if (parentForm && !parentForm.dataset.pmListenerAttached) {
      parentForm.dataset.pmListenerAttached = 'true';
      parentForm.addEventListener('submit', () => {
        handleCredentialCapture(userInput, passInput);
      }, true);
    }
  }
}

function findSubmitButton(passInput) {
  const form = passInput.closest('form');
  if (form) {
    const btn = form.querySelector('button[type="submit"], input[type="submit"]');
    if (btn) return btn;
  }

  let parent = passInput.parentElement;
  for (let i = 0; i < 3; i++) {
    if (!parent) break;
    const buttons = parent.querySelectorAll('button, div[role="button"], input[type="button"]');
    for (const btn of buttons) {
      if (SUBMIT_REGEX.test(btn.innerText || btn.value || btn.id)) {
        return btn;
      }
    }
    parent = parent.parentElement;
  }
  return null;
}

async function handleCredentialCapture(userInput, passInput) {
  const uVal = userInput ? userInput.value : '';
  const pVal = passInput.value;

  if (!pVal || (userInput && !uVal)) return; 

  let finalUser = uVal;
  if (!finalUser && userInput) {
      await new Promise(r => setTimeout(r, 100));
      finalUser = userInput.value;
  }

  const exists = await chrome.runtime.sendMessage({ 
    type: 'CHECK_CREDENTIALS_EXIST', 
    url: window.location.href, 
    username: finalUser 
  });

  if (!exists) {
    chrome.runtime.sendMessage({
      type: 'CACHE_TEMP_CREDENTIALS',
      url: window.location.href,
      username: finalUser,
      password: pVal
    });
  }
}

// --- UI INJECTION (ATUALIZADO) ---

/**
 * Injeta o ícone em um campo alvo (targetInput).
 * @param {HTMLInputElement} targetInput - O campo onde o ícone será desenhado (pode ser User ou Pass)
 * @param {HTMLInputElement} relatedUser - Referência para o campo de usuário (para preencher)
 * @param {HTMLInputElement} relatedPass - Referência para o campo de senha (para preencher)
 */
function injectIcon(targetInput, relatedUser, relatedPass) {
  // Verifica se ESTE campo específico já tem ícone
  if (targetInput.dataset.pmIconAttached === 'true') return;
  
  // Verifica se o elemento ainda está conectado ao DOM
  if (!targetInput.parentElement) return;

  // Criação do Wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'pm-icon-wrapper';
  
  const computed = window.getComputedStyle(targetInput);
  wrapper.style.cssText = `
    position: relative;
    display: ${computed.display === 'block' ? 'block' : 'inline-block'};
    width: ${targetInput.offsetWidth}px;
    margin: ${computed.margin};
    padding: 0;
    border: none;
    background: transparent;
    vertical-align: ${computed.verticalAlign};
  `;

  // Insere o wrapper e move o input para dentro
  targetInput.parentElement.insertBefore(wrapper, targetInput);
  wrapper.appendChild(targetInput);
  
  // Marca como processado
  targetInput.dataset.pmIconAttached = 'true';
  targetInput.focus(); 

  // Criação do Ícone
  const icon = document.createElement('img');
  icon.src = PM_ICON_URL;
  icon.style.cssText = `
    position: absolute;
    width: 18px;
    height: 18px;
    top: 50%;
    right: 10px;
    transform: translateY(-50%);
    cursor: pointer;
    z-index: 1000;
    opacity: 0.5;
    transition: opacity 0.2s, transform 0.2s;
  `;
  icon.title = "Gerenciador de Senhas";
  
  icon.onmouseover = () => icon.style.opacity = '1';
  icon.onmouseout = () => icon.style.opacity = '0.5';

  // Evento de Clique no Ícone
  icon.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Efeito visual de clique
    icon.style.transform = 'translateY(-50%) scale(0.9)';
    setTimeout(() => icon.style.transform = 'translateY(-50%) scale(1)', 150);

    const response = await chrome.runtime.sendMessage({ type: 'GET_LOGIN', url: window.location.href });
    
    if (response) {
      // Preenche AMBOS os campos, independentemente de qual ícone foi clicado
      fillFields(relatedUser, relatedPass, response);
    } else {
      shakeElement(icon);
    }
  });

  wrapper.appendChild(icon);
}

function fillFields(userInput, passInput, data) {
  if (passInput) {
    passInput.value = data.password;
    dispatchEvents(passInput);
  }
  if (userInput && data.username) {
    userInput.value = data.username;
    dispatchEvents(userInput);
  }
}

function dispatchEvents(element) {
  const events = ['click', 'focus', 'input', 'change', 'blur'];
  events.forEach(evtType => {
    const event = new Event(evtType, { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
  });
}

function shakeElement(el) {
    const originalTransform = el.style.transform;
    el.style.transform = `${originalTransform} translateX(2px)`;
    setTimeout(() => el.style.transform = `${originalTransform} translateX(-2px)`, 100);
    setTimeout(() => el.style.transform = `${originalTransform} translateX(2px)`, 200);
    setTimeout(() => el.style.transform = originalTransform, 300);
}

// --- PENDÊNCIAS E UI ---

async function checkPendingCredentials() {
  try {
    const pending = await chrome.runtime.sendMessage({ type: 'CHECK_PENDING_TO_SAVE', url: window.location.href });
    if (pending) {
       const exists = await chrome.runtime.sendMessage({ 
          type: 'CHECK_CREDENTIALS_EXIST', 
          url: pending.url, 
          username: pending.username 
       });

       if (!exists) {
         showSavePrompt(pending.username, pending.password);
       }
    }
  } catch (e) {}
}

function showSavePrompt(username, password) {
  const existing = document.getElementById('pm-shadow-host');
  if (existing) existing.remove();

  const host = document.createElement('div');
  host.id = 'pm-shadow-host';
  host.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 2147483647;'; 
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = `
    <style>
      .pm-card {
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.15);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        box-sizing: border-box;
        width: 320px;
        padding: 20px;
        color: #333;
        border: 1px solid #e0e0e0;
        animation: slideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes slideIn { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      .pm-header { display: flex; align-items: center; margin-bottom: 12px; }
      .pm-logo { width: 24px; height: 24px; margin-right: 12px; border-radius: 4px; }
      .pm-title { font-weight: 600; font-size: 16px; margin: 0; color: #0e4e55; }
      .pm-text { font-size: 14px; margin-bottom: 20px; color: #5e6d75; line-height: 1.5; }
      .pm-user { font-weight: 700; color: #223038; background: #f5f7f9; padding: 2px 6px; border-radius: 4px; }
      .pm-actions { display: flex; justify-content: flex-end; gap: 12px; }
      button { border: none; padding: 10px 18px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
      .btn-cancel { background: transparent; color: #5e6d75; }
      .btn-cancel:hover { background: #f1f3f5; color: #223038; }
      .btn-save { background: #0e4e55; color: white; }
      .btn-save:hover { background: #0a3a40; box-shadow: 0 2px 4px rgba(14, 78, 85, 0.3); }
    </style>
  `;

  shadow.innerHTML = `
    ${style}
    <div class="pm-card">
      <div class="pm-header">
        <img src="${PM_ICON_URL}" class="pm-logo" />
        <h3 class="pm-title">Salvar Login?</h3>
      </div>
      <p class="pm-text">Deseja que o gerenciador salve as credenciais para <span class="pm-user">${username}</span>?</p>
      <div class="pm-actions">
        <button id="btn-cancel" class="btn-cancel">Agora não</button>
        <button id="btn-save" class="btn-save">Salvar Senha</button>
      </div>
    </div>
  `;

  shadow.getElementById('btn-save').addEventListener('click', () => {
    chrome.runtime.sendMessage({ 
      type: 'SAVE_CREDENTIALS', 
      url: window.location.href, 
      username: username, 
      password: password 
    });
    closePrompt();
  });

  shadow.getElementById('btn-cancel').addEventListener('click', closePrompt);
  
  function closePrompt() {
      host.style.opacity = '0';
      setTimeout(() => host.remove(), 300);
  }
  
  setTimeout(() => { if (document.body.contains(host)) closePrompt(); }, 15000);
}

// --- UTILITÁRIOS ---

async function isAutofillPaused(domain) {
  try {
    const data = await chrome.storage.local.get([AUTOFILL_STORAGE_KEY]);
    const pausedList = Array.isArray(data[AUTOFILL_STORAGE_KEY]) ? data[AUTOFILL_STORAGE_KEY] : [];
    const normalizedTarget = normalizeDomain(domain);
    return pausedList.some((saved) => {
      const normalizedSaved = normalizeDomain(saved);
      return normalizedTarget === normalizedSaved || normalizedTarget.endsWith(`.${normalizedSaved}`);
    });
  } catch (error) {
    return false;
  }
}

function normalizeDomain(domain = '') {
  return domain.toLowerCase().replace(/^www\./, '');
}