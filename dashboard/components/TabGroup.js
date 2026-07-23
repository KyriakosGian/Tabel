/**
 * Tabel - TabGroup Component
 * Renders a group of saved tabs with header, actions, and collapsible content.
 * Includes: format popover (width/color) and drag handle in header-right area.
 */

import { TabItem } from './TabItem.js';

const GROUP_COLORS = [
  { value: '', labelKey: 'colorDefault', preview: 'transparent' },
  { value: 'rgba(239, 68, 68, 0.12)', labelKey: 'colorRed', preview: '#ef4444' },
  { value: 'rgba(249, 115, 22, 0.12)', labelKey: 'colorOrange', preview: '#f97316' },
  { value: 'rgba(234, 179, 8, 0.12)', labelKey: 'colorYellow', preview: '#eab308' },
  { value: 'rgba(34, 197, 94, 0.12)', labelKey: 'colorGreen', preview: '#22c55e' },
  { value: 'rgba(6, 182, 212, 0.12)', labelKey: 'colorCyan', preview: '#06b6d4' },
  { value: 'rgba(99, 102, 241, 0.12)', labelKey: 'colorIndigo', preview: '#6366f1' },
  { value: 'rgba(168, 85, 247, 0.12)', labelKey: 'colorPurple', preview: '#a855f7' },
  { value: 'rgba(236, 72, 153, 0.12)', labelKey: 'colorPink', preview: '#ec4899' }
];

const WIDTH_OPTIONS = [
  { value: 33, label: '33%' },
  { value: 50, label: '50%' },
  { value: 100, label: '100%' }
];

export class TabGroup {
  constructor(groupData, tabsData = [], callbacks = {}) {
    this.data = groupData;
    this.tabs = tabsData;
    this.callbacks = callbacks;
    this.element = null;
    this.tabItems = [];
    this._formatPopoverOpen = false;
  }

  render() {
    const el = document.createElement('div');
    el.className = `tab-group${this.data.collapsed ? ' tab-group--collapsed' : ''}${this.data.locked ? ' tab-group--locked' : ''}`;
    el.dataset.groupId = this.data.id;
    el.draggable = false;

    // Apply custom width
    const w = this.data.width || 100;
    el.style.setProperty('--group-width', `${w}%`);

    // Apply custom background color
    if (this.data.bgColor) {
      el.style.setProperty('--group-tint', this.data.bgColor);
    }

    const date = new Date(this.data.createdAt);
    const dateStr = date.toLocaleDateString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const tabCount = this.tabs.length;
    const tabLabel = tabCount === 1 ? chrome.i18n.getMessage('tab') : chrome.i18n.getMessage('tabs');

    const lockIcon = this.data.locked
      ? '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'
      : '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>';

    el.innerHTML = `
      <div class="tab-group__header">
        <div class="tab-group__header-left">
          <button class="tab-group__collapse-btn" data-action="toggle-collapse" title="${chrome.i18n.getMessage(this.data.collapsed ? 'expandGroup' : 'collapseGroup')}">
            <svg class="tab-group__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <div class="tab-group__info">
            <h3 class="tab-group__title" title="${chrome.i18n.getMessage('renameGroup')}">${this._esc(this.data.name)}</h3>
            <div class="tab-group__meta">
              <span class="tab-group__count">${tabCount} ${tabLabel}</span>
              <span class="tab-group__separator">·</span>
              <span class="tab-group__date">${dateStr}</span>
            </div>
          </div>
        </div>
        <div class="tab-group__header-right">
          <div class="tab-group__format-wrapper">
            <button class="tab-group__action-btn tab-group__action-btn--format" data-action="toggle-format" title="${chrome.i18n.getMessage('formatLayoutColor')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
              </svg>
            </button>
            <div class="format-popover" data-popover="format" style="display:none;">
              <div class="format-popover__section">
                <span class="format-popover__label">${chrome.i18n.getMessage('formatWidth')}</span>
                <div class="format-popover__widths">
                  ${WIDTH_OPTIONS.map(opt => `
                    <button class="format-popover__width-btn${opt.value === w ? ' format-popover__width-btn--active' : ''}"
                            data-width="${opt.value}">${opt.label}</button>
                  `).join('')}
                </div>
              </div>
              <div class="format-popover__section">
                <span class="format-popover__label">${chrome.i18n.getMessage('formatColor')}</span>
                <div class="format-popover__colors">
                  ${GROUP_COLORS.map(c => `
                    <button class="format-popover__color-btn${c.value === (this.data.bgColor || '') ? ' format-popover__color-btn--active' : ''}"
                            data-color="${c.value}"
                            title="${chrome.i18n.getMessage(c.labelKey)}"
                            style="background:${c.preview};${c.value === '' ? 'border:1px dashed var(--color-text-muted);' : ''}">
                    </button>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>
          <button class="tab-group__action-btn" data-action="toggle-lock" title="${chrome.i18n.getMessage(this.data.locked ? 'unlockGroup' : 'lockGroup')}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${lockIcon}</svg>
          </button>
          <button class="tab-group__action-btn tab-group__action-btn--restore" data-action="restore-all" title="${chrome.i18n.getMessage('restoreAll')}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </button>
          <button class="tab-group__action-btn tab-group__action-btn--delete" data-action="delete-group" title="${chrome.i18n.getMessage('deleteGroup')}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
          <div class="tab-group__drag-handle" draggable="true" title="${chrome.i18n.getMessage('dragToReorder')}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity="0.6">
              <circle cx="8" cy="4" r="2"/><circle cx="16" cy="4" r="2"/>
              <circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/>
              <circle cx="8" cy="20" r="2"/><circle cx="16" cy="20" r="2"/>
            </svg>
          </div>
        </div>
      </div>
      <div class="tab-group__body">
        <div class="tab-group__tabs-list"></div>
      </div>
    `;

    const tabsList = el.querySelector('.tab-group__tabs-list');
    this._renderTabs(tabsList);
    this._bindEvents(el);
    this.element = el;
    return el;
  }

  _renderTabs(container) {
    const fragment = document.createDocumentFragment();
    this.tabItems = this.tabs.map(tabData => {
      const tabItem = new TabItem(tabData, {
        isLocked: () => this.data.locked,
        onRestore: (d) => this.callbacks.onRestoreTab?.(d),
        onDelete: (d) => this.callbacks.onDeleteTab?.(d),
        onUpdate: (id, u) => this.callbacks.onUpdateTab?.(id, u)
      });
      fragment.appendChild(tabItem.render());
      return tabItem;
    });
    container.appendChild(fragment);
  }

  _bindEvents(el) {
    // ── Collapse ──
    el.querySelector('[data-action="toggle-collapse"]')?.addEventListener('click', () => {
      this.data.collapsed = !this.data.collapsed;
      el.classList.toggle('tab-group--collapsed');
      el.querySelector('[data-action="toggle-collapse"]').title = chrome.i18n.getMessage(
        this.data.collapsed ? 'expandGroup' : 'collapseGroup'
      );
      this.callbacks.onUpdateGroup?.(this.data.id, { collapsed: this.data.collapsed });
    });

    // ── Lock ──
    el.querySelector('[data-action="toggle-lock"]')?.addEventListener('click', () => {
      this.data.locked = !this.data.locked;
      el.classList.toggle('tab-group--locked');
      const btn = el.querySelector('[data-action="toggle-lock"]');
      const icon = this.data.locked
        ? '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'
        : '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>';
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`;
      btn.title = chrome.i18n.getMessage(this.data.locked ? 'unlockGroup' : 'lockGroup');
      this.callbacks.onUpdateGroup?.(this.data.id, { locked: this.data.locked });
    });

    // ── Restore all ──
    el.querySelector('[data-action="restore-all"]')?.addEventListener('click', () => {
      if (this.data.locked) return;
      const urls = this.tabs.map(t => t.url);
      if (urls.length > 0) this.callbacks.onRestoreAll?.(urls, this.data.id);
    });

    // ── Delete ──
    el.querySelector('[data-action="delete-group"]')?.addEventListener('click', () => {
      if (this.data.locked) return;
      if (confirm(chrome.i18n.getMessage('confirmDeleteGroup'))) {
        el.classList.add('tab-group--removing');
        el.addEventListener('animationend', () => {
          this.callbacks.onDeleteGroup?.(this.data.id);
        }, { once: true });
      }
    });

    // ── Title edit (single click) ──
    const titleEl = el.querySelector('.tab-group__title');
    titleEl?.addEventListener('click', () => {
      if (this.data.locked) return;
      const original = titleEl.textContent;
      titleEl.contentEditable = true;
      titleEl.classList.add('tab-group__title--editing');
      titleEl.focus();
      const range = document.createRange();
      range.selectNodeContents(titleEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const ac = new AbortController();
      const finish = () => {
        titleEl.contentEditable = false;
        titleEl.classList.remove('tab-group__title--editing');
        ac.abort();
        const newName = titleEl.textContent.trim();
        if (newName && newName !== original) {
          this.data.name = newName;
          this.callbacks.onUpdateGroup?.(this.data.id, { name: newName });
        } else titleEl.textContent = original;
      };
      titleEl.addEventListener('blur', finish, { once: true, signal: ac.signal });
      titleEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
        else if (e.key === 'Escape') { titleEl.textContent = original; titleEl.blur(); }
      }, { signal: ac.signal });
    });

    // ── Format popover ──
    this._bindFormatPopover(el);
  }

  _bindFormatPopover(el) {
    const toggleBtn = el.querySelector('[data-action="toggle-format"]');
    const popover = el.querySelector('[data-popover="format"]');
    if (!toggleBtn || !popover) return;

    // AbortController lets us remove the document listener when the group is removed from DOM
    const closeController = new AbortController();

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.data.locked) return;
      this._formatPopoverOpen = !this._formatPopoverOpen;
      popover.style.display = this._formatPopoverOpen ? 'block' : 'none';
    });

    document.addEventListener('click', (e) => {
      if (this._formatPopoverOpen && !popover.contains(e.target) && e.target !== toggleBtn && !toggleBtn.contains(e.target)) {
        this._formatPopoverOpen = false;
        popover.style.display = 'none';
      }
    }, { signal: closeController.signal });

    // Clean up the document listener when the element is removed from the DOM
    new MutationObserver((_, obs) => {
      if (!document.contains(el)) {
        closeController.abort();
        obs.disconnect();
      }
    }).observe(document.body, { childList: true, subtree: true });

    popover.querySelectorAll('[data-width]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const width = parseInt(btn.dataset.width, 10);
        this.data.width = width;
        popover.querySelectorAll('[data-width]').forEach(b => b.classList.remove('format-popover__width-btn--active'));
        btn.classList.add('format-popover__width-btn--active');
        el.style.setProperty('--group-width', `${width}%`);
        this.callbacks.onUpdateGroup?.(this.data.id, { width });
      });
    });

    popover.querySelectorAll('[data-color]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const color = btn.dataset.color;
        this.data.bgColor = color;
        popover.querySelectorAll('[data-color]').forEach(b => b.classList.remove('format-popover__color-btn--active'));
        btn.classList.add('format-popover__color-btn--active');
        el.style.setProperty('--group-tint', color || 'transparent');
        this.callbacks.onUpdateGroup?.(this.data.id, { bgColor: color });
      });
    });
  }

  updateCount(count) {
    const el = this.element?.querySelector('.tab-group__count');
    if (el) {
      const label = count === 1 ? chrome.i18n.getMessage('tab') : chrome.i18n.getMessage('tabs');
      el.textContent = `${count} ${label}`;
    }
  }

  _esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
}
