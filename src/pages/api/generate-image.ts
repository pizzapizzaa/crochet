export const prerender = false;

import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY is not configured.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let prompt: string;
  try {
    const body = await request.json();
    prompt = body?.prompt?.toString() ?? '';
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!prompt) {
    return new Response(JSON.stringify({ error: 'prompt is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-003:predict?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: '1:1' },
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    return new Response(JSON.stringify({ error: errText }), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const data = await res.json();
  const imageData: string | undefined = data.predictions?.[0]?.bytesBase64Encoded;
  const mimeType: string = data.predictions?.[0]?.mimeType ?? 'image/png';

  if (!imageData) {
    return new Response(JSON.stringify({ error: 'No image returned from Gemini.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({ image: `data:${mimeType};base64,${imageData}` }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
