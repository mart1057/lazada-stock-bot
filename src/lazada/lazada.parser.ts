import type { LazadaProductTarget } from '../config/env.js';
import type { LazadaStock, StockStatus } from '../stock/stock.types.js';
import { detailModuleSchema, LazadaFetchError, type LazadaQuantity } from './lazada.types.js';

const BASE_URL = 'https://www.lazada.co.th';
const STORAGE_PATTERN = /^(\d+(?:\.\d+)?)\s*(GB|TB)$/i;

/// 256GB < 512GB < 1TB < 2TB. Anything unrecognised sorts last.
export const storageRank = (storage: string): number => {
  const match = STORAGE_PATTERN.exec(storage.trim());
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]) * (match[2]?.toUpperCase() === 'TB' ? 1024 : 1);
};

export interface QuantityVerdict {
  status: StockStatus;
  quantityMax: number | null;
  quantityText: string | null;
}

/**
 * The availability rule.
 *
 *   AVAILABLE = quantity.limit.max > 0 AND quantity.type !== "warning"
 *
 * Out of stock looks like `{limit:{max:0,min:0}, text:"สินค้าหมด", type:"warning"}`.
 *
 * IMPORTANT: the server-rendered HTML carries a *placeholder*
 * `{limit:{max:5,min:1}, type:"default"}` for every SKU before the page asks
 * the real API. That is why the bot never reads stock out of raw HTML - only
 * from the API answer / the hydrated page.
 */
export const classifyQuantity = (quantity: LazadaQuantity | undefined): QuantityVerdict => {
  if (!quantity || !Number.isFinite(quantity.limit.max)) {
    return { status: 'UNKNOWN', quantityMax: null, quantityText: null };
  }
  const max = quantity.limit.max;
  const text = quantity.text ?? null;
  if (max > 0 && quantity.type !== 'warning') {
    return { status: 'AVAILABLE', quantityMax: max, quantityText: text };
  }
  return { status: 'UNAVAILABLE', quantityMax: max, quantityText: text };
};

/// Accepts the raw mtop response, its `data.module` string, or the fields object.
export const decodeModule = (input: unknown): unknown => {
  let value: unknown = input;
  if (typeof value === 'string') value = JSON.parse(value);
  if (value && typeof value === 'object' && 'data' in value) {
    const data = (value as { data?: { module?: unknown; root?: { fields?: unknown } } }).data;
    if (data?.module !== undefined) return decodeModule(data.module);
    if (data?.root?.fields !== undefined) return data.root.fields;
  }
  return value;
};

/**
 * Turns one detail module into one observation per SKU.
 * Throws LazadaFetchError when the shape is not understood - the caller turns
 * that into UNKNOWN for the whole product, never UNAVAILABLE.
 */
export const parseDetailModule = (
  input: unknown,
  target: LazadaProductTarget,
  checkedAt: Date,
): LazadaStock[] => {
  const parsed = detailModuleSchema.safeParse(decodeModule(input));
  if (!parsed.success) {
    throw new LazadaFetchError(
      `Unexpected Lazada detail shape: ${parsed.error.issues[0]?.path.join('.') ?? '?'} ${parsed.error.issues[0]?.message ?? ''}`,
    );
  }

  const module = parsed.data;
  const { properties, skus } = module.productOption.skuBase;
  if (skus.length === 0) throw new LazadaFetchError('Lazada detail has no SKUs');

  const valueName = new Map<string, string>();
  for (const property of properties) {
    for (const value of property.values) valueName.set(`${property.pid}:${value.vid}`, value.name);
  }

  const seen = new Set<string>();
  const stocks: LazadaStock[] = [];

  for (const sku of skus) {
    if (seen.has(sku.skuId)) continue;
    seen.add(sku.skuId);

    const options = sku.propPath
      .split(';')
      .map((pair) => pair.trim())
      .filter((pair) => pair.length > 0)
      .map((pair) => valueName.get(pair) ?? pair.slice(pair.indexOf(':') + 1));

    const storage = options.find((option) => STORAGE_PATTERN.test(option.trim())) ?? '';
    const color = options.filter((option) => option !== storage).join(' / ');

    const info = module.skuInfos[sku.skuId];
    const verdict = classifyQuantity(info?.quantity);
    const price = info?.price?.salePrice?.value;

    stocks.push({
      productName: target.name,
      productUrl: target.url,
      title: module.product?.title ?? target.name,
      sellerName: module.seller?.name ?? 'Lazada',
      itemId: sku.itemId,
      skuId: sku.skuId,
      label: options.length > 0 ? options.join(' / ') : sku.skuId,
      color,
      storage,
      priceTHB: typeof price === 'number' && Number.isFinite(price) ? price : null,
      quantityMax: verdict.quantityMax,
      quantityText: verdict.quantityText,
      status: verdict.status,
      available: verdict.status === 'AVAILABLE',
      url: sku.pagePath
        ? new URL(sku.pagePath, BASE_URL).toString()
        : `${BASE_URL}/products/-i${sku.itemId}-s${sku.skuId}.html`,
      checkedAt,
    });
  }

  return stocks;
};
