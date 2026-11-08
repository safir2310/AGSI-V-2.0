/**
 * E2E API — LOGIN BIOMETRIK (WebAuthn) dengan respons KRIPTOGRAFI ASLI.
 *
 * Mensimulasikan platform authenticator sungguhan:
 *  1. Login password (admin) → token sesi
 *  2. register/options → craft attestation fmt:"none" (EC P-256 via node crypto)
 *  3. register/verify  → simpan kredensial
 *  4. login/options + craft assertion (tanda tangan authData||clientDataHash)
 *  5. login/verify     → dapat token + user
 *  6. GET credentials, DELETE, dan uji negatif (challenge salah, cred hapus)
 *
 * Jalankan: bun scripts/test-biometric.ts
 */
import { createHash, createSign, generateKeyPairSync, randomBytes } from "crypto";

const BASE = "http://127.0.0.1:3000";
const EMAIL = "admin@agsi.test";
const PASSWORD = "admin123";
const RP_ID = "127.0.0.1";
const ORIGIN = "http://127.0.0.1:3000";

// ===== util dasar =====
const b64u = (buf: Buffer) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest();

async function jfetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return { status: res.status, json, text };
}

// ===== CBOR minimal (hanya struktur yang dibutuhkan) =====
function cborInt(major: number, val: number): Buffer {
  // nilai negatif: major 1, encoded = -1 - val
  const v = major === 1 ? -1 - val : val;
  if (v < 24) return Buffer.from([(major << 5) | v]);
  if (v < 256) return Buffer.from([(major << 5) | 24, v]);
  if (v < 65536) return Buffer.from([(major << 5) | 25, v >> 8, v & 0xff]);
  return Buffer.from([(major << 5) | 26, (v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
}
const cborBytes = (b: Buffer) =>
  b.length < 24
    ? Buffer.concat([cborInt(2, b.length), b])
    : b.length < 256
      ? Buffer.concat([Buffer.from([0x58, b.length]), b])
      : Buffer.concat([Buffer.from([0x59, b.length >> 8, b.length & 0xff]), b]);
const cborText = (s: string) => {
  const b = Buffer.from(s, "utf8");
  return b.length < 24
    ? Buffer.concat([cborInt(3, b.length), b])
    : Buffer.concat([Buffer.from([0x78, b.length]), b]);
};
const cborMapHeader = (n: number) => cborInt(5, n);

/** COSE key EC2/P-256: {1:2, 3:-7, -1:1, -2:X, -3:Y} */
function coseKey(x: Buffer, y: Buffer): Buffer {
  return Buffer.concat([
    cborMapHeader(5),
    cborInt(0, 1),
    cborInt(0, 2), // kty = EC2
    cborInt(0, 3),
    cborInt(1, -7), // alg = ES256
    cborInt(1, -1),
    cborInt(0, 1), // crv = P-256
    cborInt(1, -2), // x
    cborBytes(x),
    cborInt(1, -3), // y
    cborBytes(y),
  ]);
}

function buildAuthData(opts: {
  flags: number;
  counter: number;
  credId?: Buffer;
  cose?: Buffer;
}) {
  const rpIdHash = sha256(Buffer.from(RP_ID, "utf8"));
  const counterBuf = Buffer.alloc(4);
  counterBuf.writeUInt32BE(opts.counter, 0);
  const parts: Buffer[] = [rpIdHash, Buffer.from([opts.flags]), counterBuf];
  if (opts.credId && opts.cose) {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(opts.credId.length, 0);
    const aaguid = Buffer.alloc(16, 0x07); // aaguid dummy
    parts.push(aaguid, len, opts.credId, opts.cose);
  }
  return Buffer.concat(parts);
}

function cborAttestationObject(authData: Buffer): Buffer {
  return Buffer.concat([
    cborMapHeader(3),
    cborText("fmt"),
    cborText("none"),
    cborText("attStmt"),
    cborInt(5, 0), // map kosong {}
    cborText("authData"),
    cborBytes(authData),
  ]);
}

// ===== keypair per skenario =====
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const spki = publicKey.export({ type: "spki", format: "der" });
const point = spki.subarray(spki.length - 64); // 04 || X || Y → 64 byte terakhir
const X = point.subarray(0, 32);
const Y = point.subarray(32, 64);

function signDer(data: Buffer): Buffer {
  return createSign("SHA256").update(data).sign(privateKey);
}

function clientDataJSON(type: string, challenge: string): Buffer {
  return Buffer.from(
    JSON.stringify({ type, challenge, origin: ORIGIN, crossOrigin: false })
  );
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

async function main() {
  console.log("== 1. Login password ==");
  const login = await jfetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  check("login password sukses", login.status === 200 && typeof login.json.token === "string");
  const bearer = { Authorization: `Bearer ${login.json.token}` };
  const me = login.json.user as { id: string };
  const userHandle = b64u(Buffer.from(me.id, "utf8"));

  console.log("== 2. Register: options (kirim origin browser seperti klien asli) ==");
  const opts = await jfetch("/api/auth/biometric/register/options", {
    method: "POST",
    headers: { ...bearer, "Content-Type": "application/json" },
    body: JSON.stringify({ origin: ORIGIN }),
  });
  check(
    "register/options 200 + challenge + rp.id",
    opts.status === 200 &&
      typeof opts.json.challenge === "string" &&
      (opts.json.rp as { id?: string } | undefined)?.id === RP_ID,
    JSON.stringify(opts.json).slice(0, 120)
  );

  // Kompatibilitas klien lama: tanpa body origin → fallback derivasi header
  const optsFallback = await jfetch("/api/auth/biometric/register/options", {
    method: "POST",
    headers: bearer,
  });
  check(
    "register/options tanpa origin → fallback header tetap jalan",
    optsFallback.status === 200 &&
      (optsFallback.json.rp as { id?: string } | undefined)?.id === RP_ID,
    optsFallback.text.slice(0, 120)
  );
  // challenge terakhir yang dipakai (dari fallback) tidak valid lagi karena
  // diganti — minta options sekali lagi agar challenge konsisten dengan verify
  const opts2 = await jfetch("/api/auth/biometric/register/options", {
    method: "POST",
    headers: { ...bearer, "Content-Type": "application/json" },
    body: JSON.stringify({ origin: ORIGIN }),
  });
  const regChallenge = String(opts2.json.challenge);

  const credId = randomBytes(32);
  const credIdB64u = b64u(credId);
  const regAuthData = buildAuthData({
    flags: 0x45, // UP | UV | AT (attested credential data present)
    counter: 0,
    credId,
    cose: coseKey(X, Y),
  });
  const registration = {
    id: credIdB64u,
    rawId: credIdB64u,
    type: "public-key",
    clientExtensionResults: {},
    authenticatorAttachment: "platform",
    response: {
      clientDataJSON: b64u(clientDataJSON("webauthn.create", regChallenge)),
      attestationObject: b64u(cborAttestationObject(regAuthData)),
      transports: ["internal"],
    },
  };

  console.log("== 3. Register: verify ==");
  const regVer = await jfetch("/api/auth/biometric/register/verify", {
    method: "POST",
    headers: { ...bearer, "Content-Type": "application/json" },
    body: JSON.stringify(registration),
  });
  check(
    "register/verify verified:true",
    regVer.status === 200 && regVer.json.verified === true,
    regVer.text.slice(0, 200)
  );
  // challenge sekali pakai → kedua kalinya harus gagal
  const regReplay = await jfetch("/api/auth/biometric/register/verify", {
    method: "POST",
    headers: { ...bearer, "Content-Type": "application/json" },
    body: JSON.stringify(registration),
  });
  check("challenge sekali pakai (replay ditolak)", regReplay.status === 400);

  console.log("== 4. Login biometrik: options (dengan origin) ==");
  const authOpts = await jfetch("/api/auth/biometric/login/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, origin: ORIGIN }),
  });
  check(
    "login/options 200 + allowCredentials 1",
    authOpts.status === 200 &&
      Array.isArray(authOpts.json.allowCredentials) &&
      authOpts.json.allowCredentials.length === 1,
    authOpts.text.slice(0, 160)
  );
  const authChallenge = String(authOpts.json.challenge);

  const authData = buildAuthData({ flags: 0x05, counter: 1 }); // UP | UV
  const clientHash = sha256(clientDataJSON("webauthn.get", authChallenge));
  const signature = signDer(Buffer.concat([authData, clientHash]));
  const assertion = {
    id: credIdB64u,
    rawId: credIdB64u,
    type: "public-key",
    clientExtensionResults: {},
    response: {
      authenticatorData: b64u(authData),
      clientDataJSON: b64u(clientDataJSON("webauthn.get", authChallenge)),
      signature: b64u(signature),
      userHandle,
    },
  };

  console.log("== 5. Login biometrik: verify ==");
  const authVer = await jfetch("/api/auth/biometric/login/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(assertion),
  });
  check(
    "login/verify → token + user",
    authVer.status === 200 &&
      typeof authVer.json.token === "string" &&
      (authVer.json.user as { email?: string })?.email === EMAIL,
    authVer.text.slice(0, 200)
  );

  // Tanda tangan DIPALSUKAN → harus ditolak
  const authOpts2 = await jfetch("/api/auth/biometric/login/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, origin: ORIGIN }),
  });
  const challenge2 = String(authOpts2.json.challenge);
  const authData2 = buildAuthData({ flags: 0x05, counter: 2 });
  const badAssertion = {
    id: credIdB64u,
    rawId: credIdB64u,
    type: "public-key",
    clientExtensionResults: {},
    response: {
      authenticatorData: b64u(authData2),
      clientDataJSON: b64u(clientDataJSON("webauthn.get", challenge2)),
      signature: b64u(signDer(Buffer.concat([authData2, sha256(Buffer.from("tampered")!)]))),
      userHandle,
    },
  };
  const badVer = await jfetch("/api/auth/biometric/login/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(badAssertion),
  });
  check("tanda tangan palsu ditolak", badVer.status === 401 || badVer.status === 500, `status ${badVer.status}`);

  console.log("== 6. Kelola kredensial ==");
  const list = await jfetch("/api/auth/biometric/credentials", { headers: bearer });
  const items = (list.json.credentials as { id: string; label: string | null }[]) ?? [];
  check("list berisi 1 kredensial + label UA", list.status === 200 && items.length === 1 && !!items[0].label);

  console.log("== 7. Hapus kredensial ==");
  const del = await jfetch(`/api/auth/biometric/credentials/${credIdB64u}`, {
    method: "DELETE",
    headers: bearer,
  });
  check("delete sukses", del.status === 200 && del.json.deleted === true);
  const listAfter = await jfetch("/api/auth/biometric/credentials", { headers: bearer });
  check("list kosong setelah delete", ((listAfter.json.credentials as unknown[]) ?? []).length === 0);
  const optsAfterDelete = await jfetch("/api/auth/biometric/login/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, origin: ORIGIN }),
  });
  check("login/options tanpa kredensial → 404", optsAfterDelete.status === 404);

  console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
