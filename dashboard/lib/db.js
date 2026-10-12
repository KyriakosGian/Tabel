/**
 * Tabel - IndexedDB Wrapper
 * Manages all local storage operations for tab groups and items.
 * Uses IndexedDB for high-performance storage of potentially millions of records.
 */

import { createTombstone, mergeSyncData } from './merge.js';
import { sanitizeGroupRecord, sanitizeTabRecord, sanitizeTombstoneRecord } from './recordSanitizer.js';
import { validateData } from './validateData.js';

const DB_NAME = 'TabelDB';
const DB_VERSION = 5;

const STORES = {
  GROUPS: 'tabGroups',
  ITEMS: 'tabItems',
  TOMBSTONES: 'tombstones',
  BACKUPS: 'backups'
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

        if (!db.objectStoreNames.contains(STORES.BACKUPS)) {
          db.createObjectStore(STORES.BACKUPS, { keyPath: 'id' });
        }

        // Remove the deprecated thumbnails store from older (v1) installs.
        if (db.objectStoreNames.contains('thumbnails')) {
          db.deleteObjectStore('thumbnails');
        }

        // Version 4 stops storing remote favicon URLs. Existing records are
        // migrated in place so legacy favicon data also leaves IndexedDB.
        if (event.oldVersion < 5) {
          for (const [name, sanitize] of [[STORES.GROUPS, sanitizeGroupRecord], [STORES.ITEMS, sanitizeTabRecord], [STORES.TOMBSTONES, sanitizeTombstoneRecord]]) {
            const cursorRequest = event.target.transaction.objectStore(name).openCursor();
            cursorRequest.onsuccess = () => {
              const cursor = cursorRequest.result;
              if (!cursor) return;
              cursor.update(sanitize(cursor.value));
              cursor.continue();
            };
          }
        }
      };

      request.onsuccess = (event) => {
        const database = event.target.result;
        this._db = database;
        database.onversionchange = () => {
          database.close();
          if (this._db === database) {
            this._db = null;
            this._ready = null;
          }
        };
        resolve(this._db);
      };
      request.onblocked = () => reject(new Error('Close other Tabel pages to finish the database upgrade.'));

      request.onerror = (event) => {
        console.error('[TabelDB] Failed to open database:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /** Ensure the DB is ready before any operation */
  async _getDB() {
    if (!this._db) {
      this._ready ||= this._init();
      try { await this._ready; } catch (error) { this._ready = null; throw error; }
    }
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
    const storedData = storeName === STORES.ITEMS
      ? sanitizeTabRecord(data)
      : data;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put(storedData);

      tx.oncomplete = () => resolve(storedData);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  // ─── Group Operations ──────────────────────────────────────

  /** Read, transform and commit together, including across open dashboards. */
  async _editSnapshot(transform, mode = 'readwrite') {
    const database = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(Object.values(STORES), mode);
      let result;
      let failure;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure || tx.error || new Error('Transaction aborted'));
      tx.onerror = () => { failure ||= tx.error; };
      const definitions = [
        ['groups', STORES.GROUPS],
        ['items', STORES.ITEMS],
        ['tombstones', STORES.TOMBSTONES]
      ];
      const snapshot = {};
      let remaining = definitions.length;
      for (const [field, name] of definitions) {
        const request = tx.objectStore(name).getAll();
        request.onsuccess = () => {
          snapshot[field] = request.result;
          if (--remaining) return;
          try {
            // The callback is synchronous so the transaction stays active.
            const edited = transform(snapshot);
            result = edited.result;
            if (mode === 'readonly') return;
            for (const [key, storeName] of definitions) {
              const store = tx.objectStore(storeName);
              store.clear();
              for (const record of edited.data[key]) {
                const sanitize = key === 'items' ? sanitizeTabRecord : key === 'groups' ? sanitizeGroupRecord : sanitizeTombstoneRecord;
                store.put(sanitize(record));
              }
            }
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
      }
    });
  }

  /** Create a new tab group */
  async createGroup(name, tabs = [], options = {}) {
    return this._editSnapshot(data => {
      const allGroups = data.groups;
      if (options.sourceSweepId) {
        const existing = allGroups.find(group => group.sourceSweepId === options.sourceSweepId);
        if (existing) return { data, result: existing };
      }

      const uniqueTabs = this._dedupeTabsByUrl(tabs);
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
        tabCount: uniqueTabs.length,
        width: [33, 50, 100].includes(Number(options.width))
          ? Number(options.width)
          : 50,
        bgColor: '',
        ...(options.sourceSweepId ? { sourceSweepId: options.sourceSweepId } : {})
      };

      // New groups get order 0 (top), push existing groups down
      for (const existing of allGroups) {
        existing.order = existing.order + 1;
        existing.updatedAt = now;
      }
      group.order = 0;

      const previousItems = this._capturedItems(data, uniqueTabs);
      this._replaceCapturedUrls(data, uniqueTabs, groupId, now, previousItems);
      data.groups.push(group);
      data.items.push(...this._captureRecords(groupId, uniqueTabs, now, previousItems));
      return { data, result: group };
    });
  }

  _capturedItems(data, tabs) {
    const urls = new Set(tabs.map(tab => tab.url));
    const previous = new Map();
    for (const item of data.items) {
      if (!urls.has(item.url)) continue;
      const selected = previous.get(item.url);
      if (!selected || (item.updatedAt || 0) > (selected.updatedAt || 0) ||
          ((item.updatedAt || 0) === (selected.updatedAt || 0) && item.id > selected.id)) previous.set(item.url, item);
    }
    return previous;
  }

  _captureRecords(groupId, tabs, now, previous = new Map()) {
    return tabs.map((tab, index) => ({
      id: previous.get(tab.url)?.id || `tab_${now}_${index}_${Math.random().toString(36).slice(2, 8)}`,
      groupId, url: tab.url, title: tab.title || tab.url,
      order: index, createdAt: previous.get(tab.url)?.createdAt || now,
      updatedAt: Math.max(now, (previous.get(tab.url)?.updatedAt || 0) + 1)
    }));
  }

  _replaceCapturedUrls(data, tabs, preserveGroupId, now, previous = new Map()) {
    const urls = new Set(tabs.map(tab => tab.url));
    const affected = new Set();
    const tombstones = new Map(data.tombstones.map(record => [record.key, record]));
    let replacedCount = 0;
    data.items = data.items.filter(item => {
      if (!urls.has(item.url)) return true;
      affected.add(item.groupId);
      if (previous.get(item.url)?.id === item.id) {
        tombstones.delete(`item:${item.id}`);
      } else {
        const deletion = createTombstone('item', item.id, now);
        tombstones.set(deletion.key, deletion);
      }
      replacedCount++;
      return false;
    });
    data.groups = data.groups.filter(group => {
      if (!affected.has(group.id)) return true;
      group.tabCount = data.items.filter(item => item.groupId === group.id).length;
      group.updatedAt = now;
      if (group.tabCount || group.id === preserveGroupId) return true;
      const deletion = createTombstone('group', group.id, now);
      tombstones.set(deletion.key, deletion);
      return false;
    });
    data.tombstones = [...tombstones.values()];
    return replacedCount;
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

  _dedupeTabsByUrl(tabs) {
    const uniqueTabs = new Map();
    for (const tab of Array.isArray(tabs) ? tabs : []) {
      if (!tab?.url) continue;
      uniqueTabs.set(tab.url, tab);
    }
    return [...uniqueTabs.values()];
  }

  /**
   * Add new URLs to an existing unlocked group.
   * A new capture replaces older saved records with the same URL.
   */
  async addTabsToGroup(groupId, tabs = []) {
    return this._editSnapshot(data => {
      const group = data.groups.find(record => record.id === groupId);
      if (!group) throw new Error('Group not found');
      if (group.locked) throw new Error('Group is locked');

      const uniqueTabs = this._dedupeTabsByUrl(tabs);
      if (uniqueTabs.length === 0) {
        return { data, result: { addedCount: 0, replacedCount: 0 } };
      }

      const now = Date.now();
      const previousItems = this._capturedItems(data, uniqueTabs);
      const replacedCount = this._replaceCapturedUrls(data, uniqueTabs, groupId, now, previousItems);
      const currentTabs = data.items.filter(item => item.groupId === groupId)
        .sort((a, b) => a.order - b.order);
      currentTabs.forEach((tab, index) => {
        tab.order = uniqueTabs.length + index;
        tab.updatedAt = now;
      });
      data.items.push(...this._captureRecords(groupId, uniqueTabs, now, previousItems));
      group.tabCount = currentTabs.length + uniqueTabs.length;
      group.updatedAt = now;
      return {
        data,
        result: {
          addedCount: uniqueTabs.length,
          replacedCount
        }
      };
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

    const updated = sanitizeTabRecord({ ...tab, ...updates, updatedAt: Date.now() });
    return this._put(STORES.ITEMS, updated);
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

  /** Remove tombstones only after the sync layer confirms safe compaction. */
  async deleteTombstones(keys) {
    const uniqueKeys = [...new Set(keys)].filter(key => typeof key === 'string' && key);
    if (uniqueKeys.length === 0) return;

    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.TOMBSTONES, 'readwrite');
      const store = tx.objectStore(STORES.TOMBSTONES);
      for (const key of uniqueKeys) store.delete(key);

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /** Export all data */
  async exportAll() {
    return this._editSnapshot(({ groups, items, tombstones }) => ({ result: {
      version: DB_VERSION,
      exportedAt: Date.now(),
      groups: groups.map(sanitizeGroupRecord),
      items: items.map(sanitizeTabRecord),
      tombstones: tombstones.map(sanitizeTombstoneRecord)
    } }), 'readonly');
  }

  /** Import data (full overwrite — used for manual import/restore) */
  async importAll(data, options = {}) {
    validateData(data);
    return this._editSnapshot(current => {
      this._checkExpectedSnapshot(current, options.expectedCurrent);
      const currentGroups = current.groups;
      const currentItems = current.items;
      const currentTombstones = current.tombstones;
      const importedAt = Date.now();
      const importedGroups = data.groups.map(group => ({
        ...group,
        createdAt: group.createdAt || importedAt,
        updatedAt: importedAt
      }));
      const importedItems = data.items.map(item => sanitizeTabRecord({
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
          const incomingIds = tombstone.entityType === 'group' ? incomingGroupIds : incomingItemIds;
          if (incomingIds.has(tombstone.entityId)) continue;
          const normalized = {
            ...tombstone,
            key: tombstone.key || `${tombstone.entityType}:${tombstone.entityId}`,
            deletedAt: importedAt
          };
          tombstones.set(normalized.key, normalized);
        }
      }

      return { data: { groups: importedGroups, items: importedItems, tombstones: [...tombstones.values()] } };
    });
  }

  _checkExpectedSnapshot(current, expected) {
    if (!expected) return;
    const contents = data => JSON.stringify({
      groups: data.groups.map(sanitizeGroupRecord),
      items: data.items.map(sanitizeTabRecord),
      tombstones: (data.tombstones || []).map(sanitizeTombstoneRecord)
    });
    if (contents(current) !== contents(expected)) {
      throw new Error('Saved data changed. Please review the action again.');
    }
  }

  /** Exact replacement is reserved for confirmed cloud-generation recovery. */
  async replaceAll(data, options = {}) {
    validateData(data);
    return this._editSnapshot(current => {
      this._checkExpectedSnapshot(current, options.expectedCurrent);
      return { data: {
        groups: data.groups,
        items: data.items.map(sanitizeTabRecord),
        tombstones: data.tombstones || []
      } };
    });
  }

  async saveBackup(backup, { pinnedIds = [] } = {}) {
    const database = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORES.BACKUPS, 'readwrite');
      const store = tx.objectStore(STORES.BACKUPS);
      const request = store.getAll();
      request.onsuccess = () => {
        const storedBackup = {
          ...backup,
          createdAt: Math.max(backup.createdAt, ...request.result.map(record => record.createdAt + 1))
        };
        const pinned = new Set([...pinnedIds, backup.id]);
        const records = [...request.result, storedBackup]
          .sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)) ||
            b.createdAt - a.createdAt || b.id.localeCompare(a.id));
        let total = 0;
        const keep = new Set();
        for (const record of records) {
          // Keep the new verified checkpoint, at most five records and 50 MiB.
          if (keep.size < 5 && total + record.bytes <= 50 * 1024 * 1024) {
            keep.add(record.id);
            total += record.bytes;
          }
        }
        if (records.some(record => pinned.has(record.id) && !keep.has(record.id))) { tx.abort(); return; }
        store.put(storedBackup);
        for (const record of request.result) {
          if (!keep.has(record.id)) store.delete(record.id);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('Backup storage failed'));
      tx.onerror = () => reject(tx.error);
    });
  }

  async getBackup(id) { return this._get(STORES.BACKUPS, id); }
  async getBackups() { return this._getAll(STORES.BACKUPS); }

  async clearBackups() {
    const database = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORES.BACKUPS, 'readwrite');
      tx.objectStore(STORES.BACKUPS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Backup cleanup failed'));
    });
  }

  /** Merge local and remote records. Tombstones propagate deletions safely. */
  async mergeAll(remoteData) {
    validateData(remoteData);
    return this._editSnapshot(local => {
      const merged = mergeSyncData(
        { ...local, items: local.items.map(sanitizeTabRecord) },
        {
          ...remoteData,
          items: Array.isArray(remoteData?.items)
            ? remoteData.items.map(sanitizeTabRecord)
            : remoteData?.items
        }
      );

      return { data: merged, result: {
        localOnlyCount: merged.localOnlyCount,
        remoteOnlyCount: merged.remoteOnlyCount,
        updatedCount: merged.updatedCount
      } };
    });
  }

  /** Delete all data */
  async clearAll(options = {}) {
    return this._editSnapshot(current => {
      this._checkExpectedSnapshot(current, options.expectedCurrent);
      const tombstones = new Map(current.tombstones.map(record => [record.key, record]));
      const deletedAt = Date.now();
      for (const group of current.groups) {
        const record = createTombstone('group', group.id, deletedAt);
        tombstones.set(record.key, record);
      }
      for (const item of current.items) {
        const record = createTombstone('item', item.id, deletedAt);
        tombstones.set(record.key, record);
      }
      return { data: { groups: [], items: [], tombstones: [...tombstones.values()] } };
    });
  }
}

// Export singleton
export const db = new TabelDB();
export { STORES };
