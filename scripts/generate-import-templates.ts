/**
 * Genera plantillas Excel MARFYL para:
 *  - Compras (compatible con /purchases-import)
 *  - Ventas (formato MARFYL manual + /sales-import)
 *  - Autoconsumo/merma (compatible con /inventory/movements/import)
 *
 *   ./node_modules/.bin/tsx scripts/generate-import-templates.ts
 */
import "dotenv/config";
import { mkdirSync, copyFileSync, existsSync } from "fs";
import { join } from "path";
import * as ExcelJS from "exceljs";

const OUT_DIR = join(__dirname, "../templates/imports");
const DESCARGAS = "/home/gabdev/Descargas/MARFYL-plantillas";

type Col = { header: string; width: number; note: string; example: unknown };

function styleHeader(ws: ExcelJS.Worksheet, colCount: number) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F4E79" },
  };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  row.height = 36;
  for (let i = 1; i <= colCount; i++) {
    ws.getCell(1, i).border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

function addInstructions(
  wb: ExcelJS.Workbook,
  title: string,
  lines: string[],
) {
  const ws = wb.addWorksheet("INSTRUCCIONES");
  ws.getColumn(1).width = 100;
  ws.addRow([title]);
  ws.getRow(1).font = { bold: true, size: 14, color: { argb: "FF1F4E79" } };
  ws.addRow([]);
  for (const line of lines) ws.addRow([line]);
  ws.getColumn(1).alignment = { wrapText: true };
}

function addDataSheet(
  wb: ExcelJS.Workbook,
  name: string,
  cols: Col[],
  exampleRows: unknown[][],
  listValidations?: { col: number; list: string }[],
) {
  const ws = wb.addWorksheet(name, { properties: { defaultRowHeight: 18 } });
  ws.addRow(cols.map((c) => c.header));
  styleHeader(ws, cols.length);
  cols.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
    ws.getCell(1, i + 1).note = c.note;
  });
  for (const row of exampleRows) {
    const r = ws.addRow(row);
    r.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } },
      };
    });
  }
  if (listValidations) {
    for (const v of listValidations) {
      const colLetter = ws.getColumn(v.col).letter;
      for (let i = 2; i <= 1001; i++) {
        ws.getCell(`${colLetter}${i}`).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [`"${v.list}"`],
          showErrorMessage: true,
          errorTitle: "Valor no permitido",
          error: `Use uno de: ${v.list}`,
        };
      }
    }
  }
  return ws;
}

async function buildCompras() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARFYL";
  addDataSheet(
    wb,
    "DATOS",
    [
      { header: "MES", width: 12, note: "Opcional. Ej: AGOSTO", example: "AGOSTO" },
      { header: "FECHA", width: 14, note: "Obligatoria en la 1ª línea de cada factura. Formato DD/MM/AAAA", example: "11/08/2026" },
      { header: "FACTURA", width: 16, note: "Nº factura o nota del proveedor. Obligatoria por bloque.", example: "FACT-71963" },
      { header: "PROVEEDOR", width: 36, note: "Nombre del proveedor", example: "COMERCIALIZADORA HEN & SAM, C.A." },
      { header: "STATUS", width: 14, note: "Opcional. Ej: YA REGISTRADO", example: "" },
      { header: "CANTIDAD", width: 12, note: "Unidades compradas (entero > 0)", example: 20 },
      { header: "SKU", width: 18, note: "Código único del producto en MARFYL / código de barras", example: "00000052" },
      { header: "NOMBRE DEL PRODUCTO", width: 32, note: "Nombre legible (recomendado)", example: "HELADO BARQUILLA" },
      { header: "COSTO", width: 12, note: "Costo unitario USD", example: 0.81 },
      { header: "PRECIO VENTA", width: 14, note: "Precio venta unitario USD", example: 1.4 },
      { header: "DESCRIPCION", width: 18, note: "Familia/categoría opcional. Ej: HELADO, CHARCUTERIA", example: "HELADO" },
      { header: "EXENTO", width: 12, note: "EXENTO o GRAVADO", example: "EXENTO" },
    ],
    [
      ["AGOSTO", "11/08/2026", "FACT-71963", "COMERCIALIZADORA LA ESQUINA", "", 7, "00000017", "QUESO BLANCO 1KG", 6.78, 11, "CHARCUTERIA", "EXENTO"],
      ["", "", "", "", "", 24, "0000000000023", "1/2 CARTON DE HUEVOS", 2.33, 3.5, "CHARCUTERIA", "EXENTO"],
      ["AGOSTO", "11/08/2026", "NOTA-106199", "COMERCIALIZADORA HEN & SAM, C.A.", "", 20, "00000052", "HELADO BARQUILLA", 0.81, 1.4, "HELADO", "EXENTO"],
      ["", "", "", "", "", 15, "000000142", "HELADO CREMOSO OREO", 0.66, 1.1, "HELADO", "EXENTO"],
    ],
    [{ col: 12, list: "EXENTO,GRAVADO,SI,NO" }],
  );
  addInstructions(wb, "Plantilla MARFYL — COMPRAS", [
    "Dónde subir: Inventario → Importar compras",
    "Moneda: todos los montos en USD.",
    "Una compra = mismo bloque FECHA + FACTURA + PROVEEDOR. Cuando cambie la factura, vuelva a llenar esas columnas en la primera línea del bloque.",
    "SKU debe existir en el catálogo (o el sistema puede crear el producto si no existe, según preview).",
    "CANTIDAD: entero > 0. COSTO: costo unitario USD. PRECIO VENTA: precio de venta USD (opcional pero recomendado).",
    "EXENTO: EXENTO o GRAVADO (o SI/NO).",
    "No borre la fila de encabezados. Puede borrar las filas de ejemplo y poner las reales.",
    "Fecha: DD/MM/AAAA (ej. 11/08/2026).",
  ]);
  return wb.xlsx.writeBuffer();
}

async function buildVentas() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARFYL";
  addDataSheet(
    wb,
    "DATOS",
    [
      { header: "FECHA", width: 14, note: "DD/MM/AAAA", example: "11/08/2026" },
      { header: "DOCUMENTO", width: 22, note: "ID único del ticket. Ej: CAJA-20260811-001", example: "CAJA-20260811-001" },
      { header: "SKU", width: 18, note: "SKU o código de barras del producto", example: "7591031003267" },
      { header: "NOMBRE DEL PRODUCTO", width: 32, note: "Opcional, ayuda a revisar", example: "PEPSI 2 LITROS" },
      { header: "CANTIDAD", width: 12, note: "Unidades vendidas", example: 2 },
      { header: "TOTAL LINEA USD", width: 16, note: "Total cobrado de la línea en USD", example: 4.06 },
      { header: "METODO PAGO", width: 16, note: "EFECTIVO_USD / PUNTO / PAGO_MOVIL / ZELLE / EFECTIVO_BS", example: "EFECTIVO_USD" },
      { header: "CLIENTE", width: 24, note: "Opcional. Si vacío = CLIENTE NATURAL CONTADO", example: "" },
    ],
    [
      ["11/08/2026", "CAJA-20260811-001", "7591031003267", "PEPSI 2 LITROS", 1, 2.03, "EFECTIVO_USD", ""],
      ["11/08/2026", "CAJA-20260811-001", "00000052", "HELADO BARQUILLA", 2, 2.8, "PUNTO", ""],
      ["11/08/2026", "CAJA-20260811-002", "75902940", "CERVEZA POLAR PILSEN BOTELLA RETORNABLE 222ML", 6, 10.5, "EFECTIVO_USD", ""],
      ["11/08/2026", "CAJA-20260811-003", "5000277001200", "WHISKY DEWARS 1 LITRO", 1, 45, "ZELLE", ""],
    ],
    [
      {
        col: 7,
        list: "EFECTIVO_USD,PUNTO,PAGO_MOVIL,ZELLE,EFECTIVO_BS",
      },
    ],
  );
  addInstructions(wb, "Plantilla MARFYL — VENTAS", [
    "Dónde subir: Ventas → Importar ventas",
    "Use esta plantilla para ventas manuales del día (cuando no haya reporte FastReport).",
    "DOCUMENTO: identificador único del ticket/factura del día (ej. CAJA-20260811-001). No lo repita entre días.",
    "Líneas con el mismo DOCUMENTO se agrupan en una sola factura.",
    "SKU obligatorio y debe existir en catálogo. Si falta, use primero «Crear productos faltantes» en la pantalla de importación.",
    "CANTIDAD > 0. TOTAL LINEA USD = lo cobrado por esa línea (no el precio unitario).",
    "METODO PAGO (opcional): EFECTIVO_USD, PUNTO, PAGO_MOVIL, ZELLE, EFECTIVO_BS. Si lo deja vacío = EFECTIVO_USD.",
    "FECHA: DD/MM/AAAA. Esta venta DESCUENTA stock al confirmar.",
    "También puede seguir subiendo reportes FastReport (.xls) del sistema anterior; ambos formatos son válidos.",
  ]);
  return wb.xlsx.writeBuffer();
}

async function buildAutoconsumo() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARFYL";
  addDataSheet(
    wb,
    "DATOS",
    [
      { header: "FECHA", width: 14, note: "DD/MM/AAAA", example: "11/08/2026" },
      { header: "SKU", width: 18, note: "SKU del producto", example: "00000052" },
      { header: "NOMBRE DEL PRODUCTO", width: 32, note: "Opcional", example: "HELADO BARQUILLA" },
      { header: "CANTIDAD", width: 12, note: "Unidades a descontar", example: 1 },
      { header: "TIPO", width: 16, note: "AUTOCONSUMO / MERMA_VENCIDO / MERMA_DANADO / USO_TALLER", example: "AUTOCONSUMO" },
      { header: "MOTIVO", width: 16, note: "MERMA / MUESTRAS / USO_OPERATIVO", example: "USO_OPERATIVO" },
      { header: "RAZON", width: 40, note: "Detalle: ej. Consumo personal turno noche", example: "Consumo personal cajera" },
    ],
    [
      ["11/08/2026", "00000052", "HELADO BARQUILLA", 1, "AUTOCONSUMO", "USO_OPERATIVO", "Consumo personal turno"],
      ["11/08/2026", "7591031003267", "PEPSI 2 LITROS", 1, "MERMA_DANADO", "MERMA", "Envase roto en nevera"],
      ["11/08/2026", "7591031005988", "GATORADE MANDARINA 500ML", 2, "MERMA_VENCIDO", "MERMA", "Vencimiento agosto"],
    ],
    [
      { col: 5, list: "AUTOCONSUMO,MERMA_VENCIDO,MERMA_DANADO,USO_TALLER" },
      { col: 6, list: "MERMA,MUESTRAS,USO_OPERATIVO" },
    ],
  );
  addInstructions(wb, "Plantilla MARFYL — AUTOCONSUMO / MERMA", [
    "Dónde subir: Inventario → Movimientos (Importar Excel) o Autoconsumo",
    "Cada fila = una salida de inventario. DESCUENTA stock y registra gasto operativo/merma.",
    "SKU obligatorio y debe existir. CANTIDAD entero > 0 y no puede superar el stock disponible.",
    "TIPO: AUTOCONSUMO | MERMA_VENCIDO | MERMA_DANADO | USO_TALLER",
    "MOTIVO (opcional): MERMA | MUESTRAS | USO_OPERATIVO — para el dashboard.",
    "RAZON: texto libre (quién / por qué). Recomendado.",
    "FECHA: DD/MM/AAAA (informativa en la nota; el movimiento se registra al importar).",
  ]);
  return wb.xlsx.writeBuffer();
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(DESCARGAS, { recursive: true });

  const files: { name: string; buffer: ExcelJS.Buffer }[] = [
    { name: "MARFYL-plantilla-COMPRAS.xlsx", buffer: await buildCompras() },
    { name: "MARFYL-plantilla-VENTAS.xlsx", buffer: await buildVentas() },
    { name: "MARFYL-plantilla-AUTOCONSUMO.xlsx", buffer: await buildAutoconsumo() },
  ];

  const { writeFileSync } = await import("fs");
  for (const f of files) {
    const a = join(OUT_DIR, f.name);
    const b = join(DESCARGAS, f.name);
    writeFileSync(a, Buffer.from(f.buffer as ArrayBuffer));
    writeFileSync(b, Buffer.from(f.buffer as ArrayBuffer));
    console.log("OK", a);
    console.log("OK", b);
  }
  console.log("\nPlantillas listas.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
