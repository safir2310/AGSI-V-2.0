/**
 * Uji API "Kelola Admin" (localhost:3000):
 * GET/POST /api/admins, PUT/DELETE /api/admins/[id] + aturan akses.
 * Pakai: bun scripts/test-admins-api.ts
 */
const BASE = "http://localhost:3000";

type Any = Record<string, unknown>;
const j = (r: Response) => r.json() as Promise<Any>;
let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, extra?: string) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await j(res);
  return { res, token: body.token as string | undefined };
}
const auth = (token: string) => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });

console.log("== 1. Guard: tanpa login ditolak ==");
{
  const res = await fetch(`${BASE}/api/admins`);
  check("GET tanpa login → 403", res.status === 403, `status=${res.status}`);
}

console.log("== 2. Kasir tidak diizinkan ==");
{
  const { token } = await login("kasir@agsi.test", "kasir123");
  const res = await fetch(`${BASE}/api/admins`, { headers: auth(token!) });
  check("GET sebagai kasir → 403", res.status === 403, `status=${res.status}`);
}

console.log("== 3. Owner melihat daftar admin ==");
const owner = await login("owner@agsi.test", "owner123");
let list: Any[] = [];
{
  const res = await fetch(`${BASE}/api/admins`, { headers: auth(owner.token!) });
  const body = await j(res);
  list = (body.admins as Any[]) ?? [];
  check("GET sebagai owner → 200", res.status === 200);
  check("jumlah awal 2 (owner+admin)", list.length === 2, `n=${list.length}`);
  check("urut terlama dulu", (list[0]?.role === "OWNER"), `pertama=${list[0]?.email}`);
}

console.log("== 4. Owner menambah admin baru ==");
let newId = "";
{
  const res = await fetch(`${BASE}/api/admins`, {
    method: "POST",
    headers: auth(owner.token!),
    body: JSON.stringify({ name: "Rina Kartika", email: "rina@agsi.test", phone: "0812-3456-7890", password: "rina123", role: "ADMIN" }),
  });
  const body = await j(res);
  newId = (body.admin as Any)?.id as string;
  check("POST admin baru → 201", res.status === 201, `status=${res.status}`);
  check("role ADMIN", (body.admin as Any)?.role === "ADMIN");
}
{
  const res = await fetch(`${BASE}/api/admins`, { headers: auth(owner.token!) });
  const body = await j(res);
  check("daftar kini 3 akun", ((body.admins as Any[]) ?? []).length === 3);
}

console.log("== 5. Validasi POST ==");
{
  const dup = await fetch(`${BASE}/api/admins`, {
    method: "POST", headers: auth(owner.token!),
    body: JSON.stringify({ name: "X", email: "rina@agsi.test", password: "123456", role: "ADMIN" }),
  });
  check("email duplikat → 409", dup.status === 409, `status=${dup.status}`);
  const short = await fetch(`${BASE}/api/admins`, {
    method: "POST", headers: auth(owner.token!),
    body: JSON.stringify({ name: "X", email: "x@agsi.test", password: "123", role: "ADMIN" }),
  });
  check("password pendek → 400", short.status === 400, `status=${short.status}`);
}

console.log("== 6. ADMIN tidak bisa membuat OWNER (escalation guard) ==");
{
  const rina = await login("rina@agsi.test", "rina123");
  check("admin baru bisa login", !!rina.token);
  const res = await fetch(`${BASE}/api/admins`, {
    method: "POST", headers: auth(rina.token!),
    body: JSON.stringify({ name: "Backdoor", email: "backdoor@agsi.test", password: "123456", role: "OWNER" }),
  });
  check("POST role OWNER oleh admin → 403", res.status === 403, `status=${res.status}`);
}

console.log("== 7. Proteksi akun sendiri ==");
{
  const meId = list.find((a) => a.email === "owner@agsi.test")?.id as string;
  const del = await fetch(`${BASE}/api/admins/${meId}`, { method: "DELETE", headers: auth(owner.token!) });
  check("hapus diri sendiri → 400", del.status === 400, `status=${del.status}`);
  const role = await fetch(`${BASE}/api/admins/${meId}`, {
    method: "PUT", headers: auth(owner.token!), body: JSON.stringify({ role: "ADMIN" }),
  });
  check("ubah akses diri sendiri → 400", role.status === 400, `status=${role.status}`);
}

console.log("== 8. ADMIN tidak bisa mengelola akun OWNER ==");
{
  const rina = await login("rina@agsi.test", "rina123");
  const ownerId = list.find((a) => a.role === "OWNER")?.id as string;
  const del = await fetch(`${BASE}/api/admins/${ownerId}`, { method: "DELETE", headers: auth(rina.token!) });
  check("admin hapus owner → 403", del.status === 403, `status=${del.status}`);
  const put = await fetch(`${BASE}/api/admins/${ownerId}`, {
    method: "PUT", headers: auth(rina.token!), body: JSON.stringify({ name: "Diretas" }),
  });
  check("admin edit owner → 403", put.status === 403, `status=${put.status}`);
}

console.log("== 9. Owner mengubah akses ADMIN → OWNER ==");
{
  const res = await fetch(`${BASE}/api/admins/${newId}`, {
    method: "PUT", headers: auth(owner.token!), body: JSON.stringify({ role: "OWNER" }),
  });
  const body = await j(res);
  check("PUT role → 200", res.status === 200, `status=${res.status}`);
  check("role kini OWNER", (body.admin as Any)?.role === "OWNER");
  const relogin = await login("rina@agsi.test", "rina123");
  check("sesi lama dicabut tapi login dengan password sama tetap bisa", !!relogin.token);
}

console.log("== 10. Owner mengubah kembali OWNER → ADMIN ==");
{
  const res = await fetch(`${BASE}/api/admins/${newId}`, {
    method: "PUT", headers: auth(owner.token!), body: JSON.stringify({ role: "ADMIN" }),
  });
  const body = await j(res);
  check("PUT role → 200 & role ADMIN", res.status === 200 && (body.admin as Any)?.role === "ADMIN");
}

console.log("== 11. Reset password memaksa masuk ulang ==");
{
  const res = await fetch(`${BASE}/api/admins/${newId}`, {
    method: "PUT", headers: auth(owner.token!), body: JSON.stringify({ password: "rina456" }),
  });
  check("PUT password → 200", res.status === 200);
  const oldPw = await login("rina@agsi.test", "rina123");
  check("password lama ditolak", !oldPw.token);
  const newPw = await login("rina@agsi.test", "rina456");
  check("password baru bisa login", !!newPw.token);
}

console.log("== 12. Hapus admin ==");
{
  const res = await fetch(`${BASE}/api/admins/${newId}`, { method: "DELETE", headers: auth(owner.token!) });
  check("DELETE → 200", res.status === 200, `status=${res.status}`);
  const after = await fetch(`${BASE}/api/admins`, { headers: auth(owner.token!) });
  const body = await j(after);
  check("daftar kembali 2 akun", ((body.admins as Any[]) ?? []).length === 2);
  const gone = await fetch(`${BASE}/api/admins/${newId}`, { method: "DELETE", headers: auth(owner.token!) });
  check("hapus ulang → 404", gone.status === 404, `status=${gone.status}`);
}

console.log(`\nHASIL: ${pass} lulus, ${fail} gagal`);
process.exit(fail > 0 ? 1 : 0);
