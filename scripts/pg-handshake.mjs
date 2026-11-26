// pg-handshake.mjs — verifikasi kredensial + skema tanpa driver eksternal:
// handshake Postgres murni (SSLRequest → Startup → Password → Query).
// URL dibaca dari /tmp/dburl.txt (tidak dicetak).
import net from "node:net";
import tls from "node:tls";
import fs from "node:fs";

const url = fs.readFileSync("/tmp/dburl.txt", "utf8").trim();
const u = new URL(url);
const user = decodeURIComponent(u.username);
const pass = decodeURIComponent(u.password);
const dbName = u.pathname.slice(1);

const cstr = (s) => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
const msg = (type, payload) => Buffer.concat([Buffer.from([type]), (() => { const b = Buffer.alloc(4); b.writeInt32BE(payload.length + 4); return b; })(), payload]);

let phase = "ssl";
let ready = false;
let out = "";
let rows = [];

const sock = net.connect({ host: u.hostname, port: 5432, timeout: 20000 }, () => {
  sock.write(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47])); // SSLRequest
});

sock.on("data", (d) => {
  if (phase === "ssl") {
    if (d[0] !== 83) { console.log("Server tolak SSL"); process.exit(1); }
    phase = "tls";
    const t = tls.connect({ socket: sock, servername: u.hostname, rejectUnauthorized: false }, () => {
      phase = "startup";
      const params = Buffer.concat([cstr("user"), cstr(user), cstr("database"), cstr(dbName), Buffer.from([0])]);
      const st = Buffer.concat([Buffer.alloc(4), params]);
      st.writeInt32BE(params.length + 4, 0);
      st.writeInt32BE(196608, 4);
      t.write(st);
    });
    t.on("data", (td) => onData(td, t));
    t.on("error", (e) => { console.log("TLS err:", e.message); process.exit(1); });
  }
});

function onData(buf, t) {
  let off = 0;
  while (off < buf.length) {
    const type = String.fromCharCode(buf[off]);
    const len = buf.readInt32BE(off + 1);
    const payload = buf.subarray(off + 5, off + 1 + len);
    off += 1 + len;
    handle(type, payload, t);
  }
}

function handle(type, p, t) {
  if (type === "R") {
    const code = p.readInt32BE(0);
    if (code === 3) { // cleartext
      t.write(msg("p", cstr(pass)));
    } else if (code === 0) {
      // AuthOK
    }
  } else if (type === "E") {
    const fields = {};
    for (let i = 0; i < p.length && p[i] !== 0;) {
      const code = String.fromCharCode(p[i]);
      const end = p.indexOf(0, i + 1);
      fields[code] = p.toString("utf8", i + 1, end);
      i = end + 1;
    }
    console.log("ERROR DB:", fields.S, "|", fields.M?.slice(0, 200));
    process.exit(1);
  } else if (type === "Z") { // ReadyForQuery
    if (!ready) {
      ready = true;
      console.log("✓ AUTENTIKASI BERHASIL — kredensial valid, instance hidup");
      // Query 1: daftar tabel
      t.write(msg("Q", cstr(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;`)));
      setTimeout(() => {
        console.log("TABEL:", rows.filter(r => r.table_name).map(r => r.table_name).join(", ") || "(kosong)");
        process.exit(0);
      }, 3000);
    } else {
      // hasil query
      for (const r of rows) if (r.table_name) { /* collected */ }
      console.log("TABEL:", rows.map(r => Object.values(r)[0]).filter(Boolean).join(", ") || "(kosong)");
      process.exit(0);
    }
  } else if (type === "T") { // RowDescription
    rows = [];
  } else if (type === "D") { // DataRow
    const row = {};
    // parse sederhana: nilai dipisah int32 length
    let i = 0;
    const ncol = p.readInt16BE(0); i += 2;
    const vals = [];
    for (let c = 0; c < ncol; c++) {
      const l = p.readInt32BE(i); i += 4;
      if (l === -1) vals.push(null);
      else { vals.push(p.toString("utf8", i, i + l)); i += l; }
    }
    rows.push(vals);
  } else if (type === "N") { // Notice
  }
}
sock.on("error", (e) => { console.log("KONEKSI GAGAL:", e.message); process.exit(1); });
sock.on("timeout", () => { console.log("TIMEOUT"); process.exit(2); });
