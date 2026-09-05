-- CreateIndex
CREATE UNIQUE INDEX "Payment_userId_transactionRef_key" ON "Payment"("userId", "transactionRef");
