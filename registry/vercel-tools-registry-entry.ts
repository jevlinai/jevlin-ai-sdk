// The entry for vercel/ai content/tools-registry/registry.ts, appended to the `tools` array.
// PR title: feat(tools-registry): add jevlin-supersearch
  {
    slug: 'jevlin-supersearch',
    name: 'Jevlin SuperSearch',
    description:
      'Jevlin SuperSearch asks several web search engines in one call and returns one merged, de-duplicated list. Every result names the engines that found it, so your model can see which pages independent indexes agree on, and an engine that failed is reported rather than hidden.',
    packageName: '@jevlinsearch/ai-sdk',
    tags: ['search', 'web', 'multi-engine'],
    apiKeyEnvName: 'JEVLIN_API_KEY',
    installCommand: {
      pnpm: 'pnpm add @jevlinsearch/ai-sdk',
      npm: 'npm install @jevlinsearch/ai-sdk',
      yarn: 'yarn add @jevlinsearch/ai-sdk',
      bun: 'bun add @jevlinsearch/ai-sdk',
    },
    codeExample: `import { generateText, isStepCount } from 'ai';
import { superSearch } from '@jevlinsearch/ai-sdk';

const { text } = await generateText({
  model: 'openai/gpt-5-mini',
  prompt: 'What changed in the latest stable Kubernetes release?',
  tools: {
    superSearch: superSearch(),
  },
  stopWhen: isStepCount(3),
});

console.log(text);`,
    docsUrl: 'https://docs.jevlin.ai/integrations/ai-sdk',
    apiKeyUrl: 'https://platform.jevlin.ai',
    websiteUrl: 'https://jevlin.ai',
    npmUrl: 'https://www.npmjs.com/package/@jevlinsearch/ai-sdk',
  },
