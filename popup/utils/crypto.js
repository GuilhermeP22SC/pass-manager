// popup/utils/crypto.js

const ALGORITHM = 'AES-GCM';
const KEY_STORAGE_NAME = 'pm_master_key'; // Chave legado (sem senha)
const ENC_STORAGE_NAME = 'pm_enc_key';    // Chave encriptada (com senha)
const SALT_STORAGE_NAME = 'pm_salt';      // Salt para PBKDF2
const SESSION_KEY_NAME = 'pm_session_key'; // Chave temporária na RAM/Sessão

// --- Funções Auxiliares ---
function bufferToBase64(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Deriva uma chave (KEK) a partir da senha do usuário
async function deriveKeyFromPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true, ["encrypt", "decrypt"]
  );
}

// --- Gestão de Chaves ---

// Tenta obter a chave desbloqueada (da sessão)
async function getCryptoKey() {
  // 1. Tenta pegar da sessão (estado Desbloqueado)
  try {
    const session = await chrome.storage.session.get(SESSION_KEY_NAME);
    if (session[SESSION_KEY_NAME]) {
      return crypto.subtle.importKey(
        'jwk', session[SESSION_KEY_NAME], { name: ALGORITHM }, true, ['encrypt', 'decrypt']
      );
    }
  } catch (e) { /* Fallback se session API não estiver disponível */ }

  // 2. Verifica armazenamento local
  const local = await chrome.storage.local.get([KEY_STORAGE_NAME, ENC_STORAGE_NAME]);
  
  // Se existir chave encriptada mas não está na sessão -> BLOQUEADO
  if (local[ENC_STORAGE_NAME]) {
    throw new Error('LOCKED');
  }

  // 3. Modo Legado/Inicial (Sem senha mestra definida)
  if (local[KEY_STORAGE_NAME]) {
    return crypto.subtle.importKey(
      'jwk', local[KEY_STORAGE_NAME], { name: ALGORITHM }, true, ['encrypt', 'decrypt']
    );
  } else {
    // Gera nova chave se não existir nada
    const key = await crypto.subtle.generateKey(
      { name: ALGORITHM, length: 256 }, true, ['encrypt', 'decrypt']
    );
    const jwk = await crypto.subtle.exportKey('jwk', key);
    await chrome.storage.local.set({ [KEY_STORAGE_NAME]: jwk });
    return key;
  }
}

export async function setMasterPassword(password) {
  // Pega a chave atual (ou gera nova)
  let currentKey;
  try {
    currentKey = await getCryptoKey();
  } catch (e) { throw new Error('Cofre bloqueado. Desbloqueie antes de mudar a senha.'); }

  // Gera Salt e deriva KEK
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await deriveKeyFromPassword(password, salt);

  // Exporta a chave mestra para encriptá-la
  const rawKey = await crypto.subtle.exportKey('raw', currentKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const encryptedMasterKey = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv }, kek, rawKey
  );

  // Salva: Chave Encriptada + Salt + IV. Remove chave plana.
  const payload = JSON.stringify({
    iv: bufferToBase64(iv),
    content: bufferToBase64(encryptedMasterKey)
  });

  await chrome.storage.local.set({
    [ENC_STORAGE_NAME]: payload,
    [SALT_STORAGE_NAME]: bufferToBase64(salt)
  });
  await chrome.storage.local.remove(KEY_STORAGE_NAME);
  
  // Mantém desbloqueado na sessão
  const jwk = await crypto.subtle.exportKey('jwk', currentKey);
  await chrome.storage.session.set({ [SESSION_KEY_NAME]: jwk });
}

export async function unlockVault(password) {
  const local = await chrome.storage.local.get([ENC_STORAGE_NAME, SALT_STORAGE_NAME]);
  if (!local[ENC_STORAGE_NAME] || !local[SALT_STORAGE_NAME]) return false;

  try {
    const salt = base64ToBuffer(local[SALT_STORAGE_NAME]);
    const kek = await deriveKeyFromPassword(password, salt);
    
    const parsed = JSON.parse(local[ENC_STORAGE_NAME]);
    const iv = base64ToBuffer(parsed.iv);
    const content = base64ToBuffer(parsed.content);

    const decryptedRaw = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: iv }, kek, content
    );

    // Importa para objeto CryptoKey e salva na sessão
    const key = await crypto.subtle.importKey(
      'raw', decryptedRaw, { name: ALGORITHM }, true, ['encrypt', 'decrypt']
    );
    const jwk = await crypto.subtle.exportKey('jwk', key);
    
    await chrome.storage.session.set({ [SESSION_KEY_NAME]: jwk });
    return true;
  } catch (e) {
    console.error(e);
    return false; // Senha incorreta
  }
}

export async function lockVault() {
  await chrome.storage.session.remove(SESSION_KEY_NAME);
}

export async function isVaultConfigured() {
  const local = await chrome.storage.local.get([ENC_STORAGE_NAME]);
  return !!local[ENC_STORAGE_NAME];
}

export async function exportKey() {
   // Apenas exporta se estiver desbloqueado
   const key = await getCryptoKey();
   const jwk = await crypto.subtle.exportKey('jwk', key);
   return JSON.stringify(jwk);
}

// --- Funções Principais (Encriptar/Decriptar dados) ---
// (Mantêm-se iguais, mas chamam o novo getCryptoKey que pode lançar erro LOCKED)

export async function encryptData(data) {
  const key = await getCryptoKey(); // Pode lançar erro 'LOCKED'
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedData = new TextEncoder().encode(JSON.stringify(data));
  const encryptedContent = await crypto.subtle.encrypt({ name: ALGORITHM, iv: iv }, key, encodedData);
  return JSON.stringify({ iv: bufferToBase64(iv), content: bufferToBase64(encryptedContent) });
}

export async function decryptData(encryptedString) {
  if (!encryptedString) return [];
  try {
    let parsed = JSON.parse(encryptedString);
    if (!parsed.iv || !parsed.content) return Array.isArray(parsed) ? parsed : [];

    const key = await getCryptoKey(); // Pode lançar erro 'LOCKED'
    const iv = base64ToBuffer(parsed.iv);
    const content = base64ToBuffer(parsed.content);
    const decryptedBuffer = await crypto.subtle.decrypt({ name: ALGORITHM, iv: iv }, key, content);
    return JSON.parse(new TextDecoder().decode(decryptedBuffer));
  } catch (e) {
    if (e.message === 'LOCKED') throw e;
    console.warn('Crypto: Falha ou formato antigo.', e);
    return [];
  }
}