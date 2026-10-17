import { env, type LazadaProductTarget } from '../config/env.js';
import type { LazadaStock } from '../stock/stock.types.js';
import { logger } from '../utils/logger.js';
import { lazadaBrowser } from './lazada.browser.js';
import { parseDetailModule } from './lazada.parser.js';
import { isBlockedError } from './lazada.types.js';

/// Anything that can hand back a detail module for a url (the browser, or a fake in tests).
export interface DetailSource {
  fetchDetail(url: string): Promise<unknown>;
}

export interface AvailabilitySnapshot {
  checkedAt: Date;
  stocks: LazadaStock[];
  /// Products whose page could not be read this cycle. Their SKUs become
  /// UNKNOWN - never UNAVAILABLE.
  failedProductUrls: string[];
  errors: string[];
  blocked: boolean;
}

export class LazadaAvailabilityCollector {
  constructor(
    private readonly source: DetailSource = lazadaBrowser,
    private readonly products: readonly LazadaProductTarget[] = env.products,
    private readonly skuFilter: ReadonlySet<string> = env.skuFilter,
  ) {}

  async collect(): Promise<AvailabilitySnapshot> {
    const checkedAt = new Date();
    const stocks: LazadaStock[] = [];
    const failedProductUrls: string[] = [];
    const errors: string[] = [];
    let blocked = false;

    // Sequential on purpose: one page at a time looks like one person browsing.
    for (const product of this.products) {
      try {
        const detail = await this.source.fetchDetail(product.url);
        const parsed = parseDetailModule(detail, product, checkedAt);
        const watched =
          this.skuFilter.size === 0 ? parsed : parsed.filter((stock) => this.skuFilter.has(stock.skuId));
        if (watched.length === 0) {
          logger.warn(`No watched SKU found on ${product.name}`, `LAZADA_SKU_IDS=${[...this.skuFilter].join(',')}`);
        }
        stocks.push(...watched);
      } catch (error) {
        failedProductUrls.push(product.url);
        errors.push(`${product.name}: ${error instanceof Error ? error.message : String(error)}`);
        if (isBlockedError(error)) blocked = true;
      }
    }

    return { checkedAt, stocks, failedProductUrls, errors, blocked };
  }
}

export const lazadaAvailabilityCollector = new LazadaAvailabilityCollector();
