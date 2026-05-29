/**
 * macOS Keychain wrapper for the LLM API key — plan "API Key Storage".
 *
 * Uses the system `security` CLI (`add-generic-password` /
 * `find-generic-password` / `delete-generic-password`). Electron apps on macOS
 * can access self-owned generic-password items without extra entitlements.
 * The API key NEVER touches the plaintext `electron-store` settings file.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Keychain service name under which the API key is stored. */
export const KEYCHAIN_SERVICE = 'co.soslab.wdiot';

/** Account name for the single stored LLM API key item. */
export const KEYCHAIN_ACCOUNT = 'llm-api-key';

/**
 * Store (or replace) the LLM API key in the Keychain. `-U` updates the item
 * in place if it already exists, so this is idempotent.
 */
export async function setApiKey(apiKey: string): Promise<void> {
  await execFileAsync('security', [
    'add-generic-password',
    '-U',
    '-s', KEYCHAIN_SERVICE,
    '-a', KEYCHAIN_ACCOUNT,
    '-w', apiKey,
  ]);
}

/**
 * Read the LLM API key from the Keychain. Returns `undefined` when no item
 * exists (`security` exits non-zero — "could not be found").
 */
export async function getApiKey(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password',
      '-s', KEYCHAIN_SERVICE,
      '-a', KEYCHAIN_ACCOUNT,
      '-w',
    ]);
    const key = stdout.trim();
    return key.length > 0 ? key : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Delete the stored LLM API key. Resolves `true` when an item was removed,
 * `false` when there was nothing to delete.
 */
export async function deleteApiKey(): Promise<boolean> {
  try {
    await execFileAsync('security', [
      'delete-generic-password',
      '-s', KEYCHAIN_SERVICE,
      '-a', KEYCHAIN_ACCOUNT,
    ]);
    return true;
  } catch {
    return false;
  }
}
