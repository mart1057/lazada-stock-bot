import { describe, expect, it } from 'vitest';
import { buildAvailabilityBody, buildStatusText } from '../src/notification/stock.text.js';
import type { StockState, StoredItem } from '../src/stock/stock.state.js';

const item = (skuId: string, color: string, storage: string, status: StoredItem['status'], price: number): StoredItem => ({
  skuId,
  itemId: '16250067859',
  productName: 'iPhone Duo',
  productUrl: 'https://www.lazada.co.th/products/-i16250067859-s127511251733.html',
  sellerName: 'Apple Flagship Store',
  label: `${color} / ${storage}`,
  color,
  storage,
  url: `https://www.lazada.co.th/products/-i16250067859-s${skuId}.html`,
  priceTHB: price,
  quantityMax: status === 'AVAILABLE' ? 2 : 0,
  available: status === 'AVAILABLE',
  status,
  firstSeenAt: '2026-10-17T16:00:00.000Z',
  lastCheckedAt: '2026-10-17T16:00:00.000Z',
  lastAvailableAt: null,
  lastChangedAt: null,
});

const state = (items: StoredItem[]): StockState => ({
  version: 1,
  updatedAt: '2026-10-17T16:30:15.000Z',
  items: Object.fromEntries(items.map((i) => [i.skuId, i])),
});

describe('stock text', () => {
  it('says plainly when nothing is in stock', () => {
    const text = buildAvailabilityBody(state([item('1', 'Star White', '256GB', 'UNAVAILABLE', 79900)]));
    expect(text).toContain('มีของ: 0 / 1');
    expect(text).toContain('🔴 ยังไม่มีสินค้าพร้อมสั่งซื้อ');
    expect(text).toContain('17/10/2026 23:30:15');
  });

  it('groups in-stock items by capacity, smallest first, and marks new ones', () => {
    const text = buildAvailabilityBody(
      state([
        item('a', 'Night Sky', '1TB', 'AVAILABLE', 103900),
        item('b', 'Star White', '256GB', 'AVAILABLE', 79900),
        item('c', 'Night Sky', '256GB', 'UNKNOWN', 79900),
      ]),
      new Set(['a']),
    );
    expect(text.indexOf('💾 256GB')).toBeLessThan(text.indexOf('💾 1TB'));
    expect(text).toContain('• Night Sky  ฿103,900  🆕');
    expect(text).toContain('• Star White  ฿79,900');
    expect(text).toContain('ไม่ทราบสถานะ: 1');
  });

  it('status message names the product', () => {
    expect(buildStatusText(state([]), ['iPhone Duo'])).toContain('📊 iPhone Duo — สถานะ Lazada');
  });
});
