# sn1p

`sn1p` is a small end-to-end encrypted web notepad with tabbed notes, realtime sync, and file-backed storage.

The browser encrypts note content and tab labels before anything is sent to the server. The server stores encrypted JSON blobs under `_storage/` and coordinates sync over WebSockets, but it does not have the plaintext password or note contents.

## Features

- Client-side encryption with `AES-GCM`
- Password-based key derivation with `PBKDF2`
- Encrypted tab labels and encrypted tab content
- Explorer-style tab list
- Realtime sync across open clients
- Automatic exclusive editing per tab; other clients remain live readers
- Password rotation with full re-encryption
- File-only storage under `_storage/`
- Document-wide auth throttling and temporary lockout
- Gated document unlock flow before ciphertext is returned

## How It Works

Each document has a random URL such as:

```text
http://localhost:8080/21al623v2dhh
```

When a client opens a document:

1. The server returns only document metadata such as the KDF settings.
2. The browser derives a password-based auth proof locally.
3. The client calls the unlock endpoint with that proof.
4. If the proof is valid, the server returns the encrypted document.
5. The browser decrypts tab labels and note content locally.

The same password-derived proof is also required for WebSocket access to existing documents.

## Security Model

- The plaintext password does not leave the browser.
- Note content is encrypted client-side before save.
- Tab names are encrypted client-side too.
- The server sees document ids, opaque tab ids, timestamps, encrypted payloads, and password-derived auth hashes.
- Existing documents require a successful unlock before encrypted tabs are returned.
- Repeated failed auth attempts trigger document-wide throttling:
  - after 5 failures: small delay
  - after 10 failures in 10 minutes: 10 minute lock

### Important Limitations

- This is still a web app, so decrypted content exists in browser memory while a document is unlocked.
- If an attacker already has a copy of the encrypted document JSON, they can still attempt offline password guessing against that ciphertext.
- Editing locks are held by the server process. Run one server instance for a storage directory; separate server processes do not share locks.
- Unsaved edits remain in browser memory until acknowledged. Keep the window open while disconnected or while a save is pending.

### Concurrent Editing

Multiple clients can keep the same note open. The first client to type in an available tab acquires its editing lock; other clients see live updates in read-only mode. Opening, focusing, or selecting text in a reader does not claim editing ownership. Different tabs can be edited at the same time.

Changes sync in batches scheduled within 200 ms, including during continuous typing. After 1.5 seconds without input, the client finishes any pending save and automatically releases editing. Leaving the editor or switching tabs also releases it. There is no handoff button. Editing status appears in the footer without resizing the editor. A disconnected connection loses its locks; server heartbeats detect unresponsive connections in approximately 15-30 seconds.

Every save, rename, and deletion requires the current server-issued lock token. Password changes require ownership of every saved tab. Client clock differences do not decide whose content wins. After a disconnect or simultaneous lock attempt, any unsaved draft that cannot safely be applied is kept in a separate `(recovered)` tab.

Restart the server and reload all open clients when deploying this protocol change. Older clients cannot write without a lock token.

## Storage Behavior

Documents are stored as JSON files in `_storage/`.

Current behavior:

- A brand-new document may exist only in memory until the first save that should persist it.
- The first tab always exists and cannot be deleted.
- Empty tabs are preserved when the document itself should remain.
- Clearing the first tab preserves the encrypted document metadata, password, and tab identity so other open clients stay attached to the same note.

## Project Structure

```text
server.js
lib/
  doc-store.js
  doc-service.js
  ws-hub.js
routes/
  doc-routes.js
public/
  index.html
  app.js
  styles.css
_storage/
```

### Module Responsibilities

- `server.js`
  - App bootstrap
  - Express middleware
  - HTTP server and WebSocket server wiring

- `lib/doc-store.js`
  - File paths
  - Loading and writing document JSON
  - Per-document write locking
  - Storage directory setup

- `lib/doc-service.js`
  - Document auth and lockout rules
  - Unlock flow
  - Tab mutation rules
  - Rekey logic
  - WebSocket message handling

- `lib/ws-hub.js`
  - Channel membership
  - Broadcast helpers

- `routes/doc-routes.js`
  - HTTP routes
  - Metadata endpoint
  - Unlock endpoint
  - Root redirect and document page route

- `public/app.js`
  - Client-side crypto
  - Unlock flow
  - Tab UI
  - Realtime sync
  - Password rotation

## Running Locally

Install dependencies:

```bash
corepack enable
yarn install
```

Start the server:

```bash
yarn start
```

Then open:

```text
http://localhost:8080
```

The root route redirects to a new random document id.

Run the sync regression tests with `yarn test`. They exercise the real document service and encryption with in-process WebSocket and DOM test doubles; they do not require a listening network port.

## HTTP Endpoints

- `GET /`
  - Redirects to a new random document id

- `GET /api/doc/:doc`
  - Returns document metadata only

- `POST /api/doc/:doc/unlock`
  - Verifies the password-derived auth proof
  - Returns the encrypted document on success

- `GET /:doc`
  - Serves the app shell for a document URL

## WebSocket Behavior

WebSockets are used for:

- saving tab changes
- deleting tabs
- password rotation broadcasts
- realtime updates to other connected clients

For existing documents, WebSocket access requires the same password-derived auth proof used for unlock.

## Manual Unlock Reset

If a document is temporarily locked because of repeated failed attempts, you can clear it manually in the corresponding file under `_storage/`.

Clear these fields under `auth`:

- `failures`
- `lockUntil`
- optionally `lastFailedAt`

Example:

```json
"auth": {
  "tokenHash": "...",
  "failures": [],
  "lockUntil": null
}
```

## Notes

- The wrap mode toggle is a local browser preference and is remembered with `localStorage`.
- The editor focuses at the end after unlock and tab switches without inserting text into a shared note.
- The UI is intentionally file-free from the user perspective; import/export has been removed.
