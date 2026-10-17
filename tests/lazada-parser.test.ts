import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classifyQuantity,
  decodeModule,
  parseDetailModule,
  storageRank,
} from '../src/lazada/lazada.parser.js';
import { LazadaFetchError } from '../src/lazada/lazada.types.js';

/// Real getDetailInfo answer for the iPhone Duo listing (17 Oct 2026, all sold out),
/// pruned to the fields the bot reads.
const response = JSON.parse(
  readFileSync(new URL('./fixtures/detail-response.json', import.meta.url), 'utf8'),
) as { data: { module: string } };

const target = {
  name: 'iPhone Duo',
  url: 'https://www.lazada.co.th/products/-i16250067859-s127511251733.html',
};
const now = new Date('2026-10-17T16:00:00Z');

const withQuantity = (skuId: string, quantity: unknown) => {
  const module = JSON.parse(response.data.module);
  module.skuInfos[skuId].quantity = quantity;
  return module;
};

describe('parseDetailModule', () => {
  it('reads all 8 variants from the real response, all sold out', () => {
    const stocks = parseDetailModule(response, target, now);
    expect(stocks).toHaveLength(8);
    expect(stocks.every((s) => s.status === 'UNAVAILABLE')).toBe(true);
    expect(stocks.every((s) => s.available === false)).toBe(true);
    expect(new Set(stocks.map((s) => s.skuId)).size).toBe(8);
  });

  it('maps propPath to colour and capacity names', () => {
    const stocks = parseDetailModule(response, target, now);
    const byId = new Map(stocks.map((s) => [s.skuId, s]));
    expect(byId.get('127511251733')).toMatchObject({
      label: 'Star White / 256GB',
      color: 'Star White',
      storage: '256GB',
      priceTHB: 79900,
      quantityMax: 0,
      quantityText: 'สินค้าหมด',
      sellerName: 'Apple Flagship Store',
    });
    expect(byId.get('127636474782')).toMatchObject({ label: 'Night Sky / 1TB', priceTHB: 103900 });
    expect(byId.get('127636474785')).toMatchObject({ label: 'Night Sky / 2TB', priceTHB: 127900 });
  });

  it('builds a deep link to each SKU', () => {
    const [first] = parseDetailModule(response, target, now);
    expect(first?.url).toBe(
      'https://www.lazada.co.th/products/pre-order-iphone-duo-23-69-i16250067859-s127511251733.html',
    );
  });

  it('marks a SKU available when Lazada reports a purchasable quantity', () => {
    const module = withQuantity('127511251736', { limit: { max: 2, min: 1 }, type: 'default' });
    const stock = parseDetailModule(module, target, now).find((s) => s.skuId === '127511251736');
    expect(stock).toMatchObject({ status: 'AVAILABLE', available: true, quantityMax: 2 });
  });

  it('treats a SKU without stock info as UNKNOWN, never UNAVAILABLE', () => {
    const module = JSON.parse(response.data.module);
    delete module.skuInfos['127636474784'];
    const stock = parseDetailModule(module, target, now).find((s) => s.skuId === '127636474784');
    expect(stock).toMatchObject({ status: 'UNKNOWN', available: false });
  });

  it('throws on a shape it does not understand', () => {
    expect(() => parseDetailModule({ data: { module: '{"foo":1}' } }, target, now)).toThrow(
      LazadaFetchError,
    );
  });

  it('accepts the hydrated __moduleData__ shape as well', () => {
    const fields = JSON.parse(response.data.module);
    const stocks = parseDetailModule({ data: { root: { fields } } }, target, now);
    expect(stocks).toHaveLength(8);
  });
});

describe('classifyQuantity', () => {
  it('sold out', () => {
    expect(
      classifyQuantity({ limit: { max: 0, min: 0 }, text: 'สินค้าหมด', type: 'warning' }).status,
    ).toBe('UNAVAILABLE');
  });

  it('a warning type is never available, even with a positive max', () => {
    expect(classifyQuantity({ limit: { max: 3 }, type: 'warning' }).status).toBe('UNAVAILABLE');
  });

  it('missing quantity is UNKNOWN', () => {
    expect(classifyQuantity(undefined).status).toBe('UNKNOWN');
  });

  it('the SSR placeholder {max:5,type:default} WOULD read as available - which is why raw HTML is never parsed', () => {
    expect(classifyQuantity({ limit: { max: 5, min: 1 }, type: 'default' }).status).toBe('AVAILABLE');
  });
});

describe('helpers', () => {
  it('orders capacities smallest first', () => {
    expect(['2TB', '256GB', '1TB', '512GB'].sort((a, b) => storageRank(a) - storageRank(b))).toEqual([
      '256GB',
      '512GB',
      '1TB',
      '2TB',
    ]);
  });

  it('decodes a module given as a JSON string', () => {
    const decoded = decodeModule(response.data.module) as { skuInfos: object };
    expect(Object.keys(decoded.skuInfos)).toContain('127511251733');
  });
});
