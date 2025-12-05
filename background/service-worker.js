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
    
    const hostname = new URL(url).hostname;
    
    // MUDANÇA: Usa filter() para retornar TODOS os resultados correspondentes
    const matches = vault.filter(item => {
      if (!item.site) return false;
      let site = item.site.toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
      return hostname.includes(site) || site.includes(hostname);
    });
    
    return matches; // Retorna array vazio ou com itens
  } catch (error) { return []; }
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