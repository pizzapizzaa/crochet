import { supabase, isSupabaseConfigured } from './supabase';
import { mockProducts } from './mockData';
import type { Category, Product } from './database.types';

/*
 * Storefront reads. Everything here degrades to the mock catalogue when
 * Supabase is not configured (or is unreachable), so the shop keeps rendering
 * while the POS is being set up. Once pos-schema.sql has been run and the env
 * vars are real, the same calls return live rows written from /pos.
 */

/** Categories derived from the mock catalogue, used as the offline fallback. */
function mockCategories(): Category[] {
  const names = [...new Set(mockProducts.map((p) => p.category))];
  return names.map((name, i) => ({
    id: `mock-${slugify(name)}`,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    name,
    slug: slugify(name),
    description: null,
    image_url: null,
    display_order: i + 1,
    is_active: true,
  }));
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Active categories in display order. */
export async function getCategories(): Promise<Category[]> {
  if (!isSupabaseConfigured || !supabase) return mockCategories();

  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true });

  // Only fall back on a real failure. An empty result is a legitimate answer
  // once the shop is live - otherwise hiding every category would resurrect
  // the mock list.
  if (error || !data) return mockCategories();
  return data;
}

/** Active products for the shop grid. */
export async function getProducts(): Promise<Product[]> {
  if (!isSupabaseConfigured || !supabase) return mockProducts.filter((p) => p.is_active);

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error || !data) return mockProducts.filter((p) => p.is_active);
  return data;
}

/** A single active product by slug, or null. */
export async function getProductBySlug(slug: string): Promise<Product | null> {
  if (!isSupabaseConfigured || !supabase) {
    return mockProducts.find((p) => p.slug === slug && p.is_active) ?? null;
  }

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();

  if (error) return mockProducts.find((p) => p.slug === slug && p.is_active) ?? null;
  return data ?? null;
}
