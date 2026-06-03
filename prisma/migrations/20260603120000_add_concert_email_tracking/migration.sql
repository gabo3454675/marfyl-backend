-- AlterTable
ALTER TABLE "concert_orders" ADD COLUMN     "emailSentAt" TIMESTAMP(3),
ADD COLUMN     "emailSentTo" TEXT;
