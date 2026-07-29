import { Prisma } from "@prisma/client";
import { applyInvoiceIssueDateGuard } from "@/modules/invoices/issue-date";

/**
 * Fail-closed: ningún invoice.create/createMany puede persistir sin issueDate.
 * Legacy sin issueDate lanza; operativa sin issueDate recibe `new Date()`.
 */
export const invoiceIssueDateGuardExtension = Prisma.defineExtension({
  name: "invoiceIssueDateGuard",
  query: {
    invoice: {
      async create({ args, query }) {
        if (args.data && typeof args.data === "object") {
          applyInvoiceIssueDateGuard(args.data as Record<string, unknown>);
        }
        return query(args);
      },
      async createMany({ args, query }) {
        if (args.data === undefined) return query(args);
        const rows = Array.isArray(args.data) ? args.data : [args.data];
        for (const row of rows) {
          if (row && typeof row === "object") {
            applyInvoiceIssueDateGuard(row as Record<string, unknown>);
          }
        }
        return query(args);
      },
    },
  },
});
