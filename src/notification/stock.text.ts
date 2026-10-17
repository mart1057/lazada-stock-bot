import { storageRank } from '../lazada/lazada.parser.js';
import type { StockState, StoredItem } from '../stock/stock.state.js';
import type { StockTransition } from '../stock/stock.types.js';
import { formatBaht, formatThaiDateTime } from '../utils/datetime.js';

const byStorageThenColor = (a: StoredItem, b: StoredItem): number =>
  storageRank(a.storage) - storageRank(b.storage) || a.color.localeCompare(b.color);

/// Groups items by capacity, smallest first (256GB, 512GB, 1TB, 2TB).
export const groupByStorage = (items: readonly StoredItem[]): Map<string, StoredItem[]> => {
  const grouped = new Map<string, StoredItem[]>();
  for (const item of [...items].sort(byStorageThenColor)) {
    const key = item.storage || 'อื่น ๆ';
    const bucket = grouped.get(key);
    if (bucket) bucket.push(item);
    else grouped.set(key, [item]);
  }
  return grouped;
};

const itemLine = (item: StoredItem, isNew: boolean): string => {
  const price = item.priceTHB !== null ? `  ${formatBaht(item.priceTHB)}` : '';
  return `   • ${item.color || item.label}${price}${isNew ? '  🆕' : ''}`;
};

/**
 * Summary of what is in stock right now, grouped by capacity.
 * `newSkus` marks what only just came in.
 */
export const buildAvailabilityBody = (
  state: StockState,
  newSkus: ReadonlySet<string> = new Set(),
): string => {
  const items = Object.values(state.items);
  const inStock = items.filter((item) => item.status === 'AVAILABLE');
  const out = items.filter((item) => item.status === 'UNAVAILABLE').length;
  const unknown = items.filter((item) => item.status === 'UNKNOWN').length;
  const sellers = [...new Set(items.map((item) => item.sellerName))].join(', ');

  const lines = [
    `ร้าน: ${sellers || '-'} (Lazada)`,
    `มีของ: ${inStock.length} / ${items.length}`,
    `ไม่มีของ: ${out}`,
  ];
  // "ไม่มีของ" and "ไม่รู้" are very different answers - say so.
  if (unknown > 0) lines.push(`ไม่ทราบสถานะ: ${unknown}`);
  lines.push(
    `ตรวจล่าสุด: ${state.updatedAt ? formatThaiDateTime(new Date(state.updatedAt)) : 'ยังไม่เคยตรวจ'}`,
  );

  if (inStock.length === 0) {
    lines.push('', '🔴 ยังไม่มีสินค้าพร้อมสั่งซื้อ');
    return lines.join('\n');
  }

  lines.push('', '🟢 พร้อมสั่งซื้อ');
  for (const [storage, group] of groupByStorage(inStock)) {
    lines.push('', `💾 ${storage}`);
    for (const item of group) lines.push(itemLine(item, newSkus.has(item.skuId)));
  }
  return lines.join('\n');
};

/// The alert sent when something has just come INTO stock.
export const buildStockAlertText = (
  transitions: readonly StockTransition[],
  state: StockState,
): string => {
  const products = [...new Set(transitions.map((t) => t.stock.productName))].join(' + ');
  const newSkus = new Set(transitions.map((t) => t.stock.skuId));

  const links = [...transitions]
    .sort(
      (a, b) =>
        storageRank(a.stock.storage) - storageRank(b.stock.storage) ||
        a.stock.color.localeCompare(b.stock.color),
    )
    .flatMap((t) => [`🛒 ${t.stock.label}`, t.stock.url]);

  return [
    `📱 ${products} — LAZADA STOCK ALERT`,
    '',
    `🔔 เพิ่งมีของ ${transitions.length} รายการ`,
    '',
    buildAvailabilityBody(state, newSkus),
    '',
    ...links,
  ].join('\n');
};

/// On-demand status (npm run notify:status).
export const buildStatusText = (state: StockState, productNames: readonly string[]): string =>
  [`📊 ${productNames.join(' + ')} — สถานะ Lazada`, '', buildAvailabilityBody(state)].join('\n');

export const buildSystemText = (title: string, rows: ReadonlyArray<[string, string]>): string =>
  [title, '', ...rows.map(([key, value]) => `${key}: ${value}`)].join('\n');
