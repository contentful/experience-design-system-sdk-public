const LAMBDA_LOG_PREFIX_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s+[0-9a-f-]+\s+ERROR\s+(?:\[dd\.[^\]]*\]\s*)?/;
const DD_TAG_RE = /\[dd\.(?:trace_id|span_id)=[^\]]*\]\s*/g;

/** Remove Lambda log timestamp + Datadog trace tags from a server-error body. */
export function stripLambdaLogPrefix(body: string): string {
  return body.replace(LAMBDA_LOG_PREFIX_RE, '').replace(DD_TAG_RE, '').trim();
}
