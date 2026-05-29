/**
 * @wdiot/shared — public surface.
 *
 * Re-exports every type and zod schema used at the daemon <-> renderer <->
 * IDE-extension boundaries so the HTTP and IPC contracts cannot drift.
 */
export * from './activity.js';
export * from './context.js';
export * from './ingest-contract.js';
export * from './llm-contract.js';
