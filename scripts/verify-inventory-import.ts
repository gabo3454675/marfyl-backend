/**
 * Verifica el parseo de un Excel contra importFromExcelWithDryRun (confirm=false).
 * Uso: npx ts-node -r tsconfig-paths/register scripts/verify-inventory-import.ts "C:\path\file.xlsx"
 */
import * as fs from "fs";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { InventoryService } from "../src/modules/inventory/inventory.service";

async function main() {
  const filePath = process.argv[2];
  if (!filePath || !fs.existsSync(filePath)) {
    console.error("Uso: npx ts-node scripts/verify-inventory-import.ts <ruta.xlsx>");
    process.exit(1);
  }

  const buffer = fs.readFileSync(filePath);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error"],
  });

  try {
    const inventory = app.get(InventoryService);
    const result = await inventory.importFromExcelWithDryRun({
      file: {
        buffer,
        originalname: filePath.split(/[/\\]/).pop() || "test.xlsx",
        mimetype:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      } as Express.Multer.File,
      organizationId: 1,
      confirm: false,
    });

    console.log("=== Vista previa importación ===");
    console.log(`Filas válidas: ${result.preview.length}`);
    console.log(`Errores: ${result.errors.length}`);
    console.log(`Crear: ${result.summary.toCreate} | Actualizar: ${result.summary.toUpdate}`);
    if (result.preview.length > 0) {
      console.log("\nPrimeras 3 filas:");
      console.log(JSON.stringify(result.preview.slice(0, 3), null, 2));
    }
    if (result.errors.length > 0) {
      console.log("\nPrimeros 5 errores:");
      console.log(JSON.stringify(result.errors.slice(0, 5), null, 2));
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
