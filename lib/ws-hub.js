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
