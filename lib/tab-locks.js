import { randomUUID } from "crypto";

// Call these methods inside withDocLock so ownership and writes are atomic.
export function createTabLocks() {
  const documents = new Map();
  return {
    acquire(name, tabId, ws) {
      let tabs = documents.get(name);
      if (!tabs) documents.set(name, tabs = new Map());
      const current = tabs.get(tabId);
      if (current && current.ws !== ws) return null;
      if (current) return current.token;
      const token = randomUUID();
      tabs.set(tabId, { ws, token });
      return token;
    },
    owns(name, tabId, ws, token) {
      const lock = documents.get(name)?.get(tabId);
      return !!lock && lock.ws === ws && lock.token === token;
    },
    release(name, tabId, ws, token) {
      if (!this.owns(name, tabId, ws, token)) return false;
      const tabs = documents.get(name);
      tabs.delete(tabId);
      if (!tabs.size) documents.delete(name);
      return true;
    },
    releaseAll(name, ws) {
      const released = [];
      for (const [tabId, lock] of documents.get(name) || []) {
        if (lock.ws === ws && this.release(name, tabId, ws, lock.token)) released.push(tabId);
      }
      return released;
    },
    list(name) {
      return [...(documents.get(name)?.keys() || [])];
    },
    hasOtherOwner(name, ws) {
      return [...(documents.get(name)?.values() || [])].some((lock) => lock.ws !== ws);
    }
  };
}
