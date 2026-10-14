import type { AstroCookies } from 'astro';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

/*
 * The POS reuses the admin account that already gates the pattern generator:
 * ADMIN_PASSWORD from .env, held in the same `admin_auth` cookie. Signing in
 * at /pos/login therefore also signs you in to /pattern-generator, and
 * /api/admin-logout signs you out of both.
 */
export const AUTH_COOKIE = 'admin_auth';
export const ORDER_RECEIPT_COOKIE = 'order_receipt';
export const SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours
export const ORDER_RECEIPT_MAX_AGE = 60 * 60 * 24 * 7;
const SESSION_SECRET = import.meta.env.SESSION_SECRET || import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

export function createSignedToken(
  purpose: string,
  payload: string,
  maxAgeSeconds: number,
  secret = SESSION_SECRET,
): string | null {
  if (!secret || !purpose || !payload || payload.includes('.') || maxAgeSeconds < 1) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  const nonce = randomBytes(24).toString('base64url');
  const unsigned = `v1.${expiresAt}.${payload}.${nonce}`;
  const signature = createHmac('sha256', secret).update(`${purpose}.${unsigned}`).digest('base64url');
  return `${unsigned}.${signature}`;
}

export function verifySignedToken(purpose: string, token: string, secret = SESSION_SECRET): string | null {
  if (!secret || !purpose) return null;
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') return null;

  const [version, expiresAt, payload, nonce, signature] = parts;
  const expiry = Number(expiresAt);
  if (version !== 'v1' || !payload || !nonce || !Number.isInteger(expiry) || expiry <= Date.now() / 1000) {
    return null;
  }

  const unsigned = `${version}.${expiresAt}.${payload}.${nonce}`;
  const expected = createHmac('sha256', secret).update(`${purpose}.${unsigned}`).digest();
  const received = Buffer.from(signature, 'base64url');
  return received.length === expected.length && timingSafeEqual(received, expected) ? payload : null;
}

export function isAuthed(cookies: AstroCookies): boolean {
  const token = cookies.get(AUTH_COOKIE)?.value;
  return Boolean(token && verifySignedToken('admin-session', token) === 'admin');
}

export function setSession(cookies: AstroCookies): boolean {
  const token = createSignedToken('admin-session', 'admin', SESSION_MAX_AGE);
  if (!token) return false;

  cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return true;
}

export function setOrderReceiptAccess(cookies: AstroCookies, orderNumber: string, orderId: string): boolean {
  const token = createSignedToken(`order-receipt:${orderNumber}`, orderId, ORDER_RECEIPT_MAX_AGE);
  if (!token) return false;

  cookies.set(ORDER_RECEIPT_COOKIE, token, {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: `/order/${orderNumber}`,
    maxAge: ORDER_RECEIPT_MAX_AGE,
  });
  return true;
}

export function orderReceiptId(cookies: AstroCookies, orderNumber: string): string | null {
  const token = cookies.get(ORDER_RECEIPT_COOKIE)?.value;
  return token ? verifySignedToken(`order-receipt:${orderNumber}`, token) : null;
}

export function clearSession(cookies: AstroCookies): void {
  cookies.delete(AUTH_COOKIE, { path: '/' });
}

/** Where an unauthenticated POS page should send the visitor. */
export function loginUrl(url: URL): string {
  const next = url.pathname + url.search;
  return `/pos/login?next=${encodeURIComponent(next)}`;
}

/**
 * Guard for /api/pos/* routes. Returns a 401 Response when the caller is not
 * signed in, otherwise null.
 */
export function guardApi(cookies: AstroCookies): Response | null {
  if (isAuthed(cookies)) return null;
  return new Response('Unauthorized', { status: 401 });
}
