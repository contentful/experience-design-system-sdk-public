# Step 5 — Apply

Ships the resolved CDF document to Contentful: preview, apply, poll.

## What it does

1. Builds the CDF document from components and tokens (`buildCDF`).
2. Calls `POST /spaces/{s}/environments/{e}/design_systems/imports/preview` and inspects the response:
   - Empty preview → returns `no-changes`.
   - `previewOnly === true` → returns `preview` (with `hasBreakingChanges` flag).
3. Otherwise calls `POST …/design_systems/imports/apply` with `acknowledgeBreakingChanges` as supplied; receives an operation ID.
4. Polls `GET …/design_systems/imports/apply/{operationId}` until the operation is `succeeded`, `partial` or `failed`. The wait between polls grows from 2s to 5s, with jitter, and it gives up with a timeout error after 150 polls.
5. Parses the final operation into per-entity write counts and returns `applied`.

5xx responses and network errors on preview and poll are retried (3 attempts, exponential backoff, `Retry-After` respected). Apply requests are not retried once dispatched, because retrying could start a duplicate operation.

## Input

`ApplyEndpointRequest`

| Field                       | Type                                                      | Notes                                                        |
|-----------------------------|-----------------------------------------------------------|--------------------------------------------------------------|
| `components`                | `Array<{ key: string; entry: CDFComponentEntry }>`        | From Step 4, keyed for `buildCDF`                            |
| `tokens`                    | `DTCGTokenEntry[]?`                                       | Flat form; converted via `toCdfTokens`                       |
| `credentials`               | `{ accessToken, spaceId, environmentId, host? }`          | All three IDs required; controller throws on missing fields  |
| `previewOnly`               | `boolean?`                                                | Skips the apply + poll phases                                |
| `acknowledgeBreakingChanges`| `boolean?`                                                | Must be true to apply a plan with breaking changes           |
| `onProgress`                | `(status, operationId?) => void`                          | `'previewing' \| 'applying' \| 'polling'`                     |

## Output

`ApplyEndpointResponse` — tagged union on `type`:

| Variant          | Carries                                                                                        |
|------------------|------------------------------------------------------------------------------------------------|
| `'no-changes'`   | `xContentfulRequestId?`                                                                        |
| `'preview'`      | `preview`, `hasBreakingChanges`, `xContentfulRequestId?`                                       |
| `'applied'`      | `operation`, `operationId`, `componentWriteResult`, `designTokenWriteResult?`, `spaceId`, `environmentId`, `host`, `xContentfulRequestId?` |

## Cache

**None.** Apply is a side-effectful network operation; results are not cacheable.

## External calls

Contentful Management API via `ApiClient` (internal):

| Endpoint                                                              | When                                              |
|-----------------------------------------------------------------------|---------------------------------------------------|
| `GET /users/me`                                                       | Token validation (`validateToken`, not in `applyComponents`) |
| `GET /spaces/{s}/environments/{e}/design_systems/preflight`           | Right after the token check                       |
| `POST /spaces/{s}/environments/{e}/design_systems/imports/preview`    | Always                                            |
| `POST /spaces/{s}/environments/{e}/design_systems/imports/apply`      | Non-preview only                                  |
| `GET  /spaces/{s}/environments/{e}/design_systems/imports/apply/{op}` | Poll until terminal                               |

The caller's user agent (or this package's own) is sent as `X-Contentful-User-Agent`. `X-Contentful-Request-Id` from each response is captured on `client.getLastRequestId()`.

## DSI contribution

This is the only step that produces fields the CLI's terminal analytics event cannot derive itself:

| Pipeline result field       | CLI analytics prop                       | Used for                              |
|-----------------------------|------------------------------------------|---------------------------------------|
| `xContentfulRequestId`      | `x_contentful_request_id` on context     | Support tracing from Contentful side  |
| `operationId`               | `dsi_operation_id` on completion         | Correlation with Import service logs  |
| `componentWriteResult`      | `component_type_result` on completion    | Per-run created/updated/failed counts |
| `designTokenWriteResult`    | `design_token_result` on completion      | Per-run created/updated/failed counts |

The TUI does not call `applyComponents` (it is exported for other callers). The import's preview and push screens use `ImportApiClient` directly (`packages/experience-design-system-cli/src/tui/import/steps/10-flow/flow/preview.ts` and `push.ts`) and record the outcome themselves with `recordContentfulContext` (preview) and `recordApplyOutcome` (push) from `src/analytics/apply.ts`. These attach the fields above to the active analytics command before `dsi_cli_command_completed` fires. A preview attaches only the request id and the space and environment.
