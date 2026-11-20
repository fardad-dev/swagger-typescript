# swagger-typescript: guide for AI coding assistants

This file is for an AI assistant working in a project that uses `swagger-typescript` (CLI name: `swag-ts`). It explains how to set the tool up, what it generates, and how to write code against the generated files.

`swagger-typescript` reads an OpenAPI v3, Swagger v2 or Postman collection document and generates a typed API client: one function per endpoint, the types those endpoints use, and optionally react-query hooks. The generated client uses axios.

If anything here disagrees with the generated files in the project, trust the generated files. The project may have a different version installed.

## How to work in a project that uses it

1. Read `swagger.config.json` in the project root. Its `dir` value is the folder that holds the generated code.
2. Call the backend through the generated functions in `{dir}/services.ts`, or the hooks in `{dir}/hooks.ts`. Do not hand-write `axios` or `fetch` calls for endpoints that are in the API document, because the generated functions already carry the URL, the types and the project's auth and error handling.
3. Do not edit `services.ts`, `types.ts`, `hooks.ts` or `httpRequest.ts`. They are rewritten on every run, so edits are lost. Change behavior in `config.ts`, or change `swagger.config.json` and regenerate.
4. When the backend API changes, regenerate with `yarn swag-ts` (or `npx swag-ts`) and then fix the call sites TypeScript reports.
5. Do not change `methodName` or `prefix` in an existing project unless the user asks. They rename every generated function and break every call site.

## Setup

```bash
yarn add -D swagger-typescript prettier
yarn add axios qs
# only when reactHooks is true:
yarn add @tanstack/react-query
```

The generated `config.ts` and `services.ts` import `qs`. It is installed as a dependency of `swagger-typescript`, but a strict package manager (pnpm, Yarn PnP) will not resolve it from the app, so add it to the app's own dependencies.

Create `swagger.config.json` in the project root:

```json
{
  "$schema": "https://raw.githubusercontent.com/hosseinmd/swagger-typescript/master/schema/v6.json",
  "url": "https://example.com/api/swagger.json",
  "dir": "./src/services",
  "prefix": "/api",
  "reactHooks": true
}
```

Run it from the project root:

```bash
yarn swag-ts
```

A successful run ends with `All Completed`. Read the output instead of relying on the exit code: a wrong or missing config exits with an error, but a failed download or a failed generation only prints `Generation failed` and still exits with code 0.

After the first run, open `{dir}/config.ts` and set `baseURL` (see [Customizing config.ts](#customizing-configts)).

## swagger.config.json

| Key                   | Type                                       | Default                             | Meaning                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`                 | string, or `{ branch, url }[]`             | required                            | Where the API document is. An `http(s)` URL or a local file path, JSON or YAML. Required even when `local` is true. The array form is described under [One URL per git branch](#one-url-per-git-branch). |
| `dir`                 | string                                     | required                            | Output folder, relative to the folder the command runs in. Created if missing.                                                                                                                           |
| `language`            | `"typescript"`, `"javascript"`, `"kotlin"` | `"typescript"`                      | Output language.                                                                                                                                                                                         |
| `methodName`          | string                                     | `"{method}{path}"`                  | Template for function names. Placeholders: `{method}`, `{path}`, `{operationId}`. An operation with no `operationId` falls back to `{method}{path}`.                                                     |
| `prefix`              | string                                     | none                                | Removed from the start of each path when building names, so `/api/v2/users` with prefix `/api/v2` becomes `getUsers`. It only affects names. The request URL keeps the full path.                        |
| `reactHooks`          | boolean                                    | `false`                             | Also generate `hooks.ts` with react-query hooks.                                                                                                                                                         |
| `useQuery`            | string[]                                   | `[]`                                | Non-GET endpoints that should get a query hook instead of a mutation hook, for example a POST that only reads data.                                                                                      |
| `useInfiniteQuery`    | string[]                                   | `[]`                                | Endpoints that should get an infinite-query hook.                                                                                                                                                        |
| `useSuspenseQuery`    | string[]                                   | `[]`                                | Endpoints whose query hook should suspend. See [Suspense query hooks](#suspense-query-hooks). Needs react-query v5.                                                                                      |
| `includes`            | string[]                                   | `[]`                                | Regex patterns. When set, only endpoints whose function name matches one of them are generated.                                                                                                          |
| `excludes`            | string[]                                   | `[]`                                | Regex patterns. Endpoints whose function name matches one of them are skipped.                                                                                                                           |
| `generateEnumAsType`  | boolean                                    | `false`                             | `false` emits `enum Status { A = "A" }`. `true` emits `type Status = "A" \| "B"`.                                                                                                                        |
| `ignore.headerParams` | string[]                                   | none                                | Header parameter names to leave out of every function signature.                                                                                                                                         |
| `keepJson`            | boolean                                    | `false`                             | Save the API document to `{dir}/swagger.json`. Needed for `local` and for partial updates.                                                                                                               |
| `local`               | boolean                                    | `false`                             | Generate from the saved `{dir}/swagger.json` instead of downloading.                                                                                                                                     |
| `mock`                | boolean                                    | `false`                             | Also write one mock response JSON file per endpoint into `{dir}/mocks/`.                                                                                                                                 |
| `prettierPath`        | string                                     | `.prettierrc`, then `prettier.json` | Prettier config used to format the output. The file must be JSON.                                                                                                                                        |
| `hub`                 | string                                     | none                                | URL of a SignalR hub description. Generates `{dir}/hub.ts`.                                                                                                                                              |
| `kotlinPackage`       | string                                     | required for kotlin                 | Package name written at the top of the Kotlin files.                                                                                                                                                     |

`useQuery`, `useInfiniteQuery` and `useSuspenseQuery` accept either the function name (`postTicketsGetall`) or the hook name (`usePostTicketsGetall`), in any letter case.

`includes` and `excludes` are tested against the generated function name, such as `getPetPetId`, and are case sensitive. With both set, an endpoint is generated when it matches an include and no exclude.

For several backends, make the file an array of config objects, each with its own `dir`. All of them are generated in one run.

## CLI

```bash
yarn swag-ts                          # generate everything
yarn swag-ts --config=./config        # use ./config/swagger.config.json
yarn swag-ts --config=./api/my.json   # use a config file with another name
yarn swag-ts --local                  # generate from the saved {dir}/swagger.json
yarn swag-ts --branch=develop         # pick the url entry for this branch
yarn swag-ts User Order               # update only the endpoints tagged User or Order
```

From Node (the package is ESM only):

```js
import { generate } from "swagger-typescript";

await generate(); // reads ./swagger.config.json
await generate({
  url: "https://example.com/swagger.json",
  dir: "./src/services",
});
```

## Generated files

| File             | Rewritten on every run | Purpose                                                                                                                          |
| ---------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `services.ts`    | yes                    | One function per endpoint.                                                                                                       |
| `types.ts`       | yes                    | Interfaces, enums and query-parameter types.                                                                                     |
| `hooks.ts`       | yes                    | react-query hooks. Only with `reactHooks`.                                                                                       |
| `httpRequest.ts` | yes                    | Thin axios wrapper used by `services.ts`.                                                                                        |
| `config.ts`      | no, created once       | axios instance, base URL, interceptors, `RequestError`, `SwaggerResponse`. Edit this file.                                       |
| `hooksConfig.ts` | no, created once       | Pagination helpers for infinite hooks. Only with `reactHooks`. Edits are kept, even though its header says it is auto generated. |
| `swagger.json`   | yes                    | Saved API document. Only with `keepJson`.                                                                                        |

Other outputs:

- `language: "javascript"` writes `.js` and `.d.ts` files in place of the `.ts` files.
- `language: "kotlin"` writes only `IApis.kt` (a Retrofit interface with `suspend` functions) and `Models.kt`.

`types.ts` holds only the types that a generated endpoint uses, directly or through other types. A schema that no generated endpoint reaches is left out.

## Finding the function for an endpoint

With the default `methodName`, the name is the HTTP method in lower case followed by the path in PascalCase. The characters `/ . - { } [ ] *` and the backtick are removed and the next letter is capitalized. Underscores are kept.

| Endpoint                | Function             | Hook                    | Query params type               |
| ----------------------- | -------------------- | ----------------------- | ------------------------------- |
| `GET /pet/{petId}`      | `getPetPetId`        | `useGetPetPetId`        | none                            |
| `GET /pet/findByStatus` | `getPetFindByStatus` | `useGetPetFindByStatus` | `GetPetFindByStatusQueryParams` |
| `POST /pet`             | `postPet`            | `usePostPet`            | none                            |
| `PUT /user/{username}`  | `putUserUsername`    | `usePutUserUsername`    | none                            |

The fastest way to find a function is to search `services.ts` for the path. Every function has a `key` property holding its path:

```ts
getPetPetId.key = "/pet/{petId}";
```

## Calling a service function

Arguments are positional and always in this order. A part is present only when the endpoint has it:

1. path parameters, one argument each
2. `requestBody`
3. `queryParams`, one object
4. `headerParams`, one object
5. `configOverride`, an optional `AxiosRequestConfig` that every function accepts last

```ts
import {
  getPetPetId,
  getPetFindByStatus,
  putUserUsername,
} from "./services/services";
import type { Pet } from "./services/types";

const pet: Pet = await getPetPetId(10);
const pets = await getPetFindByStatus({ status: "available" });
await putUserUsername("john", { firstName: "John" });

// configOverride is merged over the request config for this one call
const slow = await getPetPetId(10, {
  timeout: 60_000,
  headers: { "x-trace": "1" },
});
```

Things to know:

- **The awaited value is the response body, not an axios response.** By default `config.ts` returns `response.data` from its response interceptor and declares `SwaggerResponse<R> = R`. So write `const pet = await getPetPetId(10)`, not `const { data } = await ...`. A project can change this in `config.ts`, so check how `SwaggerResponse` is declared there.
- The return type comes from the `200` response in the API document. An endpoint that documents only `201` or `204`, or a `200` with no schema, returns `SwaggerResponse<any>`. The fix belongs in the API document, not in the generated file.
- Because arguments are positional, pass `undefined` to skip an optional one: `getUserLogin(undefined, { timeout: 1000 })`.
- `configOverride.headers` are merged with the endpoint's headers. `configOverride.params` are merged with `queryParams`, and `queryParams` win on the same key.
- For `multipart/form-data` endpoints, pass a plain object or a `FormData` as `requestBody`. A plain object is converted to `FormData`, and its empty values (`undefined`, `null`, `""`, `0`, `false`) are skipped. For `application/x-www-form-urlencoded`, pass a plain object.
- To cancel a request, pass an `AbortSignal`: `getPetPetId(10, { signal: controller.signal })`.
- Deprecated endpoints are marked `@deprecated` and log a warning outside production.

### Errors

A failed request rejects with `RequestError` from `config.ts`:

```ts
import { RequestError } from "./services/config";

try {
  await postPet(newPet);
} catch (error) {
  if (RequestError.isRequestError(error)) {
    error.status; // HTTP status, undefined when there was no response
    error.message; // the response body sent by the server
    error.response; // the full axios response
  }
}
```

When the server sends no response at all, `message` is the string `"noInternetConnection"`.

## React hooks

Set `"reactHooks": true`. The generated hooks use `@tanstack/react-query` (4.8 or newer; the examples below use v5 names such as `isPending`) and need a `QueryClientProvider` above them, as with any react-query code.

Which hook an endpoint gets:

- `GET` endpoints, and endpoints listed in `useQuery`, get a query hook.
- Endpoints listed in `useInfiniteQuery` get an infinite-query hook.
- Endpoints listed in `useSuspenseQuery` get the suspense version of their query hook. This needs react-query v5.
- Everything else gets a mutation hook.

### Query hooks

The arguments are the same as the service function, then `options` (react-query options without `queryKey`), then `configOverride`.

```tsx
import { useGetPetPetId, useGetPetFindByStatus } from "./services/hooks";

const {
  data: pet,
  isLoading,
  error,
} = useGetPetPetId(petId, { enabled: petId != null });
const { data: pets } = useGetPetFindByStatus(
  { status: "available" },
  { staleTime: 60_000 },
);
```

`data` has the same shape as the awaited service function.

### Mutation hooks

The hook takes only react-query mutation options. The request arguments go to `mutate` as one object, using the same names as the service function: the path parameter names, `requestBody`, `queryParams`, `headerParams`, plus optional `configOverride`.

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { usePostPet, usePutUserUsername } from "./services/hooks";
import { getPetFindByStatus } from "./services/services";

const queryClient = useQueryClient();

const { mutate: addPet, isPending } = usePostPet({
  onSuccess: () =>
    queryClient.invalidateQueries({ queryKey: [getPetFindByStatus.key] }),
});
addPet({ requestBody: newPet });

const { mutateAsync: updateUser } = usePutUserUsername();
await updateUser({ username: "john", requestBody: { firstName: "John" } });
```

An endpoint with no arguments is called as `mutate()`.

To carry extra data to `onSuccess` or `onError`, type it with the hook's generic and pass it as `_extraVariables`:

```ts
const { mutate } = usePostPet<{ closeDialog: boolean }>({
  onSuccess: (_data, variables) =>
    variables._extraVariables?.closeDialog && close(),
});
mutate({ requestBody: newPet, _extraVariables: { closeDialog: true } });
```

### Query keys, invalidation, prefetch

A query hook builds its key from the endpoint path and the arguments, in this order:

```
[service.key, ...pathParams, requestBody, queryParams, headerParams, ...extraQueryKey]
```

Only the parts the endpoint has are included. For example `useGetPetPetId(10)` uses `["/pet/{petId}", 10]`.

```ts
// every cached query of one endpoint
queryClient.invalidateQueries({ queryKey: [getPetPetId.key] });

// one exact query: every query hook has .info(), which returns { key, fun }
const { key } = useGetPetPetId.info(10);
queryClient.setQueryData(key, updatedPet);

// prefetch, skipped when the data is already cached
await useGetPetPetId.prefetch(queryClient, 10);
```

`extraQueryKey` appends your own values to the end of the key, for example a tenant id:

```ts
useGetPetFindByStatus(queryParams, { extraQueryKey: ["tenant-1"] });
useGetPetFindByStatus.info(queryParams, undefined, ["tenant-1"]);
```

### Infinite query hooks

Add the endpoint to `useInfiniteQuery` in the config and regenerate. The hook returns the react-query infinite result plus three extra fields:

```tsx
// swagger.config.json: "useInfiniteQuery": ["useGetUsers"]
const { list, total, hasMore, fetchNextPage, isFetchingNextPage } = useGetUsers(
  { pageSize: 20 },
);
```

- `list` is all loaded pages flattened into one array.
- `total` is the total count reported by the last page.
- `hasMore` tells whether another page exists.

How it works, and what to check when it does not fit the API:

- The page number is sent in the endpoint's query parameter named `page`, `pageNo`, `pageNumber` or `offset` (any letter case). Pages count 1, 2, 3 and so on. Pass `initialPageParam` and `getNextPageParam` in the hook options to change that.
- Do not put the page parameter in `queryParams`. A value there overrides the hook's page number, so every page would load the same data.
- `list`, `total` and `hasMore` are computed by the helpers in `hooksConfig.ts`. By default they read the items from `page.data`, `page.data.data` or `page.data.list`, and the total from `page.data.total`. When no total exists, `hasMore` compares the last page length with the `pageSize` query parameter (10 when absent). If the API uses other field names, such as `results` and `count`, edit `hooksConfig.ts` to match.

### Suspense query hooks

Add the endpoint to `useSuspenseQuery` in the config and regenerate. The hook keeps its name and arguments, but calls `useSuspenseQuery` instead of `useQuery`:

```tsx
// swagger.config.json: "useSuspenseQuery": ["useGetPetPetId"]
const { data: pet } = useGetPetPetId(petId); // data is never undefined
```

- The component suspends while loading and throws on error, so render it under a `<Suspense>` and an error boundary.
- The options are react-query's suspense options: `enabled`, `placeholderData` and `throwOnError` are not accepted.
- `.info()`, `.prefetch()` and `extraQueryKey` work as for any query hook.
- A non-GET endpoint listed here gets a query hook, as if it were also in `useQuery`.
- An endpoint listed in both `useSuspenseQuery` and `useInfiniteQuery` calls `useSuspenseInfiniteQuery` and returns the same extra fields as an infinite hook.
- The list replaces the hook. To use one endpoint both with and without suspense, leave it out of the list and call react-query's `useSuspenseQuery` with the `key` and `fun` from `.info()`.

## Customizing config.ts

`config.ts` is created on the first run and never overwritten. All project-specific HTTP behavior goes here.

- **Base URL and static headers:** the `baseConfig` object. On the first run `baseURL` is filled from `servers[0].url` of the API document when present.
- **Auth and dynamic headers:** the request interceptor inside `getAxiosInstance(security)`. `security` is the `security` array declared on that operation in the API document, or `undefined` when the operation declares none. Security declared only at the top level of the document is not passed, so in that case add the header without the `security` check.

  ```ts
  axiosInstance.interceptors.request.use(async (requestConfig) => {
    if (security?.[0]) {
      requestConfig.headers.authorization = `Bearer ${getToken()}`;
    }
    return requestConfig;
  });
  ```

- **Response shape:** to get the whole axios response instead of the body, return `response` from the response interceptor and change the type to `export interface SwaggerResponse<R> extends AxiosResponse<R> {}`. All functions and hooks follow that type.
- **Error shape:** the response error interceptor builds `RequestError`. Change it there to map server errors differently.

## Updating when the API changes

Run `yarn swag-ts` again. It downloads the document and rewrites the generated files.

### Updating only some tags

When several backend branches are in flight, a full update can pull in unrelated changes. With `"keepJson": true`:

1. Run `yarn swag-ts` once and commit `{dir}/swagger.json`.
2. Later run `yarn swag-ts User Order`. Only the endpoints tagged `User` or `Order`, and the types they use, are refreshed in `swagger.json`. Everything else stays as saved, and the code is regenerated from the merged file.

Tags are ignored when `keepJson` is off.

### One URL per git branch

```json
{
  "url": [
    { "branch": "master", "url": "https://example.com/api/swagger.json" },
    { "branch": "develop", "url": "https://stage.example.com/api/swagger.json" }
  ],
  "dir": "./src/services"
}
```

The entry is chosen by `--branch`, otherwise by the current git branch or the closest listed branch in its history. The first entry is the fallback.

## Troubleshooting

| Symptom                                    | Cause and fix                                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Please define swagger.config.json`        | No config in the folder the command runs in. Run from the project root or pass `--config`.                                                          |
| `swagger.json file not found`              | `--local` or a tag update needs a saved document. Set `keepJson: true` and run once without tags.                                                   |
| Output ends with `Generation failed`       | Usually the URL is unreachable or the document is not OpenAPI v3, Swagger v2 or a Postman collection. The message printed before it has the reason. |
| A function returns `any`                   | The endpoint has no schema under its `200` response in the API document.                                                                            |
| A function is missing                      | Check `includes` and `excludes`, then regenerate. Search `services.ts` for the path to confirm.                                                     |
| A type is missing from `types.ts`          | No generated endpoint uses it, so it was left out.                                                                                                  |
| A read-only POST got a mutation hook       | Add its name to `useQuery` and regenerate.                                                                                                          |
| Names are long or contain a version prefix | Set `prefix`, or use `methodName` with `{operationId}`. Both rename existing functions.                                                             |
| Formatting fails or looks wrong            | Point `prettierPath` at a JSON prettier config.                                                                                                     |
| `Cannot find module 'qs'`                  | Add `qs` to the app's dependencies.                                                                                                                 |
| `list` is empty in an infinite hook        | The API's page shape differs from the defaults. Edit the helpers in `hooksConfig.ts`.                                                               |
| `useSuspenseQuery` is not exported         | Suspense hooks need `@tanstack/react-query` v5. Upgrade it, or remove the endpoint from `useSuspenseQuery`.                                         |
