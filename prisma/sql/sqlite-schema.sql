-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "points" INTEGER NOT NULL DEFAULT 0,
    "memberCode" TEXT,
    "dataConsentAt" DATETIME,
    "dataConsentVersion" TEXT,
    "appTermsAt" DATETIME,
    "appTermsVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'web',
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatThread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "lastMessageAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageBody" TEXT,
    "lastSenderRole" TEXT,
    "unreadAdmin" INTEGER NOT NULL DEFAULT 0,
    "unreadCustomer" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChatThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderRole" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🍗',
    "imageColor" TEXT NOT NULL DEFAULT '#F97316',
    "imageData" TEXT,
    "imageMime" TEXT,
    "spicy" INTEGER NOT NULL DEFAULT 0,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "popular" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "userId" TEXT,
    "customerName" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DINE_IN',
    "tableNo" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "qrisTrxId" TEXT,
    "qrisPayload" TEXT,
    "qrisMode" TEXT,
    "qrisExpiresAt" DATETIME,
    "qrisAmount" INTEGER,
    "qrisProvider" TEXT,
    "qrisFallbackReason" TEXT,
    "qrisDeclaredAt" DATETIME,
    "paidAt" DATETIME,
    "paidVia" TEXT,
    "subtotal" INTEGER NOT NULL,
    "serviceFee" INTEGER NOT NULL DEFAULT 0,
    "deliveryArea" TEXT,
    "distanceKm" REAL,
    "deliveryFee" INTEGER NOT NULL DEFAULT 0,
    "courierName" TEXT,
    "courierPhone" TEXT,
    "onTheWayAt" DATETIME,
    "courierLat" REAL,
    "courierLng" REAL,
    "courierLocAt" DATETIME,
    "deliveryPhotoAt" DATETIME,
    "courierUserId" TEXT,
    "deliveryLat" REAL,
    "deliveryLng" REAL,
    "codSetoranId" TEXT,
    "voucherCode" TEXT,
    "voucherDiscount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'APP',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_codSetoranId_fkey" FOREIGN KEY ("codSetoranId") REFERENCES "CourierSetoran" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeliveryPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "mime" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedByUserId" TEXT,
    "uploadedByName" TEXT,
    CONSTRAINT "DeliveryPhoto_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourierSetoran" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courierUserId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "ongkir" INTEGER NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" DATETIME,
    CONSTRAINT "CourierSetoran_courierUserId_fkey" FOREIGN KEY ("courierUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🍗',
    "price" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "note" TEXT,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Voucher" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'PERCENT',
    "value" INTEGER NOT NULL,
    "minPurchase" INTEGER NOT NULL DEFAULT 0,
    "maxDiscount" INTEGER,
    "quota" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ownerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VoucherRedemption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "voucherId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VoucherRedemption_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "orderId" TEXT,
    "voucherId" TEXT,
    "description" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PointTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BiometricCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "deviceType" TEXT,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "transports" TEXT,
    "rpId" TEXT,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    CONSTRAINT "BiometricCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BiometricChallenge" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "challenge" TEXT NOT NULL,
    "rpId" TEXT,
    "origin" TEXT,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StoreSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'main',
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "qrisEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ewalletEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bannerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bannerTitle" TEXT,
    "bannerText" TEXT,
    "bannerImageData" TEXT,
    "bannerImageMime" TEXT,
    "bannerUpdatedAt" DATETIME,
    "promoStripEnabled" BOOLEAN NOT NULL DEFAULT true,
    "promoStripBadge" TEXT NOT NULL DEFAULT 'Promo Hari Ini',
    "promoStripTitle" TEXT NOT NULL DEFAULT 'Paket Komplit mulai Rp 27.000',
    "promoStripText" TEXT NOT NULL DEFAULT 'Geprek + nasi + es teh manis jumbo',
    "menuHeroEnabled" BOOLEAN NOT NULL DEFAULT true,
    "menuHeroBadge" TEXT NOT NULL DEFAULT 'Promo Spesial',
    "menuHeroTitle" TEXT NOT NULL DEFAULT 'Paket Komplit mulai Rp 27.000',
    "menuHeroText" TEXT NOT NULL DEFAULT 'Geprek + nasi + es teh manis jumbo',
    "menuHeroImageData" TEXT,
    "menuHeroImageMime" TEXT,
    "menuHeroUpdatedAt" DATETIME,
    "menuPromoVouchersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "menuPromoVouchersMax" INTEGER NOT NULL DEFAULT 3,
    "menuPromoBanners" JSONB,
    "menuPromoBannersUpdatedAt" DATETIME,
    "menuPromoBanner1ImageData" TEXT,
    "menuPromoBanner1ImageMime" TEXT,
    "menuPromoBanner2ImageData" TEXT,
    "menuPromoBanner2ImageMime" TEXT,
    "videoPromoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "videoPromoSlides" JSONB,
    "videoPromoUpdatedAt" DATETIME,
    "videoPromoSlot1Data" TEXT,
    "videoPromoSlot1Mime" TEXT,
    "videoPromoSlot2Data" TEXT,
    "videoPromoSlot2Mime" TEXT,
    "videoPromoSlot3Data" TEXT,
    "videoPromoSlot3Mime" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "QrisSandboxTrx" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trxid" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "qrString" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "paidAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_memberCode_key" ON "User"("memberCode");

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE INDEX "PushToken_userId_idx" ON "PushToken"("userId");

-- CreateIndex
CREATE INDEX "PushToken_role_idx" ON "PushToken"("role");

-- CreateIndex
CREATE UNIQUE INDEX "ChatThread_userId_key" ON "ChatThread"("userId");

-- CreateIndex
CREATE INDEX "ChatThread_lastMessageAt_idx" ON "ChatThread"("lastMessageAt");

-- CreateIndex
CREATE INDEX "ChatMessage_threadId_createdAt_idx" ON "ChatMessage"("threadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "PasswordReset_email_idx" ON "PasswordReset"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Order_code_key" ON "Order"("code");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryPhoto_orderId_key" ON "DeliveryPhoto"("orderId");

-- CreateIndex
CREATE INDEX "DeliveryPhoto_uploadedAt_idx" ON "DeliveryPhoto"("uploadedAt");

-- CreateIndex
CREATE INDEX "CourierSetoran_courierUserId_idx" ON "CourierSetoran"("courierUserId");

-- CreateIndex
CREATE INDEX "CourierSetoran_createdAt_idx" ON "CourierSetoran"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_code_key" ON "Voucher"("code");

-- CreateIndex
CREATE INDEX "Voucher_isActive_idx" ON "Voucher"("isActive");

-- CreateIndex
CREATE INDEX "Voucher_ownerId_idx" ON "Voucher"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherRedemption_orderId_key" ON "VoucherRedemption"("orderId");

-- CreateIndex
CREATE INDEX "VoucherRedemption_userId_idx" ON "VoucherRedemption"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherRedemption_voucherId_userId_key" ON "VoucherRedemption"("voucherId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PointTransaction_orderId_key" ON "PointTransaction"("orderId");

-- CreateIndex
CREATE INDEX "PointTransaction_userId_createdAt_idx" ON "PointTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BiometricCredential_userId_idx" ON "BiometricCredential"("userId");

-- CreateIndex
CREATE INDEX "BiometricChallenge_expiresAt_idx" ON "BiometricChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "QrisSandboxTrx_trxid_key" ON "QrisSandboxTrx"("trxid");

-- CreateIndex
CREATE INDEX "QrisSandboxTrx_expiresAt_idx" ON "QrisSandboxTrx"("expiresAt");

