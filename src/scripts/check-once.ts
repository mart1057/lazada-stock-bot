/**
 * npm run check - one sweep, printed as a table. Does not touch the saved
 * state and sends nothing. Use it to confirm the browser can read Lazada and
 * to look up SKU ids for LAZADA_SKU_IDS.
 */
import { lazadaAvailabilityCollector } from '../lazada/lazada.availability.js';
import { lazadaBrowser } from '../lazada/lazada.browser.js';
import { storageRank } from '../lazada/lazada.parser.js';
import { formatBaht } from '../utils/datetime.js';

const ICON = { AVAILABLE: '🟢', UNAVAILABLE: '🔴', UNKNOWN: '⚪' } as const;

const main = async (): Promise<void> => {
  const snapshot = await lazadaAvailabilityCollector.collect();
  const rows = [...snapshot.stocks].sort(
    (a, b) => storageRank(a.storage) - storageRank(b.storage) || a.color.localeCompare(b.color),
  );

  for (const stock of rows) {
    console.log(
      `${ICON[stock.status]} ${stock.status.padEnd(11)} ${stock.skuId}  ${stock.label.padEnd(24)} ${formatBaht(stock.priceTHB).padEnd(10)} ${stock.quantityText ?? `max ${stock.quantityMax ?? '?'}`}`,
    );
  }
  if (rows.length > 0) console.log(`\n${rows[0]?.title} — ${rows[0]?.sellerName}`);
  for (const error of snapshot.errors) console.error(`✗ ${error}`);
  process.exitCode = snapshot.errors.length > 0 ? 1 : 0;
};

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void lazadaBrowser.close());
