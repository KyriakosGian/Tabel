/**
 * Tabel - TabItem Component
 * Renders an individual saved tab with favicon, title, and actions.
 */

export class TabItem {
  /**
   * @param {Object} data - Tab data from IndexedDB
   * @param {Object} callbacks - Event callbacks { onRestore, onDelete, onUpdate }
   */
  constructor(data, callbacks = {}) {
    this.data = data;
    this.callbacks = callbacks;
    this.element = null;
  }

  /** Create the DOM element for this tab item */
  render() {
    const el = document.createElement('div');
    el.className = 'tab-item';
    el.dataset.tabId = this.data.id;
    el.dataset.groupId = this.data.groupId;
    el.draggable = true;

    // Extract domain from URL for display
    let domain = '';
    try {
      domain = new URL(this.data.url).hostname;
    } catch (e) {
      domain = this.data.url;
    }

    // Favicon URL - use Chrome's favicon service
    const faviconUrl = this.data.favIconUrl ||
      `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(this.data.url)}&size=32`;

    el.innerHTML = `
      <div class="tab-item__drag-handle" title="${chrome.i18n.getMessage('dragToReorder')}">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <circle cx="3" cy="2" r="1.2"/>
          <circle cx="9" cy="2" r="1.2"/>
          <circle cx="3" cy="6" r="1.2"/>
          <circle cx="9" cy="6" r="1.2"/>
          <circle cx="3" cy="10" r="1.2"/>
          <circle cx="9" cy="10" r="1.2"/>
        </svg>
      </div>
      <img class="tab-item__favicon"
           src="${faviconUrl}"
           alt=""
           width="16"
           height="16"
           loading="lazy">
      <a class="tab-item__content" href="${this._escapeHtml(this.data.url)}" target="_blank" rel="noopener noreferrer" title="${this._escapeHtml(this.data.url)}">
        <span class="tab-item__title">${this._escapeHtml(this.data.title)}</span>
        <span class="tab-item__domain">${this._escapeHtml(domain)}</span>
      </a>
      <div class="tab-item__actions">
        <button class="tab-item__btn tab-item__btn--restore" title="${chrome.i18n.getMessage('restoreTab')}" data-action="restore">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </button>
        <button class="tab-item__btn tab-item__btn--delete" title="${chrome.i18n.getMessage('deleteTab')}" data-action="delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `;

    // Favicon fallback (CSP-compliant, no inline handler)
    const favicon = el.querySelector('.tab-item__favicon');
    favicon.addEventListener('error', () => {
      favicon.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#374151"/><text x="8" y="12" font-size="10" text-anchor="middle" fill="#9ca3af">T</text></svg>');
    }, { once: true });

    // Event listeners
    const content = el.querySelector('.tab-item__content');
    content.addEventListener('click', (e) => {
      e.preventDefault();
      this._onRestore();
    });

    const restoreBtn = el.querySelector('[data-action="restore"]');
    restoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._onRestore();
    });

    const deleteBtn = el.querySelector('[data-action="delete"]');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._onDelete();
    });

    // Double-click to edit title
    const titleEl = el.querySelector('.tab-item__title');
    titleEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (this.callbacks.isLocked?.()) return;
      this._enableTitleEdit(titleEl);
    });

    this.element = el;
    return el;
  }

  /** Open the tab URL */
  _onRestore() {
    if (this.callbacks.isLocked?.()) return;
    if (this.callbacks.onRestore) {
      this.callbacks.onRestore(this.data);
    }
  }

  /** Delete this tab */
  _onDelete() {
    if (this.callbacks.isLocked?.()) return;
    if (this.element) {
      this.element.classList.add('tab-item--removing');
      this.element.addEventListener('animationend', () => {
        if (this.callbacks.onDelete) {
          this.callbacks.onDelete(this.data);
        }
      }, { once: true });
    }
  }

  /** Enable inline title editing */
  _enableTitleEdit(titleEl) {
    const original = titleEl.textContent;
    titleEl.contentEditable = true;
    titleEl.classList.add('tab-item__title--editing');
    titleEl.focus();

    // Select all text
    const range = document.createRange();
    range.selectNodeContents(titleEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const ac = new AbortController();
    const finishEdit = () => {
      titleEl.contentEditable = false;
      titleEl.classList.remove('tab-item__title--editing');
      ac.abort();

      const newTitle = titleEl.textContent.trim();
      if (newTitle && newTitle !== original) {
        this.data.title = newTitle;
        if (this.callbacks.onUpdate) {
          this.callbacks.onUpdate(this.data.id, { title: newTitle });
        }
      } else {
        titleEl.textContent = original;
      }
    };

    titleEl.addEventListener('blur', finishEdit, { once: true, signal: ac.signal });
    titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        titleEl.blur();
      } else if (e.key === 'Escape') {
        titleEl.textContent = original;
        titleEl.blur();
      }
    }, { signal: ac.signal });
  }

  /** Escape HTML entities */
  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
