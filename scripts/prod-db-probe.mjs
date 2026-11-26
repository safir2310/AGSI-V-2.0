// Uji koneksi langsung ke DB produksi dari sandbox (tanpa menampilkan URL).
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const url = fs.readFileSync("/tmp/dburl.txt", "utf8").trim();
process.env.DATABASE_URL = url;
try {
  execFileSync(
    "node_modules/.bin/prisma",
    ["db", "execute", "--stdin", "--schema", "prisma/schema.prisma"],
    { input: "SELECT 1;", stdio: ["pipe", "inherit", "inherit"], env: process.env },
  );
  console.log("KONEKSI LANGSUNG: BERHASIL — DB menerima koneksi baru");
} catch {
  console.log("KONEKSI LANGSUNG: GAGAL — lihat error di atas (kode keluar bukan nol)");
}
