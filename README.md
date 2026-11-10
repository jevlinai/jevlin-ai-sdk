# @jevlinsearch/ai-sdk

[Jevlin](https://jevlin.ai) SuperSearch as a tool for the [AI SDK](https://ai-sdk.dev). One call asks several search engines at once and returns one merged, de-duplicated list. Every result names the engines that found it, so your model can see which pages independent indexes agree on.

## Install

```bash
npm install @jevlinsearch/ai-sdk
```

Set `JEVLIN_API_KEY` to an `sr-` key from [platform.jevlin.ai](https://platform.jevlin.ai).

## Use

```ts
import { generateText, isStepCount } from 'ai';
import { superSearch } from '@jevlinsearch/ai-sdk';

const { text } = await generateText({
  model: 'openai/gpt-5-mini',
  prompt: 'What changed in the latest stable Kubernetes release?',
  tools: {
    superSearch: superSearch(),
  },
  stopWhen: isStepCount(3),
});

console.log(text);
```

The model sends a `query` and, when it helps, `recency` (`day`, `week`, `month`, `year`), `domains` (bare hostnames) and `searchQueries` (up to four other wordings of the same question, pooled with the first).

## What the tool returns

```ts
{
  query: 'latest stable Kubernetes release',
  results: [
    {
      url: 'https://kubernetes.io/releases/',
      title: 'Releases',
      published: '2026-10-28',
      excerpt: '…',
      foundBy: ['exa', 'brave', 'serper'], // the engines that listed this page
      votes: 3,                             // how many independent indexes did
    },
  ],
  engines: [{ name: 'exa', status: 'ok', results: 8 }, { name: 'tinyfish', status: 'timeout' }],
  requestId: '01a1…',   // the trace on platform.jevlin.ai is filed under this
  billing: 'credit',
  costUsd: 0.015,
}
```

An engine that failed is named in `engines`, not hidden. The rest of the fan-out still answers.

## Options

```ts
superSearch({
  apiKey: process.env.JEVLIN_API_KEY, // the default
  tier: 'fast',              // 'fast' | 'balanced' | 'max'; unset, your key's default applies
  maxResults: 8,             // 1 to 25
  pageChars: 1200,           // text per page, 200 to 4000
  modelMayChooseTier: false, // true adds `tier` to what the model may send
  timeoutMs: 30_000,
  baseUrl: 'https://api.jevlin.ai',
});
```

`tier` decides how many engines a search asks and what it costs, so the model cannot change it unless you set `modelMayChooseTier`.

## Errors

A refusal from the router is thrown as a `JevlinError` with the HTTP `status` and the router's `code`, for example `401 bad_key`, `402 credits_exhausted` or `429 rate_limited`. The AI SDK hands a thrown tool error back to the model as a tool error.

## Pricing

A search from this package is billed at list price from your account's credit: see [Pricing](https://docs.jevlin.ai/use/pricing). The free allowance is for searches that carry an agent's trajectory, which the Jevlin client sends from a coding agent's hooks; this package does not send one.

## Links

- [AI SDK integration guide](https://docs.jevlin.ai/integrations/ai-sdk)
- [Request options](https://docs.jevlin.ai/use/request-options)
- [Jevlin for coding agents](https://docs.jevlin.ai/quickstart): Claude Code, Cursor, Codex, opencode, Pi and Hermes

Apache-2.0
