/**
 * Runtime resolver for the `@/*` path alias used across the source tree.
 *
 * `tsc` type-checks `@/*` via `compilerOptions.paths` but does not rewrite the
 * specifier in its emit, so the compiled CommonJS under `.test-dist` would
 * otherwise fail with MODULE_NOT_FOUND. This hook maps `@/x` to
 * `.test-dist/x` for the duration of the test run.
 */
const path = require('node:path');
const Module = require('node:module');

const compiledRoot = path.resolve(__dirname, '..', '.test-dist');
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function resolveWithAlias(request, ...rest) {
  if (typeof request === 'string' && request.startsWith('@/')) {
    return originalResolve.call(this, path.join(compiledRoot, request.slice(2)), ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};
