import type { AstroCookies } from 'astro';
import { isAuthed } from './auth';

/*
 * Letting something that is not the POS call an import endpoint.
 *
 * The rest of /api/pos/* is only ever reached from a page the shop owner is
 * already looking at, so the `admin_auth` cookie is enough. The browser
 * extension is different: it runs on somebody else's origin — a yarn shop, a
 * Pinterest board — so no cookie of ours is attached to its requests and every
 * one of them is a cross-origin call.
 *
 * The rule this module enforces:
 *
 *   same origin  →  the cookie, or a token
 *   cross origin →  the token, never the cookie
 *
 * The second half is the point. If a cross-origin request could authenticate
 * with the cookie, any page the owner happened to be signed in on could post
 * products into the shop behind their back. Requiring the token means a caller
 * has to have been given a secret on purpose. Responses to those calls never
 * set Access-Control-Allow-Credentials, so a browser will not attach the
 * cookie to them in the first place.
 *
 * The token may arrive in the Authorization header or in the request body.
 * The body is not a shortcut around anything — it is what lets the extension
 * send a CORS *simple* request, which no preflight stands in front of, and a
 * preflight is the part of this that depends on how the site happens to be
 * hosted rather than on anything we control.
 */

const TOKEN_HEADER = 'authorization';

/** The shared secret the extension sends, or null when none is configured. */
export function importToken(): string | null {
  const token = import.meta.env.POS_IMPORT_TOKEN;
  return typeof token === 'string' && token.trim().length >= 16 ? token.trim() : null;
}

export const isImportTokenConfigured = () => importToken() !== null;

/** Bearer token off the request, if one was sent. */
function bearer(request: Request): string | null {
  const header = request.headers.get(TOKEN_HEADER) ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Constant-time-ish comparison. Both values are short and the endpoint is not
 * a realistic timing-attack target, but there is no reason to leak the prefix.
 */
function tokenMatches(sent: string, expected: string): boolean {
  if (sent.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sent.length; i += 1) diff |= sent.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** A request from a page on another site — the extension's normal case. */
export function isCrossOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}

/**
 * CORS headers for a cross-origin caller. Deliberately no
 * Access-Control-Allow-Credentials: the token is the only way in, and without
 * that header the browser will not send our cookie even if asked to.
 */
export function corsHeaders(request: Request): Record<string, string> {
  if (!isCrossOrigin(request)) return {};
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

/** JSON response that carries the CORS headers when it needs to. */
export function jsonFor(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

/** The answer to a preflight. Every import endpoint exports this as OPTIONS. */
export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export type Caller = 'session' | 'token';

/**
 * Returns the caller when the request is allowed, or a ready-made refusal.
 * The message says which of the two doors was tried, because "unauthorized"
 * on its own is unhelpful when there are two ways of being authorized.
 */
export function authorizeImport(
  request: Request,
  cookies: AstroCookies,
  /** Token lifted from the parsed body, for callers avoiding a preflight. */
  bodyToken?: unknown,
): { caller: Caller; denied: null } | { caller: null; denied: Response } {
  const inBody = typeof bodyToken === 'string' && bodyToken.trim() ? bodyToken.trim() : null;
  const sent = bearer(request) ?? inBody;
  const expected = importToken();

  if (sent) {
    if (!expected) {
      return {
        caller: null,
        denied: jsonFor(
          request,
          {
            error:
              'This shop has no import token set. Add POS_IMPORT_TOKEN to the environment (16 characters or more) and put the same value in the extension options.',
          },
          401,
        ),
      };
    }
    if (!tokenMatches(sent, expected)) {
      return {
        caller: null,
        denied: jsonFor(request, { error: 'That import token is not the one this shop expects.' }, 401),
      };
    }
    return { caller: 'token', denied: null };
  }

  // No token. The cookie is only trusted from our own pages.
  if (isCrossOrigin(request)) {
    return {
      caller: null,
      denied: jsonFor(
        request,
        { error: 'Calls from another site must send the import token. Set one in the extension options.' },
        401,
      ),
    };
  }

  if (isAuthed(cookies)) return { caller: 'session', denied: null };

  return { caller: null, denied: jsonFor(request, { error: 'Not signed in.' }, 401) };
}
