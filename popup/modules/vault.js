import { VaultService } from './storage.js';
import { cloneTemplate, setText, toggleHidden, clearChildren, focusElement } from '../utils/dom.js';

const EYE_OPEN_ICON = '../assets/opened-eye.svg';
const EYE_CLOSED_ICON = '../assets/eye-closed.svg';

// Ícones (Certifique-se de que os arquivos existem em assets/ ou use os placeholders)
const ICON_LOGIN = '../assets/internet.svg';
const ICON_CARD = '../assets/credit-card.svg';
const ICON_NOTE = '../assets/sticky-note.svg';

export function createVaultModule(options) {
  const state = {
    items: [],
    filterText: '',
    filterType: 'all', // Estado para o filtro de tipo (all, login, card, note)
    currentEditId: null
  };

  const {
    listEl, countLabel, emptyState, templateEl, searchInput, addButton,
    overlayEl, formEl, deleteButton, saveButton, closeButtons,
    inputs, groups, filterButtons, // Novos elementos recebidos
    passwordToggleButton, passwordIcon, strengthFill, strengthText
  } = options;

  let eventsBound = false;

  async function init() {
    let rawItems = await VaultService.getAll();
    
    // --- MIGRAÇÃO DE DADOS (Compatibilidade) ---
    // Converte itens antigos (apenas site/username/password) para o novo formato
    state.items = rawItems.map(item => {
      if (!item.type) {
        return {
          id: item.id,
          type: 'login',
          name: item.site || 'Sem nome', // Campo 'site' migrado para 'name'
          username: item.username,
          password: item.password,
          url: item.site // Usa o antigo site como URL
        };
      }
      return item;
    });

    bindEvents();
    renderList();
  }

  function bindEvents() {
    if (eventsBound) return;

    addButton.addEventListener('click', openCreateForm);
    searchInput.addEventListener('input', (e) => {
      state.filterText = e.target.value.trim();
      renderList();
    });

    // --- Listeners para Filtros de Tipo ---
    if (filterButtons) {
      filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          // Atualiza visual dos botões
          filterButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          
          // Atualiza estado e re-renderiza
          state.filterType = btn.dataset.type;
          renderList();
        });
      });
    }

    saveButton.addEventListener('click', handleSave);
    formEl.addEventListener('submit', (e) => { e.preventDefault(); handleSave(); });
    deleteButton.addEventListener('click', handleDelete);
    
    if (passwordToggleButton) passwordToggleButton.addEventListener('click', togglePasswordVisibility);
    if (inputs.password) inputs.password.addEventListener('input', updateStrengthMeter);

    closeButtons.forEach(btn => btn.addEventListener('click', () => toggleOverlay(false)));

    // --- Listener de Mudança de Tipo no Formulário ---
    if (inputs.type) {
      inputs.type.addEventListener('change', () => {
        updateFormView(inputs.type.value);
      });
    }

    // --- Listeners de Formatação de Cartão ---
    if (inputs.cardNumber) inputs.cardNumber.addEventListener('input', handleCardInput);
    if (inputs.expiry) inputs.expiry.addEventListener('input', handleExpiryInput);
    if (inputs.cvv) inputs.cvv.addEventListener('input', (e) => e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4));

    eventsBound = true;
  }

  // --- Handlers de Formatação Automática ---

  function handleCardInput(e) {
    const target = e.target;
    // Remove tudo que não é dígito
    let value = target.value.replace(/\D/g, '');
    
    // Limita a 16 dígitos
    if (value.length > 16) value = value.slice(0, 16);

    // Agrupa de 4 em 4
    const formatted = value.match(/.{1,4}/g)?.join(' ') || value;
    target.value = formatted;

    // Foco automático no próximo campo
    if (value.length === 16 && inputs.expiry) {
      inputs.expiry.focus();
    }
  }

  function handleExpiryInput(e) {
    const target = e.target;
    let value = target.value.replace(/\D/g, '');
    
    // Limita a 4 dígitos (MMAA)
    if (value.length > 4) value = value.slice(0, 4);

    // Adiciona barra
    if (value.length >= 2) {
      target.value = `${value.slice(0, 2)}/${value.slice(2)}`;
    } else {
      target.value = value;
    }

    // Foco automático no CVV
    if (value.length === 4 && inputs.cvv) {
      inputs.cvv.focus();
    }
  }

  // --- Controle de UI do Formulário ---
  
  function updateFormView(type) {
    // Esconde todos os grupos
    Object.values(groups).forEach(el => toggleHidden(el, true));

    // Mostra apenas o grupo do tipo selecionado
    if (groups[type]) toggleHidden(groups[type], false);

    // Atualiza label do campo Nome
    if (inputs.labelName) {
      if (type === 'card') setText(inputs.labelName, 'Nome do Banco / Apelido');
      else if (type === 'note') setText(inputs.labelName, 'Título da Nota');
      else setText(inputs.labelName, 'Site / Serviço');
    }
  }

  // --- Operações CRUD ---

  function openCreateForm() {
    state.currentEditId = null;
    formEl.reset();
    
    // Reset para padrão (Login)
    inputs.type.value = 'login';
    updateFormView('login');
    updateStrengthMeter();
    
    toggleHidden(deleteButton, true);
    resetPasswordField();
    toggleOverlay(true);
    focusElement(inputs.name);
  }

  function openEditForm(id) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;

    state.currentEditId = id;
    
    // Preenche campos comuns
    inputs.type.value = item.type || 'login';
    inputs.name.value = item.name || '';

    // Preenche campos específicos
    if (item.type === 'login') {
      inputs.username.value = item.username || '';
      inputs.password.value = item.password || '';
      inputs.url.value = item.url || '';
      updateStrengthMeter();
    } else if (item.type === 'card') {
      inputs.cardHolder.value = item.cardHolder || '';
      inputs.cardNumber.value = item.cardNumber || '';
      inputs.expiry.value = item.expiry || '';
      inputs.cvv.value = item.cvv || '';
      inputs.pin.value = item.pin || '';
    } else if (item.type === 'note') {
      inputs.noteContent.value = item.noteContent || '';
    }

    updateFormView(inputs.type.value);
    toggleHidden(deleteButton, false);
    resetPasswordField();
    toggleOverlay(true);
  }

  async function handleSave() {
    const type = inputs.type.value;
    const name = inputs.name.value.trim();
    if (!name) return alert('O campo Nome é obrigatório.');

    // Cria objeto base
    const newItem = {
      id: state.currentEditId || crypto.randomUUID(),
      type,
      name
    };

    // Preenche dados específicos
    if (type === 'login') {
      newItem.username = inputs.username.value.trim();
      newItem.password = inputs.password.value; 
      newItem.url = inputs.url.value.trim();
      
      // CORREÇÃO: Define 'site' baseado na URL para o Autofill.
      try {
        if (newItem.url) {
            // Usa o hostname da URL, que é o que o Service Worker procura.
            newItem.site = new URL(newItem.url).hostname.replace(/^www\./, ''); 
        } else {
            // Se não tem URL, usa o nome como fallback (pior cenário)
            newItem.site = newItem.name; 
        }
      } catch (e) {
        // URL inválida, usa o nome como fallback.
        newItem.site = newItem.name;
      }

    } else if (type === 'card') {
      newItem.cardHolder = inputs.cardHolder.value.trim();
      newItem.cardNumber = inputs.cardNumber.value.trim();
      newItem.expiry = inputs.expiry.value.trim();
      newItem.cvv = inputs.cvv.value.trim();
      newItem.pin = inputs.pin.value.trim();
    } else if (type === 'note') {
      newItem.noteContent = inputs.noteContent.value;
    }

    if (state.currentEditId) {
      state.items = state.items.map(i => i.id === state.currentEditId ? newItem : i);
    } else {
      state.items.push(newItem);
    }

    await VaultService.saveAll(state.items);
    toggleOverlay(false);
    renderList();
  }

  async function handleDelete() {
    if (!state.currentEditId || !confirm('Excluir este item permanentemente?')) return;
    state.items = state.items.filter(i => i.id !== state.currentEditId);
    await VaultService.saveAll(state.items);
    toggleOverlay(false);
    renderList();
  }

  // --- Renderização da Lista ---

  function renderList() {
    clearChildren(listEl);
    const filterText = (state.filterText || '').toLowerCase();
    const filterType = state.filterType || 'all';
    
    const filtered = state.items.filter(item => {
      // 1. Filtro de Tipo
      if (filterType !== 'all' && item.type !== filterType) return false;

      // 2. Filtro de Texto (busca em vários campos)
      const name = (item.name || '').toLowerCase();
      const user = (item.username || '').toLowerCase();
      const extra = (item.cardNumber || item.noteContent || '').toLowerCase();
      
      return name.includes(filterText) || user.includes(filterText) || extra.includes(filterText);
    });

    setText(countLabel, `${filtered.length} itens`);
    toggleHidden(emptyState, filtered.length !== 0);

    filtered.forEach(item => {
      listEl.appendChild(buildListItem(item));
    });
  }

  function buildListItem(item) {
    const el = cloneTemplate(templateEl);
    const nameEl = el.querySelector('.item-name');
    const subEl = el.querySelector('.item-sub');
    const iconImg = el.querySelector('.item-icon-box img');
    const copyBtn = el.querySelector('.copy-btn');
    const launchBtn = el.querySelector('.launch-btn');

    el.dataset.id = item.id;

    // --- Renderização por Tipo ---

    if (item.type === 'card') {
      // CARTÃO
      const last4 = (item.cardNumber || '').replace(/\D/g, '').slice(-4);
      setText(nameEl, item.name); // Mantém o nome do cartão
      setText(subEl, last4 ? `Terminado em ${last4}` : 'Cartão de Crédito');
      
      iconImg.src = ICON_CARD;
      iconImg.onerror = () => { iconImg.src = '../assets/internet.svg'; }; // Fallback
      
      // Copia número do cartão
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        copyToClipboard(item.cardNumber);
      };
      launchBtn.style.display = 'none'; // Sem botão de abrir site

    } else if (item.type === 'note') {
      // NOTA
      setText(nameEl, item.name); // Mantém o título da nota
      setText(subEl, 'Nota Segura');
      iconImg.src = ICON_NOTE;
      iconImg.onerror = () => { iconImg.src = '../assets/internet.svg'; };
      
      // Copia conteúdo da nota
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        copyToClipboard(item.noteContent);
      };
      launchBtn.style.display = 'none';

    } else {
      // LOGIN (Padrão)

      // MODIFICAÇÃO: Ajusta o nome principal. 
      // Se houver URL, usa o nome de domínio limpo. Caso contrário, usa o nome salvo.
      const displayTitle = item.url ? getDisplayHostname(item.url) : item.name;
      setText(nameEl, displayTitle); 
      
      setText(subEl, item.username);
      
      // Favicon
      const domain = item.url || item.name;
      setupIcon(iconImg, domain, ICON_LOGIN);

      // Copia senha
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        copyToClipboard(item.password);
      };
      
      // Abre site
      launchBtn.onclick = (e) => {
        e.stopPropagation();
        openSite(item.url || item.name);
      };
    }

    el.addEventListener('click', (e) => {
      if (!e.target.closest('.btn-icon-action')) openEditForm(item.id);
    });

    return el;
  }

  // --- Funções Auxiliares ---

  // NOVO: Função para extrair e formatar o nome do site (SLD)
  function getDisplayHostname(urlOrDomain) {
    if (!urlOrDomain) return '';
    
    let hostname;
    try {
      // 1. Tenta obter o hostname de forma segura
      if (!urlOrDomain.includes('://')) {
          urlOrDomain = 'https://' + urlOrDomain;
      }
      hostname = new URL(urlOrDomain).hostname;
    } catch (e) {
      hostname = urlOrDomain.split('/')[0];
    }
    
    // 2. Limpeza: remove www., porta e converte para minúsculas
    hostname = hostname.toLowerCase()
                       .replace(/^www\./, '')
                       .split(':')[0];
    
    // 3. Extrai o Second-Level Domain (SLD) e formata (ex: gmail.com -> Gmail)
    const parts = hostname.split('.');
    let sld = parts[0]; 
    
    if (sld) {
        return sld.charAt(0).toUpperCase() + sld.slice(1);
    }
    
    return hostname; // Retorna o hostname limpo como fallback
  }

  function setupIcon(imgEl, domainOrUrl, fallbackIcon) {
    if (!domainOrUrl) {
      imgEl.src = fallbackIcon;
      return;
    }
    try {
      let domain = domainOrUrl.trim();
      if (domain.includes('://')) domain = new URL(domain).hostname;
      else domain = domain.split('/')[0];
      
      imgEl.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
      imgEl.onerror = () => { imgEl.src = fallbackIcon; };
    } catch {
      imgEl.src = fallbackIcon;
    }
  }

  function copyToClipboard(text) {
    if (!text) return;
    navigator.clipboard.writeText(text);
  }

  function openSite(url) {
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    chrome.tabs.create({ url });
  }

  function toggleOverlay(show) {
    toggleHidden(overlayEl, !show);
    if (!show) {
      state.currentEditId = null;
      formEl.reset();
    }
  }
  
  function resetPasswordField() {
    if (inputs.password) {
      inputs.password.type = 'password';
      if(passwordIcon) passwordIcon.src = EYE_CLOSED_ICON;
    }
  }

  function togglePasswordVisibility() {
    const isHidden = inputs.password.type === 'password';
    inputs.password.type = isHidden ? 'text' : 'password';
    if (passwordIcon) passwordIcon.src = isHidden ? EYE_OPEN_ICON : EYE_CLOSED_ICON;
  }

  function updateStrengthMeter() {
    if(!strengthFill || !strengthText) return;
    const pwd = inputs.password.value || '';
    
    let score = 0;
    if (pwd.length > 6) score++;
    if (pwd.length > 10) score++;
    if (/[A-Z]/.test(pwd)) score += 0.5;
    if (/[0-9]/.test(pwd)) score += 0.5;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;

    score = Math.floor(score);
    const colors = ['#e53e3e', '#e53e3e', '#ecc94b', '#48bb78', '#38a169'];
    const labels = ['Muito Fraca', 'Fraca', 'Média', 'Forte', 'Muito Forte'];
    const widths = ['10%', '25%', '50%', '75%', '100%'];
    
    if(score > 4) score = 4;
    
    if (pwd.length === 0) {
       strengthFill.style.width = '0%';
       setText(strengthText, '');
    } else {
       strengthFill.style.width = widths[score];
       strengthFill.style.backgroundColor = colors[score];
       setText(strengthText, labels[score]);
       strengthText.style.color = colors[score];
    }
  }

  // --- Export/Import CSV ---
  async function exportToCsv() {
    const items = await VaultService.getAll();
    if (!items.length) { alert('Nenhum item para exportar.'); return; }
    
    // Altera a exportação para garantir que o campo 'url' seja usado
    const header = ['type', 'name', 'username', 'password', 'url', 'extra'];
    const rows = items.map(item => [
      item.type || 'login',
      item.name || '',
      item.username || '',
      item.password || '',
      item.url || '',
      item.noteContent || item.cardNumber || ''
    ]);
    
    const csv = [header, ...rows].map(r => r.map(escapeCsv).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'cofre_backup.csv';
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  function escapeCsv(val) {
    if (val == null) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  async function importFromCsv(file) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return alert('Arquivo CSV vazio.');
    
    const [headerLine, ...rows] = lines;
    const cols = headerLine.split(',').map(s => s.trim().toLowerCase().replace(/"/g,''));
    
    const typeIdx = cols.indexOf('type');
    const nameIdx = cols.indexOf('name');
    const userIdx = cols.indexOf('username');
    const passIdx = cols.indexOf('password');
    const urlIdx = cols.indexOf('url');

    const newItems = rows.map(line => {
      const vals = line.split(',').map(v => v.replace(/^"|"$/g, '').replace(/""/g, '"'));
      
      const type = (typeIdx > -1 ? vals[typeIdx] : 'login') || 'login';
      let name = (nameIdx > -1 ? vals[nameIdx] : '') || '';
      
      const importedUrl = urlIdx > -1 ? vals[urlIdx] : '';
      let siteForAutofill = name;
      
      // Tenta obter o domínio da URL para o campo 'site' (necessário para o autofill)
      try {
        if (importedUrl) {
            siteForAutofill = new URL(importedUrl).hostname.replace(/^www\./, '');
        }
      } catch (e) { /* Se URL inválida, usa o nome */ }

      return {
        id: crypto.randomUUID(),
        type,
        name,
        username: userIdx > -1 ? vals[userIdx] : '',
        password: passIdx > -1 ? vals[passIdx] : '',
        url: importedUrl,
        site: siteForAutofill // Campo 'site' corrigido para compatibilidade com o service-worker
      };
    }).filter(i => i.name);

    if (!newItems.length) return alert('Nenhum item válido encontrado.');
    
    const current = await VaultService.getAll();
    const merged = [...current, ...newItems];
    await VaultService.saveAll(merged);
    alert(`${newItems.length} itens importados!`);
    renderList();
  }

  return { init, renderList, exportToCsv, importFromCsv };
}