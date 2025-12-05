import { initGeneratorModule } from './modules/generator.js';
import { createVaultModule } from './modules/vault.js';
import { createAutofillModule } from './modules/autofill.js';
import { createSecurityModule } from './modules/security.js';

const views = {
  main: document.getElementById('view-main'),
  autofill: document.getElementById('view-autofill'),
  generator: document.getElementById('view-generator')
};

const navButtons = {
  main: document.getElementById('nav-vault'),
  autofill: document.getElementById('nav-autofill'),
  generator: document.getElementById('nav-gen')
};

// --- Inicialização dos Módulos ---

const generatorModule = initGeneratorModule({
  resultContainer: document.getElementById('gen-result-html'),
  lengthSlider: document.getElementById('opt-length'),
  lengthValueLabel: document.getElementById('len-val'),
  letterCheckbox: document.getElementById('opt-letters'),
  digitCheckbox: document.getElementById('opt-digits'),
  symbolCheckbox: document.getElementById('opt-symbols'),
  regenerateButton: document.getElementById('btn-regenerate'),
  copyButton: document.getElementById('btn-copy-gen')
});

const vaultModule = createVaultModule({
  listEl: document.getElementById('password-list'),
  countLabel: document.getElementById('item-count'),
  emptyState: document.getElementById('empty-state'),
  templateEl: document.getElementById('tpl-vault-item'),
  searchInput: document.getElementById('search-input'),
  addButton: document.getElementById('btn-add-hero'),
  overlayEl: document.getElementById('view-edit'),
  formEl: document.getElementById('form-entry'),
  deleteButton: document.getElementById('btn-delete'),
  saveButton: document.getElementById('btn-save-form'),
  closeButtons: document.querySelectorAll('#view-edit .btn-close'),
  inputs: {
    site: document.getElementById('entry-site'),
    username: document.getElementById('entry-username'),
    password: document.getElementById('entry-password')
  },
  passwordToggleButton: document.getElementById('btn-toggle-pass'),
  passwordIcon: document.getElementById('icon-eye')
});

const autofillModule = createAutofillModule({
  domainEl: document.getElementById('current-domain'),
  faviconEl: document.getElementById('current-favicon'),
  autofillStatusEl: document.getElementById('site-status-autofill'),
  autofillToggleButton: document.getElementById('btn-toggle-autofill')
});

// --- Módulo de Segurança (Com Mapeamento de Email/Código) ---
const securityModule = createSecurityModule({
  lockScreen: document.getElementById('lock-screen'),
  lockContent: document.getElementById('lock-content'),
  setupContent: document.getElementById('setup-content'),
  timerSelect: document.getElementById('opt-timer'),
  timerDisplay: document.getElementById('lock-timer-display'),
  btnExport: document.getElementById('btn-export-key'),
  btnLogout: document.getElementById('btn-logout'),

  // Login
  unlockInput: document.getElementById('unlock-pass'),
  unlockEmailInput: document.getElementById('unlock-email'), // NOVO CAMPO
  btnUnlock: document.getElementById('btn-unlock'),
  lockErrorMsg: document.getElementById('lock-error'),
  btnShowSetup: document.getElementById('btn-show-setup'),

  // Setup (Cadastro)
  setupEmailInput: document.getElementById('setup-email'),
  setupPassInput: document.getElementById('setup-pass'),
  btnSendCode: document.getElementById('btn-send-code'),

  setupCodeInput: document.getElementById('setup-code'),
  btnConfirmSetup: document.getElementById('btn-confirm-setup'),
  btnBackStep: document.getElementById('btn-back-step'),

  stepRequestDiv: document.getElementById('step-request'),
  stepVerifyDiv: document.getElementById('step-verify'),
  setupMsg: document.getElementById('setup-msg')
});

// --- Navegação ---

function initNavigation() {
  navButtons.main.addEventListener('click', () => switchMainView('main'));
  navButtons.autofill.addEventListener('click', () => switchMainView('autofill'));
  navButtons.generator.addEventListener('click', () => switchMainView('generator'));
}

function switchMainView(target) {
  // Se o cofre estiver bloqueado, não permite navegação
  if (!document.getElementById('lock-screen').classList.contains('hidden')) {
    return;
  }

  Object.values(views).forEach((view) => view.classList.add('hidden'));
  Object.values(navButtons).forEach((button) => button.classList.remove('active'));

  const viewEl = views[target];
  const navButton = navButtons[target];
  if (viewEl) viewEl.classList.remove('hidden');
  if (navButton) navButton.classList.add('active');

  if (target === 'autofill') {
    autofillModule.refresh();
  }
}

async function initApp() {
  initNavigation();

  // 1. Inicializa Segurança
  await securityModule.init();

  // 2. Tenta inicializar o Vault
  try {
    await vaultModule.init();

    // 3. Se passar daqui, está desbloqueado e configurado. Mostra a main view.
    if (document.getElementById('lock-screen').classList.contains('hidden')) {
      switchMainView('main');
    }

  } catch (error) {
    if (error.message === 'LOCKED') {
      // Se deu erro de cofre bloqueado (timer expirado), mostra a tela de login
      securityModule.showLockScreen();
      Object.values(views).forEach((view) => view.classList.add('hidden'));
    } else {
      console.error('Erro ao iniciar módulo do cofre:', error);
      // Erro genérico (se não for LOCK), tenta mostrar a main view.
      if (document.getElementById('lock-screen').classList.contains('hidden')) {
        switchMainView('main');
      }
    }
  }
}

// --- CSV Import/Export ---
function setupCsvImportExport() {
  const exportBtn = document.getElementById('btn-export-csv');
  const importBtn = document.getElementById('btn-import-csv');
  const importInput = document.getElementById('import-csv-input');

  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      // Bloqueia se o cofre estiver bloqueado
      if (!document.getElementById('lock-screen').classList.contains('hidden')) return;

      if (vaultModule && vaultModule.exportToCsv) {
        await vaultModule.exportToCsv();
      }
    });
  }

  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => {
      // Bloqueia se o cofre estiver bloqueado
      if (!document.getElementById('lock-screen').classList.contains('hidden')) return;
      importInput.click();
    });
    importInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file && vaultModule && vaultModule.importFromCsv) {
        await vaultModule.importFromCsv(file);
      }
      importInput.value = '';
    });
  }
}

initApp();
setupCsvImportExport();

export { generatorModule, vaultModule, autofillModule, securityModule, switchMainView };