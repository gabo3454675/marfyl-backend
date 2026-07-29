/**
 * Prisma client for one-off scripts (tsx), with the same invoice.issueDate
 * fail-closed guard as Nest PrismaService.
 *
 * Prefer this over `new PrismaClient()` whenever a script may call
 * invoice.create / createMany.
 */
import { PrismaClient } from "@prisma/client";
import { invoiceIssueDateGuardExtension } from "../../src/common/prisma/invoice-issue-date.extension";

export function createScriptPrisma() {
  return new PrismaClient().$extends(invoiceIssueDateGuardExtension);
}

export type ScriptPrisma = ReturnType<typeof createScriptPrisma>;
