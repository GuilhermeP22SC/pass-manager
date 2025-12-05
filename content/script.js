// script.js - Detecção Empresarial (Ícones em todos os campos)

const AUTOFILL_STORAGE_KEY = 'autofillPausedSites';
const PM_ICON_URL = chrome.runtime.getURL('icons/logo.png');

let scannerTimeout = null;
const SCAN_DEBOUNCE_MS = 500;

const USERNAME_REGEX = /user|name|login|mail|id|conta|usuario|utilizador/i;
const SUBMIT_REGEX = /login|sign|entrar|acessar|logon|submit/i;

// --- NOVAS CONSTANTES PARA CARTÃO DE CRÉDITO ---
const CC_REGEX = {
  number: /card.?number|numero.?cartao|pan|cc.?num|credit.?card/i,
  name: /card.?holder|nome.?titular|owner|name.?on.?card/i,
  cvv: /cvv|cvc|security.?code|codigo.?seguranca|verification/i,
  expiry: /expir|valid|vencimento|month|year/i
};

// CSS para o seletor de contas
const SELECTOR_STYLES = `
  .pm-selector-menu {
    position: absolute;
    z-index: 2147483647; /* Máximo z-index */
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    min-width: 200px;
    max-width: 300px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    text-align: left;
    overflow: hidden;
    animation: pmFadeIn 0.1s ease-out;
  }
  .pm-selector-item {
    padding: 10px 14px;
    cursor: pointer;
    border-bottom: 1px solid #f3f4f6;
    transition: background 0.1s;
    display: flex;
    flex-direction: column;
  }
  .pm-selector-item:last-child { border-bottom: none; }
  .pm-selector-item:hover { background-color: #f9fafb; }
  .pm-sel-user { font-weight: 600; font-size: 13px; color: #111827; }
  .pm-sel-site { font-size: 11px; color: #6b7280; margin-top: 2px; }
  @keyframes pmFadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
`;

// Injeta os estilos uma única vez
const styleEl = document.createElement('style');
styleEl.textContent = SELECTOR_STYLES;
document.head.appendChild(styleEl);

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
  // Inclui 'select' para detecção de datas de validade (ex: Amazon)
  const allInputs = deepQuerySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select');
  
  // 1. Password/Login Scan
  const passwordInputs = allInputs.filter(el => el.type === 'password' || el.name?.toLowerCase().includes('password'));

  for (const passInput of passwordInputs) {
    if (passInput.dataset.pmProcessed) continue;

    const userInput = findRelatedUsernameField(passInput, allInputs);

    passInput.dataset.pmProcessed = 'true';
    if (userInput) userInput.dataset.pmProcessed = 'true';

    injectIcon(passInput, userInput, passInput);

    if (userInput) {
      injectIcon(userInput, userInput, passInput);
    }

    attachTrafficListeners(passInput, userInput);
    
    // Tenta Autofill inicial (apenas uma vez para o par)
    try {
      const matches = await chrome.runtime.sendMessage({ type: 'GET_LOGIN', url: window.location.href });
      // Se houver matches, preenche o primeiro automaticamente ao carregar
      if (matches && matches.length > 0 && userInput && passInput) {
        fillFields(userInput, passInput, matches[0]);
      }
    } catch (e) {}
  }

  // 2. Credit Card Scan
  runCreditCardScan(allInputs);
  
  checkPendingCredentials();
}

// --- ENGINE DE CARTÃO DE CRÉDITO ---

function runCreditCardScan(allInputs) {
  // Filtra candidatos a número de cartão (campo principal)
  const ccInputs = allInputs.filter(el => {
    // Evita inputs com type=password, já tratados acima.
    if (el.type === 'password' || el.dataset.pmProcessed) return false;
    
    const score = calculateCCScore(el);
    return score >= 20; // Limiar de confiança (ajustável)
  });

  for (const ccInput of ccInputs) {
    // Tenta encontrar os "irmãos" do cartão (CVV, Data, Nome) próximos a ele
    const group = findCardFieldGroup(ccInput, allInputs);
    
    // Marca todos como processados para não injetar ícone duplicado
    Object.values(group).forEach(el => { 
        if(el) el.dataset.pmProcessed = 'true'; 
    });

    // Injeta o ícone apenas no campo do número do cartão
    if (group.number) {
      injectCCIcon(group.number, group);
    }
  }
}

function calculateCCScore(input) {
  let score = 0;
  const attrString = `${input.name} ${input.id} ${input.placeholder} ${input.getAttribute('aria-label')}`.toLowerCase();
  
  // Heurística Forte (padrão do navegador ou palavras-chave claras)
  if (input.autocomplete === 'cc-number') score += 50;
  if (CC_REGEX.number.test(attrString)) score += 30;
  
  // Heurística de Formato
  // A maioria dos cartões tem 16 dígitos. Amazon usa type="tel".
  if (input.type === 'tel' && input.maxLength >= 13 && input.maxLength <= 19) score += 10;
  if (input.id && attrString.includes('cardnumber')) score += 20; // Campo do Mercado Livre

  return score;
}

function findCardFieldGroup(numberInput, allInputs) {
  // Procura campos relacionados num raio de proximidade no DOM
  const index = allInputs.indexOf(numberInput);
  // Olha 10 campos para trás e 10 para frente (cerca de 20 campos de alcance)
  const range = allInputs.slice(Math.max(0, index - 10), Math.min(allInputs.length, index + 10));

  const group = {
    number: numberInput,
    name: null,
    expiry: null,     // Campo único (MM/AA)
    expMonth: null,   // Select ou input separado
    expYear: null,    // Select ou input separado
    cvv: null
  };

  range.forEach(input => {
    if (input === numberInput || input.dataset.pmProcessed) return;
    const attrString = `${input.name} ${input.id} ${input.placeholder} ${input.getAttribute('aria-label')}`.toLowerCase();
    
    // Detecção de Nome
    if (!group.name && (input.autocomplete === 'cc-name' || CC_REGEX.name.test(attrString))) {
      group.name = input;
    }
    
    // Detecção de CVV
    // Note: CVV é sempre password/tel/text e com max-length 3-4
    if (!group.cvv && (input.autocomplete === 'cc-csc' || CC_REGEX.cvv.test(attrString)) && input.maxLength <= 4) {
      group.cvv = input;
    }

    // Detecção de Validade (Selects)
    if (input.tagName === 'SELECT') {
      if (attrString.includes('month') || input.options.length === 12) {
         group.expMonth = input;
      } else if (attrString.includes('year') && input.options.length > 10) {
         group.expYear = input;
      }
    } 
    // Detecção de Validade (Campo único MM/AA)
    else if (!group.expiry && CC_REGEX.expiry.test(attrString) && input.maxLength <= 5) {
       group.expiry = input;
    }
  });

  return group;
}

// --- TRAVERSAL & HEURÍSTICA (Lógica de Login) ---
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
    if (immediate.type === 'text' || immediate.type === 'email') return immediate;
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

// --- LISTENERS E CAPTURA (Login) ---
function attachTrafficListeners(passInput, userInput) {
  const inputs = [passInput, userInput].filter(Boolean);
  inputs.forEach(input => {
    if (input.dataset.pmListenerAttached) return;
    input.dataset.pmListenerAttached = 'true';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleCredentialCapture(userInput, passInput);
    }, true);
  });
  const submitBtn = findSubmitButton(passInput);
  if (submitBtn && !submitBtn.dataset.pmListenerAttached) {
    submitBtn.dataset.pmListenerAttached = 'true';
    submitBtn.addEventListener('click', () => handleCredentialCapture(userInput, passInput), true);
  } else {
    const parentForm = passInput.closest('form');
    if (parentForm && !parentForm.dataset.pmListenerAttached) {
      parentForm.dataset.pmListenerAttached = 'true';
      parentForm.addEventListener('submit', () => handleCredentialCapture(userInput, passInput), true);
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
      if (SUBMIT_REGEX.test(btn.innerText || btn.value || btn.id)) return btn;
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

// --- UI INJECTION E SELEÇÃO (LOGIN) ---

// Função original para injeção de ícone em campos de LOGIN/PASSWORD
function injectIcon(targetInput, relatedUser, relatedPass) {
  if (targetInput.dataset.pmIconAttached === 'true') return;
  if (!targetInput.parentElement) return;

  const wrapper = createIconWrapper(targetInput);

  targetInput.parentElement.insertBefore(wrapper, targetInput);
  wrapper.appendChild(targetInput);
  targetInput.dataset.pmIconAttached = 'true';
  // targetInput.focus(); // Removido focus para evitar roubo de foco

  const icon = createIconElement();
  
  icon.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Animação de clique
    icon.style.transform = 'translateY(-50%) scale(0.9)';
    setTimeout(() => icon.style.transform = 'translateY(-50%) scale(1)', 150);

    const matches = await chrome.runtime.sendMessage({ type: 'GET_LOGIN', url: window.location.href });
    
    if (matches && matches.length > 0) {
      const loginMatches = matches.filter(i => i.type === 'login' || !i.type); // Filtra só logins
      if (loginMatches.length === 1) {
        fillFields(relatedUser, relatedPass, loginMatches[0]);
      } else if (loginMatches.length > 1) {
        showCredentialSelector(icon, loginMatches, relatedUser, relatedPass);
      } else {
        shakeElement(icon);
      }
    } else {
      shakeElement(icon);
    }
  });

  wrapper.appendChild(icon);
}

// --- UI INJECTION E SELEÇÃO (CARTÃO DE CRÉDITO) ---

function injectCCIcon(targetInput, group) {
  if (targetInput.dataset.pmIconAttached === 'true') return;
  if (!targetInput.parentElement) return;

  const wrapper = createIconWrapper(targetInput);

  targetInput.parentElement.insertBefore(wrapper, targetInput);
  wrapper.appendChild(targetInput);
  targetInput.dataset.pmIconAttached = 'true';

  const icon = createIconElement();
  
  icon.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Animação de clique
    icon.style.transform = 'translateY(-50%) scale(0.9)';
    setTimeout(() => icon.style.transform = 'translateY(-50%) scale(1)', 150);

    // Usa um filtro específico para buscar APENAS cartões
    const vaultItems = await chrome.runtime.sendMessage({ type: 'GET_LOGIN', url: 'CARD_REQUEST' }); 
    const cards = vaultItems.filter(i => i.type === 'card'); // Filtra só cartões

    if (cards.length > 0) {
      if (cards.length === 1) {
        fillCardForm(group, cards[0]);
      } else {
        showCardSelector(icon, cards, group);
      }
    } else {
      shakeElement(icon);
    }
  });

  wrapper.appendChild(icon);
}


function createIconWrapper(targetInput) {
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
    return wrapper;
}

function createIconElement() {
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
    return icon;
}

// Função de Seleção de Login (original)
function showCredentialSelector(icon, credentials, userField, passField) {
  // Remove seletor anterior se existir
  const existing = document.querySelector('.pm-selector-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'pm-selector-menu';

  credentials.forEach(cred => {
    const item = document.createElement('div');
    item.className = 'pm-selector-item';
    item.innerHTML = `
      <span class="pm-sel-user">${escapeHtml(cred.username)}</span>
      <span class="pm-sel-site">${escapeHtml(cred.site)}</span>
    `;
    
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      fillFields(userField, passField, cred);
      menu.remove();
    });
    
    menu.appendChild(item);
  });

  positionAndShowMenu(icon, menu);
}

// Função de Seleção de Cartão (nova)
function showCardSelector(icon, cards, group) {
  // Remove seletor anterior se existir
  const existing = document.querySelector('.pm-selector-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'pm-selector-menu';

  cards.forEach(card => {
    const item = document.createElement('div');
    item.className = 'pm-selector-item';
    const last4 = (card.cardNumber || '').replace(/\D/g, '').slice(-4);
    item.innerHTML = `
      <span class="pm-sel-user">Cartão final **** ${last4}</span>
      <span class="pm-sel-site">${escapeHtml(card.cardHolder)}</span>
    `;
    
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      fillCardForm(group, card); // Usa função especializada
      menu.remove();
    });
    
    menu.appendChild(item);
  });

  positionAndShowMenu(icon, menu);
}

function positionAndShowMenu(icon, menu) {
  // 1. Adiciona ao body primeiro para calcular dimensões
  document.body.appendChild(menu);

  // 2. Cálculos de Posicionamento Robusto
  const rect = icon.getBoundingClientRect();
  const scrollY = window.scrollY || window.pageYOffset;
  const scrollX = window.scrollX || window.pageXOffset;
  
  const menuWidth = menu.offsetWidth;
  const windowWidth = window.innerWidth;

  // Tenta alinhar a borda direita do menu com a borda direita do ícone (rect.right)
  let leftPos = (rect.right + scrollX) - menuWidth;

  // Se o menu sair pela esquerda (left negativo), alinha com a esquerda do ícone
  if (leftPos < 10) {
    leftPos = rect.left + scrollX;
  }
  
  // Se ainda assim sair pela direita da tela, ajusta para caber
  if (leftPos + menuWidth > windowWidth + scrollX) {
      leftPos = (windowWidth + scrollX) - menuWidth - 10;
  }

  // Aplica as coordenadas
  menu.style.top = `${rect.bottom + scrollY + 5}px`;
  menu.style.left = `${leftPos}px`;

  // Fecha ao clicar fora
  setTimeout(() => {
    const closeHandler = (e) => {
      if (!menu.contains(e.target) && e.target !== icon) {
        menu.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    document.addEventListener('click', closeHandler);
  }, 50);
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// --- FUNÇÕES DE PREENCHIMENTO (ENTERPRISE) ---

// Preenchimento de Login (usa dispatchEvents)
function fillFields(userInput, passInput, data) {
  if (passInput) {
    setNativeValue(passInput, data.password);
  }
  if (userInput && data.username) {
    setNativeValue(userInput, data.username);
  }
}

// Preenchimento de Cartão (usa setNativeValue e setSelectValue)
function fillCardForm(group, data) {
  // Preenche Número
  if (group.number) setNativeValue(group.number, (data.cardNumber || '').replace(/\s/g, ''));
  
  // Preenche Nome
  if (group.name) setNativeValue(group.name, data.cardHolder);
  
  // Preenche CVV
  if (group.cvv) setNativeValue(group.cvv, data.cvv);

  // Lógica Especial para Datas (Campo Único vs Selects)
  if (data.expiry) {
    const [month, year] = data.expiry.split('/'); 
    
    if (group.expMonth && group.expYear) {
      // Caso Amazon (Selects separados MM/AAAA)
      
      // Tenta setar o mês (remove zero à esquerda se necessário: 01 -> 1)
      setSelectValue(group.expMonth, month);
      
      // Tenta setar o ano (Converte 25 para 2025)
      const fullYear = year.length === 2 ? `20${year}` : year;
      setSelectValue(group.expYear, fullYear);
      
    } else if (group.expiry) {
      // Caso padrão (Campo único MM/AA)
      setNativeValue(group.expiry, data.expiry);
    }
  }
}

// Helper para disparar eventos de frameworks (React/Vue/Angular)
function setNativeValue(element, value) {
  if (!element || element.value === value) return; // Evita loop infinito

  const lastValue = element.value;
  element.value = value;
  
  // Dispara evento de 'input' para React/Frameworks
  const event = new Event('input', { bubbles: true });
  const tracker = element._valueTracker;
  if (tracker) {
    tracker.setValue(lastValue); // Hack para React 15/16
  }
  element.dispatchEvent(event);
  
  // Dispara eventos de 'change' e 'blur' para garantir a validação
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

function setSelectValue(select, value) {
  if (!select) return;
  
  // 1. Tenta encontrar a opção pelo value ou pelo texto
  let option = Array.from(select.options).find(o => o.value == value || o.text.includes(value));
  
  // 2. Fallback: Tenta remover zero à esquerda (01 -> 1)
  if (!option && value.startsWith('0')) {
      const singleDigit = value.substring(1);
      option = Array.from(select.options).find(o => o.value == singleDigit);
  }

  // 3. Aplica o valor e dispara o evento 'change'
  if (option) {
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function dispatchEvents(element) {
  // Versão simplificada do setNativeValue para campos que não precisam de hacks de frameworks
  const events = ['input', 'change']; 
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

// --- PENDÊNCIAS E UI (Inalterado) ---
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

// --- UTILITÁRIOS (Inalterado) ---
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