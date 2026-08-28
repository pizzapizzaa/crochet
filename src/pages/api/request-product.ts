import type { APIRoute } from 'astro';
import { Resend } from 'resend';

const CATEGORY_LABELS: Record<string, string> = {
  crochet_design: 'New crochet design / pattern',
  yarn: 'New yarn type or color',
  tool: 'Crochet tool or accessory',
  other: 'Other',
};

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.RESEND_API_KEY;
  const ownerEmail = import.meta.env.OWNER_EMAIL;
  if (!apiKey || !ownerEmail) {
    return new Response(JSON.stringify({ error: 'Email service is not configured.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: FormData;
  try {
    body = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const name = (body.get('name') as string | null)?.trim() ?? '';
  const email = (body.get('email') as string | null)?.trim().toLowerCase() ?? '';
  const requestType = (body.get('request_type') as string | null) ?? '';
  const description = (body.get('description') as string | null)?.trim() ?? '';
  const referenceUrl = (body.get('reference_url') as string | null)?.trim() ?? '';

  if (!name || !email || !requestType || !description) {
    return new Response(JSON.stringify({ error: 'Please fill in all required fields.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'That email address does not look right.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const categoryLabel = CATEGORY_LABELS[requestType] ?? requestType;

  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    from: 'ZippyZack <onboarding@resend.dev>',
    to: ownerEmail,
    reply_to: email,
    subject: `Product Request: ${categoryLabel} from ${name}`,
    html: `
      <h2>New Product Request</h2>
      <table cellpadding="6" style="border-collapse:collapse">
        <tr><td><strong>Name</strong></td><td>${escapeHtml(name)}</td></tr>
        <tr><td><strong>Email</strong></td><td><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
        <tr><td><strong>Category</strong></td><td>${escapeHtml(categoryLabel)}</td></tr>
        ${referenceUrl ? `<tr><td><strong>Reference</strong></td><td><a href="${escapeHtml(referenceUrl)}">${escapeHtml(referenceUrl)}</a></td></tr>` : ''}
      </table>
      <h3>Description</h3>
      <p style="white-space:pre-wrap">${escapeHtml(description)}</p>
    `,
  });

  if (error) {
    console.error('Resend error:', error);
    return new Response(JSON.stringify({ error: 'Failed to send your request. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
