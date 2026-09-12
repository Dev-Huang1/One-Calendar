import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    // node by default: the migration rehearsals talk to a real Postgres and jose
    // rejects jsdom's separate-realm Uint8Array. Component tests opt into jsdom
    // with a @vitest-environment pragma at the top of the file.
    environment: 'node',
    setupFiles: ['./vitest-setup.ts'],
    globals: true,
    include: [
      '../../tests/auth/**/*.test.ts',
      '../../tests/auth/**/*.test.tsx',
    ],
    // The integration tests (plan 026 Seam 2) reach a real Postgres in
    // eu-north-1; a TLS handshake from a phone does not fit the 5s default.
    // Kept as a per-suite budget rather than a global one so a genuinely hung
    // unit test still fails fast.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // One schema, several suites, and the migration rehearsals must use the REAL
    // table names -- that is what makes them rehearsals rather than tests of a
    // renamed copy. So they cannot run concurrently: two suites creating
    // `account` in the same schema is not a race to fix with a lock, it is two
    // tests sharing one resource. Serial is the honest answer.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@zntr/auth': path.resolve(__dirname, 'src'),
      // Tests live outside this package and pnpm does not hoist to the repo
      // root, so a bare specifier in tests/auth resolves to nothing while the
      // source under test resolves the real module — `vi.mock` then silently
      // never applies and the test runs against Better Auth itself.
      'better-auth/adapters/drizzle': path.resolve(
        __dirname,
        'node_modules/better-auth/dist/adapters/drizzle-adapter/index.mjs',
      ),
      'better-auth/plugins': path.resolve(
        __dirname,
        'node_modules/better-auth/dist/plugins/index.mjs',
      ),
      // Subpaths must be listed before the bare specifier: vite matches the
      // first alias that prefixes the request, so a bare `better-auth` entry
      // would swallow `better-auth/react` and resolve it to a directory.
      'better-auth/react': path.resolve(
        __dirname,
        'node_modules/better-auth/dist/client/react/index.mjs',
      ),
      'better-auth/client/plugins': path.resolve(
        __dirname,
        'node_modules/better-auth/dist/client/plugins/index.mjs',
      ),
      'better-auth/api': path.resolve(
        __dirname,
        'node_modules/better-auth/dist/api/index.mjs',
      ),
      'better-auth/db': path.resolve(
        __dirname,
        'node_modules/better-auth/dist/db/index.mjs',
      ),
      'better-auth/cookies': path.resolve(
        __dirname,
        'node_modules/better-auth/dist/cookies/index.mjs',
      ),
      'better-auth/next-js': path.resolve(
        __dirname,
        'node_modules/better-auth/dist/integrations/next-js.mjs',
      ),
      'better-auth': path.resolve(__dirname, 'node_modules/better-auth'),
      '@better-auth/sentinel': path.resolve(
        __dirname,
        'node_modules/@better-auth/sentinel',
      ),
      // The integration tests (plan 026 Seam 2) need a real Postgres driver.
      // It is not a dependency of this package -- the calendar owns it -- and
      // pnpm does not hoist to the repo root, so tests/auth cannot resolve a
      // bare specifier without this.
      // JWT verification is core client behaviour, so jose is a real dependency
      // of this package rather than test-only -- but tests/auth still needs the
      // alias, since pnpm does not hoist to the repo root.
      jose: path.resolve(__dirname, 'node_modules/jose'),
      postgres: path.resolve(
        __dirname,
        '../../apps/calendar/node_modules/postgres',
      ),
    },
  },
  server: {
    fs: {
      allow: ['../..'],
    },
  },
})
