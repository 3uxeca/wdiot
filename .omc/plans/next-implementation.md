# WDIOT Next Implementation Handoff

Last updated: 2026-06-10

## Current Verified State

- Local Electron dev startup works with `npm run dev`.
- Menu-bar `W` tray is visible and opens the Korean tray menu.
- Capture health shows app, Chrome, and Safari as normal after macOS permissions are granted.
- Timeline window renders recorded activities.
- `Cmd+Shift+W` opens the palette and renders phase-1 local evidence.
- Palettes can still show `의도를 분석하지 못했어요.` when no LLM API key is stored; that is the next product gap, not a renderer/preload failure.
- Verification before this handoff:
  - `npm test` passed, 143 tests.
  - `npm run build` passed.
  - `npm run lint` passed.

## Next Implementation Priority

### 1. API Key Setup Path

Problem: `config/keychain.ts` already supports `setApiKey`, `getApiKey`, and `deleteApiKey`, but there is no user-facing way to store a key. The palette reaches the LLM phase and then fails because `createRuntimeBackend().reconstructIntent()` cannot find an API key.

Recommended implementation:

- Add tray menu items for API key management:
  - `API 키 설정`
  - `API 키 삭제`
- Use a small Electron prompt/input window or a minimal settings window.
- Store the secret with `setApiKey()` only; do not put it in `electron-store`.
- Keep all user-facing labels and error messages Korean.
- Add tests around the IPC/backend boundary if a new IPC channel is introduced.

Acceptance check:

- Enter a valid provider API key.
- Press `Cmd+Shift+W`.
- Palette advances from local evidence to an LLM-generated Korean intent and action buttons.

### 2. Provider and Model Settings

Problem: non-secret settings already exist in `config/settings.ts`, but there is no UI to switch provider/model/window minutes/hotkey.

Recommended implementation:

- Add a settings surface reachable from tray `설정`.
- Support provider selection (`claude` / `openai`), optional model override, context window minutes, and hotkey text.
- Preserve defaults from `DEFAULT_SETTINGS`.
- Re-register the hotkey after hotkey setting changes.

### 3. IDE Extension E2E

Problem: VSIX packaging works, but extension install/report flow still needs manual E2E verification.

Recommended implementation/checklist:

- Run `npm run package --workspace wdiot-ide-extension`.
- Install the generated VSIX into Cursor/VSCode.
- Confirm it reads `~/Library/Application Support/wdiot/ingest.json`.
- Edit/save a file and verify `file_edit` rows appear in the timeline.
- Confirm no Cursor AI chat content is collected.

### 4. Polish Remaining Dev UX

- Consider making the menu-bar title `W` dev-only once a designed template icon exists.
- Keep renderer diagnostics for now; they caught preload failures quickly.
- Later, add a proper Content-Security-Policy to silence Electron's dev security warning before packaging.

## Known Runtime Notes

- `better-sqlite3` must be rebuilt for the active runtime:
  - `npm run dev` rebuilds for Electron.
  - `npm test` rebuilds for Node/Vitest.
- After running `npm test`, run `npm run dev` again before manual Electron testing so the Electron ABI binary is restored.
- In dev mode, macOS permissions apply to `Electron.app`, not a packaged `WDIOT.app`.
