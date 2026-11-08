/**
 * VIRTUAL AUTHENTICATOR (stub WebAuthn kriptografi asli) untuk E2E di browser.
 * Di-inject via agent-browser eval SEBELUM sheet biometrik dibuka:
 *   - PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable → true
 *   - navigator.credentials.create/get → ECDSA P-256 WebCrypto + CBOR fmt:"none"
 * Hasilnya identik dengan platform authenticator sungguhan (fingerprint).
 */
(function () {
  const te = new TextEncoder();
  const b64u = (u8) => {
    let s = "";
    new Uint8Array(u8).forEach((b) => (s += String.fromCharCode(b)));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const concat = (...arrs) => {
    const total = arrs.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const a of arrs) {
      out.set(a, o);
      o += a.length;
    }
    return out;
  };
  const sha256 = async (u8) => new Uint8Array(await crypto.subtle.digest("SHA-256", u8));

  // ===== CBOR encoder minimal (uint, negatif, byte, teks, map) =====
  function cborEnc(value) {
    const parts = [];
    const head = (major, val) => {
      if (val < 24) parts.push(new Uint8Array([(major << 5) | val]));
      else if (val < 256) parts.push(new Uint8Array([(major << 5) | 24, val]));
      else parts.push(new Uint8Array([(major << 5) | 25, val >> 8, val & 255]));
    };
    const walk = (v) => {
      if (v instanceof Map) {
        head(5, v.size);
        for (const [k, item] of v) {
          walk(k);
          walk(item);
        }
      } else if (typeof v === "number") {
        if (v >= 0) head(0, v);
        else head(1, -1 - v);
      } else if (typeof v === "string") {
        const b = te.encode(v);
        head(3, b.length);
        parts.push(b);
      } else if (v instanceof Uint8Array) {
        head(2, v.length);
        parts.push(v);
      } else {
        throw new Error("CBOR: tipe tak didukung " + typeof v);
      }
    };
    walk(value);
    return concat(...parts);
  }

  // ===== tanda tangan: WebCrypto memberi raw (r||s) → konversi ASN.1 DER =====
  function rawToDER(sig64) {
    const part = (start) => {
      let b = Array.from(sig64.slice(start, start + 32));
      while (b.length && b[0] === 0) b.shift();
      if (b[0] & 0x80) b.unshift(0);
      return b;
    };
    const r = part(0);
    const s = part(32);
    const body = [0x02, r.length].concat(r, [0x02, s.length], s);
    return new Uint8Array([0x30, body.length].concat(body));
  }

  // ===== authenticator data =====
  function authDataUnused() {}

  let keyPair = null;
  let credId = null;
  let counter = 0;

  async function makeAuthData(rpId, flags, cnt, withCred) {
    const rpHash = await sha256(te.encode(rpId));
    const counterBytes = new Uint8Array(4);
    new DataView(counterBytes.buffer).setUint32(0, cnt, false);
    const parts = [rpHash, new Uint8Array([flags]), counterBytes];
    if (withCred) {
      const len = new Uint8Array(2);
      new DataView(len.buffer).setUint16(0, credId.length, false);
      const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
      const cose = cborEnc(
        new Map([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, rawKey.slice(1, 33)],
          [-3, rawKey.slice(33, 65)],
        ])
      );
      parts.push(new Uint8Array(16).fill(7), len, credId, cose);
    }
    return concat(...parts);
  }

  navigator.credentials.create = async (opts) => {
    const pk = opts.publicKey;
    const challenge = new Uint8Array(pk.challenge);
    const rpId = (pk.rp && pk.rp.id) || location.hostname;
    keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    credId = crypto.getRandomValues(new Uint8Array(32));
    const cdj = te.encode(
      JSON.stringify({
        type: "webauthn.create",
        challenge: b64u(challenge),
        origin: location.origin,
        crossOrigin: false,
      })
    );
    const ad = await makeAuthData(rpId, 0x45, 0, true); // UP|UV|AT
    const attObj = cborEnc(
      new Map([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", ad],
      ])
    );
    const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
    return {
      id: b64u(credId),
      rawId: credId.slice().buffer,
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: cdj,
        attestationObject: attObj,
        getTransports: () => ["internal"],
        getPublicKeyAlgorithm: () => -7,
        getPublicKey: () => rawKey,
        getAuthenticatorData: () => ad,
      },
    };
  };

  navigator.credentials.get = async (opts) => {
    const pk = opts.publicKey;
    const challenge = new Uint8Array(pk.challenge);
    const rpId = pk.rpId || location.hostname;
    const cdj = te.encode(
      JSON.stringify({
        type: "webauthn.get",
        challenge: b64u(challenge),
        origin: location.origin,
        crossOrigin: false,
      })
    );
    counter += 1;
    const ad = await makeAuthData(rpId, 0x05, counter, false); // UP|UV
    const cdjHash = await sha256(cdj);
    const raw = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        keyPair.privateKey,
        concat(ad, cdjHash)
      )
    );
    return {
      id: b64u(credId),
      rawId: credId.slice().buffer,
      type: "public-key",
      clientExtensionResults: {},
      getClientExtensionResults: () => ({}),
      response: {
        authenticatorData: ad,
        clientDataJSON: cdj,
        signature: rawToDER(raw),
      },
    };
  };

  PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
  window.__virtualAuthenticator = true;
  return "virtual authenticator siap (ECDSA P-256, fmt none)";
})();
