# ADR-002: SaleMode + Combos y Descorches (Monddy)

## Status

Accepted (Gate B **APPROVED_WITH_NOTES**; follow-ups FE **APPROVED_WITH_NOTES**)

## Date

2026-08-16

## Context

Monddy necesita vender **tarifas de descorche** (servicio) y **combos de licor** (BOM) sin confundir stock de botella con cobro de tarifa. Beers/tobos quedan **fuera** de esta entrega.

## Decision

### SaleMode en líneas

Enum Prisma `SaleMode`: `STANDARD` | `DESCORCHE` | `COMBO`.

- Persistido en `InvoiceItem.saleMode` y `FloorOrderItem.saleMode` (default `STANDARD`).
- Al cobrar comanda → factura, se **copia** `saleMode` de cada `FloorOrderItem` al ítem de factura.
- Resolución: `resolveSaleMode()` — solo `DESCORCHE` / `COMBO` se aceptan; cualquier otro valor → `STANDARD`.

### Stock por modalidad

Canonical: `src/common/bom/sale-mode-stock.ts`.

| Modalidad / producto | Comportamiento de stock |
|----------------------|-------------------------|
| `DESCORCHE` + línea `isService` | Nunca descuenta botella; solo acompañamientos BOM (si existen). Tarifas v1: BOM vacío. |
| Botella / producto no-servicio + `saleMode=DESCORCHE` | **Rechazo** (`assertDescorcheAllowed` / invoices): DESCORCHE solo en `isService`. |
| Combo (`isBundle`) / `COMBO` | Solo componentes BOM; nunca el padre. |
| `STANDARD` producto normal | Descuenta el padre. |

Invariantes BOM: componente `isService` o `isBundle` anidado → no descontable (rechazo).

### Catálogo Monddy (staging)

**Descorches** (5 tarifas `isService`, BOM vacío v1):

| SKU | Precio USD | Notas |
|-----|------------|--------|
| `DESCORCHE-30` | 30 | Alta/upsert |
| `0000112` (VIP) / fallback `DESCORCHE-20` | 20 | Reutilizar si `salePrice=20` |
| `DESCORCHE-15` | 15 | Alta/upsert |
| `DESCORCHE-10` | 10 | Genérico |
| `0000125` (VINO) | 10 | Reutilizar si precio=10; mapeo vinos |

**Combos**: 16 productos `COMBO-01` … `COMBO-15B` (`isBundle`). Descorche **no** entra en BOM (`DESCORCHE_SKU_BLOCKLIST`). Hint `suggestedDescorcheSku` / tarifa solo como **anotación** (description); no auto-agrega línea en POS.

Fuentes: `src/common/monddy/descorche-catalog.ts`, `src/common/monddy/liquor-combo-catalog.ts`.

### Seeds (solo staging)

Orden:

1. `scripts/seed-monddy-descorches.ts`
2. `scripts/seed-monddy-liquor-combos.ts`

Guardas: `DATABASE_URL` debe contener `ep-curly-star` (staging); abort si `ep-super-art` (prod). Org: `monddy`.

### Schema floor en staging

Aplicado en **staging** (`ep-curly-star`) vía `scripts/staging-apply-floor-schema.sql`:

- 5 tablas `floor_*` + columna `floor_order_items.saleMode`.

**Producción** (`ep-super-art`): **aún sin** migración SaleMode / este schema floor. No asumir prod migrado.

### Frontend (POS + comanda)

- Picker de `saleMode` en POS y comanda.
- Resolución UI: `DESCORCHE` si `isService`; `COMBO` si `isBundle`; payloads envían `saleMode`.
- Comanda `avail()`: evalúa `isBundle` / `isService` **antes** de `availableStock` para que combos/servicios aparezcan.
- Critic FE: **APPROVED_WITH_NOTES** — nota cosmética: badge `999999` disp. (no bloqueante).

### Alcance explícitamente fuera

- **Beers / tobos**: OUT de esta entrega (sigue fuera).

### Deuda aceptada (v1)

Clasificación botella/licor en BOM vía heurística `classifyLiquorProduct(name)` (sin columna `role` en schema). Aceptada para v1 (Gate B notes).

## Consequences

### Positive

- Modalidad explícita en línea (comanda y factura).
- Stock de descorche no toca botella; combos descuentan solo BOM.
- Seeds acotados a staging con abort de producción.
- Staging floor + `saleMode` en comanda operables en `ep-curly-star`.
- UI picker POS/comanda envía `saleMode`; combos visibles en comanda tras fix `avail()`.

### Negative / notes

- Heurística de nombre para botella en BOM (deuda v1).
- Prod **sin** SaleMode / schema floor de este follow-up.
- Badge FE `999999` disp. (nota cosmética critic).

## Related Files

- `prisma/schema.prisma` — enum `SaleMode`; `InvoiceItem.saleMode`; `FloorOrderItem.saleMode`
- `src/common/bom/sale-mode-stock.ts` (+ `.spec.ts`)
- `src/modules/invoices/invoices.service.ts` — validación DESCORCHE + stock
- `src/modules/floor-orders/floor-orders.service.ts` — persistencia, copia Floor→Invoice al cobrar
- `src/common/monddy/descorche-catalog.ts`, `liquor-combo-catalog.ts`
- `scripts/seed-monddy-descorches.ts`, `scripts/seed-monddy-liquor-combos.ts`
- `scripts/staging-apply-floor-schema.sql` — floor + `saleMode` solo staging
- Frontend: picker POS/comanda; `avail()` comanda; tipos/API con `saleMode`
