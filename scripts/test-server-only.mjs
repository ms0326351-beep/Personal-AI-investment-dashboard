// Only loaded by the Node test runner. Next.js still enforces server-only in builds.
import { registerHooks } from 'node:module';
registerHooks({resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') return nextResolve('next/dist/compiled/server-only/empty.js',context);
  return nextResolve(specifier,context);
}});
