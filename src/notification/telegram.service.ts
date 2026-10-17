import { env, isTelegramConfigured } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

/// Telegram rejects anything longer than this.
const MAX_TEXT_LENGTH = 4096;

class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

export interface SendResult {
  success: boolean;
  sent: number;
  error?: string;
}

const maskChatId = (chatId: string): string =>
  chatId.length <= 5 ? chatId : `${chatId.slice(0, 3)}...${chatId.slice(-2)}`;

/// Telegram Bot API sender. Docs: https://core.telegram.org/bots/api#sendmessage
export class TelegramService {
  constructor(
    private readonly token: string = env.TELEGRAM_BOT_TOKEN,
    private readonly chatIds: readonly string[] = env.telegramChatIds,
  ) {}

  isConfigured(): boolean {
    return isTelegramConfigured();
  }

  async send(text: string): Promise<SendResult> {
    if (!this.token || this.chatIds.length === 0) {
      return { success: false, sent: 0, error: 'Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)' };
    }
    if (env.TELEGRAM_DRY_RUN) {
      logger.warn('TELEGRAM_DRY_RUN=true - message not sent', `\n${text}`);
      return { success: true, sent: 0 };
    }

    const results = await Promise.all(this.chatIds.map((chatId) => this.sendTo(chatId, text)));
    const failed = results.filter((result) => result !== null);
    return {
      success: failed.length === 0,
      sent: results.length - failed.length,
      error: failed.length > 0 ? failed.join('; ') : undefined,
    };
  }

  /// null on success, error text otherwise.
  private async sendTo(chatId: string, text: string): Promise<string | null> {
    const endpoint = `https://api.telegram.org/bot${this.token}/sendMessage`;
    try {
      await withRetry(
        async () => {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(env.REQUEST_TIMEOUT_MS),
            body: JSON.stringify({
              chat_id: chatId,
              // Plain text on purpose: Thai text, '/' and '[Pre-order]' would
              // trip Markdown parsing. Urls are still clickable.
              text: text.slice(0, MAX_TEXT_LENGTH),
              disable_web_page_preview: true,
            }),
          });
          if (!response.ok) {
            const body = await response.text();
            throw new TelegramApiError(
              `Telegram send failed status=${response.status} body=${body.slice(0, 300)}`,
              response.status,
            );
          }
          const payload = (await response.json()) as { result?: { message_id?: number } };
          logger.info('Telegram message sent', `chat=${maskChatId(chatId)} id=${payload.result?.message_id ?? '?'}`);
        },
        {
          retries: env.MAX_RETRIES,
          baseDelayMs: env.RETRY_BASE_DELAY_MS,
          label: `Telegram send to ${maskChatId(chatId)}`,
          // 4xx other than 429 = bad token / chat id / bot not started - retrying cannot help.
          isRetryable: (error) =>
            !(error instanceof TelegramApiError) || error.status >= 500 || error.status === 429,
        },
      );
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
}

export const telegramService = new TelegramService();
