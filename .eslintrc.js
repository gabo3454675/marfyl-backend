module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    // Anti-SQL-injection guard: forbid Prisma unsafe raw methods across all src/.
    // Use $queryRaw / $executeRaw with tagged templates, or parametrized
    // methods like findMany / groupBy instead. See TASK-B3.
    'no-restricted-syntax': [
      'error',
      {
        selector: "MemberExpression[property.name='$queryRawUnsafe']",
        message:
          '$queryRawUnsafe is forbidden: it allows SQL injection. Use $queryRaw with tagged templates or parametrized Prisma methods (findMany, groupBy, etc.).',
      },
      {
        selector: "MemberExpression[property.name='$executeRawUnsafe']",
        message:
          '$executeRawUnsafe is forbidden: it allows SQL injection. Use $executeRaw with tagged templates or parametrized Prisma methods (findMany, groupBy, etc.).',
      },
    ],
  },
};
