import { jwtDecrypt } from "jose";
import { hkdf } from "@panva/hkdf";
import http from "node:http";

const AUTH_SECRET = process.env.AUTH_SECRET || "";

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const cookies: Record<string, string> = {};
  const header = req.headers.cookie || "";
  for (const pair of header.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (key) cookies[key] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

// Cache derived keys by salt (cookie name)
const _keyCache = new Map<string, Uint8Array>();

async function getEncryptionKey(salt: string): Promise<Uint8Array> {
  if (_keyCache.has(salt)) return _keyCache.get(salt)!;
  // Auth.js derives the key with the cookie name as both salt and part of the info string
  const key = await hkdf(
    "sha256",
    AUTH_SECRET,
    salt,
    `Auth.js Generated Encryption Key (${salt})`,
    64
  );
  const buf = new Uint8Array(key);
  _keyCache.set(salt, buf);
  return buf;
}

export async function getSessionEmail(req: http.IncomingMessage): Promise<string | null> {
  if (!AUTH_SECRET) return null;

  const cookies = parseCookies(req);

  // Try each possible cookie name — the salt for key derivation IS the cookie name
  const candidates: [string, string | undefined][] = [
    ["__Secure-authjs.session-token", cookies["__Secure-authjs.session-token"]],
    ["authjs.session-token", cookies["authjs.session-token"]],
  ];

  for (const [cookieName, token] of candidates) {
    if (!token) continue;
    try {
      const key = await getEncryptionKey(cookieName);
      const { payload } = await jwtDecrypt(token, key, {
        clockTolerance: 15,
        keyManagementAlgorithms: ["dir"],
        contentEncryptionAlgorithms: ["A256CBC-HS512"],
      });
      return (payload.email as string) || null;
    } catch {
      // Try next candidate
    }
  }

  return null;
}
