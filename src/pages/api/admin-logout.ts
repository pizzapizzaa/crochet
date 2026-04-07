export const prerender = false;

import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ cookies, redirect }) => {
  cookies.delete('admin_auth', { path: '/' });
  return redirect('/');
};
