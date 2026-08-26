import type { AstroCookies } from 'astro';

/*
 * The POS reuses the admin account that already gates the pattern generator:
 * ADMIN_PASSWORD from .env, held in the same `admin_auth` cookie. Signing in
 * at /pos/login therefore also signs you in to /pattern-generator, and
 * /api/admin-logout signs you out of both.
 */
export const AUTH_COOKIE = 'admin_auth';
export const SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours

/** The cookie value we expect for a valid session, or null if unconfigured. */
export function expectedToken(): string | null {
  const password = import.meta.env.ADMIN_PASSWORD;
  return password ? btoa(password) : null;
}

export function isAuthed(cookies: AstroCookies): boolean {
  const expected = expectedToken();
  if (!expected) return false;
  return cookies.get(AUTH_COOKIE)?.value === expected;
}

export function setSession(cookies: AstroCookies, token: string): void {
  cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
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
