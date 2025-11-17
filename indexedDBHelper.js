/* FlowFixer IndexedDB Helper */
/* Clean and organized database structure for storing message payloads and cache */

const DB_NAME = 'FlowFixerDB';
const DB_VERSION = 2; // Incremented for new store

// Object Store Names
const STORES = {
  PAYLOADS: 'messagePayloads',      // Store message payloads by iFlow
  CACHE: 'cache',                    // Store cached data
  CREDENTIALS: 'credentials',        // Store user credentials
  METADATA: 'metadata',              // Store metadata like timestamps
  RESENT_HISTORY: 'resentHistory'    // Store permanently resent message IDs
};

class FlowFixerDB {
  constructor() {
    this.db = null;
  }

  /**
   * Initialize the database
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('IndexedDB error:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('✓ FlowFixer IndexedDB initialized');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        console.log('Creating IndexedDB object stores...');

        // Create messagePayloads store (keyed by iFlowName)
        if (!db.objectStoreNames.contains(STORES.PAYLOADS)) {
          const payloadsStore = db.createObjectStore(STORES.PAYLOADS, { keyPath: 'iFlowName' });
          payloadsStore.createIndex('timestamp', 'timestamp', { unique: false });
          console.log('✓ Created messagePayloads store');
        }

        // Create cache store (keyed by cacheKey)
        if (!db.objectStoreNames.contains(STORES.CACHE)) {
          const cacheStore = db.createObjectStore(STORES.CACHE, { keyPath: 'key' });
          cacheStore.createIndex('timestamp', 'timestamp', { unique: false });
          console.log('✓ Created cache store');
        }

        // Create credentials store (keyed by credentialType)
        if (!db.objectStoreNames.contains(STORES.CREDENTIALS)) {
          db.createObjectStore(STORES.CREDENTIALS, { keyPath: 'type' });
          console.log('✓ Created credentials store');
        }

        // Create metadata store (keyed by metaKey)
        if (!db.objectStoreNames.contains(STORES.METADATA)) {
          db.createObjectStore(STORES.METADATA, { keyPath: 'key' });
          console.log('✓ Created metadata store');
        }

        // Create resent history store (keyed by messageGuid)
        if (!db.objectStoreNames.contains(STORES.RESENT_HISTORY)) {
          const resentStore = db.createObjectStore(STORES.RESENT_HISTORY, { keyPath: 'messageGuid' });
          resentStore.createIndex('resentAt', 'resentAt', { unique: false });
          resentStore.createIndex('iFlowName', 'iFlowName', { unique: false });
          console.log('✓ Created resentHistory store');
        }
      };
    });
  }

  /**
   * Ensure database is initialized
   */
  async ensureDB() {
    if (!this.db) {
      await this.init();
    }
    return this.db;
  }

  // ============ PAYLOAD OPERATIONS ============

  /**
   * Save payloads for a specific iFlow
   */
  async savePayloads(iFlowName, messages) {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.PAYLOADS], 'readwrite');
      const store = transaction.objectStore(STORES.PAYLOADS);

      const data = {
        iFlowName: iFlowName,
        messages: messages,
        timestamp: Date.now()
      };

      const request = store.put(data);

      request.onsuccess = () => {
        console.log(`✓ Saved ${messages.length} payloads for iFlow: ${iFlowName}`);
        resolve();
      };

      request.onerror = () => {
        console.error('Error saving payloads:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Get payloads for a specific iFlow
   */
  async getPayloads(iFlowName) {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.PAYLOADS], 'readonly');
      const store = transaction.objectStore(STORES.PAYLOADS);
      const request = store.get(iFlowName);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.messages : []);
      };

      request.onerror = () => {
        console.error('Error getting payloads:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Get all payloads (all iFlows)
   */
  async getAllPayloads() {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.PAYLOADS], 'readonly');
      const store = transaction.objectStore(STORES.PAYLOADS);
      const request = store.getAll();

      request.onsuccess = () => {
        const results = request.result || [];
        const payloadsMap = {};
        results.forEach(item => {
          payloadsMap[item.iFlowName] = item.messages;
        });
        resolve(payloadsMap);
      };

      request.onerror = () => {
        console.error('Error getting all payloads:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Delete specific messages from an iFlow
   */
  async deleteMessages(iFlowName, messageGuids) {
    await this.ensureDB();
    const messages = await this.getPayloads(iFlowName);
    const remainingMessages = messages.filter(m => !messageGuids.includes(m.messageGuid));
    
    if (remainingMessages.length > 0) {
      await this.savePayloads(iFlowName, remainingMessages);
    } else {
      // If no messages left, delete the entire iFlow entry
      await this.deletePayloads(iFlowName);
    }
    
    console.log(`✓ Deleted ${messageGuids.length} messages from ${iFlowName}`);
  }

  /**
   * Delete all payloads for a specific iFlow
   */
  async deletePayloads(iFlowName) {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.PAYLOADS], 'readwrite');
      const store = transaction.objectStore(STORES.PAYLOADS);
      const request = store.delete(iFlowName);

      request.onsuccess = () => {
        console.log(`✓ Deleted all payloads for iFlow: ${iFlowName}`);
        resolve();
      };

      request.onerror = () => {
        console.error('Error deleting payloads:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Clear all payloads
   */
  async clearAllPayloads() {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.PAYLOADS], 'readwrite');
      const store = transaction.objectStore(STORES.PAYLOADS);
      const request = store.clear();

      request.onsuccess = () => {
        console.log('✓ Cleared all payloads');
        resolve();
      };

      request.onerror = () => {
        console.error('Error clearing payloads:', request.error);
        reject(request.error);
      };
    });
  }

  // ============ CACHE OPERATIONS ============

  /**
   * Save cache data
   */
  async saveCache(key, data) {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.CACHE], 'readwrite');
      const store = transaction.objectStore(STORES.CACHE);

      const cacheData = {
        key: key,
        data: data,
        timestamp: Date.now()
      };

      const request = store.put(cacheData);

      request.onsuccess = () => {
        console.log(`✓ Cached data for key: ${key}`);
        resolve();
      };

      request.onerror = () => {
        console.error('Error saving cache:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Get cache data
   */
  async getCache(key) {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.CACHE], 'readonly');
      const store = transaction.objectStore(STORES.CACHE);
      const request = store.get(key);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result || null);
      };

      request.onerror = () => {
        console.error('Error getting cache:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Delete cache data
   */
  async deleteCache(key) {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.CACHE], 'readwrite');
      const store = transaction.objectStore(STORES.CACHE);
      const request = store.delete(key);

      request.onsuccess = () => {
        console.log(`✓ Deleted cache for key: ${key}`);
        resolve();
      };

      request.onerror = () => {
        console.error('Error deleting cache:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Clear all cache
   */
  async clearCache() {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.CACHE], 'readwrite');
      const store = transaction.objectStore(STORES.CACHE);
      const request = store.clear();

      request.onsuccess = () => {
        console.log('✓ Cleared all cache');
        resolve();
      };

      request.onerror = () => {
        console.error('Error clearing cache:', request.error);
        reject(request.error);
      };
    });
  }

  // ============ CREDENTIALS OPERATIONS ============

  /**
   * Save credentials
   */
  async saveCredentials(type, credentials) {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.CREDENTIALS], 'readwrite');
      const store = transaction.objectStore(STORES.CREDENTIALS);

      const data = {
        type: type,
        ...credentials,
        timestamp: Date.now()
      };

      const request = store.put(data);

      request.onsuccess = () => {
        console.log(`✓ Saved credentials for type: ${type}`);
        resolve();
      };

      request.onerror = () => {
        console.error('Error saving credentials:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Get credentials
   */
  async getCredentials(type) {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.CREDENTIALS], 'readonly');
      const store = transaction.objectStore(STORES.CREDENTIALS);
      const request = store.get(type);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result || null);
      };

      request.onerror = () => {
        console.error('Error getting credentials:', request.error);
        reject(request.error);
      };
    });
  }

  // ============ METADATA OPERATIONS ============

  /**
   * Save metadata
   */
  async saveMetadata(key, value) {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.METADATA], 'readwrite');
      const store = transaction.objectStore(STORES.METADATA);

      const data = {
        key: key,
        value: value,
        timestamp: Date.now()
      };

      const request = store.put(data);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        console.error('Error saving metadata:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Get metadata
   */
  async getMetadata(key) {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.METADATA], 'readonly');
      const store = transaction.objectStore(STORES.METADATA);
      const request = store.get(key);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.value : null);
      };

      request.onerror = () => {
        console.error('Error getting metadata:', request.error);
        reject(request.error);
      };
    });
  }

  // ============ RESENT HISTORY OPERATIONS ============

  /**
   * Add message to resent history (permanent record)
   */
  async addToResentHistory(messageGuid, iFlowName) {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.RESENT_HISTORY], 'readwrite');
      const store = transaction.objectStore(STORES.RESENT_HISTORY);

      const record = {
        messageGuid: messageGuid,
        iFlowName: iFlowName,
        resentAt: Date.now()
      };

      const request = store.put(record);

      request.onsuccess = () => {
        console.log(`✓ Added message ${messageGuid} to resent history`);
        resolve();
      };

      request.onerror = () => {
        console.error('Error adding to resent history:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Add multiple messages to resent history
   */
  async addMultipleToResentHistory(messageGuids, iFlowName) {
    await this.ensureDB();
    const promises = messageGuids.map(guid => this.addToResentHistory(guid, iFlowName));
    await Promise.all(promises);
    console.log(`✓ Added ${messageGuids.length} messages to resent history`);
  }

  /**
   * Check if message was resent
   */
  async wasMessageResent(messageGuid) {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.RESENT_HISTORY], 'readonly');
      const store = transaction.objectStore(STORES.RESENT_HISTORY);
      const request = store.get(messageGuid);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        console.error('Error checking resent history:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Get all resent messages for an iFlow
   */
  async getResentMessagesForIFlow(iFlowName) {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.RESENT_HISTORY], 'readonly');
      const store = transaction.objectStore(STORES.RESENT_HISTORY);
      const index = store.index('iFlowName');
      const request = index.getAll(iFlowName);

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        console.error('Error getting resent messages:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Get all resent message GUIDs (for quick lookup)
   */
  async getAllResentMessageGuids() {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.RESENT_HISTORY], 'readonly');
      const store = transaction.objectStore(STORES.RESENT_HISTORY);
      const request = store.getAllKeys();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        console.error('Error getting resent message GUIDs:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Clear resent history (optional - for maintenance)
   */
  async clearResentHistory() {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.RESENT_HISTORY], 'readwrite');
      const store = transaction.objectStore(STORES.RESENT_HISTORY);
      const request = store.clear();

      request.onsuccess = () => {
        console.log('✓ Cleared resent history');
        resolve();
      };

      request.onerror = () => {
        console.error('Error clearing resent history:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Export resent history to JSON (for shift handover)
   */
  async exportResentHistory() {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORES.RESENT_HISTORY], 'readonly');
      const store = transaction.objectStore(STORES.RESENT_HISTORY);
      const request = store.getAll();

      request.onsuccess = () => {
        const data = request.result || [];
        const exportData = {
          version: 1,
          exportedAt: Date.now(),
          exportedBy: 'FlowFixer',
          totalRecords: data.length,
          records: data
        };
        console.log(`✓ Exported ${data.length} resent history records`);
        resolve(exportData);
      };

      request.onerror = () => {
        console.error('Error exporting resent history:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Import resent history from JSON (for shift handover)
   * Automatically handles duplicates - updates existing records with same messageGuid
   */
  async importResentHistory(importData, mode = 'merge') {
    await this.ensureDB();
    
    // Validate import data
    if (!importData || !importData.records || !Array.isArray(importData.records)) {
      throw new Error('Invalid import data format');
    }

    return new Promise(async (resolve, reject) => {
      try {
        // Get existing records for duplicate detection
        const existingGuids = mode === 'merge' ? await this.getAllResentMessageGuids() : [];
        const existingGuidsSet = new Set(existingGuids);
        
        const transaction = this.db.transaction([STORES.RESENT_HISTORY], 'readwrite');
        const store = transaction.objectStore(STORES.RESENT_HISTORY);

        // If mode is 'replace', clear existing data first
        if (mode === 'replace') {
          await new Promise((res, rej) => {
            const clearRequest = store.clear();
            clearRequest.onsuccess = () => res();
            clearRequest.onerror = () => rej(clearRequest.error);
          });
          console.log('✓ Cleared existing resent history for REPLACE mode');
        }

        // Import records with duplicate tracking
        let imported = 0;
        let updated = 0;
        let skipped = 0;

        for (const record of importData.records) {
          // Validate record structure
          if (record.messageGuid && record.iFlowName && record.resentAt) {
            // Check if this is an update or new record
            const isUpdate = existingGuidsSet.has(record.messageGuid);
            
            const putRequest = store.put(record); // put() automatically handles duplicates
            await new Promise((res, rej) => {
              putRequest.onsuccess = () => {
                if (isUpdate) {
                  updated++;
                  console.log(`  ↻ Updated: ${record.messageGuid}`);
                } else {
                  imported++;
                  console.log(`  ✓ Added: ${record.messageGuid}`);
                }
                res();
              };
              putRequest.onerror = () => {
                skipped++;
                console.log(`  ✗ Skipped: ${record.messageGuid} (error)`);
                res(); // Continue even if one fails
              };
            });
          } else {
            skipped++;
            console.log(`  ✗ Skipped: Invalid record structure`);
          }
        }

        const summary = {
          imported: imported,      // New records added
          updated: updated,        // Existing records updated (duplicates)
          skipped: skipped,        // Invalid or failed records
          total: importData.records.length,
          mode: mode
        };
        
        console.log(`✓ Import complete: ${imported} new, ${updated} updated, ${skipped} skipped`);
        resolve(summary);

      } catch (error) {
        console.error('Error importing resent history:', error);
        reject(error);
      }
    });
  }

  // ============ UTILITY OPERATIONS ============

  /**
   * Get database size estimate
   */
  async getStorageEstimate() {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage,
        quota: estimate.quota,
        usageInMB: (estimate.usage / (1024 * 1024)).toFixed(2),
        quotaInMB: (estimate.quota / (1024 * 1024)).toFixed(2),
        percentUsed: ((estimate.usage / estimate.quota) * 100).toFixed(2)
      };
    }
    return null;
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('✓ FlowFixer IndexedDB closed');
    }
  }
}

// Create singleton instance
const flowFixerDB = new FlowFixerDB();

// Initialize on load
flowFixerDB.init().catch(err => {
  console.error('Failed to initialize FlowFixer IndexedDB:', err);
});
