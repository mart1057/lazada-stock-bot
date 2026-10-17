import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LazadaAvailabilityCollector, type DetailSource } from '../src/lazada/lazada.availability.js';
import { LazadaBlockedError } from '../src/lazada/lazada.types.js';
import { NotificationService } from '../src/notification/notification.service.js';
import { StockService } from '../src/stock/stock.service.js';
import { StateStore } from '../src/stock/stock.state.js';

const response = JSON.parse(
  readFileSync(new URL('./fixtures/detail-response.json', import.meta.url), 'utf8'),
) as { data: { module: string } };

const target = {
  name: 'iPhone Duo',
  url: 'https://www.lazada.co.th/products/-i16250067859-s127511251733.html',
};

/// A detail source whose answer each test can change between checks.
class FakeSource implements DetailSource {
  inStock = new Set<string>();
  blocked = false;
  async fetchDetail(): Promise<unknown> {
    if (this.blocked) throw new LazadaBlockedError('RGV587_ERROR::SM');
    const module = JSON.parse(response.data.module);
    for (const skuId of this.inStock) {
      module.skuInfos[skuId].quantity = { limit: { max: 2, min: 1 }, type: 'default' };
    }
    return module;
  }
}

const setup = (skuFilter: Set<string> = new Set()) => {
  const source = new FakeSource();
  const store = new StateStore(join(mkdtempSync(join(tmpdir(), 'lzd-')), 'state.json'));
  const service = new StockService(new LazadaAvailabilityCollector(source, [target], skuFilter), store);
  const sent: string[] = [];
  const notifications = new NotificationService(
    { send: async (text: string) => (sent.push(text), { success: true, sent: 1 }) },
    async () => undefined,
  );
  return { source, store, service, notifications, sent };
};

describe('StockService', () => {
  it('first run stores a baseline silently, even if something is in stock', async () => {
    const { source, service, notifications, sent } = setup();
    source.inStock.add('127511251733');
    const result = await service.runCheck();
    expect(result.firstRun).toBe(true);
    expect(result.transitions).toHaveLength(0);
    await notifications.notifyStock(result);
    expect(sent).toHaveLength(0);
    expect(result.state.items['127511251733']?.available).toBe(true);
  });

  it('alerts (twice) when a sold-out SKU comes into stock, then stays quiet', async () => {
    const { source, service, notifications, sent } = setup();
    await service.runCheck(); // baseline: all sold out

    source.inStock.add('127511251736');
    const restock = await service.runCheck();
    expect(restock.transitions.map((t) => t.stock.label)).toEqual(['Star White / 512GB']);
    expect(await notifications.notifyStock(restock)).toBe(2);
    expect(sent[0]).toContain('LAZADA STOCK ALERT');
    expect(sent[0]).toContain('Star White');
    expect(sent[0]).toContain('฿87,900');
    expect(sent[0]).toContain('i16250067859-s127511251736.html');

    const again = await service.runCheck();
    expect(again.transitions).toHaveLength(0);
  });

  it('a block marks everything UNKNOWN but keeps the last answer', async () => {
    const { source, service } = setup();
    await service.runCheck();
    source.blocked = true;
    const blocked = await service.runCheck();
    expect(blocked.blocked).toBe(true);
    expect(blocked.unknown).toBe(8);
    expect(Object.values(blocked.state.items).every((i) => i.status === 'UNKNOWN' && !i.available)).toBe(true);

    // Block clears and stock is still out -> no alert
    source.blocked = false;
    expect((await service.runCheck()).transitions).toHaveLength(0);
  });

  it('LAZADA_SKU_IDS narrows what is watched', async () => {
    const { source, service } = setup(new Set(['127636474785']));
    await service.runCheck();
    source.inStock.add('127511251733'); // not watched
    source.inStock.add('127636474785');
    const result = await service.runCheck();
    expect(result.checked).toBe(1);
    expect(result.transitions.map((t) => t.stock.skuId)).toEqual(['127636474785']);
  });

  it('state survives a restart (no re-seed, no duplicate alert)', async () => {
    const { source, store, service } = setup();
    await service.runCheck();
    source.inStock.add('127511251734');
    await service.runCheck();

    const restarted = new StockService(new LazadaAvailabilityCollector(source, [target], new Set()), store);
    const result = await restarted.runCheck();
    expect(result.firstRun).toBe(false);
    expect(result.transitions).toHaveLength(0);
  });
});
