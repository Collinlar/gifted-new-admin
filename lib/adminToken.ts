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

function secret(): string {
  const explicit = process.env.ADMIN_TOKEN_SECRET;
  if (explicit && explicit.length >= 16) return explicit;

  // Fall back to the service role key so this works without new configuration.
  // It is already server-only and secret, but a dedicated ADMIN_TOKEN_SECRET is
  // better: rotating it then does not mean rotating database access too.
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (fallback) return fallback;

  throw new Error("No ADMIN_TOKEN_SECRET or SUPABASE_SERVICE_ROLE_KEY is set.");
}

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64url = (s: string) =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function sign(payload: string): string {
  return b64url(crypto.createHmac("sha256", secret()).update(payload).digest());
}

export interface AdminClaims {
  email: string;
  iat: number;
  exp: number;
}

export function issueToken(email: string): string {
  const now = Date.now();
  const claims: AdminClaims = {
    email,
    iat: now,
    exp: now + TTL_HOURS * 60 * 60 * 1000,
  };
  const payload = b64url(JSON.stringify(claims));
  return `${payload}.${sign(payload)}`;
}

// Returns the claims for a token this server issued and that has not expired,
// or null for anything else. Never throws, so callers can treat null as "no".
export function verifyToken(token: string | null | undefined): AdminClaims | null {
  if (!token) return null;

  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;

  const payload = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(payload);

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
