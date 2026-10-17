/**
 * npm run notify:test    - one test message to every TELEGRAM_CHAT_ID
 * npm run notify:status  - what the bot currently believes is in stock
 */
import { env, isTelegramConfigured } from '../config/env.js';
import { buildStatusText } from '../notification/stock.text.js';
import { telegramService } from '../notification/telegram.service.js';
import { stateStore } from '../stock/stock.state.js';
import { formatThaiDateTime } from '../utils/datetime.js';

const main = async (): Promise<void> => {
  if (!isTelegramConfigured()) {
    throw new Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env first');
  }

  const text = process.argv.includes('--status')
    ? buildStatusText(await stateStore.load(), env.products.map((p) => p.name))
    : [
        '✅ ทดสอบแจ้งเตือน Lazada Stock Bot',
        '',
        `สินค้า: ${env.products.map((p) => p.name).join(', ')}`,
        `เวลา: ${formatThaiDateTime(new Date())}`,
        '',
        'ถ้าเห็นข้อความนี้ แปลว่าบอทส่งเข้าแชทนี้ได้แล้ว',
      ].join('\n');

  const result = await telegramService.send(text);
  if (!result.success) {
    throw new Error(
      `${result.error}\nHint: open the bot in Telegram and press Start first - a bot cannot message a chat that never talked to it.`,
    );
  }
  console.log(`Sent to ${result.sent} chat(s)`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
