import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', '.wrangler', 'src/worker-configuration.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
