import { describe, expect, it } from 'vitest';
import { detectChange } from '../src/stock/stock.detector.js';

describe('detectChange', () => {
  it('first observation never notifies', () => {
    expect(detectChange(null, { status: 'AVAILABLE' })).toMatchObject({
      shouldNotify: false,
      reason: 'first-observation',
    });
  });

  it('out of stock -> in stock notifies', () => {
    expect(detectChange({ available: false, status: 'UNAVAILABLE' }, { status: 'AVAILABLE' })).toMatchObject({
      shouldNotify: true,
      reason: 'became-available',
    });
  });

  it('in stock -> in stock stays quiet', () => {
    expect(detectChange({ available: true, status: 'AVAILABLE' }, { status: 'AVAILABLE' }).shouldNotify).toBe(
      false,
    );
  });

  it('in stock -> out of stock is recorded but not pushed', () => {
    expect(detectChange({ available: true, status: 'AVAILABLE' }, { status: 'UNAVAILABLE' })).toMatchObject({
      shouldNotify: false,
      shouldUpdateAvailable: true,
      reason: 'became-unavailable',
    });
  });

  it('UNKNOWN never notifies and never overwrites the last answer', () => {
    expect(detectChange({ available: false, status: 'UNAVAILABLE' }, { status: 'UNKNOWN' })).toMatchObject({
      shouldNotify: false,
      shouldUpdateAvailable: false,
    });
  });

  it('a block (UNKNOWN) between two sold-out checks cannot fake a restock', () => {
    // sold out -> UNKNOWN keeps available=false -> still sold out: no edge
    const afterUnknown = { available: false, status: 'UNKNOWN' as const };
    expect(detectChange(afterUnknown, { status: 'UNAVAILABLE' }).shouldNotify).toBe(false);
    // ... and a real restock after a block still alerts
    expect(detectChange(afterUnknown, { status: 'AVAILABLE' }).shouldNotify).toBe(true);
  });
});
