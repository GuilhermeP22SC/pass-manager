import { getPausedSites, savePausedSites } from './storage.js';
import { setText } from '../utils/dom.js';

const DEFAULT_FAVICON = '../assets/internet.svg';

export function createAutofillModule(options) {
  const {
    domainEl,
    faviconEl,
    autofillStatusEl,
    autofillToggleButton
  } = options;
  let currentDomain = null;
  let cachedPausedAutofillSites = [];

  autofillToggleButton.addEventListener('click', async () => {
    if (!currentDomain) return;
    const isPaused = await domainIsAutofillPaused(currentDomain);
    await setAutofillPaused(currentDomain, !isPaused);
    renderAutofillState(!isPaused);
  });

  async function refresh() {
    currentDomain = await getActiveDomain();
    if (!currentDomain) {
      renderUnavailable();
      return;
    }

    setText(domainEl, currentDomain);
    faviconEl.src = `https://www.google.com/s2/favicons?domain=${currentDomain}&sz=64`;

    const autofillPaused = await domainIsAutofillPaused(currentDomain);
    renderAutofillState(autofillPaused);
  }

  async function domainIsAutofillPaused(domain) {
    cachedPausedAutofillSites = await getPausedSites();
    return domainInList(cachedPausedAutofillSites, domain);
  }

  async function setAutofillPaused(domain, shouldPause) {
    cachedPausedAutofillSites = toggleDomainInCache(
      cachedPausedAutofillSites,
      domain,
      shouldPause
    );
    await savePausedSites(cachedPausedAutofillSites);
  }

  function renderAutofillState(isPaused) {
    setText(autofillStatusEl, isPaused ? 'Autofill pausado' : 'Autofill ativo');
    autofillToggleButton.textContent = isPaused ? 'Ativar' : 'Pausar';
    autofillToggleButton.disabled = !currentDomain;
  }

  function renderUnavailable() {
    currentDomain = null;
    setText(domainEl, 'Página desconhecida');
    faviconEl.src = DEFAULT_FAVICON;
    setText(autofillStatusEl, 'Autofill indisponível');
    autofillToggleButton.textContent = 'Pausar';
    autofillToggleButton.disabled = true;
  }

  function domainInList(list, domain) {
    const normalized = normalizeDomain(domain);
    return list.some((site) => {
      const saved = normalizeDomain(site);
      return normalized === saved || normalized.endsWith(`.${saved}`);
    });
  }

  function toggleDomainInCache(cache, domain, shouldPause) {
    const normalizedDomain = normalizeDomain(domain);
    const normalizedSet = new Set(cache.map((site) => normalizeDomain(site)));
    if (shouldPause) normalizedSet.add(normalizedDomain);
    else normalizedSet.delete(normalizedDomain);
    return Array.from(normalizedSet);
  }

  function normalizeDomain(domain = '') {
    return domain.toLowerCase().replace(/^www\./, '');
  }

  function getActiveDomain() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const [tab] = tabs || [];
        if (!tab?.url) {
          resolve(null);
          return;
        }
        try {
          const { hostname } = new URL(tab.url);
          resolve(hostname);
        } catch (error) {
          console.warn('Autofill: domínio inválido', error);
          resolve(null);
        }
      });
    });
  }

  const api = {
    refresh,
    async getCurrentDomain() {
      return currentDomain;
    }
  };

  return api;
}
