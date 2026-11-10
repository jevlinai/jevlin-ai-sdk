import { describe, expect, it } from 'vitest';
import { generateText, isStepCount } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { JevlinError, superSearch } from '../src/index';

const routerAnswer = {
  request_id: '01a1-test',
  merged: [
    {
      url: 'https://www.postgresql.org/docs/18/functions-uuid.html',
      title: 'UUID Functions',
      published: '2026-09-25',
      excerpt: 'uuidv7() generates a version 7 UUID.',
      found_by: [{ provider: 'exa', rank: 1 }, { provider: 'brave', rank: 2 }, { provider: 'exa', rank: 4 }],
      votes: 2,
    },
    { url: 'https://example.com/b', title: 'B', published: null, excerpt: 'b', found_by: [{ provider: 'serper', rank: 1 }], votes: 1 },
    { title: 'no url, dropped' },
  ],
  indexes: [
    { provider: 'exa', status: 'ok', results: 8 },
    { provider: 'tinyfish', status: 'timeout' },
  ],
  usage: { billing: 'credit', cost_micros: 15000 },
};

function fakeFetch(status = 200, body: unknown = routerAnswer) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { f, calls };
}

const opts = { toolCallId: 't1', messages: [] } as never;

describe('superSearch', () => {
  it('posts the merged-view request with the key as a bearer and maps the answer', async () => {
    const { f, calls } = fakeFetch();
    const t = superSearch({ apiKey: 'sr-test', fetch: f, tier: 'fast', maxResults: 5, pageChars: 99999 });
    const out = await t.execute!(
      { query: 'postgres uuidv7', recency: 'month', domains: ['https://PostgreSQL.org/docs/'], searchQueries: ['pg18 uuid v7'] },
      opts,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.jevlin.ai/v1/search');
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h.authorization).toBe('Bearer sr-test');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      query: 'postgres uuidv7',
      view: 'merged',
      max_results: 5,
      tier: 'fast',
      recency: 'month',
      domain_filter: ['postgresql.org'],
      search_queries: ['pg18 uuid v7'],
      page_chars: 4000,
    });

    expect(out).toEqual({
      query: 'postgres uuidv7',
      results: [
        {
          url: 'https://www.postgresql.org/docs/18/functions-uuid.html',
          title: 'UUID Functions',
          published: '2026-09-25',
          excerpt: 'uuidv7() generates a version 7 UUID.',
          foundBy: ['exa', 'brave'],
          votes: 2,
        },
        { url: 'https://example.com/b', title: 'B', excerpt: 'b', foundBy: ['serper'], votes: 1 },
      ],
      engines: [
        { name: 'exa', status: 'ok', results: 8 },
        { name: 'tinyfish', status: 'timeout' },
      ],
      requestId: '01a1-test',
      billing: 'credit',
      costUsd: 0.015,
    });
  });

  it('sends no tier unless one is configured, and hides tier from the model by default', async () => {
    const { f, calls } = fakeFetch();
    const t = superSearch({ apiKey: 'sr-test', fetch: f });
    await t.execute!({ query: 'q', tier: 'max' } as never, opts);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ query: 'q', view: 'merged', max_results: 8 });
  });

  it('lets the model choose the tier when asked to', async () => {
    const { f, calls } = fakeFetch();
    const t = superSearch({ apiKey: 'sr-test', fetch: f, tier: 'fast', modelMayChooseTier: true });
    await t.execute!({ query: 'q', tier: 'balanced' } as never, opts);
    expect(JSON.parse(String(calls[0]!.init.body)).tier).toBe('balanced');
  });

  it('raises the router code on a refusal and never the key', async () => {
    const { f } = fakeFetch(402, { error: 'out of credit', code: 'credits_exhausted' });
    const t = superSearch({ apiKey: 'sr-secret-value', fetch: f });
    const err = (await (t.execute!({ query: 'q' }, opts) as Promise<unknown>).catch(e => e)) as JevlinError;
    expect(err).toBeInstanceOf(JevlinError);
    expect(err.status).toBe(402);
    expect(err.code).toBe('credits_exhausted');
    expect(err.message).toContain('out of credit');
    expect(err.message).not.toContain('sr-secret-value');
  });

  it('survives a non-JSON refusal', async () => {
    const { f } = fakeFetch(503, '<html>bad gateway</html>');
    const t = superSearch({ apiKey: 'sr-test', fetch: f });
    const err = (await (t.execute!({ query: 'q' }, opts) as Promise<unknown>).catch(e => e)) as JevlinError;
    expect(err.status).toBe(503);
    expect(err.code).toBe('http_error');
  });

  it('refuses before the network when there is no key', async () => {
    const prev = process.env.JEVLIN_API_KEY;
    delete process.env.JEVLIN_API_KEY;
    try {
      const { f, calls } = fakeFetch();
      const t = superSearch({ fetch: f });
      const err = (await (t.execute!({ query: 'q' }, opts) as Promise<unknown>).catch(e => e)) as JevlinError;
      expect(err.code).toBe('no_api_key');
      expect(calls).toHaveLength(0);
    } finally {
      if (prev !== undefined) process.env.JEVLIN_API_KEY = prev;
    }
  });

  it('runs inside generateText: the model calls the tool, reads the result and answers', async () => {
    const { f, calls } = fakeFetch();
    let turn = 0;
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        turn++;
        if (turn === 1) {
          return {
            content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'superSearch', input: JSON.stringify({ query: 'postgres 18 uuidv7' }) }],
            finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
            usage,
            warnings: [],
          } as never;
        }
        return {
          content: [{ type: 'text', text: 'uuidv7() is built in.' }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage,
          warnings: [],
        } as never;
      },
    });

    const result = await generateText({
      model,
      prompt: 'Does Postgres 18 have uuidv7?',
      tools: { superSearch: superSearch({ apiKey: 'sr-test', fetch: f }) },
      stopWhen: isStepCount(3),
    });

    expect(calls).toHaveLength(1);
    expect(result.text).toBe('uuidv7() is built in.');
    const toolResults = result.steps.flatMap(s => s.toolResults);
    expect(toolResults).toHaveLength(1);
    expect((toolResults[0] as { output: { results: unknown[] } }).output.results).toHaveLength(2);
  });
});
