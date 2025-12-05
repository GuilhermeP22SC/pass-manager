import { setText } from '../utils/dom.js';

export function initGeneratorModule(options) {
  const {
    resultContainer,
    lengthSlider,
    lengthValueLabel,
    letterCheckbox,
    digitCheckbox,
    symbolCheckbox,
    regenerateButton,
    copyButton
  } = options;

  const copyLabel = copyButton.querySelector('[data-copy-label]') || copyButton;

  function generatePassword() {
    const length = Number(lengthSlider.value);
    const useLetters = letterCheckbox.checked;
    const useDigits = digitCheckbox.checked;
    const useSymbols = symbolCheckbox.checked;

    const alpha = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';

    let charset = '';
    if (useLetters) charset += alpha;
    if (useDigits) charset += digits;
    if (useSymbols) charset += symbols;
    if (!charset) charset = alpha;

    let password = '';
    for (let i = 0; i < length; i += 1) {
      const index = Math.floor(Math.random() * charset.length);
      password += charset.charAt(index);
    }

    renderPassword(password);
  }

  function renderPassword(password) {
    const fragment = document.createDocumentFragment();
    [...password].forEach((char) => {
      const span = document.createElement('span');
      if (/[^a-zA-Z0-9]/.test(char)) {
        span.className = 'char-symbol';
      } else if (/\d/.test(char)) {
        span.className = 'char-digit';
      } else {
        span.className = 'char-normal';
      }
      setText(span, char);
      fragment.appendChild(span);
    });
    clearContainer();
    resultContainer.appendChild(fragment);
  }

  function clearContainer() {
    resultContainer.innerHTML = '';
  }

  function handleSliderInput(event) {
    const { value, min, max } = event.target;
    setText(lengthValueLabel, value);
    // Corrigir: calcular percentual para o CSS
    const ratio = ((value - min) / (max - min)) * 100;
    event.target.style.setProperty('--sx', ratio + '%');
    generatePassword();
  }

  async function handleCopy() {
    const plainText = resultContainer.innerText;
    await navigator.clipboard.writeText(plainText);
    showCopyFeedback();
  }

  function showCopyFeedback() {
    const original = copyLabel.textContent;
    setText(copyLabel, '✓ Copied');
    setTimeout(() => setText(copyLabel, original), 1000);
  }

  regenerateButton.addEventListener('click', generatePassword);
  copyButton.addEventListener('click', handleCopy);
  lengthSlider.addEventListener('input', handleSliderInput);
  [letterCheckbox, digitCheckbox, symbolCheckbox].forEach((input) => {
    input.addEventListener('change', generatePassword);
  });

  generatePassword();

  return {
    regenerate: generatePassword
  };
}
