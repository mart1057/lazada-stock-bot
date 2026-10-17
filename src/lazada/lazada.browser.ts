import { resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { LazadaBlockedError, LazadaFetchError } from './lazada.types.js';

/**
 * Reads Lazada's product detail through a real browser page.
 *
 * Why a browser: stock is NOT in the server-rendered HTML (that only holds a
 * placeholder). The page fetches it from `mtop.global.detail.web.getDetailInfo`,
 * an API that only answers Lazada's own web client (signed requests plus a
 * security SDK). Calling it from plain Node returns FAIL_SYS_ILLEGAL_ACCESS.
 *
 * So the bot does exactly what a visitor's browser does: open the page and let
 * it load. We do NOT solve captchas or tamper with Lazada's protection - when
 * it asks for a check, that is reported as "blocked" and the scheduler backs
 * off. Run with HEADLESS=false to see (and, if you want, solve) it yourself.
 *
 * Between full reloads (PAGE_RELOAD_MINUTES) the already-open page is asked to
 * repeat its own detail request, which is far lighter than a reload.
 */

/// ret codes that mean "anti-bot said no" rather than a transient failure.
const BLOCK_MARKERS = [
  'RGV587',
  'FAIL_SYS_USER_VALIDATE',
  'FAIL_SYS_ILLEGAL_ACCESS',
  'FAIL_SYS_TRAFFIC_LIMIT',
  'FAIL_SYS_PEAK_LIMIT',
];
const TOKEN_MARKERS = ['FAIL_SYS_TOKEN', 'FAIL_SYS_SESSION_EXPIRED'];
const PUNISH_URL = /punish|_____tmd_____|\/captcha/i;

/// Plain-JS page scripts (strings, so the TS compiler cannot inject helpers
/// that do not exist inside the browser).
const HYDRATION_STATE = `(() => {
  const w = window;
  const dialog = !!document.querySelector('#baxia-dialog-content, .baxia-dialog, iframe[src*="punish"], #nc_1_wrapper');
  return {
    mtopStatus: w.__pdpMtopStatus ?? null,
    hasMtop: typeof (w.Mtop && w.Mtop.default && w.Mtop.default.request) === 'function',
    blocked: dialog || /punish|_____tmd_____/i.test(location.href),
    href: location.href,
  };
})()`;

const READ_HYDRATED = `(() => {
  const d = window.__moduleData__;
  return d && d.data && d.data.root && d.data.root.fields ? JSON.stringify(d.data.root.fields) : null;
})()`;

/// Same request the page itself makes on load (see the PDP's renderCsrData()).
const REQUEST_DETAIL = `new Promise((done) => {
  const w = window;
  const request = w.Mtop && w.Mtop.default && w.Mtop.default.request;
  if (typeof request !== 'function') { done({ kind: 'no-mtop', ret: [] }); return; }
  const match = location.pathname.match(/\\/([\\w-]+)\\.html/);
  const cookieParams = {};
  for (const item of document.cookie.split('; ')) {
    const i = item.indexOf('=');
    if (i > 0) cookieParams[item.slice(0, i)] = item.slice(i + 1);
  }
  const requestParams = {};
  new URLSearchParams(location.search).forEach((v, k) => { requestParams[k] = v; });
  const timer = setTimeout(() => done({ kind: 'timeout', ret: [] }), 25000);
  request({
    data: {
      deviceType: 'pc',
      path: location.href,
      uri: match ? match[1] : '',
      headerParams: JSON.stringify({ 'user-agent': navigator.userAgent }),
      cookieParams: JSON.stringify(cookieParams),
      requestParams: JSON.stringify(requestParams),
    },
    type: 'POST',
    v: '1.0',
    needLogin: false,
    api: 'mtop.global.detail.web.getDetailInfo',
  }, (res) => {
    clearTimeout(timer);
    done({ kind: 'ok', ret: (res && res.ret) || [], module: (res && res.data && res.data.module) || null });
  }, (err) => {
    clearTimeout(timer);
    done({ kind: 'fail', ret: (err && err.ret) || [String(err)] });
  });
})`;

interface HydrationState {
  mtopStatus: number | null;
  hasMtop: boolean;
  blocked: boolean;
  href: string;
}

interface RequestOutcome {
  kind: 'ok' | 'fail' | 'timeout' | 'no-mtop';
  ret: string[];
  module?: string | null;
}

interface PageSlot {
  page: Page;
  loadedAt: number;
}

const hasMarker = (ret: readonly string[], markers: readonly string[]): boolean =>
  ret.some((code) => markers.some((marker) => code.includes(marker)));

export class LazadaBrowser {
  private context: BrowserContext | null = null;
  private launching: Promise<BrowserContext> | null = null;
  private readonly slots = new Map<string, PageSlot>();

  private async getContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    this.launching ??= (async () => {
      const channel = env.BROWSER_CHANNEL.trim();
      logger.info(
        `Launching browser`,
        `channel=${channel || 'playwright-chromium'} headless=${env.HEADLESS} profile=${env.BROWSER_PROFILE_DIR}`,
      );
      try {
        const context = await chromium.launchPersistentContext(resolve(env.BROWSER_PROFILE_DIR), {
          ...(channel ? { channel } : {}),
          headless: env.HEADLESS,
          locale: 'th-TH',
          timezoneId: 'Asia/Bangkok',
          viewport: { width: 1366, height: 900 },
        });
        context.on('close', () => {
          this.context = null;
          this.slots.clear();
        });
        this.context = context;
        return context;
      } catch (error) {
        const hint = channel
          ? `Could not start "${channel}". Install Google Chrome, or set BROWSER_CHANNEL= and run "npm run browser:install".`
          : 'Run "npm run browser:install" to download Playwright Chromium.';
        throw new LazadaFetchError(
          `${hint} (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`,
        );
      }
    })().finally(() => {
      this.launching = null;
    });
    return this.launching;
  }

  private async getSlot(url: string): Promise<{ slot: PageSlot; fresh: boolean }> {
    const existing = this.slots.get(url);
    if (existing && !existing.page.isClosed()) return { slot: existing, fresh: false };
    const context = await this.getContext();
    const page = await context.newPage();
    page.setDefaultTimeout(env.PAGE_TIMEOUT_MS);
    const slot: PageSlot = { page, loadedAt: 0 };
    this.slots.set(url, slot);
    return { slot, fresh: true };
  }

  /// Full navigation; returns the module the page loaded for itself.
  private async loadPage(slot: PageSlot, url: string): Promise<string> {
    const { page } = slot;
    logger.debug('Loading Lazada page', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: env.PAGE_TIMEOUT_MS });
    slot.loadedAt = Date.now();

    if (PUNISH_URL.test(page.url())) {
      throw new LazadaBlockedError(`Lazada redirected to a verification page (${page.url()})`);
    }

    const deadline = Date.now() + env.PAGE_TIMEOUT_MS;
    let state: HydrationState | null = null;
    while (Date.now() < deadline) {
      state = (await page.evaluate(HYDRATION_STATE)) as HydrationState;
      if (state.blocked) {
        throw new LazadaBlockedError(`Lazada is showing a verification check (${state.href})`);
      }
      if (state.mtopStatus === 1) break;
      await page.waitForTimeout(500);
    }

    if (state?.mtopStatus === 1) {
      const fields = (await page.evaluate(READ_HYDRATED)) as string | null;
      if (fields) return fields;
    }

    // The page did not finish its own request in time - ask once ourselves.
    if (state?.hasMtop) return this.requestInPage(slot, false);

    throw new LazadaFetchError(
      `Lazada page did not load stock within ${env.PAGE_TIMEOUT_MS}ms (${state?.href ?? url})`,
    );
  }

  private async requestInPage(slot: PageSlot, allowReload: boolean, url?: string): Promise<string> {
    const outcome = (await slot.page.evaluate(REQUEST_DETAIL)) as RequestOutcome;
    const ret = outcome.ret.map(String);

    if (outcome.kind === 'ok' && typeof outcome.module === 'string' && ret.some((r) => r.startsWith('SUCCESS'))) {
      return outcome.module;
    }
    if (hasMarker(ret, BLOCK_MARKERS)) {
      throw new LazadaBlockedError(`Lazada anti-bot answered: ${ret.join(', ')}`);
    }
    if (allowReload && url && (outcome.kind === 'no-mtop' || hasMarker(ret, TOKEN_MARKERS))) {
      logger.info('Lazada session token stale - reloading page', ret.join(', ') || outcome.kind);
      return this.loadPage(slot, url);
    }
    throw new LazadaFetchError(
      `Lazada detail request failed (${outcome.kind}${ret.length ? `: ${ret.join(', ')}` : ''})`,
    );
  }

  /**
   * Returns the detail module (JSON string) for one product page.
   */
  async fetchDetail(url: string): Promise<string> {
    const { slot, fresh } = await this.getSlot(url);
    try {
      const stale = Date.now() - slot.loadedAt > env.PAGE_RELOAD_MINUTES * 60_000;
      if (fresh || stale) return await this.loadPage(slot, url);
      return await this.requestInPage(slot, true, url);
    } catch (error) {
      // A broken / blocked page is thrown away; the next check starts clean.
      await this.dropPage(url);
      throw error instanceof LazadaBlockedError || error instanceof LazadaFetchError
        ? error
        : new LazadaFetchError(error instanceof Error ? error.message.split('\n')[0] ?? String(error) : String(error));
    }
  }

  private async dropPage(url: string): Promise<void> {
    const slot = this.slots.get(url);
    this.slots.delete(url);
    await slot?.page.close().catch(() => undefined);
  }

  /// Forget every open page (used after a block so the cooldown ends with a fresh load).
  async reset(): Promise<void> {
    for (const url of [...this.slots.keys()]) await this.dropPage(url);
  }

  async close(): Promise<void> {
    this.slots.clear();
    const context = this.context;
    this.context = null;
    await context?.close().catch(() => undefined);
  }
}

export const lazadaBrowser = new LazadaBrowser();
