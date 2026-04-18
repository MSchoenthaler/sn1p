# sn1p-node (clean build)

- E2E (AES-GCM, PBKDF2) - password never leaves the browser.
- Tab labels are encrypted client-side too; the server only sees opaque tab IDs.
- File-only storage under `_storage/`.
- No file until first non-empty save; delete-on-empty when the last tab is cleared.
- Live updates via WebSockets (last-write-wins for content updates).
- Random doc redirect on `/`.
- Explorer-style tab list with rename on double-click or right-click.
- Password rotation re-encrypts all tabs and notifies peers with `rekey`.
