import crypto from "crypto";

// Signed admin sessions.
//
// The old token was base64("email:timestamp"), which is not a credential at
// all: anyone could mint one for any email. These tokens carry an HMAC over
// the payload, so the server can tell a token it issued from one someone
// wrote, and an expiry so a leaked token stops working.
//
// This runs server side only. The secret must never reach the browser, so do
// not import this file from a "use client" component.

const TTL_HOURS = 12; // long enough for an exam day, short enough to matter

// Returns null rather than throwing when nothing is configured. A throw here
// would surface as a 500 on every route, which is both a confusing way to
// report a missing setting and a way to take the whole admin down.
function secret(): string | null {
  const explicit = process.env.ADMIN_TOKEN_SECRET;
  if (explicit && explicit.length >= 16) return explicit;

  // Fall back to the service role key so this works without new configuration.
  // Both names are accepted because lib/supabase.ts accepts both, and a
  // deployment that sets only NEXT_SERVICE_ROLE is a working deployment.
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_SERVICE_ROLE;
  if (fallback) return fallback;

  return null;
}

// True when the server can sign and verify at all. Used to turn a missing
// setting into a clear message instead of a mystery failure.
export function signingConfigured(): boolean {
  return secret() !== null;
}

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64url = (s: string) =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function sign(payload: string, key: string): string {
  return b64url(crypto.createHmac("sha256", key).update(payload).digest());
}

export interface AdminClaims {
  email: string;
  iat: number;
  exp: number;
}

export function issueToken(email: string): string | null {
  const key = secret();
  if (!key) return null;

  const now = Date.now();
  const claims: AdminClaims = {
    email,
    iat: now,
    exp: now + TTL_HOURS * 60 * 60 * 1000,
  };
  const payload = b64url(JSON.stringify(claims));
  return `${payload}.${sign(payload, key)}`;
}

// Returns the claims for a token this server issued and that has not expired,
// or null for anything else. Never throws, so callers can treat null as "no".
export function verifyToken(token: string | null | undefined): AdminClaims | null {
  if (!token) return null;

  const key = secret();
  if (!key) return null; // fail closed: no secret means nothing verifies

  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;

  const payload = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(payload, key);

  // Constant time compare so a wrong signature cannot be found byte by byte
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(fromB64url(payload).toString("utf8")) as AdminClaims;
    if (!claims?.email || typeof claims.exp !== "number") return null;
    if (Date.now() > claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}

export function bearerFrom(req: { headers: { get(name: string): string | null } }): string | null {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return token || null;
}
