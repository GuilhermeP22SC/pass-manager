import { encryptData, decryptData } from '../popup/utils/crypto.js';

// service-worker.js

let tempCredentials = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_LOGIN') {
    // Agora retorna uma LISTA de logins, não apenas um
    handleGetLogin(request.url).then(sendResponse);
    return true; 
  }

  if (request.type === 'CHECK_CREDENTIALS_EXIST') {
    handleCheckCredentialsExist(request.url, request.username).then(sendResponse);
    return true;
  }

  if (request.type === 'SAVE_CREDENTIALS') {
    handleSaveCredentials(request.url, request.username, request.password).then(sendResponse);
    return true;
  }

  if (request.type === 'CACHE_TEMP_CREDENTIALS') {
    tempCredentials = {
      url: request.url,
      username: request.username,
      password: request.password,
      timestamp: Date.now()
    };
    sendResponse({ status: 'cached' });
    return false;
  }

  if (request.type === 'CHECK_PENDING_TO_SAVE') {
    if (tempCredentials && (Date.now() - tempCredentials.timestamp < 60000)) {
      let originHost, currentHost;
      try {
        originHost = new URL(tempCredentials.url).hostname;
        currentHost = new URL(request.url).hostname;
      } catch (e) {
        sendResponse(null);
        return false;
      }

      if (currentHost.includes(originHost) || originHost.includes(currentHost)) {
        const data = { ...tempCredentials };
        tempCredentials = null;
        sendResponse(data);
      } else {
        sendResponse(null);
      }
    } else {
      sendResponse(null);
    }
    return false;
  }

});

// --- FUNÇÕES AUXILIARES ---

async function getVault() {
  const local = await chrome.storage.local.get(['vault']);
  if (!local.vault) return [];
  return await decryptData(local.vault);
}

async function handleGetLogin(url) {
  try {
    const vault = await getVault();
    if (!Array.isArray(vault) || vault.length === 0) return [];

    if (url === 'CARD_REQUEST') {
       return vault.filter(i => i.type === 'card');
    }
    
    // Normalização robusta do hostname atual
    let currentHostname;
    try {
      currentHostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      currentHostname = url.toLowerCase();
      // Se a URL for inválida, não pode fazer Autofill baseado em Hostname.
      return []; 
    }
    
    const matches = vault.filter(item => {
      // Ignora itens que não são login/sem tipo definido
      if (item.type && item.type !== 'login') return false;

      // Prioridade 1: Verifica o campo URL (o mais confiável)
      if (item.url) {
        try {
          const itemHost = new URL(item.url).hostname.toLowerCase().replace(/^www\./, '');
          // Verifica correspondência exata ou subdomínio/domínio
          if (currentHostname === itemHost || currentHostname.endsWith('.' + itemHost) || itemHost.endsWith('.' + currentHostname)) {
            return true;
          }
        } catch (e) { /* URL inválida salva no item, ignora e tenta fallback */ }
      }

      // Prioridade 2: Fallback para o campo 'site' (Antigo/Migrado)
      if (item.site) {
        // Assume que 'site' pode ser o nome ('Meu Google') ou o domínio ('google.com')
        const cleanSite = item.site.toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
        // Se 'site' for um domínio válido, verifica correspondência
        if (cleanSite.includes('.') && (currentHostname.includes(cleanSite) || cleanSite.includes(currentHostname))) {
            return true;
        }
      }

      return false;
    });
    
    return matches; // Retorna array vazio ou com itens
  } catch (error) { 
    console.error('Erro no handleGetLogin:', error);
    return []; 
  }
}

async function handleCheckCredentialsExist(url, username) {
  const vault = await getVault();
  if (!Array.isArray(vault) || vault.length === 0) return false;
  
  let hostname;
  try { hostname = new URL(url).hostname; } catch { hostname = url; }
  
  return vault.some(item => {
    if (!item.site || !item.username) return false;
    let itemSite = item.site.toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    return (hostname.includes(itemSite) || itemSite.includes(hostname)) && item.username === username;
  });
}

async function handleSaveCredentials(url, username, password) {
  const vault = await getVault();
  let site;
  try { site = new URL(url).hostname; } catch { site = url; }
  
  const existingIndex = vault.findIndex(i => i.site === site && i.username === username);
  if (existingIndex > -1) vault.splice(existingIndex, 1);

  const newEntry = { id: crypto.randomUUID(), site, username, password };
  vault.push(newEntry);

  const encryptedPayload = await encryptData(vault);
  await chrome.storage.local.set({ vault: encryptedPayload });
  return true;
}