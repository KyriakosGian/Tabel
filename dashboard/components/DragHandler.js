/**
 * Tabel - DragHandler
 * Implements HTML5 Drag and Drop for reordering tabs and groups.
 *
 * Key fix: Uses mousedown tracking because e.target in dragstart
 * is always the [draggable] element, not the actual clicked child.
 * We record which element was clicked on mousedown, then check it in dragstart.
 */

export class DragHandler {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this._draggedEl = null;
    this._dragType = null;   // 'tab' or 'group'
    this._sourceGroupId = null;
    this._mouseDownTarget = null;
    this._init();
  }

  _init() {
    // Track the actual mousedown target (crucial for drag detection)
    this.container.addEventListener('mousedown', (e) => {
      this._mouseDownTarget = e.target;
    }, true);

    this.container.addEventListener('dragstart', (e) => this._onDragStart(e));
    this.container.addEventListener('dragover', (e) => this._onDragOver(e));
    this.container.addEventListener('dragenter', (e) => this._onDragEnter(e));
    this.container.addEventListener('dragleave', (e) => this._onDragLeave(e));
    this.container.addEventListener('drop', (e) => this._onDrop(e));
    this.container.addEventListener('dragend', (e) => this._onDragEnd(e));
  }

  _onDragStart(e) {
    const clicked = this._mouseDownTarget;
    if (!clicked) { e.preventDefault(); return; }

    // ─── Tab Item Drag (from drag handle) ────────────────────
    const tabItem = e.target.closest('.tab-item');
    if (tabItem) {
      const sourceGroup = tabItem.closest('.tab-group');
      // Only allow if mousedown was on the drag handle
      if (!clicked.closest('.tab-item__drag-handle') || sourceGroup?.classList.contains('tab-group--locked')) {
        e.preventDefault();
        return;
      }

      this._dragType = 'tab';
      this._draggedEl = tabItem;
      this._sourceGroupId = tabItem.dataset.groupId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tabItem.dataset.tabId);
      requestAnimationFrame(() => tabItem.classList.add('tab-item--dragging'));
      return;
    }

    // ─── Group Drag (from drag handle button) ────────────────
    // The drag handle button has draggable="true", so e.target is the handle.
    const dragHandle = e.target.closest('.tab-group__drag-handle');
    if (dragHandle) {
      const tabGroup = dragHandle.closest('.tab-group');
      if (!tabGroup || tabGroup.classList.contains('tab-group--locked')) {
        e.preventDefault();
        return;
      }

      this._dragType = 'group';
      this._draggedEl = tabGroup;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tabGroup.dataset.groupId);

      // Show the whole group as the drag image, not just the handle
      try {
        e.dataTransfer.setDragImage(tabGroup, 40, 20);
      } catch (err) { /* fallback to default */ }

      requestAnimationFrame(() => tabGroup.classList.add('tab-group--dragging'));
      return;
    }

    // Not a valid drag source
    e.preventDefault();
  }

  _onDragOver(e) {
    if (!this._draggedEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (this._dragType === 'tab') {
      this._handleTabDragOver(e);
    } else if (this._dragType === 'group') {
      this._handleGroupDragOver(e);
    }
  }

  _handleTabDragOver(e) {
    const targetTabItem = e.target.closest('.tab-item');
    const targetTabsList = e.target.closest('.tab-group__tabs-list');

    // Remove old classes from all items and lists
    this.container.querySelectorAll('.tab-item').forEach(el => {
      el.classList.remove('tab-item--drag-over-top', 'tab-item--drag-over-bottom');
    });
    this.container.querySelectorAll('.tab-group__tabs-list').forEach(el => {
      el.classList.remove('tab-group__tabs-list--empty-drag-over');
    });

    if (targetTabItem && targetTabItem !== this._draggedEl) {
      const rect = targetTabItem.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      if (e.clientY < midY) {
        targetTabItem.classList.add('tab-item--drag-over-top');
      } else {
        targetTabItem.classList.add('tab-item--drag-over-bottom');
      }
    } else if (targetTabsList && !targetTabsList.querySelector('.tab-item:not(.tab-item--dragging)')) {
      // Empty group or only contains the dragged item
      targetTabsList.classList.add('tab-group__tabs-list--empty-drag-over');
    }
  }

  _handleGroupDragOver(e) {
    const targetGroup = e.target.closest('.tab-group');

    // Remove old classes from all groups
    this.container.querySelectorAll('.tab-group').forEach(el => {
      el.classList.remove(
        'tab-group--drag-over-top',
        'tab-group--drag-over-bottom',
        'tab-group--drag-over-left',
        'tab-group--drag-over-right'
      );
    });

    if (targetGroup && targetGroup !== this._draggedEl) {
      const rect = targetGroup.getBoundingClientRect();
      const containerRect = this.container.getBoundingClientRect();
      const isHorizontalLayout = rect.width < containerRect.width * 0.9;

      if (isHorizontalLayout) {
        const midX = rect.left + rect.width / 2;
        if (e.clientX < midX) {
          targetGroup.classList.add('tab-group--drag-over-left');
        } else {
          targetGroup.classList.add('tab-group--drag-over-right');
        }
      } else {
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          targetGroup.classList.add('tab-group--drag-over-top');
        } else {
          targetGroup.classList.add('tab-group--drag-over-bottom');
        }
      }
    } else if (!targetGroup) {
      // If hovering outside any group (empty container space), show indicator on the last group
      const groups = [...this.container.querySelectorAll('.tab-group')].filter(el => el !== this._draggedEl);
      if (groups.length > 0) {
        const lastGroup = groups[groups.length - 1];
        const rect = lastGroup.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        const isHorizontalLayout = rect.width < containerRect.width * 0.9;

        if (isHorizontalLayout) {
          lastGroup.classList.add('tab-group--drag-over-right');
        } else {
          lastGroup.classList.add('tab-group--drag-over-bottom');
        }
      }
    }
  }

  _onDragEnter(e) {
    if (!this._draggedEl) return;
    e.preventDefault();

    if (this._dragType === 'tab') {
      const targetGroup = e.target.closest('.tab-group');
      if (targetGroup) targetGroup.classList.add('tab-group--drag-over');
    }
  }

  _onDragLeave(e) {
    const targetGroup = e.target.closest('.tab-group');
    if (targetGroup && !targetGroup.contains(e.relatedTarget)) {
      targetGroup.classList.remove('tab-group--drag-over');
    }
  }

  _onDrop(e) {
    if (!this._draggedEl) return;
    e.preventDefault();

    // Clean up all indicators and hover states
    this.container.querySelectorAll('.tab-item').forEach(el => el.classList.remove('tab-item--drag-over-top', 'tab-item--drag-over-bottom'));
    this.container.querySelectorAll('.tab-group').forEach(el => el.classList.remove('tab-group--drag-over-top', 'tab-group--drag-over-bottom', 'tab-group--drag-over-left', 'tab-group--drag-over-right', 'tab-group--drag-over'));
    this.container.querySelectorAll('.tab-group__tabs-list').forEach(el => el.classList.remove('tab-group__tabs-list--empty-drag-over'));

    if (this._dragType === 'tab') {
      this._handleTabDrop(e);
    } else if (this._dragType === 'group') {
      this._handleGroupDrop(e);
    }
  }

  _handleTabDrop(e) {
    const targetTabItem = e.target.closest('.tab-item');
    const targetGroup = e.target.closest('.tab-group');
    if (!targetGroup || targetGroup.classList.contains('tab-group--locked')) return;

    const targetGroupId = targetGroup.dataset.groupId;
    const tabsList = targetGroup.querySelector('.tab-group__tabs-list');

    if (targetTabItem && targetTabItem !== this._draggedEl) {
      const rect = targetTabItem.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      if (e.clientY < midY) {
        tabsList.insertBefore(this._draggedEl, targetTabItem);
      } else {
        tabsList.insertBefore(this._draggedEl, targetTabItem.nextSibling);
      }
    } else if (!targetTabItem) {
      tabsList.appendChild(this._draggedEl);
    }

    // Update data attribute
    this._draggedEl.dataset.groupId = targetGroupId;

    // Collect new order
    const tabIds = [...tabsList.querySelectorAll('.tab-item')].map(el => el.dataset.tabId);
    const tabId = this._draggedEl.dataset.tabId;
    const newOrder = tabIds.indexOf(tabId);

    if (this._sourceGroupId !== targetGroupId) {
      const sourceGroup = [...this.container.querySelectorAll('.tab-group')]
        .find(el => el.dataset.groupId === this._sourceGroupId);
      const sourceTabIds = sourceGroup
        ? [...sourceGroup.querySelectorAll('.tab-item')].map(el => el.dataset.tabId)
        : [];
      this.callbacks.onTabMoved?.(tabId, targetGroupId, newOrder, {
        targetTabIds: tabIds,
        sourceTabIds
      });
    } else {
      this.callbacks.onTabsReordered?.(targetGroupId, tabIds);
    }
  }

  _handleGroupDrop(e) {
    const targetGroup = e.target.closest('.tab-group');
    const groupsContainer = this.container;

    if (targetGroup && targetGroup !== this._draggedEl) {
      const rect = targetGroup.getBoundingClientRect();
      const containerRect = groupsContainer.getBoundingClientRect();
      const isHorizontalLayout = rect.width < containerRect.width * 0.9;

      if (isHorizontalLayout) {
        const midX = rect.left + rect.width / 2;
        if (e.clientX < midX) {
          groupsContainer.insertBefore(this._draggedEl, targetGroup);
        } else {
          groupsContainer.insertBefore(this._draggedEl, targetGroup.nextSibling);
        }
      } else {
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          groupsContainer.insertBefore(this._draggedEl, targetGroup);
        } else {
          groupsContainer.insertBefore(this._draggedEl, targetGroup.nextSibling);
        }
      }
    } else if (!targetGroup) {
      // Append to the end of the container if dropped in empty space
      groupsContainer.appendChild(this._draggedEl);
    }

    // Collect new group order
    const groupIds = [...groupsContainer.querySelectorAll('.tab-group')].map(el => el.dataset.groupId);
    this.callbacks.onGroupsReordered?.(groupIds);
  }

  _onDragEnd(e) {
    if (this._draggedEl) {
      this._draggedEl.classList.remove('tab-item--dragging', 'tab-group--dragging');
    }

    // Clean up everything
    this.container.querySelectorAll('.tab-item').forEach(el => el.classList.remove('tab-item--drag-over-top', 'tab-item--drag-over-bottom'));
    this.container.querySelectorAll('.tab-group').forEach(el => el.classList.remove('tab-group--drag-over-top', 'tab-group--drag-over-bottom', 'tab-group--drag-over-left', 'tab-group--drag-over-right', 'tab-group--drag-over'));
    this.container.querySelectorAll('.tab-group__tabs-list').forEach(el => el.classList.remove('tab-group__tabs-list--empty-drag-over'));

    this._draggedEl = null;
    this._dragType = null;
    this._sourceGroupId = null;
    this._mouseDownTarget = null;
  }
}
