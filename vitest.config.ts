import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Legacy decorators with emitted metadata, as in the nestjs/nest monorepo, so
  // parameter decorators and DI type lookup work in the specs. Class fields declared
  // without an initializer are types only, as under `tsc` with `useDefineForClassFields: false`.
  oxc: {
    decorator: {
      legacy: true,
      emitDecoratorMetadata: true,
    },
    assumptions: { setPublicClassFields: true },
    typescript: { removeClassFieldsWithoutInitializer: true },
  },
  test: {
    name: 'ai',
    globals: true,
    setupFiles: ['reflect-metadata'],
    include: ['tests/**/*.spec.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
