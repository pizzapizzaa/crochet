export const prerender = false;

import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, redirect, cookies }) => {
  const formData = await request.formData();
  const password = formData.get('password')?.toString() ?? '';
  const adminPassword = import.meta.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return new Response('Server misconfiguration: ADMIN_PASSWORD is not set.', { status: 500 });
  }

  if (password !== adminPassword) {
    return redirect('/admin/login?error=1');
  }

  cookies.set('admin_auth', btoa(adminPassword), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours
  });

  return redirect('/pattern-generator');
};
