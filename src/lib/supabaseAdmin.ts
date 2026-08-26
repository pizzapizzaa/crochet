import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

/*
 * Server-only Supabase client. The service-role key bypasses row-level
 * security, which is exactly what the POS needs to write products and
 * categories — and exactly why this module must never be imported from a
 * component that ships to the browser. Only /pos pages and /api/pos routes
 * (all `prerender = false`) touch it.
 */
const url = import.meta.env.PUBLIC_SUPABASE_URL;
const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

const isPlaceholder = (v: string | undefined) =>
  !v || v.includes('your-project-id') || v.includes('your-service-role-key');

export const isAdminConfigured = !isPlaceholder(url) && !isPlaceholder(serviceKey);

let client: SupabaseClient<Database> | null = null;

/** Returns the service-role client, or null when the env vars are unset. */
export function getSupabaseAdmin(): SupabaseClient<Database> | null {
  if (!isAdminConfigured) return null;
  if (!client) {
    client = createClient<Database>(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** Same, but throws — for API routes that cannot do anything useful without it. */
export function requireSupabaseAdmin(): SupabaseClient<Database> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error(
      'Supabase is not configured. Set PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env.',
    );
  }
  return admin;
}
