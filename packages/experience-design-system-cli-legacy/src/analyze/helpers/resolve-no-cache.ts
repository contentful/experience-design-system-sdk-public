export function resolveExtractNoCache(opts: { cache?: boolean; noCache?: boolean }): boolean {
  return opts.noCache === true || opts.cache === false;
}
