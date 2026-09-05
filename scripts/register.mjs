import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
// Resolve TypeScript source for Node's built-in test runner; no browser code is imported.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/'))
      return nextResolve(
        new URL(specifier.slice(2) + '.ts', root).href,
        context,
      );
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(specifier, context.parentURL);
      if (
        !existsSync(fileURLToPath(url)) &&
        existsSync(fileURLToPath(url) + '.ts')
      )
        return nextResolve(url.href + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});
