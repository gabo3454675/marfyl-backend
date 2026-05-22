# PDF en Producción (AWS)

## Diagnóstico

- **No usamos Puppeteer ni Chromium.** La generación de facturas usa **PDFKit**, que trabaja 100% en Node.js con Buffers. No requiere navegador ni dependencias del sistema (libX11, libXcomposite, etc.).
- El PDF se genera **en memoria** y se devuelve como Buffer. No se escriben archivos en disco.

## Dependencias NPM

```bash
cd apps/server
pnpm add pdfkit
pnpm add -D @types/pdfkit
```

Ya están en `package.json`:

```json
"pdfkit": "^0.17.2",
"@types/pdfkit": "^0.17.4"
```

## Dependencias del Sistema en AWS

**No necesitas instalar nada extra.** PDFKit utiliza fuentes estándar de PDF (Helvetica, Courier) incluidas en la librería. No se usan fuentes del sistema ni `fontconfig`.

Si en el futuro usas fuentes personalizadas (TTF/OTF), entonces sí podrías necesitar `fontconfig` en la instancia.

## Configuración del Controller

- `Content-Type: application/pdf`
- `Content-Disposition: inline; filename="factura-{id}.pdf"` (se abre en el navegador)
- No se guardan archivos en disco; se envía el Buffer directamente.

## Contenido del PDF

- Header con marca "disis" y datos de la organización (tenant)
- Datos del cliente
- Tabla: Código, Descripción, Cantidad, P. Unit., Total
- Totales con moneda y tasa de la organización
- Fuentes: Helvetica / Helvetica-Bold (estándar PDF, sin dependencias externas)

## Multi-tenant

El PDF usa `currencyCode`, `currencySymbol` y `exchangeRate` de la organización de la factura (`organizationId`). Cada tenant ve su moneda y tasa configurada.
