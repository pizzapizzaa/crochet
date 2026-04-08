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
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    },
  );

  if (!res.ok) {
    const errJson = await res.json().catch(() => null);
    const status = errJson?.error?.status;
    let message: string;
    if (res.status === 429 || status === 'RESOURCE_EXHAUSTED') {
      message =
        'Image generation requires a paid Gemini API plan. Enable billing at https://aistudio.google.com/apikey and link a billing account in Google Cloud Console.';
    } else if (res.status === 400 || status === 'INVALID_ARGUMENT') {
      message = 'Invalid request sent to Gemini. Please try a different prompt.';
    } else if (res.status === 403 || status === 'PERMISSION_DENIED') {
      message = 'Gemini API key is invalid or does not have permission to generate images.';
    } else {
      message = errJson?.error?.message ?? `Gemini API error (${res.status}).`;
    }
    return new Response(JSON.stringify({ error: message }), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const data = await res.json();
  const parts: { inlineData?: { data: string; mimeType: string } }[] =
    data.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData);
  const imageData: string | undefined = imagePart?.inlineData?.data;
  const mimeType: string = imagePart?.inlineData?.mimeType ?? 'image/png';

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
