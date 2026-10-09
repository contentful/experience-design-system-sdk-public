const FENCE_LANG_BY_EXT: Record<string, string> = {
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  ts: 'ts',
  mts: 'ts',
  cts: 'ts',
  tsx: 'tsx',
  jsx: 'jsx',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  scss: 'scss',
  sass: 'scss',
  css: 'css',
  json: 'json',
  json5: 'json',
  html: 'html',
};

export function inferFenceLang(filename: string | undefined): string {
  if (!filename) return 'json';
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return FENCE_LANG_BY_EXT[ext] ?? 'text';
}
