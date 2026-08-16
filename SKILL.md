<!-- repository: packages/ts/media | kind: PACKAGE | stack: ts-package -->

# media — Skill: Package Development

> Workflow for media (packages/ts/media). Execute this workflow before, during, and
> after changes in this repository.

## Repository Facts

- Kind: Shared Package
- Package: `@omnixys/media-ts` (version: 3.0.3)
- Runtime: Node >=20 (pnpm >=10.33.0)
- Description: Omnixys media/storage package for TypeScript (S3/MinIO).
- Architecture: src/ media/storage
- Database: n/a; Migrations: n/a
- API: n/a
- Messaging: n/a
- Tests: node --test test/*.test.mjs; type tests via tsc -p tsconfig.type-tests.json where present


## Workflow

### 1. Understand the change

- Identify consumers of this package across `omnixys/services` and other packages.
- This package is published (`@omnixys/media-ts`); consumers pin versions and rely on SemVer.

### 2. Implement

- Keep the public API surface explicit and intentional.
- For TypeScript packages, generated/transpiled output (e.g. `dist/`) must not be hand-edited.
- Reuse established Omnixys packages where relevant.

### 3. Write tests

- Unit tests exercise public API behavior and edge cases.
- Type tests are included where the package defines a `type-tests` suite.
- Verify exports compile from a consumer perspective.

### 4. Validate

## Validation

Run each applicable check and record the result as `PASS`, `FAIL`, `PRE-EXISTING
FAILURE`, or `NOT RUN` (with a reason). Never convert `NOT RUN` into `PASS`.

  - `pnpm install --frozen-lockfile`
  - `pnpm exec prettier --check "src/**/*.{ts,js,json,md,yaml}"`
  - `no ESLint configuration; type checking and formatting govern style`
  - `tsc -p tsconfig.json --noEmit`
  - `node --test test/*.test.mjs`
  - `pnpm build`
  - `pnpm test`

## Commit

- Use Conventional Commits (`<type>(<scope>): <summary>`), e.g. `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `ci`, `perf`.
- Stage only files belonging to the logical change. Run `git diff --check` before committing.
- Commit locally; never push.

## Definition of Done

See the "Definition of Done" section in `AGENTS.md`. Before finishing, confirm
`AGENTS.md` and `SKILL.md` remain accurate for this repository.
