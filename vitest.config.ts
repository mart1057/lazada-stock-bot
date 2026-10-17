import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The bot validates its environment at import time; give tests a safe one.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      TZ: 'Asia/Bangkok',
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_CHAT_ID: '123456789',
      TELEGRAM_DRY_RUN: 'true',
      ALERT_COPY_GAP_SECONDS: '0',
    },
  },
});
