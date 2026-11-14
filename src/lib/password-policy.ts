/**
 * KEBIJAKAN SANDI AGSI — sumber tunggal untuk SEMUA alur penyetelan sandi
 * (buat kurir/kasir/admin, daftar akun pelanggan, ganti & reset password).
 *
 * Latar belakang: Chrome memunculkan peringatan "Pelanggaran data — situs
 * atau aplikasi mengekspos sandi Anda" saat pengguna LOGIN dengan sandi
 * yang nilainya cocok dengan basis data kebocoran global (haveibeenpwned
 * dkk). Bukan berarti server AGSI bocor — hashing kita scrypt+salt aman —
 * melainkan sandi yang dipilih pemilik akun terlalu umum (mis. "kurir123")
 * sehingga sudah ada di kumpulan kebocoran akun lain.
 *
 * Solusi: tolak sandi umum/bocor SEJAK DITETAPKAN lewat daftar hitam
 * (offline, tanpa API eksternal) + aturan minimum (≥8 karakter, wajib
 * huruf & angka, tanpa urutan/ulangan membosankan, tak mengandung email).
 * Modul polos (tanpa import node) agar aman dipakai di client component.
 */

export const PASSWORD_MIN = 8;

/**
 * Daftar hitam sandi yang pernah bocor massal / terlalu mudah ditebak.
 * Dicocokkan huruf-kecil semua. Berisi: sandi paling umum dunia + varian
 * khas AGSI (kurir/kasir/admin/geprek/agsi) yang dipakai orang iseng.
 */
const DENYLIST = new Set([
  // umum global (top breach)
  "password", "password1", "password123", "password1234", "passw0rd",
  "p@ssw0rd", "pass123", "pass1234", "passw0rd!", "123456", "1234567",
  "12345678", "123456789", "1234567890", "0987654321", "987654321",
  "111111", "11111111", "000000", "00000000", "121212", "123123",
  "123321", "1234321", "12344321", "654321", "696969", "102030",
  "112233", "121314", "147258369", "159753", "789456", "987654",
  "abc123", "abc12345", "abc123456", "qwerty", "qwerty123", "qwertyuiop",
  "qwe123", "asd123", "zxc123", "1q2w3e", "1q2w3e4r", "1qaz2wsx",
  "zaq12wsx", "q1w2e3r4", "1234qwer", "qwer1234", "asdf", "asdfgh",
  "asdf1234", "zxcvbn", "zxcvbnm", "iloveyou", "monkey", "dragon",
  "letmein", "welcome", "welcome1", "sunshine", "princess", "football",
  "baseball", "basketball", "master", "shadow", "superman", "batman",
  "spiderman", "trustno1", "whatever", "freedom", "starwars",
  "minecraft", "fortnite", "pokemon", "xyz123", "jordan23", "harley",
  "computer", "internet", "samsung", "google", "google123", "apple123",
  "tigger", "michael", "jessica", "daniel", "ashley", "bailey", "charlie",
  "donald", "lovely", "liverpool", "chelsea", "arsenal", "indonesia",
  "indonesia123", "jakarta123", "bandung123", "saya123", "kamu123",
  // khas AGSI / domain kuliner & role
  "kurir", "kurir123", "kurir1234", "kurir2026", "kurir1", "kurir12",
  "kuriragsi", "agsi", "agsi123", "agsi1234", "agsi2026", "agsipos",
  "agsipos123", "agsipos2026", "geprek", "geprek123", "geprek1234",
  "geprek2026", "ayamgeprek", "ayamgeprek123", "sambalijo", "sambalijo123",
  "sambalijo2026", "sambal123", "sambal2026", "ayam123", "ayam1234",
  "ayam2026", "mantap123", "nendang123", "pedas123", "pedes123",
  "kasir", "kasir123", "kasir1234", "kasir2026", "kasirpos", "kasirpos123",
  "admin", "admin123", "admin1234", "admin2026", "adminagsi", "owner123",
  "owner2026", "toko123", "warung123", "kuli123", "antar123", "antar1234",
  "penjual123", "pelanggan123", "member123", "pos123", "pos1234",
  // demo / uji
  "demo", "demo123", "demo1234", "tes123", "test123", "test1234",
  "testing123", "sandi", "sandi123", "sandi1234", "sandiku", "sandiku123",
  "rahasia", "rahasia123", "katasandi", "secret123", "coba123", "cobacoba",
]);

/** Susunan karakter naik/turun sepanjang ≥5 (12345, abcde, 98765…) */
function hasRunSequence(pw: string, len = 5): boolean {
  const s = pw.toLowerCase();
  let up = 1, down = 1;
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    up = d === 1 ? up + 1 : 1;
    down = d === -1 ? down + 1 : 1;
    if (up >= len || down >= len) return true;
  }
  return false;
}

/** Karakter sama beruntun ≥4 (aaaa, 1111, !!!!…) */
function hasRepeatRun(pw: string, len = 4): boolean {
  let run = 1;
  for (let i = 1; i < pw.length; i++) {
    run = pw[i] === pw[i - 1] ? run + 1 : 1;
    if (run >= len) return true;
  }
  return false;
}

/**
 * Validasi sandi baru.
 * @param pw     sandi yang diusulkan
 * @param email  (opsional) email akun — larang memuat nama emailnya
 */
export function validatePassword(
  pw: string,
  opts?: { email?: string | null },
): { ok: true } | { ok: false; error: string } {
  const s = (pw ?? "").trim();
  if (s.length < PASSWORD_MIN)
    return { ok: false, error: `Password minimal ${PASSWORD_MIN} karakter (huruf + angka disarankan campur).` };
  if (!/[a-zA-Z]/.test(s) || !/[0-9]/.test(s))
    return { ok: false, error: "Password harus mengandung huruf DAN angka (mis. GeprekMantap7x)." };
  if (DENYLIST.has(s.toLowerCase()))
    return {
      ok: false,
      error:
        "Password ini terlalu umum dan sudah ada di basis data kebocoran (Chrome akan menandai pelanggaran data saat login). Pakai kombinasi unik, mis. GeprekMantap7x.",
    };
  if (hasRepeatRun(s))
    return { ok: false, error: "Password tidak boleh ada karakter yang berulang 4 kali berturut-turut (mis. aaaa)." };
  if (hasRunSequence(s))
    return { ok: false, error: "Password tidak boleh berurutan 5 karakter atau lebih (mis. 12345, abcde)." };
  const emailLocal = opts?.email?.split("@")[0]?.toLowerCase();
  if (emailLocal && emailLocal.length >= 3 && s.toLowerCase().includes(emailLocal))
    return { ok: false, error: "Password tidak boleh memuat bagian nama email kamu." };
  return { ok: true };
}

/** Alfabet tanpa karakter ambigu untuk generator usulan sandi */
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const DIGITS = "23456789";

/**
 * Usulkan sandi kuat yang mudah dibaca: 3 blok 4 karakter dipisah
 * strip, mis. "K7mx-9Pqw-2Rtv". Memakai crypto.getRandomValues sehingga
 * jalan di browser maupun server (Node 19+ punya webcrypto global).
 * Dijamin memuat angka (dua posisi dipaksa digit) agar selalu lolos
 * kebijakan "huruf DAN angka".
 */
export function suggestPassword(): string {
  const rand = (max: number) => {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0] % max;
  };
  const pick = (alphabet: string) => alphabet[rand(alphabet.length)];
  const chars = Array.from({ length: 12 }, () => pick(CHARS));
  // Paksa dua posisi acak jadi digit — sandi tanpa angka ditolak kebijakan
  for (const pos of new Set([rand(12), rand(12)])) chars[pos] = pick(DIGITS);
  const block = (i: number) => chars.slice(i * 4, i * 4 + 4).join("");
  return `${block(0)}-${block(1)}-${block(2)}`;
}
