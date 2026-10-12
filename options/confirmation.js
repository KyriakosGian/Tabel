/** A deliberate confirmation with keyboard cancellation and no implicit Enter. */
export function confirmAction({ title, description, actionLabel, phrase = '', checkboxLabel = '' }) {
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'confirmation-dialog';
  const heading = document.createElement('h2');
  heading.id = 'confirmation-title';
  heading.textContent = title;
  dialog.setAttribute('aria-labelledby', heading.id);
  const text = document.createElement('p');
  text.textContent = description;
  dialog.append(heading, text);
  let input;
  if (phrase) {
    const label = document.createElement('label');
    label.textContent = chrome.i18n.getMessage('confirmationType', [phrase]);
    input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', label.textContent);
    label.append(input);
    dialog.append(label);
  }
  let checkbox;
  if (checkboxLabel) {
    const label = document.createElement('label');
    label.className = 'confirmation-check';
    checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const span = document.createElement('span');
    span.textContent = checkboxLabel;
    label.append(checkbox, span);
    dialog.append(label);
  }
  const actions = document.createElement('div');
  actions.className = 'confirmation-actions';
  const cancel = document.createElement('button');
  cancel.className = 'btn';
  cancel.type = 'button';
  cancel.textContent = chrome.i18n.getMessage('cancel');
  const accept = document.createElement('button');
  accept.className = phrase ? 'btn btn--danger' : 'btn';
  accept.type = 'button';
  accept.textContent = actionLabel;
  const enabled = () => (!phrase || input.value === phrase) && (!checkbox || checkbox.checked);
  const refresh = () => { accept.disabled = !enabled(); };
  input?.addEventListener('input', refresh);
  checkbox?.addEventListener('change', refresh);
  refresh();
  actions.append(cancel, accept);
  dialog.append(actions);
  document.body.append(dialog);
  return new Promise(resolve => {
    let accepted = false;
    cancel.addEventListener('click', () => dialog.close());
    accept.addEventListener('click', () => {
      if (!enabled()) return;
      accepted = true;
      dialog.close();
    });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Enter') event.preventDefault();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      previousFocus?.focus();
      resolve(accepted);
    }, { once: true });
    dialog.showModal();
    cancel.focus();
  });
}
