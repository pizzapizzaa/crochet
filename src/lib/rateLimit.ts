import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

type Admin = SupabaseClient<Database>;
export type RateLimitResult = 'allowed' | 'limited' | 'unavailable';

const secret = import.meta.env.SESSION_SECRET || import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

export function rateLimitBucket(scope: string, address: string, key = secret): string | null {
  if (!key || !scope || !address) return null;
  return createHmac('sha256', key).update(`${scope}\0${address}`).digest('hex');
}

export async function consumeRateLimit(
  admin: Admin,
  scope: string,
  address: string | undefined,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const bucket = rateLimitBucket(scope, address ?? '');
  if (!bucket) return 'unavailable';

  const { data, error } = await admin.rpc('consume_rate_limit', {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error || typeof data !== 'boolean') return 'unavailable';
  return data ? 'allowed' : 'limited';
}

export function rateLimitResponse(result: RateLimitResult): Response | null {
  if (result === 'allowed') return null;
  const limited = result === 'limited';
  return new Response(JSON.stringify({ error: limited ? 'Too many requests. Try again shortly.' : 'Request protection is unavailable.' }), {
    status: limited ? 429 : 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(limited ? { 'Retry-After': '60' } : {}),
    },
  });
}