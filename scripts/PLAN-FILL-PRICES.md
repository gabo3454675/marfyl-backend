# Plan: Fill Prices from Hybrid API

## 1. Resumen Ejecutivo

- **Qué hace el script:** lee un Excel de inventario, identifica productos sin precio de venta, consulta la Hybrid API para obtener los precios por SKU, y genera un Excel actualizado + log JSON de trazabilidad
- **Ubicación:** `scripts/fill-prices-from-hybrid.ts`
- **Modos:** dry-run (default) y `--apply`

---

## 2. Contexto del Proyecto

- **Proyecto:** Marfyl — POS/inventario multi-tenant
- **Backend:** NestJS + Prisma en `/home/alvarovargas/Desktop/Marfyl-Project/marfyl-backend/`
- **Hybrid API:** `https://db.marfyl.site` (Bearer token, SOLO LECTURA)
- **Variables de entorno en `.env`:**
  - `HYBRID_API_BASE_URL=https://db.marfyl.site`
  - `HYBRID_API_TOKEN=4bccbaed4c20eaaa03474f29bd9d234c2d70c4c9fe3bbdd4789b18ee9dc6edc4`
  - `HYBRID_AUTH_HEADER=bearer`
- **DB staging:** `postgresql://neondb_owner:npg_pJqlIUYo2Eg7@ep-curly-star-aidptmh7-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`

---

## 3. Archivo de Entrada (Excel)

- **Ruta:** `/home/alvarovargas/Downloads/INVENTARIO REALLL.xlsx`
- **Estructura de columnas:**

| Columna | Campo | Tipo | Notas |
|---------|-------|------|-------|
| A | SKU | string | Código del producto. Se normaliza con `trim().toUpperCase()` |
| B | NOMBRE DEL PRODUCTO | string | Nombre comercial |
| C | COSTO | number | Costo unitario (formato: coma como decimal, ej: "0,58") |
| D | PRECIO VENTA | number | **Campo objetivo** — si es 0 o vacío, se llena desde Hybrid |
| E | GANANCIA | number | Margen de ganancia |
| F | STOCK | number | Cantidad en inventario |
| G | DESCRIPCION | string | Descripción del producto |
| H | EXENTO | string | "SI" o "NO" — exento de impuesto |

- Headers en fila 1, datos desde fila 2
- Separador decimal: coma (ej: "1,00" → 1.00)
- **Ejemplo de datos:**

```
6912345679107	MAIZ DULCE LAILA 184G	0,58	1,05	55,18	23	MAIZ DULCE LAILA 184G	NO
00000052	HELADO BARQUILLA	0,81	1,40	73,00	11	HELADO BARQUILLA	SI
000000131 	JABON DE BAÑO PALMOLIVE SURTIDOS	1,00	1,74	50,00	0	JABON DE BAÑO PALMOLIVE SURTIDOS	NO
```

---

## 4. Endpoint de Hybrid API para Precios

- **Endpoint:** `GET /tablas/TInventario?q={SKU}&limit=1`
- **Documentación Hybrid (README línea 439-442):**
  > `GET /tablas/{nombre}?q=&limit=&offset=` → paginado crudo. Campos `THT_*` / `PRD_*` tal cual Hybrid.
- **Campo de precio:** `PRD_PRECIOVENTA` (precio de venta del producto)
- **Campo de costo:** `PRD_PRECIOCOSTO` (costo del producto)
- **Auth:** `Authorization: Bearer {token}`
- **Timeout:** 30 segundos por request
- **Rate limit:** 500ms delay entre requests
- **Respuesta esperada:**

```json
{
  "items": [
    {
      "PRD_CODIGO": "00000052",
      "PRD_NOMBRE": "HELADO BARQUILLA",
      "PRD_PRECIOVENTA": 1.40,
      "PRD_PRECIOCOSTO": 0.81
    }
  ]
}
```

---

## 5. Archivos de Salida

- **Excel actualizado:** `/home/alvarovargas/Downloads/INVENTARIO REALLL_con_precios.xlsx`
- **Log JSON:** `/home/alvarovargas/Downloads/INVENTARIO REALLL_con_precios_log.json`
- Se generan SOLO con `--apply`

---

## 6. Esquema del Log JSON

```json
{
  "timestamp": "2026-08-16T12:00:00.000Z",
  "inputFile": "/home/alvarovargas/Downloads/INVENTARIO REALLL.xlsx",
  "outputFile": "/home/alvarovargas/Downloads/INVENTARIO REALLL_con_precios.xlsx",
  "summary": {
    "total": 762,
    "withPrice": 700,
    "withoutPrice": 62,
    "filled": 50,
    "notFound": 8,
    "errors": 4
  },
  "changes": [
    {
      "sku": "00000052",
      "action": "filled",
      "oldPrice": 0,
      "newPrice": 1.40,
      "endpoint": "/tablas/TInventario?q=00000052&limit=1",
      "response": { "items": [...] }
    }
  ]
}
```

---

## 7. Acciones del Log (ChangeEntry.action)

| Acción | Descripción |
|--------|-------------|
| `filled` | Se encontró precio en Hybrid y se completó en el Excel |
| `skipped_no_price` | No se encontró precio en Hybrid (producto no existe, precio vacío, o precio no positivo) |
| `skipped_error` | Error de conexión, HTTP error, o respuesta inesperada de la API |

---

## 8. Flujo de Ejecución

1. Validar que el archivo Excel existe
2. Validar que el token de Hybrid está configurado
3. Parsear el Excel (fila 1 = headers, datos desde fila 2)
4. Identificar productos donde PRECIO VENTA es NaN, 0, o negativo
5. Para cada producto sin precio:
   a. Normalizar SKU (trim + toUpperCase)
   b. Consultar `GET /tablas/TInventario?q={SKU}&limit=1`
   c. Extraer `PRD_PRECIOVENTA` de la respuesta
   d. Validar que el precio es > 0
   e. Si es válido: llenar en el Excel (columna D)
   f. Si no es válido: registrar como `skipped_no_price`
   g. Aplicar delay de 500ms antes del siguiente request
6. Si `--apply`: guardar Excel actualizado + log JSON
7. Si no hay `--apply`: solo mostrar resumen en consola

---

## 9. Modos de Ejecución

| Comando | Modo | Qué hace |
|---------|------|----------|
| `tsx scripts/fill-prices-from-hybrid.ts` | Dry-run (default) | Muestra qué haría sin crear archivos |
| `tsx scripts/fill-prices-from-hybrid.ts --apply` | Apply | Genera Excel + log JSON |

---

## 10. Dependencias

- `exceljs` (ya en package.json del backend)
- `dotenv` (ya en package.json del backend)
- `fetch` nativo (Node 18+)
- `tsx` para ejecutar TypeScript

---

## 11. Problemas Conocidos y Correcciones Pendientes

### Issue 1: Endpoint duplicado (línea 269)

**Problema:** La variable `endpoint` se construye dos veces — una dentro de `fetchHybridPrice` (línea 139) y otra en el loop de `main` (línea 269). `fetchHybridPrice` ya retorna `endpoint` en su resultado.

**Corrección:** Eliminar la línea 269 (`const endpoint = ...`) y usar `result.endpoint` en su lugar.

### Issue 2: Clasificación inconsistente de "precio no positivo"

**Problema:** Cuando `PRD_PRECIOVENTA` es 0 o negativo, `fetchHybridPrice` retorna `error: "PRD_PRECIOVENTA is not positive: X"`. Este error cae en la rama `else if (result.error)` (línea 284) que lo clasifica como `skipped_error`, pero conceptualmente debería ser `skipped_no_price`.

**Corrección:** Agregar `result.error?.startsWith("PRD_PRECIOVENTA is not positive")` a la condición de la línea 271.

---

## 12. Verificación

### Paso 1: Compilación TypeScript

```bash
cd /home/alvarovargas/Desktop/Marfyl-Project/marfyl-backend
npx tsc --noEmit scripts/fill-prices-from-hybrid.ts --esModuleInterop --resolveJsonModule --skipLibCheck
```

### Paso 2: Dry-run

```bash
./node_modules/.bin/tsx scripts/fill-prices-from-hybrid.ts
```

**Esperado:** muestra total de productos, cuántos sin precio, y comienza a consultar Hybrid API.

### Paso 3: Apply

```bash
./node_modules/.bin/tsx scripts/fill-prices-from-hybrid.ts --apply
```

**Esperado:** genera `INVENTARIO REALLL_con_precios.xlsx` e `INVENTARIO REALLL_con_precios_log.json` en `/home/alvarovargas/Downloads/`.

---

## 13. Rollback

- El Excel original **NUNCA** se modifica (se genera uno nuevo)
- El log JSON contiene cada cambio: SKU, precio anterior, precio nuevo, endpoint consultado, respuesta completa
- Para revertir: simplemente no usar el Excel generado, o usar el log para identificar qué se cambió

---

## 14. Referencia de Scripts Existentes

- `scripts/apply-monddy-cuadre-caja-inventario.ts` — patrón de script con `--apply`, ExcelJS, parseNumber con coma
- `prisma/import-inventory-bulk.ts` — patrón de parseo de Excel, normalización de SKU, batch processing

---

## 15. Instrucciones para la IA

1. Lee el script actual en `scripts/fill-prices-from-hybrid.ts`
2. Aplica las correcciones del Issue 1 y Issue 2 de la sección 11
3. Verifica compilación con `tsc --noEmit`
4. Ejecuta dry-run y verifica que funciona
5. Ejecuta `--apply` y verifica que genera los archivos
6. Revisa el log JSON generado para confirmar trazabilidad
