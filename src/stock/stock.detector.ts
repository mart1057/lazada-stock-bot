import type { LazadaStock, StockStatus } from './stock.types.js';

/// What the detector needs from the last saved state of a SKU.
export interface PreviousStockState {
  /// Last DEFINITIVE answer (UNKNOWN checks never overwrite it).
  available: boolean;
  /// Last OBSERVED status, may be UNKNOWN.
  status: StockStatus;
}

export interface DetectionDecision {
  shouldNotify: boolean;
  /// Overwrite the saved `available`. False while the observation is UNKNOWN.
  shouldUpdateAvailable: boolean;
  previousStatus: StockStatus;
  currentStatus: StockStatus;
  reason:
    | 'first-observation'
    | 'unknown-observation'
    | 'became-available'
    | 'became-unavailable'
    | 'unchanged';
}

/**
 * The one rule that keeps the chat free of spam (same as true-stock-bot):
 *
 *     previous.available === false && current === AVAILABLE   -> notify
 *
 *   - first observation (empty state / new SKU) never notifies,
 *   - UNKNOWN never notifies and never overwrites the last known answer,
 *     so a Lazada block cannot manufacture a false "back in stock" edge,
 *   - AVAILABLE -> AVAILABLE on every tick stays silent,
 *   - AVAILABLE -> UNAVAILABLE is recorded but not pushed.
 */
export const detectChange = (
  previous: PreviousStockState | null,
  current: Pick<LazadaStock, 'status'>,
): DetectionDecision => {
  const currentStatus = current.status;
  const previousStatus: StockStatus = previous?.status ?? 'UNKNOWN';

  if (currentStatus === 'UNKNOWN') {
    return {
      shouldNotify: false,
      shouldUpdateAvailable: false,
      previousStatus,
      currentStatus,
      reason: 'unknown-observation',
    };
  }

  if (previous === null) {
    return {
      shouldNotify: false,
      shouldUpdateAvailable: true,
      previousStatus,
      currentStatus,
      reason: 'first-observation',
    };
  }

  if (currentStatus === 'AVAILABLE') {
    const becameAvailable = previous.available === false;
    return {
      shouldNotify: becameAvailable,
      shouldUpdateAvailable: true,
      previousStatus,
      currentStatus,
      reason: becameAvailable ? 'became-available' : 'unchanged',
    };
  }

  return {
    shouldNotify: false,
    shouldUpdateAvailable: true,
    previousStatus,
    currentStatus,
    reason: previous.available ? 'became-unavailable' : 'unchanged',
  };
};
