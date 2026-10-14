export const prerender = false;

import type { APIRoute } from 'astro';
import { setSession } from '../../lib/auth';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import { consumeRateLimit, rateLimitResponse } from '../../lib/rateLimit';

export const POST: APIRoute = async ({ request, redirect, cookies, clientAddress }) => {
  const adminPassword = import.meta.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return new Response('Server misconfiguration: ADMIN_PASSWORD is not set.', { status: 500 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return new Response('Request protection is unavailable.', { status: 503 });
  const rate = await consumeRateLimit(admin, 'admin-login', clientAddress, 10, 900);
  const limited = rateLimitResponse(rate);
  if (limited) return limited;

  const formData = await request.formData();
  const password = formData.get('password')?.toString() ?? '';

  if (password !== adminPassword) {
    return redirect('/admin/login?error=1');
  }

  if (!setSession(cookies)) {
    return new Response('Server misconfiguration: SESSION_SECRET is not set.', { status: 500 });
  }

  return redirect('/pattern-generator');
};
