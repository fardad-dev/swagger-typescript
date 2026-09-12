# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`swagger-typescript` (CLI: `swag-ts`) is a code generator that turns an OpenAPI v3 / Swagger v2 / Postman collection document into TypeScript, JavaScript, or Kotlin API client code. Published to npm; consumers install it as a devDependency and run `yarn swag-ts`, or call `generate(config)` from Node.

## Commands

```bash
yarn prepare        # husky install + tsc: compiles src/*.mts -> lib/*.mjs (this IS the build)
yarn test           # prepare, then jest with NODE_OPTIONS=--experimental-vm-modules
yarn lint           # eslint src/**/*.ts
yarn eslint-fix
yarn prettier-fix
yarn release        # prepare + test + standard-version + push tags + npm publish
```

Run a single test (the `lib/` build must be current — run `yarn prepare` first if you changed `src/`):

```bash
cross-env NODE_OPTIONS=--experimental-vm-modules npx jest __tests__/e2e/petstore3.test.mjs
cross-env NODE_OPTIONS=--experimental-vm-modules npx jest __tests__/e2e/ -u   # update snapshots
cross-env NODE_OPTIONS=--experimental-vm-modules npx jest -t "should generate"
```

Manual smoke run against a config: `yarn test:api` (builds, then runs `node ./bin/index.mjs`).

Git hooks: `pre-commit` runs `yarn lint && yarn test`; `commit-msg` runs commitlint with conventional-commit rules (release notes and version bumps come from those messages via standard-version).

## Source layout and conventions

- Source is `.mts` (ESM TypeScript). **Intra-repo imports must use the `.mjs` extension** (`import { generator } from "./generator.mjs"`) even though the file on disk is `.mts` — this is required for the emitted ESM to resolve.
- `tsc` emits to `lib/`, and `bin/index.mjs` imports `../lib/index.mjs`. Nothing runs from `src/` directly, so **edits to `src/` are invisible to tests and the CLI until `tsc` runs**.
- `lib/` is committed and shipped (`files: ["lib", "files", "bin"]`).

## Architecture

The pipeline is: **fetch/normalize spec → build an AST → render strings per language → prettier-format → write files**.

1. **Entry** — [src/index.mts](src/index.mts): `generate()` reads `swagger.config.json` (or takes a config object), merges CLI flags over it, validates, and loops over the config array (multiple gateways = array of configs). Then per config:
   - `fetchAndProcessJson` — remote URL, branch-specific URL, or local `{dir}/swagger.json`.
   - `normalizeJsonFormat` — **everything is converted to OpenAPI v3 before generation**: Swagger 2 via `swaggerToOpenApi`, Postman collections via `postman-ke-openapi`. Downstream code only ever sees OpenAPI v3.
   - `handleJsonPersistence` — with `keepJson`, writes the spec to `{dir}/swagger.json`; with `tag` args, [src/updateJson.mts](src/updateJson.mts) merges only the tagged paths (plus their transitively-referenced `$ref` components) into the stored spec. This is the "partial update / conflict" feature.
   - `dispatchToGenerator` — `kotlin` → [src/kotlin/](src/kotlin/), everything else → [src/javascript/](src/javascript/).

2. **AST stage** — [src/javascript/generator.mts](src/javascript/generator.mts) walks `paths` and `components`, resolving `$ref`s, applying `includes`/`excludes` regexes against the generated service name, and deduplicating literal strings into `_CONSTANT*` entries. It produces three arrays typed in [src/types.mts](src/types.mts): `ApiAST[]` (one per endpoint), `TypeAST[]`, `ConstantsAST[]`. Kotlin has its own parallel generator at [src/kotlin/generator.mts](src/kotlin/generator.mts).

3. **Render stage** — pure string concatenation, no templating engine:
   - [generateApis.mts](src/javascript/generateApis.mts) → `services.ts`
   - [generateTypes.mts](src/javascript/generateTypes.mts) → `types.ts`
   - [generateHook.mts](src/javascript/generateHook.mts) → `hooks.ts` (react-query; `useQuery`/`useInfiniteQuery` config lists decide which endpoints get which hook)
   - [strings.mts](src/javascript/strings.mts) holds the fixed preamble/helper blocks injected into generated files.
   - [src/javascript/files/](src/javascript/files/) holds whole-file templates (`config.ts`, `httpRequest.ts`, `hooksConfig.ts`).
   - [src/javascript/utils.mts](src/javascript/utils.mts) is the schema→type-string engine (`getTsType`, plus handlers for `oneOf`/`allOf`/`anyOf`/enums/arrays) and the service-name builder driven by the `methodName` template (`{method}{path}{operationId}`).

4. **Write stage** — [src/javascript/index.mts](src/javascript/index.mts) formats every file with the consumer's prettier config (`prettierPath`) and writes it. `config.ts` and `hooksConfig.ts` are **written only if absent** — they are the user's customization surface; all other generated files carry an `AUTO_GENERATED` header and are overwritten. For `language: "javascript"`, the emitted `.ts` files are compiled with `tsc-prog` and the `.ts` originals deleted.

Optional side-generators: mock data ([src/javascript/mock/](src/javascript/mock/), a fork of swagger-to-mock) and SignalR hubs ([src/javascript/signalR/generator.mts](src/javascript/signalR/generator.mts)).

## Tests

Almost all coverage is **snapshot tests over generated output** — changes to any render or type-mapping code will move snapshots, and reviewing that diff is the point.

- `__tests__/e2e/` spawns `bin/index.mjs` as a subprocess with a `{testname}.config.json` and snapshots the resulting files. Some configs (`petstore3`, `slack-api`, `kotlin-wms`) **fetch live remote specs**, so those tests need network access. Outputs go to the git-ignored `__tests__/e2e/outputs/{testname}/`, cleaned before and after each test. See [__tests__/e2e/README.md](__tests__/e2e/README.md).
- `__tests__/main/` calls `generate()` in-process against a checked-in `swagger.json` via [`generator()`](__tests__/main/utils.mjs) — use this style for offline unit-ish coverage (`includes`/`excludes` filtering lives here).
- `__tests__/updateJson/` covers the partial-update merge; `enums.test.mjs` / `discriminator.test.mjs` cover specific schema shapes.

## Config surface

`FileConfig` in [src/types.mts](src/types.mts) is the source of truth for `swagger.config.json`; [schema/v6.json](schema/v6.json) is the published JSON Schema consumers reference via `$schema`, and [readme.md](readme.md) documents each key. **Adding a config option means updating all three.**
