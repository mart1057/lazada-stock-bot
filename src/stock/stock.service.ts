import {
  lazadaAvailabilityCollector,
  type LazadaAvailabilityCollector,
} from '../lazada/lazada.availability.js';
import { logger } from '../utils/logger.js';
import { detectChange } from './stock.detector.js';
import { stateStore, type StateStore, type StockState, type StoredItem } from './stock.state.js';
import type { LazadaStock, StockCheckResult, StockTransition } from './stock.types.js';

const toStored = (stock: LazadaStock, previous: StoredItem | undefined): StoredItem => ({
  skuId: stock.skuId,
  itemId: stock.itemId,
  productName: stock.productName,
  productUrl: stock.productUrl,
  sellerName: stock.sellerName,
  label: stock.label,
  color: stock.color,
  storage: stock.storage,
  url: stock.url,
  priceTHB: stock.priceTHB ?? previous?.priceTHB ?? null,
  quantityMax: previous?.quantityMax ?? null,
  available: previous?.available ?? false,
  status: previous?.status ?? 'UNKNOWN',
  firstSeenAt: previous?.firstSeenAt ?? stock.checkedAt.toISOString(),
  lastCheckedAt: previous?.lastCheckedAt ?? null,
  lastAvailableAt: previous?.lastAvailableAt ?? null,
  lastChangedAt: previous?.lastChangedAt ?? null,
});

export class StockService {
  constructor(
    private readonly collector: Pick<LazadaAvailabilityCollector, 'collect'> = lazadaAvailabilityCollector,
    private readonly store: Pick<StateStore, 'load' | 'save'> = stateStore,
  ) {}

  /// Current saved state (for status messages).
  async readState(): Promise<StockState> {
    return this.store.load();
  }

  /**
   * One monitoring cycle: collect -> compare with saved state -> save -> edges.
   * Sending is the notification layer's job.
   */
  async runCheck(): Promise<StockCheckResult & { state: StockState }> {
    const startedAt = new Date();
    const state = await this.store.load();
    const firstRun = Object.keys(state.items).length === 0;
    if (firstRun) logger.info('First run - baseline will be stored WITHOUT notifications');

    const snapshot = await this.collector.collect();
    const transitions: StockTransition[] = [];
    const observed = new Set<string>();
    let available = 0;
    let unavailable = 0;
    let unknown = 0;

    for (const stock of snapshot.stocks) {
      observed.add(stock.skuId);
      const previous = state.items[stock.skuId];
      const decision = detectChange(
        previous ? { available: previous.available, status: previous.status } : null,
        stock,
      );
      const next = toStored(stock, previous);
      const iso = stock.checkedAt.toISOString();

      next.status = stock.status;
      next.lastCheckedAt = iso;
      if (decision.shouldUpdateAvailable) {
        if (next.available !== stock.available) next.lastChangedAt = iso;
        next.available = stock.available;
        next.quantityMax = stock.quantityMax;
      }
      if (stock.available) next.lastAvailableAt = iso;
      state.items[stock.skuId] = next;

      if (stock.status === 'AVAILABLE') available += 1;
      else if (stock.status === 'UNAVAILABLE') unavailable += 1;
      else unknown += 1;

      if (decision.reason === 'became-available' || decision.reason === 'became-unavailable') {
        logger.info(
          `Status changed: ${decision.previousStatus} -> ${decision.currentStatus}`,
          `${stock.productName} / ${stock.label}`,
        );
      }

      if (decision.shouldNotify && !firstRun) {
        transitions.push({
          previousStatus: decision.previousStatus,
          currentStatus: decision.currentStatus,
          stock,
        });
      }
    }

    // SKUs of a page that could not be read are UNKNOWN - their last
    // definitive answer is kept as is.
    const failed = new Set(snapshot.failedProductUrls);
    for (const item of Object.values(state.items)) {
      if (observed.has(item.skuId) || !failed.has(item.productUrl)) continue;
      item.status = 'UNKNOWN';
      unknown += 1;
    }

    state.updatedAt = snapshot.checkedAt.toISOString();
    await this.store.save(state);

    const finishedAt = new Date();
    const result = {
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      checked: snapshot.stocks.length,
      available,
      unavailable,
      unknown,
      transitions,
      firstRun,
      errors: snapshot.errors,
      blocked: snapshot.blocked,
      state,
    };

    logger.info(
      `Stock check finished in ${result.durationMs}ms`,
      `checked=${result.checked} available=${available} unavailable=${unavailable} unknown=${unknown} new=${transitions.length}`,
    );
    for (const error of snapshot.errors) logger.error('Lazada check failed', error);

    return result;
  }
}

export const stockService = new StockService();
