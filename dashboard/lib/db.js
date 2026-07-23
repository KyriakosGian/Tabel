/**
 * Tabel - IndexedDB Wrapper
 * Manages all local storage operations for tab groups and items.
 * Uses IndexedDB for high-performance storage of potentially millions of records.
 */

import { createTombstone, mergeSyncData } from './merge.js';

const DB_NAME = 'TabelDB';
const DB_VERSION = 3;

const STORES = {
  GROUPS: 'tabGroups',
  ITEMS: 'tabItems',
  TOMBSTONES: 'tombstones'
};

class TabelDB {
  constructor() {
    this._db = null;
    this._ready = this._init();
  }

  /** Initialize the database and create object stores */
  async _init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Tab Groups store
        if (!db.objectStoreNames.contains(STORES.GROUPS)) {
          const groupStore = db.createObjectStore(STORES.GROUPS, { keyPath: 'id' });
          groupStore.createIndex('createdAt', 'createdAt', { unique: false });
          groupStore.createIndex('order', 'order', { unique: false });
        }

        // Tab Items store
        if (!db.objectStoreNames.contains(STORES.ITEMS)) {
          const itemStore = db.createObjectStore(STORES.ITEMS, { keyPath: 'id' });
          itemStore.createIndex('groupId', 'groupId', { unique: false });
          itemStore.createIndex('url', 'url', { unique: false });
          itemStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.TOMBSTONES)) {
          const tombstoneStore = db.createObjectStore(STORES.TOMBSTONES, { keyPath: 'key' });
          tombstoneStore.createIndex('deletedAt', 'deletedAt', { unique: false });
        }

        // Remove the deprecated thumbnails store from older (v1) installs.
        if (db.objectStoreNames.contains('thumbnails')) {
          db.deleteObjectStore('thumbnails');
        }
      };

      request.onsuccess = (event) => {
        this._db = event.target.result;
        resolve(this._db);
      };

      request.onerror = (event) => {
        console.error('[TabelDB] Failed to open database:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /** Ensure the DB is ready before any operation */
  async _getDB() {
    if (!this._db) await this._ready;
    return this._db;
  }

  /** Generic get-all from a store using a request-based approach */
  async _getAll(storeName, indexName = null, query = null) {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const target = indexName ? store.index(indexName) : store;
      const request = query ? target.getAll(query) : target.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /** Generic get-one by key */
  async _get(storeName, key) {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /** Generic put (insert/update) */
  async _put(storeName, data) {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put(data);

      tx.oncomplete = () => resolve(data);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  // ─── Group Operations ──────────────────────────────────────

  /** Create a new tab group */
  async createGroup(name, tabs = [], options = {}) {
    const allGroups = await this.getAllGroups();
    if (options.sourceSweepId) {
      const existing = allGroups.find(group => group.sourceSweepId === options.sourceSweepId);
      if (existing) return existing;
    }

    const now = Date.now();
    const groupId = `grp_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const group = {
      id: groupId,
      name: name || chrome.i18n.getMessage('groupDefaultName'),
      createdAt: now,
      updatedAt: now,
      order: 0,
      collapsed: false,
      locked: false,
      tabCount: tabs.length,
      width: 50,
      bgColor: '',
      ...(options.sourceSweepId ? { sourceSweepId: options.sourceSweepId } : {})
    };

    // New groups get order 0 (top), push existing groups down
    for (const existing of allGroups) {
      existing.order = existing.order + 1;
      existing.updatedAt = now;
      await this._put(STORES.GROUPS, existing);
    }
    group.order = 0;

    // Deduplicate: silently remove matching URLs from older groups
    if (tabs.length > 0) {
      await this._removeDuplicateUrls(tabs.map(t => t.url));
    }

    // Save group
    await this._put(STORES.GROUPS, group);

    // Save all tabs in batch
    if (tabs.length > 0) {
      await this._batchPutItems(groupId, tabs);
    }

    return group;
  }

  /** Remove tabs with matching URLs from all existing groups (deduplication) */
  async _removeDuplicateUrls(urls) {
    const urlSet = new Set(urls);
    const allItems = await this._getAll(STORES.ITEMS);
    const affectedGroupIds = new Set();

    const db = await this._getDB();
    const tx = db.transaction([STORES.ITEMS, STORES.TOMBSTONES], 'readwrite');
    const itemStore = tx.objectStore(STORES.ITEMS);
    const tombstoneStore = tx.objectStore(STORES.TOMBSTONES);
    const deletedAt = Date.now();

    for (const item of allItems) {
      if (urlSet.has(item.url)) {
        itemStore.delete(item.id);
        tombstoneStore.put(createTombstone('item', item.id, deletedAt));
        affectedGroupIds.add(item.groupId);
      }
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });

    // Update tab counts and remove empty groups
    for (const gId of affectedGroupIds) {
      const remaining = await this.getTabsByGroup(gId);
      if (remaining.length === 0) {
        await this.deleteGroup(gId);
      } else {
        await this.updateGroup(gId, { tabCount: remaining.length });
      }
    }
  }

  /** Get all groups sorted by order, newest first by default */
  async getAllGroups() {
    const groups = await this._getAll(STORES.GROUPS);
    return groups.sort((a, b) => {
      // Primary: by order field
      if (a.order !== b.order) return a.order - b.order;
      // Secondary: newest first (descending createdAt)
      return b.createdAt - a.createdAt;
    });
  }

  /** Get a single group */
  async getGroup(groupId) {
    return this._get(STORES.GROUPS, groupId);
  }

  /** Update a group */
  async updateGroup(groupId, updates) {
    const group = await this.getGroup(groupId);
    if (!group) return null;

    const updated = { ...group, ...updates, updatedAt: Date.now() };
    await this._put(STORES.GROUPS, updated);
    return updated;
  }

  /** Delete a group and all its tabs */
  async deleteGroup(groupId) {
    // Delete all tabs in this group
    const tabs = await this.getTabsByGroup(groupId);
    const db = await this._getDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.ITEMS, STORES.GROUPS, STORES.TOMBSTONES], 'readwrite');
      const itemStore = tx.objectStore(STORES.ITEMS);
      const groupStore = tx.objectStore(STORES.GROUPS);
      const tombstoneStore = tx.objectStore(STORES.TOMBSTONES);
      const deletedAt = Date.now();

      // Delete each tab item
      for (const tab of tabs) {
        itemStore.delete(tab.id);
        tombstoneStore.put(createTombstone('item', tab.id, deletedAt));
      }

      // Delete the group itself
      groupStore.delete(groupId);
      tombstoneStore.put(createTombstone('group', groupId, deletedAt));

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /** Reorder groups */
  async reorderGroups(orderedIds) {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.GROUPS, 'readwrite');
      const store = tx.objectStore(STORES.GROUPS);

      orderedIds.forEach((id, index) => {
        const req = store.get(id);
        req.onsuccess = () => {
          const group = req.result;
          if (group) {
            group.order = index;
            group.updatedAt = Date.now();
            store.put(group);
          }
        };
      });

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  // ─── Tab Item Operations ───────────────────────────────────

  /** Batch insert tabs for a group */
  async _batchPutItems(groupId, tabs) {
    const db = await this._getDB();
    const now = Date.now();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.ITEMS, 'readwrite');
      const store = tx.objectStore(STORES.ITEMS);

      tabs.forEach((tab, index) => {
        const item = {
          id: `tab_${now}_${index}_${Math.random().toString(36).slice(2, 6)}`,
          groupId: groupId,
          url: tab.url,
          title: tab.title || tab.url,
          favIconUrl: tab.favIconUrl || '',
          order: index,
          createdAt: now,
          updatedAt: now
        };
        store.put(item);
      });

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /** Get all tabs in a group sorted by order */
  async getTabsByGroup(groupId) {
    const items = await this._getAll(STORES.ITEMS, 'groupId', groupId);
    return items.sort((a, b) => a.order - b.order);
  }

  /** Get a single tab */
  async getTab(tabId) {
    return this._get(STORES.ITEMS, tabId);
  }

  /** Update a tab item */
  async updateTab(tabId, updates) {
    const tab = await this.getTab(tabId);
    if (!tab) return null;

    const updated = { ...tab, ...updates, updatedAt: Date.now() };
    await this._put(STORES.ITEMS, updated);
    return updated;
  }

  /** Delete a single tab */
  async deleteTab(tabId) {
    const tab = await this.getTab(tabId);
    if (!tab) return;

    // Delete the tab
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.ITEMS, STORES.GROUPS, STORES.TOMBSTONES], 'readwrite');

      tx.objectStore(STORES.ITEMS).delete(tabId);
      tx.objectStore(STORES.TOMBSTONES).put(createTombstone('item', tabId));

      // Update group tab count
      const groupReq = tx.objectStore(STORES.GROUPS).get(tab.groupId);
      groupReq.onsuccess = () => {
        const group = groupReq.result;
        if (group) {
          group.tabCount = Math.max(0, (group.tabCount || 1) - 1);
          group.updatedAt = Date.now();
          tx.objectStore(STORES.GROUPS).put(group);
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /** Move a tab to a different group */
  async moveTab(tabId, targetGroupId, newOrder) {
    const tab = await this.getTab(tabId);
    if (!tab) return;

    const oldGroupId = tab.groupId;
    tab.groupId = targetGroupId;
    tab.order = newOrder;
    tab.updatedAt = Date.now();

    await this._put(STORES.ITEMS, tab);

    // Update tab counts for both groups
    if (oldGroupId !== targetGroupId) {
      const oldGroup = await this.getGroup(oldGroupId);
      const newGroup = await this.getGroup(targetGroupId);

      if (oldGroup) {
        await this.updateGroup(oldGroupId, { tabCount: Math.max(0, (oldGroup.tabCount || 1) - 1) });
      }
      if (newGroup) {
        await this.updateGroup(targetGroupId, { tabCount: (newGroup.tabCount || 0) + 1 });
      }
    }
  }

  /** Reorder tabs within a group */
  async reorderTabs(groupId, orderedTabIds) {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.ITEMS, 'readwrite');
      const store = tx.objectStore(STORES.ITEMS);

      const updatedAt = Date.now();
      orderedTabIds.forEach((id, index) => {
        const req = store.get(id);
        req.onsuccess = () => {
          const tab = req.result;
          if (tab) {
            tab.order = index;
            tab.updatedAt = updatedAt;
            store.put(tab);
          }
        };
      });

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  // ─── Utility Operations ────────────────────────────────────

  /** Get total counts */
  async getCounts() {
    const groups = await this._getAll(STORES.GROUPS);
    const items = await this._getAll(STORES.ITEMS);
    return {
      groups: groups.length,
      tabs: items.length
    };
  }

  async getAllTombstones() {
    return this._getAll(STORES.TOMBSTONES);
  }

  /** Export all data */
  async exportAll() {
    const groups = await this._getAll(STORES.GROUPS);
    const items = await this._getAll(STORES.ITEMS);
    const tombstones = await this.getAllTombstones();
    return {
      version: DB_VERSION,
      exportedAt: Date.now(),
      groups,
      items,
      tombstones
    };
  }

  /** Import data (full overwrite — used for manual import/restore) */
  async importAll(data) {
    if (!data || !Array.isArray(data.groups) || !Array.isArray(data.items)) {
      throw new Error('Invalid import data');
    }

    const currentGroups = await this._getAll(STORES.GROUPS);
    const currentItems = await this._getAll(STORES.ITEMS);
    const currentTombstones = await this.getAllTombstones();
    const importedAt = Date.now();
    const importedGroups = data.groups.map(group => ({
      ...group,
      createdAt: group.createdAt || importedAt,
      updatedAt: importedAt
    }));
    const importedItems = data.items.map(item => ({
      ...item,
      createdAt: item.createdAt || importedAt,
      updatedAt: importedAt
    }));
    const incomingGroupIds = new Set(importedGroups.map(group => group.id));
    const incomingItemIds = new Set(importedItems.map(item => item.id));
    const tombstones = new Map(currentTombstones.map(t => [t.key, t]));
    const deletedAt = importedAt;

    for (const group of currentGroups) {
      if (!incomingGroupIds.has(group.id)) {
        const tombstone = createTombstone('group', group.id, deletedAt);
        tombstones.set(tombstone.key, tombstone);
      }
    }
    for (const item of currentItems) {
      if (!incomingItemIds.has(item.id)) {
        const tombstone = createTombstone('item', item.id, deletedAt);
        tombstones.set(tombstone.key, tombstone);
      }
    }
    for (const group of importedGroups) tombstones.delete(`group:${group.id}`);
    for (const item of importedItems) tombstones.delete(`item:${item.id}`);
    for (const tombstone of data.tombstones || []) {
      if (tombstone?.entityType && tombstone.entityId) {
        const normalized = {
          ...tombstone,
          key: tombstone.key || `${tombstone.entityType}:${tombstone.entityId}`,
          deletedAt: importedAt
        };
        tombstones.set(normalized.key, normalized);
      }
    }

    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.GROUPS, STORES.ITEMS, STORES.TOMBSTONES], 'readwrite');
      const groupStore = tx.objectStore(STORES.GROUPS);
      const itemStore = tx.objectStore(STORES.ITEMS);
      const tombstoneStore = tx.objectStore(STORES.TOMBSTONES);

      // Clear existing data
      groupStore.clear();
      itemStore.clear();
      tombstoneStore.clear();

      // Import groups
      for (const group of importedGroups) {
        groupStore.put(group);
      }

      // Import items
      for (const item of importedItems) {
        itemStore.put(item);
      }
      for (const tombstone of tombstones.values()) {
        tombstoneStore.put(tombstone);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /** Merge local and remote records. Tombstones propagate deletions safely. */
  async mergeAll(remoteData) {
    const localGroups = await this._getAll(STORES.GROUPS);
    const localItems  = await this._getAll(STORES.ITEMS);
    const localTombstones = await this.getAllTombstones();
    const merged = mergeSyncData(
      { groups: localGroups, items: localItems, tombstones: localTombstones },
      remoteData
    );

    // ── Write merged data ────────────────────────────────────
    const db = await this._getDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.GROUPS, STORES.ITEMS, STORES.TOMBSTONES], 'readwrite');
      const groupStore = tx.objectStore(STORES.GROUPS);
      const itemStore  = tx.objectStore(STORES.ITEMS);
      const tombstoneStore = tx.objectStore(STORES.TOMBSTONES);

      // Clear and re-insert (atomic swap)
      groupStore.clear();
      itemStore.clear();
      tombstoneStore.clear();

      for (const group of merged.groups) {
        groupStore.put(group);
      }
      for (const item of merged.items) {
        itemStore.put(item);
      }
      for (const tombstone of merged.tombstones) {
        tombstoneStore.put(tombstone);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });

    return {
      localOnlyCount: merged.localOnlyCount,
      remoteOnlyCount: merged.remoteOnlyCount,
      updatedCount: merged.updatedCount
    };
  }

  /** Delete all data */
  async clearAll() {
    const groups = await this._getAll(STORES.GROUPS);
    const items = await this._getAll(STORES.ITEMS);
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.GROUPS, STORES.ITEMS, STORES.TOMBSTONES], 'readwrite');
      const tombstoneStore = tx.objectStore(STORES.TOMBSTONES);
      const deletedAt = Date.now();

      tx.objectStore(STORES.GROUPS).clear();
      tx.objectStore(STORES.ITEMS).clear();
      for (const group of groups) {
        tombstoneStore.put(createTombstone('group', group.id, deletedAt));
      }
      for (const item of items) {
        tombstoneStore.put(createTombstone('item', item.id, deletedAt));
      }

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }
}

// Export singleton
export const db = new TabelDB();
export { STORES };
