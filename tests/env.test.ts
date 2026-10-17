import { describe, expect, it } from 'vitest';
import { DEFAULT_PRODUCTS, parseProducts } from '../src/config/env.js';

describe('parseProducts', () => {
  it('default watches the iPhone Duo listing', () => {
    expect(parseProducts(DEFAULT_PRODUCTS)).toEqual([
      { name: 'iPhone Duo', url: 'https://www.lazada.co.th/products/-i16250067859-s127511251733.html' },
    ]);
  });

  it('accepts short links and several products', () => {
    expect(
      parseProducts('A|https://s.lazada.co.th/s.Z95obC?c=d; B|https://www.lazada.co.th/products/x-i1-s2.html'),
    ).toHaveLength(2);
  });

  it('rejects non-Lazada urls and missing names', () => {
    expect(() => parseProducts('A|https://example.com/x')).toThrow(/lazada/);
    expect(() => parseProducts('https://www.lazada.co.th/products/x.html')).toThrow(/Name\|url/);
  });
});
