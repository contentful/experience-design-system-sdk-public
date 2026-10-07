# Step 5 — Apply

Ships the resolved CDF document to Contentful: preview, apply, poll.

## What it does

1. Builds the CDF document from components and tokens (`buildCDF`).
2. Calls `POST /imports/preview` and inspects the response:
   - Empty preview → returns `no-changes`.
   - `previewOnly === true` → returns `preview` (with `hasBreakingChanges` flag).
3. Otherwise calls `POST /imports` with `acknowledgeBreakingChanges` as supplied; receives an operation ID.
4. Polls `GET /imports/operations/{operationId}` until terminal (succeeded/failed), with exponential backoff and `Retry-After` honoring.
5. Parses the final operation into per-entity write counts and returns `applied`.

Transient 5xx and 429 responses on preview/poll are retried; apply requests are not retried once dispatched (idempotency unknown).

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

| Endpoint                                         | When                 |
|--------------------------------------------------|----------------------|
| `GET /` (preflight)                              | Token validation     |
| `POST /spaces/{s}/environments/{e}/imports/preview` | Always               |
| `POST /spaces/{s}/environments/{e}/imports`      | Non-preview only     |
| `GET  /spaces/{s}/environments/{e}/imports/operations/{op}` | Poll until terminal  |

User-Agent is set; `X-Contentful-Request-Id` from each response is captured on `client.getLastRequestId()`.

## DSI contribution

This is the only step that produces fields the CLI's terminal analytics event cannot derive itself:

| Pipeline result field       | CLI analytics prop                       | Used for                              |
|-----------------------------|------------------------------------------|---------------------------------------|
| `xContentfulRequestId`      | `x_contentful_request_id` on context     | Support tracing from Contentful side  |
| `operationId`               | `dsi_operation_id` on completion         | Correlation with Import service logs  |
| `componentWriteResult`      | `component_type_result` on completion    | Per-run created/updated/failed counts |
| `designTokenWriteResult`    | `design_token_result` on completion      | Per-run created/updated/failed counts |

The CLI reads these off the result struct and passes them to `setCommandContext` / `enrichCommandResult` before `completeActiveCommand` fires `dsi_cli_command_completed`. On preview-only and no-changes variants, only `xContentfulRequestId` is attached.
