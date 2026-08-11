/* ============================================================
   lib/jwt.js - 极简 HS256 JWT 签发与校验（Worker 内用 WebCrypto）
   只用于自签会话 cookie，不用于第三方校验。
   ============================================================ */

const enc = new TextEncoder();

function b64url(input) {
  let bytes;
  if (typeof input === "string") {
    bytes = enc.encode(input);
  } else {
    bytes = input;
  }
  let s = btoa(String.fromCharCode.apply(null, bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function key(secret) {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function sign(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const data = h + "." + p;
  const k = await key(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
  return data + "." + b64url(sig);
}

export async function verify(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const k = await key(secret);
  const ok = await crypto.subtle.verify(
    "HMAC", k,
    b64urlDecode(s),
    enc.encode(h + "." + p)
  );
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
    return payload;
  } catch (e) {
    return null;
  }
}
