import type {
  VerifiedItem,
  VerifyComponentWork,
  VerifyEvidence,
  ExplorationSourceInput,
} from '@contentful/experience-design-system-types';
import { checkBoundEvidence } from './check-evidence.js';
export interface CheckEvidence extends VerifyEvidence {
  context: string;
}
export interface CheckEntry {
  checkId: string;
  itemId: string;
  claim: { paths: string[]; fields: string[]; values: unknown };
  hypothesis?: string;
  evidence: CheckEvidence[];
  verifierReason: string;
}
export interface CheckWork {
  component: string;
  source: string;
  entries: CheckEntry[];
}
export function contextAround(fileText: string, quote: string): string {
  const offset = fileText.indexOf(quote);
  if (offset < 0) return '';
  const lines = fileText.split('\n'),
    index = fileText.slice(0, offset).split('\n').length - 1;
  return lines.slice(Math.max(0, index - 6), index + quote.split('\n').length + 6).join('\n');
}
export function buildCheckWork(
  components: VerifyComponentWork[],
  verified: VerifiedItem[],
  sourceInput?: ExplorationSourceInput,
): CheckWork[] {
  const result: CheckWork[] = [];
  for (const component of components) {
    const entries: CheckEntry[] = [];
    for (const item of verified.filter(
      (item) =>
        item.component === component.component && item.source === component.source && item.outcome !== 'conflicting',
    )) {
      const work = component.items.find((work) => work.itemId === item.itemId);
      if (!work || !checkBoundEvidence(item.evidence, component, sourceInput)) continue;
      entries.push({
        checkId: `check-${item.itemId}`,
        itemId: item.itemId,
        claim: {
          paths: work.claims.map((claim) => claim.path),
          fields: work.claims.map((claim) => claim.field),
          values: item.resolved,
        },
        hypothesis: work.hypothesis,
        verifierReason: item.reason,
        evidence: item.evidence.map((evidence) => {
          const file = sourceInput?.files.find((file) => file.path === evidence.source);
          const context =
            file?.ranges.find(
              (range) =>
                Number(evidence.line.split(/[-–:]/)[0]) >= range.startLine &&
                Number(evidence.line.split(/[-–:]/)[0]) <= range.endLine,
            )?.text ??
            (component.sourceRef?.sourcePath === evidence.source
              ? component.sourceRef.content
              : component.sourceRef?.siblingFiles?.find((file) => file.path === evidence.source)?.content) ??
            '';
          return { ...evidence, context: contextAround(context, evidence.quote) };
        }),
      });
    }
    if (entries.length) result.push({ component: component.component, source: component.source, entries });
  }
  return result;
}
