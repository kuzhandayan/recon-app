-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('ORDERS', 'PAYMENTS');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DiscrepancyClass" AS ENUM ('DUPLICATE_PAYMENT', 'PAID_BUT_CANCELLED', 'MISSING_PAYMENT', 'FAILED_PAYMENT', 'ORPHAN_PAYMENT', 'CURRENCY_MISMATCH', 'PARTIAL_REFUND', 'UNRECORDED_REFUND', 'OVERCHARGED', 'UNDERCHARGED', 'PENDING_PAYMENT', 'DELAYED_SETTLEMENT', 'MISSING_FIELDS', 'WITHIN_TOLERANCE', 'MATCHED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Import" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "FileKind" NOT NULL,
    "key" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderKey" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "customerEmail" TEXT,
    "currency" TEXT NOT NULL,
    "grossAmount" DECIMAL(10,2) NOT NULL,
    "discount" DECIMAL(10,2),
    "netAmount" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionRef" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL,
    "orderKey" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "fee" DECIMAL(10,2) NOT NULL,
    "netSettled" DECIMAL(10,2) NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discrepancy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderKey" TEXT NOT NULL,
    "class" "DiscrepancyClass" NOT NULL,
    "severity" "Severity" NOT NULL,
    "amountDifference" DECIMAL(10,2),
    "details" JSONB,
    "explanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Discrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Import_userId_idx" ON "Import"("userId");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_userId_orderKey_key" ON "Order"("userId", "orderKey");

-- CreateIndex
CREATE INDEX "Payment_userId_orderKey_idx" ON "Payment"("userId", "orderKey");

-- CreateIndex
CREATE INDEX "Discrepancy_userId_idx" ON "Discrepancy"("userId");

-- CreateIndex
CREATE INDEX "Discrepancy_userId_class_idx" ON "Discrepancy"("userId", "class");

-- AddForeignKey
ALTER TABLE "Import" ADD CONSTRAINT "Import_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
