import { defineConfig } from "eslint/config";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import tseslint from "typescript-eslint";

export default defineConfig([
	{
		ignores: [
			"**/node_modules/**",
			"**/dist/**",
			"**/.nx/**",
			"**/coverage/**",
			"eslint.config.ts",
			"test/fixtures/**",
			"test/analyze/extract/fixtures/**",
		],
	},
	...tseslint.configs.recommended,
	eslintPluginPrettierRecommended,
	{
		files: ["**/*.ts", "**/*.tsx"],
		languageOptions: {
			parserOptions: {
				projectService: true,
			},
		},
		rules: {
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
					destructuredArrayIgnorePattern: "^_",
				},
			],
			"prettier/prettier": ["error", { singleQuote: true, printWidth: 120 }],
		},
	},
	{
		files: ["test/**/*.ts", "src/**/*.test.ts"],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"no-console": "off",
		},
	},
]);
