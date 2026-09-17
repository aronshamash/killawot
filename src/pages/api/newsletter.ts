import type { APIRoute } from 'astro';

export const prerender = false;

interface NewsletterPayload {
  email?: string;
  website?: string; // honeypot — must stay empty for real submissions
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request, locals }) => {
  let body: NewsletterPayload;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  // Honeypot: bots that fill this field get a generic success response so the
  // detection is never revealed, but nothing is stored.
  if (body.website) {
    return jsonResponse({ ok: true }, 200);
  }

  const email = body.email?.trim().toLowerCase();

  if (!email) {
    return jsonResponse({ error: 'Email is required' }, 400);
  }

  if (!EMAIL_REGEX.test(email)) {
    return jsonResponse({ error: 'Enter a valid email address' }, 400);
  }

  const kv = (locals as { runtime?: { env?: { NEWSLETTER_SUBSCRIBERS?: KVNamespace } } }).runtime?.env
    ?.NEWSLETTER_SUBSCRIBERS;

  if (!kv) {
    console.error('NEWSLETTER_SUBSCRIBERS KV binding is not configured');
    return jsonResponse({ error: 'Server misconfiguration' }, 500);
  }

  const key = `subscriber:${email}`;
  const existing = await kv.get(key);

  if (existing) {
    return jsonResponse({ ok: true, alreadySubscribed: true }, 200);
  }

  await kv.put(
    key,
    JSON.stringify({
      email,
      subscribedAt: new Date().toISOString(),
    }),
  );

  return jsonResponse({ ok: true }, 200);
};
