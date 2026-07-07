# 📋 Changelog - Marfyl

Todos los cambios significativos del sistema se documentan aquí.

---

## [7 Julio 2026] - Variantes de Producto

### ✨ Nueva Funcionalidad

#### Backend — CRUD de Variantes
- **Modelo `ProductVariant`**: Nueva tabla `product_variants` con relación 1:N a `Product`
- **DTOs**: `CreateVariantDto` y `UpdateVariantDto` con validaciones (class-validator)
- **Endpoints**:
  - `GET /products/:id/variants` — Listar variantes de un producto
  - `POST /products/:id/variants` — Crear variante (nombre, precio, cantidad, comportamiento de stock, costo)
  - `PATCH /products/variants/:variantId` — Actualizar variante (todos los campos opcionales)
  - `DELETE /products/variants/:variantId` — Eliminar variante
- **Permisos**: Lectura requiere `canViewProducts`, escritura requiere `canManageProducts`
- **Multi-tenant**: Aislamiento por `organizationId` en todas las queries

#### Modelo de Datos
- **`ProductVariant`**: `name`, `salePrice`, `unitQuantity`, `stockBehavior` (DEDUCT/NO_DEDUCT), `inheritCost`, `customCost`, `isDefault`, `sortOrder`, `isActive`
- **`InvoiceItem`**: Campo `variantId` opcional para asociar ítems de factura a variante
- **`InventoryMovement`**: Campo `variantId` opcional para movimientos de inventario por variante
- **Unique**: `@@unique([productId, name])` — no duplicados por producto
- **Cascade**: `onDelete: Cascade` desde Product

#### Frontend — Gestión de Variantes
- **`VariantManager`** (`components/products/`): Card con lista de variantes, crear/editar/eliminar, reordenar, toggle activo, cambiar default
- **`VariantForm`**: Diálogo de creación/edición con todos los campos del modelo
- **`VariantListItem`**: Fila individual con indicador de default, badge de cantidad, selector de activo
- **`VariantSelector`** (`components/pos/`): Diálogo modal para seleccionar variante al agregar producto al carrito POS

#### API Client
- **`lib/api/variants.ts`**: `variantService.getAll()`, `.create()`, `.update()`, `.remove()`, `.reorder()`
- **Tipos**: `ProductVariant`, `CreateVariantPayload`, `UpdateVariantPayload` en `types/product-variant.ts`

### 📁 Archivos Creados

#### Backend
| Archivo | Descripción |
|---------|------------|
| `src/modules/products/dto/create-variant.dto.ts` | DTO de creación con validaciones |
| `src/modules/products/dto/update-variant.dto.ts` | DTO de actualización (campos opcionales) |

#### Frontend
| Archivo | Descripción |
|---------|------------|
| `src/components/products/VariantManager.tsx` | Gestor completo de variantes |
| `src/components/products/VariantForm.tsx` | Formulario crear/editar variante |
| `src/components/products/VariantListItem.tsx` | Fila individual de variante |
| `src/components/products/index.ts` | Barrel export |
| `src/components/pos/variant-selector.tsx` | Selector modal para POS |
| `src/lib/api/variants.ts` | API client de variantes |
| `src/types/product-variant.ts` | Tipos TypeScript |

### 📁 Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `prisma/schema.prisma` | Modelo `ProductVariant`, campos `variantId` en `InvoiceItem` e `InventoryMovement` |
| `src/modules/products/products.controller.ts` | 4 endpoints de variantes |
| `src/modules/products/products.service.ts` | Métodos CRUD de variantes |

---

## [6 Julio 2026] - Módulo de Gestión de Proveedores

### ✨ Nuevo Módulo

#### Página de Proveedores — Frontend
- **Página `/suppliers`**: CRUD completo con tabla paginada con búsqueda server-side (`usePaginatedQuery`), diálogo de creación y edición pre-rellenado, y eliminación con confirmación
- **Permisos**: Requiere `canManageExpenses` para ver/editar, `canDelete` para eliminar

### 🔧 Refactor

#### Expenses — Frontend
- **`expenses/page.tsx`**: Reemplazadas llamadas directas a `apiClient.get('/suppliers')` con `supplierService.getAll()` para listar proveedores
- **CRUD de proveedores**: Reemplazados `apiClient.patch/post/delete` con `supplierService.update/create/remove` respectivamente
- **Interface `Supplier`**: Eliminada definición local — ahora se importa desde `@/lib/api/suppliers`
- **UX**: Botón "Agregar Proveedor" integrado en 3 contextos dentro de expenses:
  - Diálogo de gasto (selector de proveedor vacío)
  - Importación de compra (selector de proveedor vacío)
  - Pestaña de proveedores (estado vacío)

### 🗄️ Base de Datos

- **Nuevo índice**: `suppliers_taxId_idx` sobre `taxId` en tabla `suppliers` para optimizar búsqueda
- **Migración**: `20260706120000_add_suppliers_taxid_index`
- **Ejecutar con**: `npx prisma migrate deploy`

### 📁 Archivos Creados

| Archivo | Descripción |
|---------|------------|
| `src/app/(dashboard)/suppliers/page.tsx` | Página CRUD de proveedores con tabla paginada |
| `prisma/migrations/20260706120000_add_suppliers_taxid_index/migration.sql` | Índice `taxId` |

### 📁 Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `src/app/(dashboard)/expenses/page.tsx` | Refactor a `supplierService`, botón "Agregar Proveedor" contextual |

---

## [1 Julio 2026] - Módulo de Subida de Facturas con Actualización Automática de Inventario

### ✨ Nuevo Módulo

#### Módulo `invoice-upload` — Backend
- **Endpoint POST `/invoice-upload/preview`**: Parsea archivos Excel/PDF de facturas de compra, resuelve productos por SKU → código de barras → nombre fuzzy, y retorna vista previa editable
- **Endpoint POST `/invoice-upload/confirm`**: Ejecuta la importación con líneas ajustadas — crea InventoryMovement(type=COMPRA), actualiza Product.stock y costPrice, opcionalmente crea Expense
- **Endpoint GET `/invoice-upload/products/search`**: Búsqueda de productos para autocomplete (nombre, SKU, código de barras)
- **Endpoint GET `/invoice-upload/history`**: Historial de subidas anteriores (consultando Expense por descripción)

#### Módulo `invoice-upload` — Frontend
- **Página `/inventory/invoice-upload`**: Interfaz completa con zona de drag-and-drop, tabla de preview editable inline, autocomplete de productos para filas sin match, y pestaña de historial
- **Navegación**: Nuevo ítem "Subir Factura" en la sección Inventario del sidebar

### 🔧 Detalles Técnicos
- **Fuzzy matching**: Algoritmo de búsqueda difusa por nombre (normalización + substring containment) con scores de confianza
- **Transaccionalidad**: Confirm ejecuta en `$transaction` Prisma (todo o nada)
- **Multi-tenant**: Aislamiento completo por organizationId en todas las queries
- **Permisos**: Requiere `canManageInventory`

### 📁 Archivos Creados
- `src/modules/invoice-upload/invoice-upload.module.ts`
- `src/modules/invoice-upload/invoice-upload.controller.ts`
- `src/modules/invoice-upload/invoice-upload.service.ts`
- `src/modules/invoice-upload/dto/confirm-invoice.dto.ts`
- `src/modules/invoice-upload/dto/invoice-upload-history.dto.ts`
- `src/app/(dashboard)/inventory/invoice-upload/page.tsx`
- `src/lib/api/invoice-upload.ts`

### 📁 Archivos Modificados
- `src/app.module.ts` — Registro de InvoiceUploadModule
- `src/config/app-nav.ts` — Nuevo ítem de navegación
- `src/lib/api/index.ts` — Export de invoice-upload service

---

## [4 Junio 2026] - Auditoría Integral y Hardening de Seguridad

### 🔒 Seguridad

#### CRÍTICO - Corregido
- **SEC-001**: Eliminadas credenciales hardcoded `338232gG` y `monddy33` de `provision-founding.ts`
- **SEC-002**: Validación obligatoria de `JWT_SECRET` en producción - rechaza valores inseguros
- **SEC-003**: Tokens públicos de facturas ahora usan `crypto.randomBytes(32)` en lugar de `uuidv4`
- **SEC-004**: Endpoint `mark-paid` protegido con rate limiting (3/min)

#### ALTO - Corregido
- **SEC-005/006**: Rate limiting agregado en auth (login, register, password recovery) y endpoints públicos
- **SEC-007**: Middleware CSRF implementado - valida Origin/Referer en requests state-changing

#### MEDIO - Corregido
- **SEC-009**: Contraseña por defecto `MARFYL2026!` eliminada - ahora es obligatoria en invitaciones

#### Schema - Nuevo
- **Soft-delete**: Agregados campos `deletedAt` a `Organization`, `Invoice`, `Expense` para compliance fiscal Venezuela (5+ años)
- ⚠️ **Requiere migración:** `pnpm prisma migrate dev --name add_soft_delete`

---

### 🐛 Bugs Corregidos

- **BUG-002**: PDF de facturas ahora muestra IVA real en lugar de `taxVal = 0`

---

### ⚡ Performance

- **UX-001**: Paginación server-side en facturas - `GET /api/invoices?page=&limit=&search=&status=`
- **UX-002**: Paginación server-side en productos - `GET /api/products?page=&limit=&search=&categoryId=`
- **UX-003**: Dashboard optimizado con `GROUP BY` y `aggregate()` en lugar de `findMany`

---

### 🎨 UI/UX

- **R1**: `AdminTableWrap` - padding mejorado para móviles (`-mx-3 sm:-mx-1`)
- **R2**: `FiscalToolbar` - responsive para pantallas <400px
- **R3**: `InvoiceDetailSheet` - ancho máximo ampliado (`max-w-xl md:max-w-2xl`)
- **R5**: Grid POS - nuevo breakpoint `xs` para móviles pequeños
- **R6**: Métricas - `break-all` en lugar de `break-words` para números
- **R7**: `.admin-section` - CSS corregido para primer hijo
- **E2**: Descarga PDF - `alert()` reemplazado por `toast.error()`
- **B3**: `retryLast()` - manejo de errores agregado
- **B6**: `AdminCard` - handling de `children` corregido

---

### 📝 Archivos Modificados

#### Backend (`marfyl-backend/`)

| Archivo | Cambio |
|---------|--------|
| `prisma/schema.prisma` | Soft-delete fields + indexes |
| `prisma/provision-founding.ts` | Credenciales obligatorias, validación |
| `.env` | Warnings de seguridad documentados |
| `src/main.ts` | JWT_SECRET validation, CSRF middleware |
| `src/modules/auth/auth.controller.ts` | Rate limiting en auth |
| `src/modules/invoices/invoices.service.ts` | crypto.randomBytes, IVA en PDF, paginación |
| `src/modules/invoices/invoices.controller.ts` | Paginación endpoints |
| `src/modules/invoices/invoices-public.controller.ts` | Rate limiting |
| `src/modules/products/products.service.ts` | Paginación |
| `src/modules/products/products.controller.ts` | Paginación + Query import |
| `src/modules/invitations/invitations.service.ts` | Sin fallback de contraseña |
| `src/modules/dashboard/dashboard.service.ts` | Aggregations, $queryRaw |
| `src/common/middleware/csrf.middleware.ts` | **NUEVO** |

#### Frontend (`marfyl-frontend/`)

| Archivo | Cambio |
|---------|--------|
| `src/components/admin/admin-card.tsx` | Padding, children check |
| `src/components/fiscal/fiscal-toolbar.tsx` | Responsive |
| `src/components/invoice-detail-sheet.tsx` | max-width |
| `src/components/assistant/assistant-panel.tsx` | Error handling |
| `src/app/(dashboard)/pos/page.tsx` | Grid breakpoints |
| `src/app/(dashboard)/invoices/page.tsx` | toast en vez de alert |
| `src/app/globals.css` | admin-section, break-all |

---

### 📄 Documentación Nueva/Actualizada

| Archivo | Descripción |
|---------|-------------|
| `SECURITY_AUDIT.md` | **NUEVO** - Reporte completo de auditoría |
| `PRODUCTION_CONFIG.md` | Actualizado con security hardening |
| `DEPLOYMENT.md` | Actualizado para Marfyl |

---

## [Anterior] - Historia previa

(Agregar entradas anteriores aquí)
