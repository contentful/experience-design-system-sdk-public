import { randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import { readPackageVersion } from '../tui/upgrade/version.js';
import type {
  SelectionAssembly,
  SelectionDetermination,
  SelectionPipelineResult,
  SelectionReviewItem,
} from '@contentful/experience-design-system-agents';

const DEFAULT_COMMAND = 'experiences-v2 importv2';

export interface SelectionRunArchiveOptions {
  root?: string;
  command?: string;
  cliVersion?: string;
  projectPath?: string;
}

interface SelectionRunArchiveMetadata {
  runId: string;
  command: string;
  cliVersion: string;
  projectPath: string;
  timestamp: string;
  startedAt: string;
  completedAt: string;
  status: 'completed';
  executedStages: string[];
  componentCount: number;
  agentCount: number;
  disagreementCount: number;
  factualDisagreementCount: number;
  interpretiveDisagreementCount: number;
  escalationCount: number;
  factualResolutionCount: number;
  debateCount: number;
  determinationCount: number;
  unresolvedCount: number;
}

export interface SelectionRunArchiveInput extends SelectionRunArchiveOptions {
  components: RawComponentDefinition[];
  agentCount: number;
  pipeline: SelectionPipelineResult;
  determinations: SelectionDetermination[];
  assembly: SelectionAssembly;
  review: SelectionReviewItem[];
  startedAt: Date;
  completedAt: Date;
}

export interface SelectionRunArchiveResult {
  runId: string;
  runDirectory: string;
  metadata: SelectionRunArchiveMetadata;
}

function defaultRunsRoot(): string {
  return join(homedir(), '.contentful', 'runs');
}

function createRunId(now: Date, projectPath: string): string {
  const timestamp = now.toISOString().replace(/[-:.]/g, '');
  const projectName = safeFileName(basename(resolve(projectPath))) || 'project';
  return `${projectName}-${timestamp}-${randomUUID().slice(0, 8)}`;
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function createRunDirectory(
  root: string,
  startedAt: Date,
  projectPath: string,
): Promise<{ runId: string; runDirectory: string }> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);

  while (true) {
    const runId = createRunId(startedAt, projectPath);
    const runDirectory = join(root, runId);
    try {
      await mkdir(runDirectory, { mode: 0o700 });
      return { runId, runDirectory };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function writeStageDirectory(directory: string, entries: Array<{ name: string; value: unknown }>): Promise<void> {
  await mkdir(directory, { mode: 0o700 });
  await chmod(directory, 0o700);
  await Promise.all(entries.map(({ name, value }) => writeJson(join(directory, `${safeFileName(name)}.json`), value)));
}

function buildExecutedStages(pipeline: SelectionPipelineResult): string[] {
  const stages = ['stage1-broadcast', 'stage2-diff', 'stage3-tier'];
  if (pipeline.factualResolutions.length > 0) stages.push('stage4a-factual-verification');
  if (pipeline.debateTranscripts.length > 0) stages.push('stage4b-debate');
  stages.push('stage5-determination', 'final-selection');
  return stages;
}

function buildMetadata(input: SelectionRunArchiveInput, runId: string): SelectionRunArchiveMetadata {
  const factualDisagreementCount = input.pipeline.tieredDisagreements.filter(({ tier }) => tier === 'factual').length;
  const interpretiveDisagreementCount = input.pipeline.tieredDisagreements.filter(
    ({ tier }) => tier === 'interpretive',
  ).length;

  return {
    runId,
    command: input.command ?? DEFAULT_COMMAND,
    cliVersion: input.cliVersion ?? readPackageVersion(),
    projectPath: input.projectPath ?? process.cwd(),
    timestamp: input.startedAt.toISOString(),
    startedAt: input.startedAt.toISOString(),
    completedAt: input.completedAt.toISOString(),
    status: 'completed',
    executedStages: buildExecutedStages(input.pipeline),
    componentCount: input.components.length,
    agentCount: input.agentCount,
    disagreementCount: input.pipeline.diff.disagreements.length,
    factualDisagreementCount,
    interpretiveDisagreementCount,
    escalationCount: input.pipeline.tieredDisagreements.length,
    factualResolutionCount: input.pipeline.factualResolutions.length,
    debateCount: input.pipeline.debateTranscripts.length,
    determinationCount: input.determinations.length,
    unresolvedCount: input.assembly.report.unresolvedCount,
  };
}

export async function archiveSelectionRun(input: SelectionRunArchiveInput): Promise<SelectionRunArchiveResult> {
  const projectPath = input.projectPath ?? process.cwd();
  const { runId, runDirectory } = await createRunDirectory(
    input.root ?? defaultRunsRoot(),
    input.startedAt,
    projectPath,
  );
  const { pipeline } = input;

  await writeStageDirectory(
    join(runDirectory, 'stage1-broadcast'),
    pipeline.broadcast.map((results, agentIndex) => ({
      name: `agent-${agentIndex + 1}`,
      value: { agentIndex, results },
    })),
  );
  await writeJson(join(runDirectory, 'stage2-diff.json'), pipeline.diff);
  await writeJson(join(runDirectory, 'stage3-tier.json'), pipeline.tieredDisagreements);

  if (pipeline.factualResolutions.length > 0) {
    await writeStageDirectory(
      join(runDirectory, 'stage4a-factual-verification'),
      pipeline.factualResolutions.map((resolution) => ({ name: resolution.disagreementId, value: resolution })),
    );
  }
  if (pipeline.debateTranscripts.length > 0) {
    await writeStageDirectory(
      join(runDirectory, 'stage4b-debate'),
      pipeline.debateTranscripts.map((transcript) => ({ name: transcript.disagreementId, value: transcript })),
    );
  }

  await writeJson(join(runDirectory, 'stage5-determination.json'), input.determinations);
  await writeJson(join(runDirectory, 'final-selection.json'), { assembly: input.assembly, review: input.review });

  const metadata = buildMetadata({ ...input, projectPath }, runId);
  await writeJson(join(runDirectory, 'metadata.json'), metadata);
  return { runId, runDirectory, metadata };
}
