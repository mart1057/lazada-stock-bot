import { env } from '../config/env.js';
import { lazadaBrowser } from '../lazada/lazada.browser.js';
import {
  notificationService,
  type NotificationService,
} from '../notification/notification.service.js';
import { stockService, type StockService } from '../stock/stock.service.js';
import { formatClock } from '../utils/datetime.js';
import { logger } from '../utils/logger.js';

/**
 * Fixed-delay loop: the next check starts STOCK_CHECK_INTERVAL_SECONDS after
 * the previous one FINISHED, so a slow page load never piles checks up.
 *
 * When Lazada's anti-bot answers, polling pauses (COOLDOWN_BASE_SECONDS,
 * doubling up to COOLDOWN_MAX_SECONDS) instead of hammering it.
 */
export class StockScheduler {
  private running = false;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private consecutiveBlocks = 0;
  private cooldownUntil = 0;

  constructor(
    private readonly stocks: StockService = stockService,
    private readonly notifications: NotificationService = notificationService,
    private readonly resetBrowser: () => Promise<void> = () => lazadaBrowser.reset(),
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    logger.info(`Scheduler: every ${env.STOCK_CHECK_INTERVAL_SECONDS}s (after each check ends)`);
    if (env.RUN_ON_STARTUP) await this.tick();
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.scheduleNext());
    }, env.STOCK_CHECK_INTERVAL_SECONDS * 1000);
  }

  private cooldownMs(level: number): number {
    return Math.min(env.COOLDOWN_BASE_SECONDS * 2 ** (level - 1), env.COOLDOWN_MAX_SECONDS) * 1000;
  }

  private async enterCooldown(reason: string | undefined): Promise<void> {
    this.consecutiveBlocks += 1;
    const ms = this.cooldownMs(this.consecutiveBlocks);
    this.cooldownUntil = Date.now() + ms;
    await this.resetBrowser().catch(() => undefined);

    logger.warn(
      `Lazada blocked the check - pausing for ${Math.round(ms / 1000)}s`,
      `consecutive=${this.consecutiveBlocks} ${reason ?? ''}`,
    );
    await this.notifications
      .notifySystem('⚠️ Lazada บล็อกการตรวจชั่วคราว', [
        ['สาเหตุ', 'Lazada ขอยืนยันตัวตน (captcha/slider) หรือปฏิเสธคำขอ'],
        ['พักนาน', `${Math.max(1, Math.round(ms / 60_000))} นาที`],
        ['กลับมาตรวจ', formatClock(new Date(this.cooldownUntil))],
        ['หมายเหตุ', 'ระหว่างนี้ไม่ทราบสถานะสต็อก ไม่ใช่ว่าไม่มีของ — ถ้าเป็นบ่อย ตั้ง HEADLESS=false แล้วยืนยันในหน้าต่างเองหนึ่งครั้ง'],
      ])
      .catch((error: unknown) => logger.error('Block alert failed', error));
  }

  private async markHealthy(): Promise<void> {
    if (this.consecutiveBlocks === 0) return;
    this.consecutiveBlocks = 0;
    logger.info('Lazada answered normally again - cooldown cleared');
    await this.notifications
      .notifySystem('✅ กลับมาตรวจ Lazada ได้แล้ว', [['รอบตรวจ', `ทุก ${env.STOCK_CHECK_INTERVAL_SECONDS} วินาที`]])
      .catch((error: unknown) => logger.error('Recovery alert failed', error));
  }

  async tick(): Promise<void> {
    if (this.stopped) return;
    if (this.running) {
      logger.warn('Previous check still running - tick skipped');
      return;
    }
    const remaining = this.cooldownUntil - Date.now();
    if (remaining > 0) {
      logger.debug(`Cooldown active - resumes in ${Math.ceil(remaining / 1000)}s`);
      return;
    }

    this.running = true;
    try {
      const result = await this.stocks.runCheck();
      await this.notifications.notifyStock(result);
      if (result.blocked) await this.enterCooldown(result.errors[0]);
      else if (result.checked > 0) await this.markHealthy();
    } catch (error) {
      // A failed cycle must never kill the loop.
      logger.error('Stock check cycle failed', error);
    } finally {
      this.running = false;
    }
  }
}

export const stockScheduler = new StockScheduler();
