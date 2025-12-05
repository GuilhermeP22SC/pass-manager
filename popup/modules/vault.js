import { VaultService } from './storage.js';
import { cloneTemplate, setText, toggleHidden, clearChildren, focusElement } from '../utils/dom.js';

const EYE_OPEN_ICON = '../assets/opened-eye.svg';
const EYE_CLOSED_ICON = '../assets/eye-closed.svg';

export function createVaultModule(options) {
  const state = {
    items: [],
    filter: '',
    currentEditId: null
  };

  const {
    listEl,
    countLabel,
    emptyState,
    templateEl,
    searchInput,
    addButton,
    overlayEl,
    formEl,
    deleteButton,
    saveButton,
    closeButtons,
    inputs,
    passwordToggleButton,
    passwordIcon
  } = options;

  let eventsBound = false;

  async function init() {
    state.items = await VaultService.getAll();
    bindEvents();
    renderList();
  }

  function bindEvents() {
    if (eventsBound) return;

    addButton.addEventListener('click', () => {
      openCreateForm();
    });

    searchInput.addEventListener('input', (event) => {
      state.filter = event.target.value.trim();
      renderList();
    });

    saveButton.addEventListener('click', handleSave);

    formEl.addEventListener('submit', (event) => {
      event.preventDefault();
      handleSave();
    });

    deleteButton.addEventListener('click', handleDelete);
    passwordToggleButton.addEventListener('click', togglePasswordVisibility);

    closeButtons.forEach((button) => {
      button.addEventListener('click', () => toggleOverlay(false));
    });

    eventsBound = true;
  }

  function renderList() {
    clearChildren(listEl);
    const normalizedFilter = state.filter.toLowerCase();
    const filtered = state.items.filter((item) => {
      const site = item.site?.toLowerCase() || '';
      const username = item.username?.toLowerCase() || '';
      return site.includes(normalizedFilter) || username.includes(normalizedFilter);
    });

    setText(countLabel, `${filtered.length} itens`);
    toggleHidden(emptyState, filtered.length !== 0);

    filtered.forEach((item) => {
      const listItem = buildListItem(item);
      listEl.appendChild(listItem);
    });
  }

  function buildListItem(item) {
    const listItem = cloneTemplate(templateEl);
    const nameEl = listItem.querySelector('.item-name');
    const userEl = listItem.querySelector('.item-sub');
    const copyBtn = listItem.querySelector('.copy-btn');
    const launchBtn = listItem.querySelector('.launch-btn');
    const iconBox = listItem.querySelector('.item-icon-box');
    const iconImg = iconBox ? iconBox.querySelector('img') : null;

    listItem.dataset.entryId = item.id;

    setText(nameEl, item.site);
    setText(userEl, item.username);

    // Atualiza o ícone para o favicon do site salvo, com fallback para SVG padrão
    if (iconImg && item.site) {
      try {
        let domain = item.site.trim();
        if (/^https?:\/\//i.test(domain)) {
          domain = new URL(domain).hostname;
        } else {
          domain = domain.split('/')[0];
        }
        iconImg.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
        iconImg.alt = `Favicon de ${domain}`;
        // Fallback: se não carregar, usa SVG padrão
        iconImg.onerror = function() {
          this.onerror = null;
          this.src = '../assets/internet.svg';
          this.alt = 'Site';
        };
      } catch (e) {
        iconImg.src = '../assets/internet.svg';
        iconImg.alt = 'Site';
      }
    }

    listItem.addEventListener('click', (event) => {
      if (event.target.closest('.btn-icon-action')) return;
      openEditForm(item.id);
    });

    copyBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      navigator.clipboard.writeText(item.password || '');
    });

    launchBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openSite(item.site);
    });

    return listItem;
  }

  function openSite(site) {
    if (!site) return;
    let url = site.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    chrome.tabs.create({ url });
  }

  function openCreateForm() {
    state.currentEditId = null;
    formEl.reset();
    inputs.site.value = '';
    inputs.username.value = '';
    inputs.password.value = '';
    toggleHidden(deleteButton, true);
    resetPasswordField();
    toggleOverlay(true);
    focusElement(inputs.site);
  }

  function openEditForm(id) {
    const entry = state.items.find((item) => item.id === id);
    if (!entry) return;
    state.currentEditId = id;
    inputs.site.value = entry.site || '';
    inputs.username.value = entry.username || '';
    inputs.password.value = entry.password || '';
    toggleHidden(deleteButton, false);
    resetPasswordField();
    toggleOverlay(true);
    focusElement(inputs.site);
  }

  async function handleSave() {
    const site = inputs.site.value.trim();
    const username = inputs.username.value.trim();
    const password = inputs.password.value.trim();

    if (!site || !password) return;

    if (state.currentEditId) {
      state.items = state.items.map((item) => (
        item.id === state.currentEditId
          ? { ...item, site, username, password }
          : item
      ));
    } else {
      state.items.push({ id: crypto.randomUUID(), site, username, password });
    }

    await VaultService.saveAll(state.items);
    toggleOverlay(false);
    renderList();
  }

  async function handleDelete() {
    if (!state.currentEditId) return;
    if (!window.confirm('Excluir?')) return;

    state.items = state.items.filter((item) => item.id !== state.currentEditId);
    await VaultService.saveAll(state.items);
    toggleOverlay(false);
    renderList();
  }

  function toggleOverlay(show) {
    toggleHidden(overlayEl, !show);
    if (!show) {
      state.currentEditId = null;
      formEl.reset();
      toggleHidden(deleteButton, true);
      resetPasswordField();
    }
  }

  function resetPasswordField() {
    if (!inputs.password) return;
    inputs.password.type = 'password';
    if (passwordIcon) {
      passwordIcon.src = EYE_CLOSED_ICON;
      passwordIcon.alt = 'Mostrar senha';
    }
  }

  function togglePasswordVisibility() {
    const isHidden = inputs.password.type === 'password';
    inputs.password.type = isHidden ? 'text' : 'password';
    if (passwordIcon) {
      passwordIcon.src = isHidden ? EYE_OPEN_ICON : EYE_CLOSED_ICON;
      passwordIcon.alt = isHidden ? 'Ocultar senha' : 'Mostrar senha';
    }
  }

  // --- Exportação CSV ---
  async function exportToCsv() {
    const items = await VaultService.getAll();
    if (!items.length) {
      alert('Nenhuma credencial para exportar.');
      return;
    }
    const header = ['site','username','password'];
    const rows = items.map(item => [item.site, item.username, item.password]);
    const csv = [header, ...rows].map(r => r.map(escapeCsv).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'credenciais.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function escapeCsv(val) {
    if (val == null) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  // --- Importação CSV ---
  async function importFromCsv(file) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return alert('Arquivo CSV vazio.');
    const [header, ...rows] = lines;
    const cols = header.split(',').map(s => s.trim().toLowerCase());
    const siteIdx = cols.indexOf('site');
    const userIdx = cols.indexOf('username');
    const passIdx = cols.indexOf('password');
    if (siteIdx === -1 || userIdx === -1 || passIdx === -1) {
      alert('Cabeçalho CSV inválido. Esperado: site, username, password');
      return;
    }
    const newItems = rows.map(line => {
      const vals = parseCsvLine(line);
      return {
        id: crypto.randomUUID(),
        site: vals[siteIdx] || '',
        username: vals[userIdx] || '',
        password: vals[passIdx] || ''
      };
    }).filter(item => item.site && item.password);
    if (!newItems.length) return alert('Nenhuma credencial válida encontrada.');
    // Mesclar com existentes, evitando duplicatas (site+username)
    const current = await VaultService.getAll();
    const exists = new Set(current.map(item => `${(item.site||'').trim().toLowerCase()}|${(item.username||'').trim().toLowerCase()}`));
    const filtered = newItems.filter(item => {
      const key = `${(item.site||'').trim().toLowerCase()}|${(item.username||'').trim().toLowerCase()}`;
      if (exists.has(key)) return false;
      exists.add(key);
      return true;
    });
    if (!filtered.length) return alert('Nenhuma credencial nova para importar.');
    const merged = [...current, ...filtered];
    await VaultService.saveAll(merged);
    alert(`${filtered.length} credenciais importadas!`);
    renderList();
  }

  function parseCsvLine(line) {
    const result = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; ++i) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') {
          if (line[i+1] === '"') { cur += '"'; ++i; }
          else inQuotes = false;
        } else cur += c;
      } else if (c === ',') {
        result.push(cur); cur = '';
      } else if (c === '"') {
        inQuotes = true;
      } else cur += c;
    }
    result.push(cur);
    return result;
  }

  return {
    init,
    renderList,
    exportToCsv,
    importFromCsv
  };
}
