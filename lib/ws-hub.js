const channels = new Map();

export function joinChannel(doc, ws) {
  if (!channels.has(doc)) channels.set(doc, new Set());
  channels.get(doc).add(ws);
  ws._doc = doc;
}

export function leaveChannel(ws) {
  const doc = ws._doc;
  if (!doc) return;
  const set = channels.get(doc);
  if (set) {
    set.delete(ws);
    if (set.size === 0) channels.delete(doc);
  }
  ws._doc = null;
}

export function resetChannel(doc, options = {}) {
  const set = channels.get(doc);
  if (!set) return;

  const {
    close = false,
    code = 1012,
    reason = "Document reset"
  } = options;

  for (const ws of [...set]) {
    set.delete(ws);
    ws._doc = null;
    ws._authorized = false;
    ws._pendingCreate = false;
    ws._pendingAuth = null;
    if (close && ws.readyState === 1) {
      try {
        ws.close(code, reason);
      } catch {
        // ignore close errors
      }
    }
  }

  channels.delete(doc);
}

export function broadcast(doc, message, except) {
  const set = channels.get(doc);
  if (!set) return;
  const str = JSON.stringify(message);
  for (const client of set) {
    if (client !== except && client.readyState === 1) {
      client.send(str);
    }
  }
}

export function sendWs(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}
