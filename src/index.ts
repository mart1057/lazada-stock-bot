import { env, isTelegramConfigured } from './config/env.js';
import { lazadaBrowser } from './lazada/lazada.browser.js';
import { stockScheduler } from './scheduler/stock.scheduler.js';
import { stateStore } from './stock/stock.state.js';
import { logger } from './utils/logger.js';

const banner = (): void => {
  logger.raw('');
  logger.raw(`📱 ${env.products.map((p) => p.name).join(' + ')} Stock Bot - Lazada Thailand`);
  logger.raw('');
  logger.raw('Monitoring:');
  for (const product of env.products) logger.raw(`✓ ${product.name}  ${product.url}`);
  logger.raw(
    env.skuFilter.size > 0 ? `  only SKUs: ${[...env.skuFilter].join(', ')}` : '  all colours / capacities',
  );
  logger.raw('');
  logger.raw(`Interval: ${env.STOCK_CHECK_INTERVAL_SECONDS}s   Browser: ${env.BROWSER_CHANNEL || 'chromium'}${env.HEADLESS ? ' (headless)' : ''}`);
  logger.raw(`State:    ${stateStore.location}`);
  logger.raw(`Telegram: ${isTelegramConfigured() ? `✓ ${env.telegramChatIds.length} chat(s)` : '✗ not configured'}${env.TELEGRAM_DRY_RUN ? ' (dry run)' : ''}`);
  logger.raw('');
};

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal} - shutting down`);
  stockScheduler.stop();
  await lazadaBrowser.close();
  process.exit(0);
};

const main = async (): Promise<void> => {
  if (!isTelegramConfigured()) {
    logger.warn('Telegram not configured - stock is tracked but no alert will be sent');
  }
  banner();
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  await stockScheduler.start();
};

main().catch(async (error: unknown) => {
  logger.error('Fatal startup error', error);
  await lazadaBrowser.close();
  process.exit(1);
});
