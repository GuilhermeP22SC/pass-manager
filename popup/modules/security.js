import { setMasterPassword, unlockVault, lockVault, isVaultConfigured as checkVaultConfigured, exportKey } from '../utils/crypto.js';
import { setText, toggleHidden } from '../utils/dom.js';

const LOCK_TIMEOUT_KEY = 'security_lock_timeout';
const LAST_ACTIVE_KEY = 'security_last_active';
const SETUP_STATE_KEY = 'security_setup_state';
const USER_EMAIL_KEY = 'user_email'; 
const API_URL = 'http://localhost:3000'; 

export function createSecurityModule(options) {
  const {
    lockScreen, lockContent, setupContent, timerSelect, timerDisplay,
    btnExport, btnLogout, // <--- IMPORTANTE: Recebe o botão de logout
    unlockInput, unlockEmailInput, btnUnlock, lockErrorMsg, btnShowSetup, 
    setupEmailInput, setupPassInput, btnSendCode, 
    setupCodeInput, btnConfirmSetup, btnBackStep,
    stepRequestDiv, stepVerifyDiv, setupMsg
  } = options;

  let checkInterval = null;
  let timerInterval = null; // NOVO: Para o timer de contagem regressiva
  let isConfigured = false; 

  // --- Inicialização ---

  async function init() {
    // 1. Carrega estado inicial
    isConfigured = await checkVaultConfigured();
    
    // 2. Decide fluxo (Login ou Setup)
    await handleFlowDecision();

    // 3. Configura Listeners
    bindEvents();

    // 4. Inicia monitoramento de tempo
    if (isConfigured) {
      startRealtimeCheck();
      startLockTimerDisplay(); // NOVO: Inicia a exibição do timer
    }
  }

  function bindEvents() {
    // Timer de Bloqueio
    if (timerSelect) {
        getTimeoutSetting().then(val => { if (timerSelect) timerSelect.value = val; });
        timerSelect.addEventListener('change', handleTimerChange);
    }

    // Botões Principais
    if (btnExport) btnExport.addEventListener('click', handleExport);
    if (btnLogout) btnLogout.addEventListener('click', handleLogout); // <--- Listener
    if (btnUnlock) btnUnlock.addEventListener('click', handleUnlock);

    // Botões de Fluxo (Login <-> Setup)
    if (btnShowSetup) btnShowSetup.addEventListener('click', handleShowSetup);
    if (btnBackStep) btnBackStep.addEventListener('click', handleBackStep);

    // Botões de Cadastro (API)
    if (btnSendCode) btnSendCode.addEventListener('click', handleSendCode);
    if (btnConfirmSetup) btnConfirmSetup.addEventListener('click', handleVerifyAndCreate);

    // Monitor de Atividade
    document.addEventListener('click', updateLastActive);
    document.addEventListener('keydown', updateLastActive);
  }

  // --- Lógica de Decisão de Fluxo ---

  async function handleFlowDecision() {
    const savedSetupState = await getStorage(SETUP_STATE_KEY);

    if (isConfigured) {
        // Se já tem conta, verifica se precisa bloquear por tempo
        await checkAutoLock();
        
        // Preenche o email salvo no campo de login para facilitar
        const savedEmail = await getStorage(USER_EMAIL_KEY);
        if (savedEmail && unlockEmailInput) {
            unlockEmailInput.value = savedEmail;
        }

    } else {
        // Se não tem conta, mostra tela de bloqueio (que servirá de porta de entrada)
        showLockScreen(); 
        
        if (savedSetupState) {
            // Se estava no meio de um cadastro, restaura
            restoreSetupState(savedSetupState);
            toggleLoginSetup(false); // Força tela de Setup
        } else {
            // Mostra tela de Login padrão com botão "Criar Conta"
            toggleLoginSetup(true); 
        }
    }
  }

  // --- Manipulação da UI (Login vs Setup) ---

  function toggleLoginSetup(showLogin) {
    toggleHidden(lockContent, !showLogin);
    toggleHidden(setupContent, showLogin);

    // Controla visibilidade do botão "Criar uma conta" na tela de login
    if (btnShowSetup) {
      const canCreate = !isConfigured;
      toggleHidden(btnShowSetup, !(showLogin && canCreate));
    }
    
    // Atualiza título conforme o estado
    const headerEl = lockContent.querySelector('h3');
    if (headerEl) {
        setText(headerEl, isConfigured ? "Cofre Bloqueado" : "Bem-vindo");
    }
  }

  function handleShowSetup() {
    toggleLoginSetup(false); // Vai para Setup
    toggleSetupStep(false); // Reseta para passo 1
  }

  async function handleBackStep() {
    await clearSetupState();
    toggleLoginSetup(true); // Volta para Login
  }

  // --- Handlers de Eventos (Callbacks) ---

  async function handleTimerChange(e) {
    const val = parseInt(e.target.value);
    await chrome.storage.local.set({ [LOCK_TIMEOUT_KEY]: val });
    startLockTimerDisplay(); // Reinicia o timer ao mudar a configuração
  }

  // --- CORREÇÃO AQUI: Logout ---
  async function handleLogout() {
    await lockVault(); // Limpa a chave da memória
    
    // Define o "último acesso" para muito antigo (1 ms).
    // Isso força o checkAutoLock a bloquear a tela imediatamente ao recarregar.
    await chrome.storage.local.set({ [LAST_ACTIVE_KEY]: 1 }); 

    window.location.reload(); // Recarrega para limpar o DOM e memória
  }

  // NOVO: Funções para o timer de exibição
  async function startLockTimerDisplay() {
    stopLockTimerDisplay(); // Garante que não há múltiplos timers rodando
    timerInterval = setInterval(updateTimerDisplay, 1000);
    updateTimerDisplay(); // Chama imediatamente para evitar delay inicial
  }

  function stopLockTimerDisplay() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
      if (timerDisplay) setText(timerDisplay, ''); // Limpa a exibição
    }
  }

  async function updateTimerDisplay() {
    if (!timerDisplay) return; // Não faz nada se o elemento não existe

    const lastActive = await getStorage(LAST_ACTIVE_KEY);
    const timeout = await getTimeoutSetting();
    const now = Date.now();

    // Se o cofre estiver bloqueado ou timeout for 0, limpa e para o timer de exibição
    if (!lockScreen.classList.contains('hidden') || timeout === 0) {
      stopLockTimerDisplay();
      return;
    }

    const timeElapsed = now - lastActive;
    const timeLeftMs = (timeout * 60 * 1000) - timeElapsed;

    if (timeLeftMs <= 0) {
      setText(timerDisplay, 'Bloqueando agora...');
      // Bug corrigido: Força a verificação de bloqueio IMEDIATAMENTE quando o tempo acaba
      await checkAutoLock(); 
      return;
    }

    const minutes = Math.floor(timeLeftMs / (60 * 1000));
    const seconds = Math.floor((timeLeftMs % (60 * 1000)) / 1000);

    setText(timerDisplay, `Bloqueio em ${minutes}m ${seconds}s`);
  }

  async function handleUnlock(e) {
    e.preventDefault();
    const email = unlockEmailInput ? unlockEmailInput.value.trim() : '';
    const pass = unlockInput.value;

    // Validação Opcional: Email corresponde ao cadastrado?
    if (isConfigured) {
        const savedEmail = await getStorage(USER_EMAIL_KEY);
        if (savedEmail && email !== savedEmail) {
            setText(lockErrorMsg, 'E-mail incorreto.');
            return;
        }
    }

    const success = await unlockVault(pass);
    if (success) {
      hideLockScreen();
      unlockInput.value = '';
      setText(lockErrorMsg, '');
      await updateLastActive(); // Reseta o timer para "agora"
      window.location.reload(); 
    } else {
      setText(lockErrorMsg, 'Senha incorreta.');
    }
  }

  async function handleSendCode() {
    const email = setupEmailInput.value.trim();
    const pass = setupPassInput.value;

    if (!email.includes('@')) { setText(setupMsg, 'E-mail inválido.'); return; }
    if (!pass) { setText(setupMsg, 'Crie uma senha mestra.'); return; }

    setText(setupMsg, 'Enviando código...');
    btnSendCode.disabled = true;

    try {
        const res = await fetch(`${API_URL}/send-code`, {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ email })
        });
        const data = await res.json();
        
        if (res.ok) {
            await saveSetupState(email, pass);
            setupEmailInput.disabled = true;
            setupPassInput.disabled = true;
            setText(setupMsg, 'Código enviado! Verifique seu e-mail.');
            toggleSetupStep(true);
        } else {
            setText(setupMsg, data.error || 'Erro ao enviar.');
        }
    } catch (e) {
        setText(setupMsg, 'Erro de conexão (backend).');
    } finally {
        btnSendCode.disabled = false;
    }
  }

  async function handleVerifyAndCreate() {
      const email = setupEmailInput.value.trim();
      const code = setupCodeInput.value.trim();
      const pass = setupPassInput.value;

      if (code.length < 6) return alert('Código inválido.');
      
      setText(setupMsg, 'Verificando...');
      btnConfirmSetup.disabled = true;

      try {
          const res = await fetch(`${API_URL}/verify-code`, {
              method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ email, code })
          });
          const data = await res.json();

          if (res.ok && data.valid) {
              await setMasterPassword(pass);
              await chrome.storage.local.set({ [USER_EMAIL_KEY]: email });
              await clearSetupState();
              await updateLastActive();
              
              alert('Cofre criado com sucesso!');
              window.location.reload();
          } else {
              setText(setupMsg, data.message || 'Código inválido.');
          }
      } catch (e) {
          setText(setupMsg, 'Erro na verificação.');
      } finally {
          btnConfirmSetup.disabled = false;
      }
  }

  async function handleExport() {
    try {
      const key = await exportKey();
      const url = URL.createObjectURL(new Blob([key], {type: "application/json"}));
      const a = document.createElement('a');
      a.href = url; a.download = 'backup.json';
      document.body.appendChild(a); a.click();
    } catch(e) { alert('Desbloqueie para exportar.'); }
  }

  // --- Estado do Setup ---

  function toggleSetupStep(isVerifying) {
      toggleHidden(stepRequestDiv, isVerifying);
      toggleHidden(stepVerifyDiv, !isVerifying);
      setText(setupMsg, '');
  }

  async function saveSetupState(email, pass) {
      await chrome.storage.local.set({ [SETUP_STATE_KEY]: { email, pass } });
  }

  async function clearSetupState() {
      await chrome.storage.local.remove(SETUP_STATE_KEY);
      setupEmailInput.disabled = false;
      setupPassInput.disabled = false;
      setupCodeInput.value = '';
  }

  function restoreSetupState(state) {
      setupEmailInput.value = state.email;
      setupPassInput.value = state.pass;
      setupEmailInput.disabled = true;
      setupPassInput.disabled = true;
      toggleSetupStep(true);
  }

  // --- Funções Auxiliares de Bloqueio ---

  function showLockScreen() {
    if (lockScreen) lockScreen.classList.remove('hidden');
  }

  function hideLockScreen() {
    if (lockScreen) lockScreen.classList.add('hidden');
    startLockTimerDisplay(); // Inicia o timer quando a tela de bloqueio é escondida
  }

  async function checkAutoLock() {
    const lastActive = await getStorage(LAST_ACTIVE_KEY);
    const timeout = await getTimeoutSetting();
    const now = Date.now();

    if (timeout === 0) return;

    // Se lastActive for 1 (logout forçado) ou muito antigo, bloqueia
    if (lastActive && (now - lastActive > timeout * 60 * 1000)) {
      await lockVault();
      showLockScreen();
      toggleLoginSetup(true);
    } else {
      updateLastActive(); // Se estiver dentro do tempo, atualiza para "agora"
    }
  }

  function startRealtimeCheck() {
    if (checkInterval) clearInterval(checkInterval);
    checkInterval = setInterval(async () => {
       const configured = await checkVaultConfigured();
       if (configured && lockScreen.classList.contains('hidden')) {
           await checkAutoLock();
       }
    }, 60000); 
  }

  async function updateLastActive() {
    // Só atualiza o timer se a tela NÃO estiver bloqueada
    if (!lockScreen.classList.contains('hidden')) return;
    await chrome.storage.local.set({ [LAST_ACTIVE_KEY]: Date.now() });
  }

  async function getTimeoutSetting() {
    const data = await getStorage(LOCK_TIMEOUT_KEY);
    return data !== undefined ? data : 10; 
  }

  async function getStorage(key) {
    const r = await chrome.storage.local.get([key]);
    return r[key];
  }

  return { init, showLockScreen };
}