import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

/*
 * The .env ships with placeholder values so the site can be developed against
 * mock data. Rather than throwing at import time (which would take the whole
 * build down), we expose a null client and let callers fall back.
 */
const isPlaceholder = (v: string | undefined) =>
  !v || v.includes('your-project-id') || v.includes('your-anon-key');

export const isSupabaseConfigured = !isPlaceholder(supabaseUrl) && !isPlaceholder(supabaseAnonKey);

export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl, supabaseAnonKey)
  : null;
