import { describe, expect, it, vi } from 'vitest';
import { POST } from '../src/pages/api/newsletter';

interface FakeKV {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

function createKv(seed: Record<string, string> = {}): FakeKV {
  const store = new Map(Object.entries(seed));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

function createContext(body: unknown, kv: FakeKV = createKv()) {
  return {
    request: {
      json: async () => body,
    } as unknown as Request,
    locals: { runtime: { env: { NEWSLETTER_SUBSCRIBERS: kv } } },
  } as Parameters<typeof POST>[0];
}

async function jsonOf(response: Response) {
  return response.json();
}

describe('POST /api/newsletter', () => {
  it('stores a valid email and confirms success', async () => {
    const kv = createKv();
    const response = await POST(createContext({ email: 'visitor@example.com' }, kv));

    expect(response.status).toBe(200);
    await expect(jsonOf(response)).resolves.toEqual({ ok: true });
    expect(kv.put).toHaveBeenCalledTimes(1);
    const [key, value] = kv.put.mock.calls[0];
    expect(key).toBe('subscriber:visitor@example.com');
    expect(JSON.parse(value)).toMatchObject({ email: 'visitor@example.com' });
  });

  it('normalises email casing/whitespace before storing and deduping', async () => {
    const kv = createKv();
    await POST(createContext({ email: '  Visitor@Example.com  ' }, kv));

    expect(kv.put).toHaveBeenCalledWith('subscriber:visitor@example.com', expect.any(String));
  });

  it('rejects a malformed email without storing it', async () => {
    const kv = createKv();
    const response = await POST(createContext({ email: 'not-an-email' }, kv));

    expect(response.status).toBe(400);
    await expect(jsonOf(response)).resolves.toEqual({ error: 'Enter a valid email address' });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('rejects a missing email and prompts for one, without storing anything', async () => {
    const kv = createKv();
    const response = await POST(createContext({ email: '' }, kv));

    expect(response.status).toBe(400);
    await expect(jsonOf(response)).resolves.toEqual({ error: 'Email is required' });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('rejects a request with no email field at all', async () => {
    const kv = createKv();
    const response = await POST(createContext({}, kv));

    expect(response.status).toBe(400);
    await expect(jsonOf(response)).resolves.toEqual({ error: 'Email is required' });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('does not create a duplicate entry for an already-subscribed email, and returns a success message', async () => {
    const kv = createKv({
      'subscriber:visitor@example.com': JSON.stringify({ email: 'visitor@example.com', subscribedAt: 'earlier' }),
    });
    const response = await POST(createContext({ email: 'visitor@example.com' }, kv));

    expect(response.status).toBe(200);
    await expect(jsonOf(response)).resolves.toEqual({ ok: true, alreadySubscribed: true });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('treats an existing email as a duplicate regardless of casing', async () => {
    const kv = createKv({
      'subscriber:visitor@example.com': JSON.stringify({ email: 'visitor@example.com', subscribedAt: 'earlier' }),
    });
    const response = await POST(createContext({ email: 'VISITOR@EXAMPLE.COM' }, kv));

    await expect(jsonOf(response)).resolves.toMatchObject({ alreadySubscribed: true });
  });

  it('silently rejects a submission when the honeypot field is filled, without storing it or revealing detection', async () => {
    const kv = createKv();
    const response = await POST(createContext({ email: 'bot@example.com', website: 'http://spam.example' }, kv));

    expect(response.status).toBe(200);
    await expect(jsonOf(response)).resolves.toEqual({ ok: true });
    expect(kv.get).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('rejects a request body that is not valid JSON', async () => {
    const context = {
      request: {
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      } as unknown as Request,
      locals: { runtime: { env: { NEWSLETTER_SUBSCRIBERS: createKv() } } },
    } as Parameters<typeof POST>[0];

    const response = await POST(context);

    expect(response.status).toBe(400);
    await expect(jsonOf(response)).resolves.toEqual({ error: 'Invalid request body' });
  });

  it('returns a server misconfiguration error when the KV binding is missing', async () => {
    const context = {
      request: { json: async () => ({ email: 'visitor@example.com' }) } as unknown as Request,
      locals: { runtime: { env: {} } },
    } as Parameters<typeof POST>[0];

    const response = await POST(context);

    expect(response.status).toBe(500);
    await expect(jsonOf(response)).resolves.toEqual({ error: 'Server misconfiguration' });
  });
});
