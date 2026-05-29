/**
 * WDIOT IDE extension — Cursor/VSCode compatible.
 *
 * Work Unit C: registers public-API editor listeners (active editor change,
 * document save/change, workspace change), collects an IDE-context snapshot
 * via `collector.ts`, and reports it to the daemon's loopback ingest server
 * via the debounced, offline-safe `reporter.ts`.
 *
 * The extension NEVER reads Cursor AI chat — see `collector.ts` (AC #10).
 */
import * as vscode from 'vscode';
import { collectFileEdit } from './collector.js';
import { Reporter } from './reporter.js';

/** The single reporter instance for the extension lifetime. */
let reporter: Reporter | undefined;

/**
 * Collect the current IDE context and hand it to the reporter. Silently does
 * nothing when there is no active file / workspace, or when collection fails —
 * the editor must never be disrupted by WDIOT.
 */
async function captureAndReport(): Promise<void> {
  if (!reporter) return;
  try {
    const payload = await collectFileEdit();
    if (payload) reporter.report(payload);
  } catch (err) {
    // Never surface collection errors to the user.
    console.error('[wdiot] capture failed:', err);
  }
}

/** Called by the editor when the extension activates (`onStartupFinished`). */
export function activate(context: vscode.ExtensionContext): void {
  reporter = new Reporter();

  const showStatus = vscode.commands.registerCommand('wdiot.showStatus', () => {
    void vscode.window.showInformationMessage('WDIOT: IDE 활동을 데몬에 보고 중입니다.');
  });

  // Active editor changed — the user switched to a different file.
  const onEditorChange = vscode.window.onDidChangeActiveTextEditor(() => {
    void captureAndReport();
  });

  // Document saved — a strong signal of meaningful work.
  const onSave = vscode.workspace.onDidSaveTextDocument(() => {
    void captureAndReport();
  });

  // Document edited — debounced inside the reporter, so a per-keystroke
  // event here is fine; the reporter collapses bursts into one POST.
  const onChange = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document === vscode.window.activeTextEditor?.document) {
      void captureAndReport();
    }
  });

  // Workspace folders added/removed.
  const onWorkspaceChange = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    void captureAndReport();
  });

  context.subscriptions.push(
    showStatus,
    onEditorChange,
    onSave,
    onChange,
    onWorkspaceChange,
  );

  // Report the initial editor state on activation.
  void captureAndReport();
}

/** Called by the editor when the extension is deactivated. */
export function deactivate(): void {
  reporter?.dispose();
  reporter = undefined;
}
