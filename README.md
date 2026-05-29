# WDIOT — 왜켰더라 ("Why Did I Open This")

macOS personal work-context restoration agent. A menu-bar daemon passively
records your activity timeline into local SQLite; a global hotkey assembles the
last ~30 minutes, asks a cloud LLM to reconstruct your intent, and renders a
one-line inferred intent, minimal evidence, and executable resume actions.

## Monorepo layout

| Package | Description |
|---------|-------------|
| `packages/shared` (`@wdiot/shared`) | Types + zod schemas for every cross-process contract. |
| `packages/daemon` (`@wdiot/daemon`) | Electron menu-bar daemon: capture, storage, LLM, palette. |
| `packages/ide-extension` (`wdiot-ide-extension`) | Cursor/VSCode extension reporting IDE context. |

## Scripts

```sh
npm install       # install all workspaces
npm run build     # build shared -> daemon -> ide-extension
npm test          # run vitest suites
npm run dev       # run the daemon via electron-vite
npm run lint      # eslint
npm run format    # prettier --write
```

## Status

Work Unit A (monorepo scaffold + shared contracts + storage layer) is complete.
Work Units B-F (capture, ingest, context assembly, LLM, palette UI, E2E) follow.
