-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "currencyCode" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "currencySymbol" TEXT NOT NULL DEFAULT '$';
