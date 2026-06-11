// @ts-check
import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * ESLint "flat config" (formato de ESLint 9).
 *
 * Capas, en orden — cada una pisa a la anterior:
 * 1. Reglas base de JavaScript.
 * 2. Reglas de TypeScript CON información de tipos (recommendedTypeChecked):
 *    detecta promesas sin await, comparaciones imposibles, etc. Cuesta más
 *    CPU que la versión sin tipos, pero en un backend async como este los
 *    bugs de promesas olvidadas son los más caros.
 * 3. eslint-config-prettier APAGA toda regla de formato: del formato se
 *    encarga Prettier; ESLint solo opina de correctitud. Sin esto, ambos
 *    pelearían por dónde van las comas.
 */
export default tseslint.config(
  // Qué no se analiza: artefactos de build y este propio archivo (es .mjs,
  // no pertenece a ningún tsconfig y el modo type-checked fallaría con él).
  { ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        // projectService: ESLint localiza solo el tsconfig que cubre cada
        // archivo (apps/api, apps/worker, libs/...) — sin listarlos a mano.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
