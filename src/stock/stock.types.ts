export type StockStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';

/// One SKU (colour x capacity) as observed on one check.
export interface LazadaStock {
  productName: string; // "iPhone Duo" - from LAZADA_PRODUCTS
  productUrl: string; // the configured PDP url
  title: string; // Lazada's listing title
  sellerName: string; // "Apple Flagship Store"
  itemId: string;
  skuId: string;
  label: string; // "Star White / 256GB"
  color: string; // "Star White"
  storage: string; // "256GB" ('' when the listing has no capacity option)
  priceTHB: number | null;
  /// Max purchasable per order as Lazada reports it (0 when out of stock).
  quantityMax: number | null;
  quantityText: string | null; // "สินค้าหมด"
  status: StockStatus;
  /// Mirror of status === 'AVAILABLE'. UNKNOWN is never `true`.
  available: boolean;
  url: string; // deep link to this SKU
  checkedAt: Date;
}

/// A false -> true edge. Only these produce an alert.
export interface StockTransition {
  previousStatus: StockStatus;
  currentStatus: StockStatus;
  stock: LazadaStock;
}

export interface StockCheckResult {
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  checked: number;
  available: number;
  unavailable: number;
  unknown: number;
  transitions: StockTransition[];
  firstRun: boolean;
  errors: string[];
  /// Lazada's anti-bot answered on at least one product this cycle.
  blocked: boolean;
}
