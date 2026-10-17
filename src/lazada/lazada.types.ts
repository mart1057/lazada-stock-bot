import { z } from 'zod';

/**
 * Shape of the PDP "detail module" - what `mtop.global.detail.web.getDetailInfo`
 * returns in `data.module` (a JSON string) and what the page writes into
 * `window.__moduleData__.data.root.fields` once it has loaded.
 *
 * Schemas are deliberately loose (passthrough everywhere): only the fields the
 * bot reads are required, so an unrelated Lazada change does not break it.
 */

const quantitySchema = z
  .object({
    limit: z
      .object({
        max: z.coerce.number(),
        min: z.coerce.number().optional(),
      })
      .passthrough(),
    /// "สินค้าหมด" when out of stock
    text: z.string().optional(),
    /// "warning" when out of stock, "default" otherwise
    type: z.string().optional(),
  })
  .passthrough();

export type LazadaQuantity = z.infer<typeof quantitySchema>;

const skuInfoSchema = z
  .object({
    skuId: z.coerce.string(),
    itemId: z.coerce.string().optional(),
    price: z
      .object({
        salePrice: z
          .object({
            value: z.coerce.number().optional(),
            text: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    quantity: quantitySchema.optional(),
  })
  .passthrough();

const propertySchema = z
  .object({
    pid: z.coerce.string(),
    name: z.string(),
    values: z.array(z.object({ vid: z.coerce.string(), name: z.string() }).passthrough()),
  })
  .passthrough();

const skuSchema = z
  .object({
    skuId: z.coerce.string(),
    itemId: z.coerce.string(),
    /// "30097:-2;30361:512GB" - pid:vid pairs into `properties`
    propPath: z.string().default(''),
    pagePath: z.string().optional(),
  })
  .passthrough();

export const detailModuleSchema = z
  .object({
    product: z.object({ title: z.string().optional() }).passthrough().optional(),
    seller: z.object({ name: z.string().optional() }).passthrough().optional(),
    productOption: z
      .object({
        skuBase: z
          .object({
            properties: z.array(propertySchema).default([]),
            skus: z.array(skuSchema),
          })
          .passthrough(),
      })
      .passthrough(),
    /// Keyed by skuId. Lazada also puts the default SKU under key "0".
    skuInfos: z.record(skuInfoSchema),
  })
  .passthrough();

export type DetailModule = z.infer<typeof detailModuleSchema>;

/// Lazada's anti-bot answered (captcha / slider / "illegal access").
/// Never retried in a tight loop - drives the scheduler's cooldown.
export class LazadaBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LazadaBlockedError';
  }
}

/// Anything else: timeout, page never hydrated, unexpected JSON shape.
export class LazadaFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LazadaFetchError';
  }
}

export const isBlockedError = (error: unknown): boolean => error instanceof LazadaBlockedError;
