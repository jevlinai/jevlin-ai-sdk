import { tool } from 'ai';
import { z } from 'zod';

/** The router's fan-out width. `fast` asks a few fast indexes, `balanced` the core set. */
export type JevlinTier = 'fast' | 'balanced' | 'max';
export type JevlinRecency = 'day' | 'week' | 'month' | 'year';

export interface SuperSearchConfig {
  /** An `sr-` key. Defaults to the `JEVLIN_API_KEY` environment variable. */
  apiKey?: string;
  /** Defaults to `https://api.jevlin.ai`. */
  baseUrl?: string;
  /** The tier a search uses when the model does not name one. Unset, the key's own default applies. */
  tier?: JevlinTier;
  /** Results in the merged list, 1 to 25. Defaults to 8. */
  maxResults?: number;
  /** Characters of text per page, 200 to 4000. Unset, the router's default applies. */
  pageChars?: number;
  /** Let the model choose `tier` per search. Off by default: the tier is a cost decision. */
  modelMayChooseTier?: boolean;
  /** Request timeout in milliseconds. Defaults to 30,000. */
  timeoutMs?: number;
  /** A `fetch` to use in place of the global one. */
  fetch?: typeof globalThis.fetch;
}

export interface SuperSearchResult {
  url: string;
  title: string;
  published?: string;
  /** What the engines returned for the page, joined and trimmed. */
  excerpt: string;
  /** The engines that listed this page. Agreement between engines is evidence. */
  foundBy: string[];
  /** How many independent indexes (or query forms) listed it. */
  votes: number;
}

export interface SuperSearchOutput {
  query: string;
  results: SuperSearchResult[];
  /** Each engine asked, with its status: an engine that failed is named here, not hidden. */
  engines: { name: string; status: string; results?: number }[];
  /** The router's id for this search; the trace on platform.jevlin.ai is filed under it. */
  requestId?: string;
  /** `free`, `reduced` or `credit`: the price band this search was served in, when reported. */
  billing?: string;
  costUsd?: number;
}

export class JevlinError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'JevlinError';
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_BASE_URL = 'https://api.jevlin.ai';

const baseShape = {
  query: z
    .string()
    .min(1)
    .max(2000)
    .describe('One focused search query, as you would type it into a search engine.'),
  searchQueries: z
    .array(z.string().min(1).max(2000))
    .max(4)
    .optional()
    .describe(
      'Up to 4 other wordings of the same question. Each runs beside the query and the results are pooled; use when one wording may miss the page.',
    ),
  recency: z
    .enum(['day', 'week', 'month', 'year'])
    .optional()
    .describe('Prefer results from this window. Use for anything time-bound: a release, a price, the news.'),
  domains: z
    .array(z.string().min(1))
    .max(16)
    .optional()
    .describe('Restrict to these bare hostnames, e.g. ["developer.mozilla.org"].'),
};

const tierField = z
  .enum(['fast', 'balanced', 'max'])
  .optional()
  .describe('fast: a few fast indexes. balanced: the core set, for when several independent sources matter.');

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name];
}

type RouterMerged = {
  url?: string;
  title?: string;
  published?: string | null;
  excerpt?: string;
  found_by?: { provider?: string }[];
  votes?: number;
};

type RouterResponse = {
  request_id?: string;
  merged?: RouterMerged[];
  indexes?: { by_provider?: { provider?: string; status?: string; results?: number }[] };
  usage?: { billing?: string; cost_micros?: number };
};

/**
 * Jevlin SuperSearch as an AI SDK tool. One call asks several search engines at once and
 * returns one merged, de-duplicated list in which every result names the engines that found it.
 */
export function superSearch(config: SuperSearchConfig = {}) {
  const inputSchema = config.modelMayChooseTier
    ? z.object({ ...baseShape, tier: tierField })
    : z.object(baseShape);

  return tool({
    description:
      'Search the web with Jevlin SuperSearch: several search engines are asked at once and their results merged into one list. ' +
      'Each result names the engines that found it (foundBy); a page several engines agree on is more likely the one to read. ' +
      'Use for current information, documentation, errors, releases and anything you are not sure of.',
    inputSchema,
    execute: async (input, options): Promise<SuperSearchOutput> => {
      const apiKey = config.apiKey ?? readEnv('JEVLIN_API_KEY');
      if (!apiKey) {
        throw new JevlinError(
          401,
          'no_api_key',
          'No Jevlin API key: set JEVLIN_API_KEY or pass apiKey to superSearch(). Get one at https://platform.jevlin.ai.',
        );
      }
      const doFetch = config.fetch ?? globalThis.fetch;
      const base = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
      // A tier the model sends counts only when it was offered one: the tier is a cost decision.
      const tier = (config.modelMayChooseTier ? (input as { tier?: JevlinTier }).tier : undefined) ?? config.tier;

      const body: Record<string, unknown> = {
        query: input.query,
        view: 'merged',
        // max_results is what each engine is asked for; merged_limit is the merged list's own window.
        max_results: clamp(config.maxResults ?? 8, 1, 25),
        merged_limit: clamp(config.maxResults ?? 8, 1, 25),
      };
      if (tier) body.tier = tier;
      if (input.recency) body.recency = input.recency;
      if (input.domains?.length) body.domain_filter = input.domains.map(bareHost);
      if (input.searchQueries?.length) body.search_queries = input.searchQueries;
      if (config.pageChars) body.page_chars = clamp(config.pageChars, 200, 4000);

      const timeout = AbortSignal.timeout(config.timeoutMs ?? 30_000);
      const signal = options?.abortSignal ? AbortSignal.any([options.abortSignal, timeout]) : timeout;

      const res = await doFetch(`${base}/v1/search`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'user-agent': 'jevlin-ai-sdk/0.1.0',
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        let code = 'http_error';
        let message = `Jevlin search failed with HTTP ${res.status}`;
        try {
          const err = (await res.json()) as { code?: string; error?: string | { message?: string } };
          if (typeof err.code === 'string') code = err.code;
          const text = typeof err.error === 'string' ? err.error : err.error?.message;
          if (text) message = `Jevlin search failed (${res.status} ${code}): ${text}`;
        } catch {
          // a non-JSON refusal keeps the generic message
        }
        throw new JevlinError(res.status, code, message);
      }

      const data = (await res.json()) as RouterResponse;
      const limit = clamp(config.maxResults ?? 8, 1, 25);
      const results: SuperSearchResult[] = (data.merged ?? [])
        .filter((m): m is RouterMerged & { url: string } => typeof m.url === 'string' && m.url !== '')
        .slice(0, limit)
        .map(m => ({
          url: m.url,
          title: m.title ?? '',
          ...(m.published ? { published: m.published } : {}),
          excerpt: m.excerpt ?? '',
          foundBy: unique((m.found_by ?? []).map(f => f.provider).filter((p): p is string => !!p)),
          votes: m.votes ?? 0,
        }));

      const out: SuperSearchOutput = {
        query: input.query,
        results,
        engines: (Array.isArray(data.indexes?.by_provider) ? data.indexes.by_provider : []).map(i => ({
          name: i.provider ?? 'unknown',
          status: i.status ?? 'unknown',
          ...(typeof i.results === 'number' ? { results: i.results } : {}),
        })),
      };
      const requestId = data.request_id ?? res.headers.get('x-request-id') ?? undefined;
      if (requestId) out.requestId = requestId;
      if (data.usage?.billing) out.billing = data.usage.billing;
      if (typeof data.usage?.cost_micros === 'number') out.costUsd = data.usage.cost_micros / 1_000_000;
      return out;
    },
  });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** The router takes bare hostnames; a model often hands over a URL. */
function bareHost(s: string): string {
  return s
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase();
}
