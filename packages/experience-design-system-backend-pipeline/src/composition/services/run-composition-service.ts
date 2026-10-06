import { runAgent } from '@contentful/experience-design-system-generation';
import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import { resolveMapping } from '../helpers/resolve-mapping.js';
import { selectCandidateFiles, capCandidatesToPromptBudget } from '../helpers/candidate-files.js';
import { buildCompositionInputHash } from '../helpers/composition-cache-key.js';
import { collectManifestDocEdges } from '../helpers/manifest-doc-evidence.js';
import type { ResolveCompositionServiceOptions, ResolveCompositionServiceResult } from '../types/contract.js';

export async function runCompositionService(
  options: ResolveCompositionServiceOptions,
): Promise<ResolveCompositionServiceResult> {
  const { components, allFiles, forceAgent, agent } = options;

  const selectedCandidates = selectCandidateFiles(allFiles);
  const capped = capCandidatesToPromptBudget(selectedCandidates);
  const promptFiles = capped.kept;

  if (capped.dropped.length > 0) {
    options.onWarning?.(
      `composition — ${capped.dropped.length} candidate file(s) omitted from the agent prompt to fit the context budget; resolution runs on the ${promptFiles.length} highest-value files.`,
    );
  }

  const componentNameSet = new Set(components.map((c) => c.name));
  const runtimeFiles = allFiles.map((c) => ({ path: c.path, content: c.content }));
  const manifestDocEdges = collectManifestDocEdges(runtimeFiles, components, componentNameSet);
  const agentCacheKey = buildCompositionInputHash({ files: promptFiles, agent });

  let lastAgentExitCode = 0;
  const spawnAgent = async (prompt: string): Promise<string> => {
    const res = await runAgent({ agent, prompt, timeoutMs: 120_000, promptViaStdin: true });
    lastAgentExitCode = res.exitCode;
    if (res.exitCode !== 0 && res.stderr.trim()) {
      options.onWarning?.(`composition — agent exited ${res.exitCode}: ${res.stderr.trim()}`);
    }
    return res.stdout;
  };

  options.onProgress?.('resolving');
  const result = await resolveMapping({
    components,
    ...(manifestDocEdges.length > 0 ? { extraEdges: manifestDocEdges } : {}),
    forceAgent,
    files: promptFiles,
    ...(options.promptOverride ? { promptOverride: options.promptOverride } : {}),
    runAgentFn: async ({ prompt }) => {
      if (!forceAgent && options.onCacheLookup) {
        const cached = options.onCacheLookup(agentCacheKey);
        if (cached !== null) { options.onProgress?.('cache-hit'); return cached; }
      }
      options.onProgress?.(`agent:${agent}`);
      const stdout = await spawnAgent(prompt);
      if (lastAgentExitCode === 0) options.onCacheStore?.(agentCacheKey, stdout);
      return stdout;
    },
  });
  options.onProgress?.('done');

  for (const w of result.warnings) options.onWarning?.(`composition — ${w}`);
  for (const c of result.conflicts) {
    options.onWarning?.(`composition conflict on ${c.parent}→${c.child}: kept ${c.winner}, dropped ${c.loser}`);
  }

  return { components: result.components as RawComponentDefinition[], warnings: result.warnings };
}
