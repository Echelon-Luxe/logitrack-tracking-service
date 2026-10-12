ALTER TABLE "TrackingEvent"
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "driverUserId" TEXT;

CREATE TABLE "LocationPing" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "driverUserId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "heading" DOUBLE PRECISION,
    "speedKph" DOUBLE PRECISION,
    "accuracyM" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationPing_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LocationPing_shipmentId_recordedAt_idx" ON "LocationPing"("shipmentId", "recordedAt");
CREATE INDEX "LocationPing_recordedAt_idx" ON "LocationPing"("recordedAt");
