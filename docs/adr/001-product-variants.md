# ADR-001: ProductVariant Table for Multiple Prices per Product

## Status

Accepted

## Date

2026-07-07

## Context

Marfyl POS needs to support multiple prices per product based on sale type (BOTELLA SOLA, SERVICIO NORMAL, SERVICIO EVENTO, TOBO, CAJA). A single product can have different prices depending on how it is sold, and different unit quantities affect stock deduction.

The business requirements are:

- A "Licores" product might sell at \$15 (BOTELLA), \$15 (SERVICIO NORMAL), or \$20 (SERVICIO EVENTO)
- A "Cerveza" product might sell at \$3 (BOTELLA), \$30 (TOBO x12), or \$300 (CAJA x36)
- Stock is deducted by base unit: CAJA x36 = deduct 36 units, TOBO x12 = deduct 12, BOTELLA = 1
- Services (SERVICIO NORMAL/EVENTO) should not deduct stock
- Backward compatibility: existing products without variants must continue working

## Decision

We will use a separate `ProductVariant` table with 1:N relationship to Product.

### Chosen Approach: ProductVariant Table

- New `ProductVariant` model in Prisma schema with fields: `name`, `salePrice`, `unitQuantity`, `stockBehavior` (enum: DEDUCT/NO_DEDUCT), `inheritCost`, `customCost`, `isDefault`, `sortOrder`, `isActive`
- `VariantStockBehavior` enum: `DEDUCT` (descuenta unitQuantity del stock base), `NO_DEDUCT` (no descuenta stock — servicios, eventos)
- `Product.salePrice` stays synchronized with the default variant's price via `syncProductSalePrice()` method
- Stock lives only on `Product.stock` (not duplicated per variant)
- `InvoiceItem.variantId` is nullable for backward compatibility
- `InventoryMovement.variantId` is nullable for backward compatibility
- Unique constraint: `@@unique([productId, name])` — no duplicate variant names per product
- Cascade delete: when a Product is deleted, all its variants are removed

### Alternatives Considered

#### Alternative 1: JSON Fields on Product

Add a `variants: JSON` field to the Product model.

- **Pros:** Simple to implement, no schema migration for new tables
- **Cons:** No referential integrity, no foreign keys, harder to query/filter, no index support, no type safety, complex to maintain in Prisma

**Veredict:** Rejected. JSON fields introduce maintenance debt and lack the safety guarantees of a relational model.

#### Alternative 2: ProductBundle / Composite Products

Each "variant" is modeled as a separate product with a bundle relationship pointing back to the base product.

- **Pros:** Reuses the existing Product model entirely
- **Cons:** Over-engineered for the use case, stock management becomes complex (composite product stock vs base stock), confusing data model for POS operators, requires bundle component resolution for every sale

**Veredict:** Rejected. Adds unnecessary complexity. The simple 1:N variant table is more straightforward.

#### Alternative 3: Price Tiers Table

Separate price table with sale type as an enum, storing only price overrides.

- **Pros:** Clean separation of price from product
- **Cons:** Does not handle `unitQuantity` differences (12 vs 36 units), does not handle `stockBehavior` differences (DEDUCT vs NO_DEDUCT), requires additional logic for stock deduction rules

**Veredict:** Rejected. Price alone is insufficient — the business needs different unit quantities and stock behaviors per variant.

## Consequences

### Positive

- **Clean data model** with referential integrity and foreign keys
- **Flexible:** each variant owns its price, unit quantity, and stock behavior independently
- **Backward-compatible:** existing products without variants work without changes (nullable `variantId` on InvoiceItem and InventoryMovement)
- **Queryable:** variants can be indexed, filtered, and joined efficiently
- **Extensible:** supports future needs (different SKUs per variant, barcodes per variant, images per variant)
- **Idempotent import:** parser handles Excel rows with/without SKU to detect variants vs base products

### Negative

- **Extra table and joins:** every invoice creation now requires variant lookup and validation
- **Synchronization complexity:** `Product.salePrice` must stay in sync with the default variant (mitigated by `syncProductSalePrice()` called on every variant create/update/delete)
- **Seed migration needed:** existing products need a default variant created post-deployment

### Risks

- **Multiple defaults per product** — mitigated by app-layer validation in `createVariant()` and `updateVariant()` (resets existing defaults before assigning a new one)
- **Decimal precision mismatch** — mitigated by consistent use of `@db.Decimal(10, 2)` across all price/cost fields
- **Server-side variant resolution** — POS must send `variantId` with each invoice item; UI must handle variant selection

## Related Files

- `prisma/schema.prisma` — ProductVariant model (lines 337–359), VariantStockBehavior enum (lines 294–297), InvoiceItem.variantId (line 623), InventoryMovement.variantId (line 309)
- `src/modules/products/products.service.ts` — CRUD operations (createVariant, updateVariant, deleteVariant, getVariantsByProduct), syncProductSalePrice, MonddY Excel parser with variant detection
- `src/modules/products/products.controller.ts` — REST endpoints for variants (GET/POST/PATCH/DELETE)
- `src/modules/products/dto/create-variant.dto.ts` — CreateVariantDto with validation
- `src/modules/products/dto/update-variant.dto.ts` — UpdateVariantDto with partial updates
- `src/modules/inventory/inventory-movements.service.ts` — Stock deduction logic with variant unitQuantity and stockBehavior
- `src/modules/inventory/dto/create-movement.dto.ts` — Optional variantId field
- `src/modules/invoices/invoices.service.ts` — Price resolution from variant, effective quantity calculation, stock deduction control
- `src/modules/invoices/dto/create-invoice.dto.ts` — Optional variantId per invoice item
