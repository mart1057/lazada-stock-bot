import { env } from '../config/env.js';
import type { StockState } from '../stock/stock.state.js';
import type { StockCheckResult } from '../stock/stock.types.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';
import { buildStockAlertText, buildSystemText } from './stock.text.js';
import { telegramService, type TelegramService } from './telegram.service.js';

export class NotificationService {
  private lastSystemAlertAt: number | null = null;
  private suppressedSystemAlerts = 0;

  constructor(
    private readonly telegram: Pick<TelegramService, 'send'> = telegramService,
    private readonly pause: (ms: number) => Promise<void> = sleep,
  ) {}

  /// Restock alert, sent ALERT_COPIES times so it is hard to miss.
  async notifyStock(result: StockCheckResult & { state: StockState }): Promise<number> {
    if (result.transitions.length === 0) return 0;
    if (result.firstRun) {
      logger.warn(`First run - suppressing ${result.transitions.length} notification(s)`);
      return 0;
    }

    const text = buildStockAlertText(result.transitions, result.state);
    logger.info(`Sending stock alert for ${result.transitions.length} item(s)`);

    let delivered = 0;
    for (let copy = 1; copy <= env.ALERT_COPIES; copy += 1) {
      if (copy > 1) await this.pause(env.ALERT_COPY_GAP_SECONDS * 1000);
      const sent = await this.telegram.send(text);
      if (sent.success) delivered += 1;
      else logger.error(`Stock alert copy ${copy}/${env.ALERT_COPIES} failed`, sent.error);
    }
    return delivered;
  }

  /**
   * Block / recovery notices share one throttle window so a flapping Lazada
   * cannot flood the chat. Stock alerts never pass through here.
   */
  async notifySystem(title: string, rows: Array<[string, string]>): Promise<void> {
    if (!env.SYSTEM_ALERTS_ENABLED) return;

    const windowMs = env.SYSTEM_ALERT_MIN_INTERVAL_MINUTES * 60_000;
    const now = Date.now();
    if (windowMs > 0 && this.lastSystemAlertAt !== null && now - this.lastSystemAlertAt < windowMs) {
      this.suppressedSystemAlerts += 1;
      logger.info(`System alert suppressed - "${title}"`, `suppressed=${this.suppressedSystemAlerts}`);
      return;
    }

    const finalRows: Array<[string, string]> =
      this.suppressedSystemAlerts > 0
        ? [...rows, ['แจ้งเตือนที่ข้ามไป', `${this.suppressedSystemAlerts} ครั้ง`]]
        : rows;
    this.lastSystemAlertAt = now;

    const sent = await this.telegram.send(buildSystemText(title, finalRows));
    if (sent.success) this.suppressedSystemAlerts = 0;
    else logger.error('System alert failed', sent.error);
  }
}

export const notificationService = new NotificationService();
