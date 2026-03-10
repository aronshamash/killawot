interface ContactFormData {
  name: string;
  email: string;
  company?: string;
  service?: string;
  message: string;
}

export const onRequestPost: PagesFunction = async (context) => {
  try {
    const body = (await context.request.json()) as ContactFormData;

    if (!body.name || !body.email || !body.message) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      return new Response(JSON.stringify({ error: 'Invalid email address' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Store in KV if available, otherwise log
    // To enable KV storage, bind a KV namespace called CONTACT_SUBMISSIONS in wrangler.toml
    const kvNamespace = (context.env as Record<string, unknown>).CONTACT_SUBMISSIONS as KVNamespace | undefined;

    const submission = {
      ...body,
      timestamp: new Date().toISOString(),
      ip: context.request.headers.get('CF-Connecting-IP') || 'unknown',
    };

    if (kvNamespace) {
      const key = `contact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await kvNamespace.put(key, JSON.stringify(submission), {
        expirationTtl: 60 * 60 * 24 * 90, // 90 days
      });
    }

    // Log for now — connect email service (Resend, SendGrid, etc.) as needed
    console.log('Contact form submission:', JSON.stringify(submission));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
