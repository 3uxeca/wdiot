# Open Questions

## WDIOT v1 - 2026-05-20

### Resolved (rev 2)
- [x] Loopback ingest port — fixed `47615` vs dynamic with discovery file? — **RESOLVED: dynamic port.** Daemon binds `127.0.0.1:0`, writes `{ port, token }` to `~/Library/Application Support/wdiot/ingest.json` (mode 0600). Extension reads discovery file.
- [x] API key storage — `electron-store` JSON vs macOS Keychain? — **RESOLVED: macOS Keychain.** Wraps the `security` CLI in `config/keychain.ts`. `electron-store` for non-secret settings only.

### Open
- [ ] Active-app capture: built-in `osascript` (System Events) vs a native module (`active-win` / `node-mac-permissions`)? — Decide in Work Unit B; native gives richer NSWorkspace data but adds a native-rebuild dependency. Plan defaults to `osascript`.
- [ ] LLM model defaults — which exact Claude/GPT model IDs and token budget for the digest? — Needs a concrete pick before Work Unit D; affects cost and the event cap in `compressor.ts`.
- [ ] App distribution — codesigning/notarization for personal use, or run unsigned locally? — Affects `electron-builder` config; unsigned local assumed for v1.
- [ ] Browser polling cadence (5 s vs 10 s) and active-app cadence (1 s vs 2 s) — tune against jank/battery during Work Unit B.
