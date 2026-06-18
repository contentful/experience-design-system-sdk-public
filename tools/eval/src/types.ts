import type { RawComponentDefinition } from '@contentful/experience-design-system-cli/src/types.js';
import type {
  CDFFile,
  CDFComponentEntry,
  CDFPropertyDefinition,
} from '@contentful/experience-design-system-types/src/cdf/types.js';
import type { CDFPropertyCategory, CDFPropertyType } from '@contentful/experience-design-system-types/src/cdf/vocabularies.js';

export type { RawComponentDefinition, CDFFile, CDFPropertyCategory, CDFPropertyType, CDFComponentEntry, CDFPropertyDefinition };

export type HumanVerdict = 'accurate' | 'partial' | 'missed' | 'incorrect';

export type CorpusComponent = {
  name: string;
  verdict: HumanVerdict;
  expectedProps?: Record<string, { category: CDFPropertyCategory; type: CDFPropertyType }>;
};

export type CorpusEntry = {
  repo: string;
  rawComponents: RawComponentDefinition[];
  expectedComponents: CorpusComponent[];
};

export type ComponentCoverageResult = {
  expected: number;
  found: number;
  missed: string[];
  ratio: number;
};

export type HallucinationResult = {
  pass: boolean;
  violations: Array<{ component: string; prop: string; invalidType: string }>;
};

export type DevPropLeakageResult = {
  /** Number of props in the output CDF that match a known DOM/a11y/data-* pass-through name. */
  leaked: number;
  /** Total props in the output CDF (denominator for leakage rate). */
  totalProps: number;
  /** The leaked prop names per component (capped to 10 per component for report size). */
  leakedByComponent: Record<string, string[]>;
};

export type JudgeScore = {
  score: 1 | 2 | 3 | 4 | 5;
  reason: string;
};

export type JudgeResult = {
  mapping_quality: JudgeScore;
};

export type BaselineEntry = {
  repo: string;
  componentCoverageRatio: number;
  hallucinationPass: boolean;
  mappingQualityScore?: number;
};

export type BaselineComparison = {
  coverageDelta: number;
  mappingDelta: number | null;
  regressions: string[];
};

export type EvalResult = {
  repo: string;
  cdf: CDFFile | null;
  error?: { stage: 'stage1' | 'stage2' | 'score' | 'judge'; message: string };
  componentCoverage: ComponentCoverageResult | null;
  hallucination: HallucinationResult | null;
  devPropLeakage?: DevPropLeakageResult;
  judgeScore?: JudgeResult;
  baselineComparison?: BaselineComparison;
};

export type FrameworkStats = {
  count: number;
  avgCoverage: number;
  medianCoverage: number;
  avgMappingQuality: number | null;
};

export type RunSummary = {
  runAt: string;
  totalEntries: number;
  errorCount: number;
  avgComponentCoverage: number;
  medianComponentCoverage: number;
  hallucinationFailures: number;
  devPropLeakageTotal: number;
  totalPropsOutput: number;
  avgMappingQuality: number | null;
  frameworkBreakdown: Record<string, FrameworkStats>;
  baselineLoaded: boolean;
  regressions: number;
};
