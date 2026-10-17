import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { StockStatus } from './stock.types.js';

/// Last known state of one SKU.
export interface StoredItem {
  skuId: string;
  itemId: string;
  productName: string;
  productUrl: string;
  sellerName: string;
  label: string;
  color: string;
  storage: string;
  url: string;
  priceTHB: number | null;
  quantityMax: number | null;
  /// Last DEFINITIVE answer. UNKNOWN never touches it.
  available: boolean;
  /// Last OBSERVED status, including UNKNOWN.
  status: StockStatus;
  firstSeenAt: string;
  lastCheckedAt: string | null;
  lastAvailableAt: string | null;
  lastChangedAt: string | null;
}

export interface StockState {
  version: 1;
  updatedAt: string | null;
  items: Record<string, StoredItem>;
}

export const emptyState = (): StockState => ({ version: 1, updatedAt: null, items: {} });

/**
 * A tiny JSON file instead of a database: one product page, a handful of
 * SKUs. Writes are atomic (tmp file + rename) so a crash mid-write never
 * leaves a half file that would make the next start look like a first run.
 */
export class StateStore {
  constructor(private readonly path: string = resolve(env.STATE_FILE)) {}

  get location(): string {
    return this.path;
  }

  async load(): Promise<StockState> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
      throw error;
    }
    try {
      const parsed = JSON.parse(text) as StockState;
      if (parsed?.version !== 1 || typeof parsed.items !== 'object' || parsed.items === null) {
        throw new Error('unsupported state format');
      }
      return parsed;
    } catch (error) {
      // Refuse to silently start over - that would re-seed and could hide a restock.
      throw new Error(
        `State file ${this.path} is unreadable (${error instanceof Error ? error.message : String(error)}). Fix or delete it.`,
      );
    }
  }

  async save(state: StockState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(tmp, this.path);
    logger.debug('State saved', this.path);
  }
}

export const stateStore = new StateStore();
