export const prerender = false;

import type { APIRoute } from 'astro';
import { clearSession } from '../../../lib/auth';

export const GET: APIRoute = ({ cookies, redirect }) => {
  clearSession(cookies);
  return redirect('/pos/login');
};
