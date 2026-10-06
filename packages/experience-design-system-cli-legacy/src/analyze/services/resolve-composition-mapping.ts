import { runAgent } from '@contentful/experience-design-system-generation';
import type { AgentName } from '@contentful/experience-design-system-generation';
import type { RawComponentDefinition } from '../../types.js';
import { lookupCompositionCache, storeCompositionCache } from '../../session/db.js';
import type { openPipelineDb } from '../../session/db.js';
import { resolveMapping } from '../composition/resolve-mapping.js';
import { selectCandidateFiles, capCandidatesToPromptBudget } from '../composition/candidate-files.js';
import { buildCompositionInputHash } from '../composition/composition-cache-key.js';
import { collectManifestDocEdges } from '../composition/manifest-doc-evidence.js';
import { getDebugLogger } from '../../lib/debug-logger.js';

export interface CompositionMappingOptions {
  db: ReturnType<typeof openPipelineDb>;
  components: RawComponentDefinition[];
  allFiles: Array<{ path: string; content: string }>;
  noCache: boolean;
  forceAgent: boolean;
  agent: AgentName;
  promptOverride?: string;
  cacheVersion: string;
  onProgress?: (phase: string) => void;
}

export interface CompositionMappingResult {
  components: RawComponentDefinition[];
  warnings: string[];
}

export async function resolveCompositionMapping(options: CompositionMappingOptions): Promise<CompositionMappingResult> {
  const { db, components, allFiles, noCache, forceAgent, agent, cacheVersion } = options;

  const selectedCandidates = selectCandidateFiles(allFiles);
  const capped = capCandidatesToPromptBudget(selectedCandidates);
  const promptFiles = capped.kept;

  if (capped.dropped.length > 0) {
    process.stderr.write(
      `Warning: composition — ${capped.dropped.length} candidate file(s) omitted from the agent prompt to fit the context budget; resolution runs on the ${promptFiles.length} highest-value files.\n`,
    );
  }

  const componentNameSet = new Set(components.map((c) => c.name));
  const runtimeFiles = allFiles.map((c) => ({ path: c.path, content: c.content }));
  const manifestDocEdges = collectManifestDocEdges(runtimeFiles, components, componentNameSet);
  const agentCacheKey = buildCompositionInputHash({ files: promptFiles, agent });

  let lastAgentExitCode = 0;
  const spawnAgent = async (prompt: string): Promise<string> => {
    const res = await runAgent({
      agent,
      prompt,
      timeoutMs: 120_000,
      promptViaStdin: true,
      onDebugEvent: (name, payload) => getDebugLogger().event('agent', name, payload),
    });
    lastAgentExitCode = res.exitCode;
    if (res.exitCode !== 0 && res.stderr.trim()) {
      process.stderr.write(`Warning: composition — agent exited ${res.exitCode}: ${res.stderr.trim()}\n`);
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
      if (!noCache && !forceAgent) {
        const cached = lookupCompositionCache(db, agentCacheKey, cacheVersion);
        if (cached !== null) {
          options.onProgress?.('cache-hit');
          return cached;
        }
      }
      options.onProgress?.(`agent:${agent}`);
      const stdout = await spawnAgent(prompt);
      if (lastAgentExitCode === 0) {
        storeCompositionCache(db, agentCacheKey, cacheVersion, stdout);
      }
      return stdout;
    },
  });
  options.onProgress?.('done');

  for (const w of result.warnings) process.stderr.write(`Warning: composition — ${w}\n`);
  for (const c of result.conflicts) {
    process.stderr.write(
      `Warning: composition conflict on ${c.parent}→${c.child}: kept ${c.winner}, dropped ${c.loser}\n`,
    );
  }

  return { components: result.components as RawComponentDefinition[], warnings: result.warnings };
}
