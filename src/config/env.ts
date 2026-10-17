import 'dotenv/config';
import { z } from 'zod';

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const booleanish = z
  .string()
  .transform((value) => ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase()));

export const DEFAULT_PRODUCTS =
  'iPhone Duo|https://www.lazada.co.th/products/-i16250067859-s127511251733.html';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_CHAT_ID: z.string().default(''),
  TELEGRAM_DRY_RUN: booleanish.default('false'),

  LAZADA_PRODUCTS: z.string().default(DEFAULT_PRODUCTS),
  LAZADA_SKU_IDS: z.string().default(''),

  BROWSER_CHANNEL: z.string().default('chrome'),
  HEADLESS: booleanish.default('true'),
  BROWSER_PROFILE_DIR: z.string().default('.browser-profile'),
  PAGE_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(45_000),
  PAGE_RELOAD_MINUTES: z.coerce.number().int().min(1).default(20),

  STOCK_CHECK_INTERVAL_SECONDS: z.coerce.number().int().min(15).default(45),
  RUN_ON_STARTUP: booleanish.default('true'),
  STATE_FILE: z.string().default('data/state.json'),

  ALERT_COPIES: z.coerce.number().int().min(1).max(5).default(2),
  ALERT_COPY_GAP_SECONDS: z.coerce.number().int().min(0).default(3),
  SYSTEM_ALERTS_ENABLED: booleanish.default('true'),
  SYSTEM_ALERT_MIN_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(30),

  COOLDOWN_BASE_SECONDS: z.coerce.number().int().min(10).default(120),
  COOLDOWN_MAX_SECONDS: z.coerce.number().int().min(60).default(1800),

  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10_000),
  MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  RETRY_BASE_DELAY_MS: z.coerce.number().int().min(50).default(500),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const raw = parsed.data;

/// One Lazada product page the bot watches.
export interface LazadaProductTarget {
  /// Display name used in alerts, e.g. "iPhone Duo".
  name: string;
  url: string;
}

export const parseProducts = (value: string): LazadaProductTarget[] => {
  const entries = value
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (entries.length === 0) {
    throw new Error('Invalid environment configuration:\n  - LAZADA_PRODUCTS: at least one product is required');
  }

  return entries.map((entry) => {
    const separator = entry.indexOf('|');
    if (separator <= 0) {
      throw new Error(
        `Invalid environment configuration:\n  - LAZADA_PRODUCTS: expected "Name|url", got "${entry}"`,
      );
    }
    const name = entry.slice(0, separator).trim();
    const url = entry.slice(separator + 1).trim();
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      throw new Error(`Invalid environment configuration:\n  - LAZADA_PRODUCTS: bad url "${url}"`);
    }
    if (!/(^|\.)lazada\.co\.th$/.test(host)) {
      throw new Error(
        `Invalid environment configuration:\n  - LAZADA_PRODUCTS: "${url}" is not a lazada.co.th url`,
      );
    }
    return { name, url };
  });
};

export const env = {
  ...raw,
  products: parseProducts(raw.LAZADA_PRODUCTS),
  /// Empty set = watch every SKU on the page.
  skuFilter: new Set(csv(raw.LAZADA_SKU_IDS)),
  telegramChatIds: csv(raw.TELEGRAM_CHAT_ID),
} as const;

export type Env = typeof env;

export const isTelegramConfigured = (): boolean =>
  env.TELEGRAM_BOT_TOKEN.length > 0 && env.telegramChatIds.length > 0;
