/**
 * IDE-context collector — public VSCode APIs ONLY.
 *
 * Acceptance Criterion #10: this module must NEVER touch Cursor AI chat,
 * Copilot, or `inlineChat` APIs. It reads only:
 *  - `workspace.workspaceFolders`  — the active workspace root
 *  - `window.activeTextEditor`     — the focused file + cursor/selection
 *  - `workspace.textDocuments`     — recently opened documents
 *  - a `git diff --quiet` boolean  — whether the workspace has uncommitted changes
 *
 * The output mirrors `FileEditActivity['payload']` from the shared contract
 * (duplicated structurally here — see `reporter.ts` for the ESM/CJS rationale).
 */
import { exec } from 'node:child_process';
import * as vscode from 'vscode';

/**
 * IDE-context snapshot — structurally identical to the shared
 * `FileEditActivity['payload']`. The `IngestRequest.payload` field on the
 * daemon validates this shape with zod, so the daemon remains the source of
 * truth for the contract.
 */
export interface FileEditPayload {
  workspacePath: string;
  filePath: string;
  recentFiles?: string[];
  cursorLine?: number;
  selectionText?: string;
  hasGitDiff: boolean;
}

/** Max characters of selection text reported (keeps payloads small). */
const MAX_SELECTION_CHARS = 500;

/** Max number of recent files reported. */
const MAX_RECENT_FILES = 10;

/** Timeout for the `git diff --quiet` probe. */
const GIT_DIFF_TIMEOUT_MS = 2000;

/**
 * Resolve the workspace folder containing `uri`, falling back to the first
 * workspace folder. Returns `undefined` when there is no workspace.
 */
function workspacePathFor(uri: vscode.Uri | undefined): string | undefined {
  if (uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder) return folder.uri.fsPath;
  }
  const firstFolder = vscode.workspace.workspaceFolders?.[0];
  return firstFolder ? firstFolder.uri.fsPath : undefined;
}

/**
 * Recently opened on-disk documents, most-recent-irrelevant order (VSCode does
 * not expose MRU ordering publicly). Filters out untitled / non-file schemes.
 */
function recentFiles(activeFilePath: string | undefined): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme !== 'file' || doc.isUntitled) continue;
    const fsPath = doc.uri.fsPath;
    if (fsPath === activeFilePath || seen.has(fsPath)) continue;
    seen.add(fsPath);
    files.push(fsPath);
    if (files.length >= MAX_RECENT_FILES) break;
  }
  return files;
}

/**
 * Run `git diff --quiet` in `cwd`. Resolves `true` when there are uncommitted
 * changes, `false` otherwise (no diff, not a repo, git missing, or timeout).
 * `git diff --quiet` exits 1 when a diff exists, 0 when clean.
 */
function hasGitDiff(cwd: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    exec(
      'git diff --quiet',
      { cwd, timeout: GIT_DIFF_TIMEOUT_MS },
      (error) => {
        // exit 1 -> diff present; exit 0 (no error) -> clean.
        // Any other failure (not a repo, git missing) -> treat as no diff.
        const code = (error as { code?: number } | null)?.code;
        resolve(code === 1);
      },
    );
  });
}

/**
 * Collect a `FileEditPayload` from the current editor state. Returns
 * `undefined` when there is no active file or no workspace — the reporter
 * skips sending in that case.
 */
export async function collectFileEdit(): Promise<FileEditPayload | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;

  const doc = editor.document;
  if (doc.uri.scheme !== 'file') return undefined;

  const filePath = doc.uri.fsPath;
  const workspacePath = workspacePathFor(doc.uri);
  if (!workspacePath) return undefined;

  const selection = editor.selection;
  const cursorLine = selection.active.line;
  const selectedText = doc.getText(selection);
  const selectionText =
    selectedText.length > 0
      ? selectedText.slice(0, MAX_SELECTION_CHARS)
      : undefined;

  const diff = await hasGitDiff(workspacePath);

  return {
    workspacePath,
    filePath,
    recentFiles: recentFiles(filePath),
    cursorLine,
    selectionText,
    hasGitDiff: diff,
  };
}
