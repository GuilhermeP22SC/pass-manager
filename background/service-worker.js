import { encryptData, decryptData } from '../popup/utils/crypto.js';

// service-worker.js

// Variável volátil para guardar a senha durante a transição de página
let tempCredentials = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Busca Login (Preenchimento)
  if (request.type === 'GET_LOGIN') {
    handleGetLogin(request.url).then(sendResponse);
    return true; 
  }

  // 2. Verifica se já existe (Para evitar salvar duplicado)
  if (request.type === 'CHECK_CREDENTIALS_EXIST') {
    handleCheckCredentialsExist(request.url, request.username).then(sendResponse);
    return true;
  }

  // 3. Salvar Definitivo (Quando o usuário clica "Salvar" no Popup)
  if (request.type === 'SAVE_CREDENTIALS') {
    handleSaveCredentials(request.url, request.username, request.password).then(sendResponse);
    return true;
  }

  // --- NOVAS ROTAS PARA O FLUXO "GUARDAR AGORA, PERGUNTAR DEPOIS" ---

  // 4. Cache Temporário (Recebe do login e guarda na RAM)
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

  // 5. Verificar Pendência (A nova página pergunta se tem algo para salvar)
  if (request.type === 'CHECK_PENDING_TO_SAVE') {
    // Só retorna se tiver algo guardado há menos de 60 segundos
    if (tempCredentials && (Date.now() - tempCredentials.timestamp < 60000)) {
      
      // Verifica se estamos no mesmo domínio (segurança básica)
      let originHost, currentHost;
      try {
        originHost = new URL(tempCredentials.url).hostname;
        currentHost = new URL(request.url).hostname;
      } catch (e) {
        sendResponse(null);
        return false;
      }

      // Permite se for o mesmo site (ex: univille.br -> univille.br)
      if (currentHost.includes(originHost) || originHost.includes(currentHost)) {
        const data = { ...tempCredentials };
        tempCredentials = null; // Limpa após entregar
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

// --- FUNÇÕES AUXILIARES (COM CRIPTOGRAFIA) ---

async function getVault() {
  const local = await chrome.storage.local.get(['vault']);
  if (!local.vault) return [];
  // Usa a função decryptData importada
  return await decryptData(local.vault);
}

async function handleGetLogin(url) {
  try {
    const vault = await getVault();
    if (!Array.isArray(vault) || vault.length === 0) return null;
    
    const hostname = new URL(url).hostname;
    const match = vault.find(item => {
      if (!item.site) return false;
      let site = item.site.toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
      return hostname.includes(site) || site.includes(hostname);
    });
    return match || null;
  } catch (error) { return null; }
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
  
  // Remove duplicatas exatas antes de salvar
  const existingIndex = vault.findIndex(i => i.site === site && i.username === username);
  if (existingIndex > -1) vault.splice(existingIndex, 1);

  const newEntry = { id: crypto.randomUUID(), site, username, password };
  vault.push(newEntry);

  // Encripta antes de salvar no storage
  const encryptedPayload = await encryptData(vault);
  await chrome.storage.local.set({ vault: encryptedPayload });
  return true;
}