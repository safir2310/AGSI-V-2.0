// pg-auth-test.mjs — uji kredensial Postgres lewat handshake murni (tanpa Prisma),
// supaya pesan error autentikasi asli terlihat (Prisma CLI menutupinya jadi P1001).
// URL dibaca dari /tmp/dburl.txt (atau env URL) agar rahasia tak tercetak.
// Pakai: node scripts/pg-auth-test.mjs
import net from "node:net";
import tls from "node:tls";
import fs from "node:fs";

const url = process.env.URL || fs.readFileSync("/tmp/dburl.txt", "utf8").trim();
const u = new URL(url);
const user = decodeURIComponent(u.username);
const pass = decodeURIComponent(u.password);
const dbName = u.pathname.slice(1) || "postgres";
const host = u.hostname;
const port = Number(u.port || 5432);

const cstr = (s) => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
const mk = (t, p) => {
  const h = Buffer.alloc(5);
  h[0] = t.charCodeAt(0);
  h.writeInt32BE(p.length + 4, 1);
  return Buffer.concat([h, p]);
};

let phase = 0; // 0=SSLRequest, 1=startup/query
let queried = false;
let rows = [];

const sock = net.connect({ host, port, timeout: 15000 }, () => {
  sock.write(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47])); // SSLRequest
});

sock.on("data", (d) => {
  if (phase === 0) {
    if (d[0] !== 83) { console.log("✗ Server menolak SSL (respons byte " + d[0] + ")"); process.exit(1); }
    phase = 1;
    const t = tls.connect({ socket: sock, servername: host, rejectUnauthorized: false }, () => {
      const params = Buffer.concat([cstr("user"), cstr(user), cstr("database"), cstr(dbName), Buffer.from([0])]);
      const st = Buffer.concat([Buffer.alloc(4), params]);
      st.writeInt32BE(params.length + 4, 0);
      st.writeInt32BE(196608, 4);
      t.write(st);
    });
    t.on("data", (td) => handle(td, t));
    t.on("error", (e) => { console.log("✗ TLS:", e.message); process.exit(1); });
  }
});

function handle(buf, t) {
  let off = 0;
  while (off + 5 <= buf.length) {
    const type = String.fromCharCode(buf[off]);
    const len = buf.readInt32BE(off + 1);
    if (off + 1 + len > buf.length) break; // pesan belum utuh
    const p = buf.subarray(off + 5, off + 1 + len);
    off += 1 + len;
    if (type === "R") {
      const code = p.readInt32BE(0);
      if (code === 3) t.write(mk("p", cstr(pass))); // cleartext password
      else if (code === 0) { /* AuthOK */ }
      else { console.log("✗ Server meminta auth jenis " + code + " (md5/SASL) — tak didukung uji ini"); process.exit(1); }
    } else if (type === "E") {
      let i = 0; const f = {};
      while (p[i] !== 0) {
        const c = String.fromCharCode(p[i]);
        const e = p.indexOf(0, i + 1);
        f[c] = p.toString("utf8", i + 1, e);
        i = e + 1;
      }
      console.log("✗ DITOLAK:", f.M || "(tanpa pesan)");
      process.exit(1);
    } else if (type === "Z") { // ReadyForQuery
      if (!queried) {
        queried = true;
        console.log("✓ KREDENSIAL VALID — autentikasi diterima (" + host + ")");
        t.write(mk("Q", cstr("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1;")));
      } else {
        console.log("Tabel skema public (" + rows.length + "):", rows.length ? rows.map(r => r[0]).join(", ") : "(kosong — database baru)");
        process.exit(0);
      }
    } else if (type === "T") {
      rows = [];
    } else if (type === "D") {
      let i = 2;
      const n = p.readInt16BE(0);
      const vals = [];
      for (let c = 0; c < n; c++) {
        const l = p.readInt32BE(i); i += 4;
        if (l === -1) vals.push(null);
        else { vals.push(p.toString("utf8", i, i + l)); i += l; }
      }
      rows.push(vals);
    }
    // S/K/N/C/C1/I — abaikan
  }
}

sock.on("error", (e) => { console.log("✗ Koneksi:", e.message); process.exit(1); });
sock.on("timeout", () => { console.log("✗ TIMEOUT koneksi"); process.exit(2); });
setTimeout(() => { console.log("✗ timeout global"); process.exit(2); }, 20000);
