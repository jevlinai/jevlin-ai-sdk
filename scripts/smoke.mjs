// One live search through the built package. Needs JEVLIN_API_KEY (an sr- key) and `npm run build`.
import { superSearch } from '../dist/index.js';

const t = superSearch({ tier: 'fast', maxResults: 5 });
try {
  const o = await t.execute({ query: process.argv[2] ?? 'postgres 18 uuidv7 default column' }, { toolCallId: 'smoke', messages: [] });
  console.log('ok', o.requestId, 'billing:', o.billing, 'cost:', o.costUsd);
  console.log('engines:', o.engines.map(e => `${e.name}=${e.status}`).join(' '));
  for (const r of o.results) console.log(`- ${r.votes} [${r.foundBy.join('+')}] ${r.url}`);
} catch (e) {
  console.error(e.name, e.status, e.code, e.message);
  process.exit(1);
}
