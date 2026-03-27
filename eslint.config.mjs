import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'

export default defineConfig(
  { ignores: ['dist/', '.wrangler/', 'worker-configuration.d.ts'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  eslintConfigPrettier,
)
