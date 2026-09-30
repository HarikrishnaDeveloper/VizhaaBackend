-- AlterTable
ALTER TABLE "SupplierProfile" ADD COLUMN     "address" TEXT,
ADD COLUMN     "businessName" TEXT,
ADD COLUMN     "businessType" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "dob" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "ownerName" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "statusReason" TEXT,
ADD COLUMN     "transportMode" TEXT;

-- CreateIndex
CREATE INDEX "SupplierProfile_status_idx" ON "SupplierProfile"("status");


-- Backfill: existing suppliers get a status matching their KYC state
UPDATE "SupplierProfile" SET "status" = 'APPROVED' WHERE "kycStatus" = 'APPROVED';
UPDATE "SupplierProfile" SET "status" = 'REJECTED' WHERE "kycStatus" = 'REJECTED';
UPDATE "SupplierProfile" SET "status" = 'UNDER_REVIEW' WHERE "kycStatus" = 'PENDING' AND "kycSubmittedAt" IS NOT NULL;
