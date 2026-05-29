/**
 * Ordered migration registry.
 *
 * The `.sql` files are the canonical schema source; they are imported as raw
 * strings (Vite `?raw`) so they survive bundling into the Electron main bundle.
 * Add new migrations by appending to {@link MIGRATIONS} — never edit an applied
 * one.
 */
import migration0001 from './0001_init.sql?raw';

export interface Migration {
  /** monotonically increasing version, applied in ascending order */
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: '0001_init', sql: migration0001 },
];
