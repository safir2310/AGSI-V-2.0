// Cek READ-ONLY: apakah kolom courierAnim sudah ada di tabel StoreSetting
// database produksi (information_schema — metadata saja, tanpa menyentuh data).
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
try {
  const cols = await db.$queryRaw`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'StoreSetting' AND column_name IN ('courierAnim', 'videoPromoSlides')
    ORDER BY column_name`;
  console.log("kolom StoreSetting:", JSON.stringify(cols));
  const has = cols.some((c) => c.column_name === "courierAnim");
  console.log(has ? "KOLON courierAnim: ADA ✓" : "KOLON courierAnim: TIDAK ADA ✗");
} finally {
  await db.$disconnect();
}
