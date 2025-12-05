export function cloneTemplate(templateEl) {
  if (!templateEl || !templateEl.content || !templateEl.content.firstElementChild) {
    throw new Error('Template inválido ou inexistente.');
  }
  return templateEl.content.firstElementChild.cloneNode(true);
}

export function setText(el, value = '') {
  if (el) {
    el.textContent = value;
  }
}

export function toggleHidden(el, shouldHide) {
  if (el) {
    el.classList.toggle('hidden', Boolean(shouldHide));
  }
}

export function clearChildren(el) {
  if (!el) return;
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

export function focusElement(el) {
  if (el && typeof el.focus === 'function') {
    el.focus();
  }
}
