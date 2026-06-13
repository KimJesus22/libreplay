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
  // Qué no se analiza: artefactos de build y los .mjs sueltos (este archivo
  // y scripts/) — no pertenecen a ningún tsconfig y el modo type-checked
  // fallaría con ellos. scripts/ son utilidades de demo, no código de la app.
  { ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs', 'scripts/**'] },
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
