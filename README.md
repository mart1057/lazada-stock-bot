# lazada-stock-bot

Stock monitor for **iPhone Duo on Lazada Thailand** (Apple Flagship Store),
with Telegram alerts.

Sibling of `true-stock-bot` / `iphone-stock-bot`: same rules for when to
alert, same Telegram style, separate process and separate state.

Listing: <https://www.lazada.co.th/products/-i16250067859-s127511251733.html>
(short link `https://s.lazada.co.th/s.Z95obC?c=d`) — 2 colours × 4 capacities = 8 SKUs.

---

## Quick start

```bash
npm install
cp .env.example .env        # fill TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
# open the bot in Telegram and press Start once
npm run notify:test         # should arrive in the chat
npm run check               # one sweep, printed - confirms Lazada is readable
npm run dev                 # start monitoring
```

Needs Google Chrome installed (default `BROWSER_CHANNEL=chrome`). Without
Chrome: set `BROWSER_CHANNEL=` and run `npm run browser:install` once.

Production: `npm run build && npm start` (or run it under `pm2`).

---

## How it gets the data

Lazada's server-rendered HTML does **not** contain real stock: every SKU
carries a placeholder `quantity: {limit:{max:5}, type:"default"}`. After
loading, the page asks `mtop.global.detail.web.getDetailInfo` and only then
shows "สินค้าหมด". That API only answers Lazada's own web client (signed
requests + a security SDK); a plain HTTP call gets `FAIL_SYS_ILLEGAL_ACCESS`.

So the bot opens the product page in a real browser (Playwright + your
Chrome, persistent profile in `.browser-profile/`) and reads what the page
loaded for itself. Between full reloads (`PAGE_RELOAD_MINUTES`) it asks the
already-open page to repeat that request, which is far lighter.

It does **not** solve captchas or tamper with Lazada's protection. If Lazada
shows a slider / verification, that check is **blocked**: the bot pauses
(`COOLDOWN_*`), says so in Telegram, and tries again later. If it happens
often, run once with `HEADLESS=false`, pass the check in the window yourself,
and the profile remembers it.

### What counts as "available"

```
AVAILABLE = quantity.limit.max > 0 AND quantity.type !== "warning"
```

Sold out looks like `{limit:{max:0,min:0}, text:"สินค้าหมด", type:"warning"}`.

Anything the bot does not understand — a block, a timeout, a shape change,
a SKU missing from the answer — becomes **UNKNOWN**, never UNAVAILABLE.
UNKNOWN never alerts and never overwrites the last known answer.

### When it alerts

```
previous.available === false && current === AVAILABLE   ->  alert (sent ALERT_COPIES times)
```

The first run only stores a baseline; in-stock → in-stock stays quiet;
going out of stock is recorded but not pushed. State lives in
`data/state.json`, so restarts neither re-alert nor forget.

---

## Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | – | bot + chat(s), comma separated |
| `LAZADA_PRODUCTS` | the iPhone Duo listing | `Name\|url;Name\|url` |
| `LAZADA_SKU_IDS` | empty = all | watch only these SKUs (ids from `npm run check`) |
| `STOCK_CHECK_INTERVAL_SECONDS` | `45` | gap after each check ends (min 15) |
| `BROWSER_CHANNEL` | `chrome` | empty = Playwright Chromium |
| `HEADLESS` | `true` | `false` shows the browser window |
| `PAGE_RELOAD_MINUTES` | `20` | full page reload interval |
| `ALERT_COPIES` | `2` | restock alert repeats, `ALERT_COPY_GAP_SECONDS` apart |
| `COOLDOWN_BASE_SECONDS` / `_MAX_` | `120` / `1800` | pause when blocked, doubling |

SKU ids (current listing):

| SKU | Variant | Price |
|---|---|---|
| 127511251733 | Star White / 256GB | ฿79,900 |
| 127511251734 | Night Sky / 256GB | ฿79,900 |
| 127511251736 | Star White / 512GB | ฿87,900 |
| 127511251737 | Night Sky / 512GB | ฿87,900 |
| 127636474781 | Star White / 1TB | ฿103,900 |
| 127636474782 | Night Sky / 1TB | ฿103,900 |
| 127636474784 | Star White / 2TB | ฿127,900 |
| 127636474785 | Night Sky / 2TB | ฿127,900 |

---

## Layout

```
src/lazada/        talking to lazada.co.th
  lazada.browser.ts    Playwright page: load / re-ask, block detection
  lazada.parser.ts     detail module -> one observation per SKU
  lazada.availability.ts one sweep over LAZADA_PRODUCTS
  lazada.types.ts      zod schema of the detail module
src/stock/         change detection + JSON state
src/notification/  Telegram + message text
src/scheduler/     fixed-delay loop, cooldown on block
src/scripts/       check-once, test-notification
```

## Tests

```bash
npm test
```

The parser suite runs against a real `getDetailInfo` answer captured on
17 Oct 2026 (`tests/fixtures/detail-response.json`, pruned to the fields used).

## License

MIT
