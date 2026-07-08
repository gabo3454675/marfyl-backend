import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { InventoryService } from "../src/modules/inventory/inventory.service";
import * as fs from "fs";

async function main() {
  const buffer = fs.readFileSync(
    "C:/Users/glong/Desktop/INVENTARIO MONDDY  06072026.xlsx",
  );
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error"],
  });
  const inv = app.get(InventoryService);
  try {
    const preview = await inv.importFromExcelWithDryRun({
      file: {
        buffer,
        originalname: "test.xlsx",
        mimetype:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      } as Express.Multer.File,
      organizationId: 2,
      confirm: false,
    });
    const firstUpdate = preview.preview.find((p) => p.action === "update");
    console.log("Sample update row:", JSON.stringify(firstUpdate, null, 2));
    console.log("costPrice type:", typeof firstUpdate?.costPrice, firstUpdate?.costPrice);

    const result = await inv.importFromExcelWithDryRun({
      file: {
        buffer,
        originalname: "test.xlsx",
        mimetype:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      } as Express.Multer.File,
      organizationId: 2,
      confirm: true,
    });
    console.log("Import OK:", result);
  } catch (e: any) {
    console.error("Import FAIL:", e.message);
  } finally {
    await app.close();
  }
}

main();
