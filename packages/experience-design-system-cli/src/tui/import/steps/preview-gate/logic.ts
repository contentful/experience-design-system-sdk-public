import type {
  ChangeClassification,
  DesignTokenSummary,
  ServerPreviewResponse,
} from '@contentful/experience-design-system-types';
import { PALETTE } from '../../../home/home.theme.js';
import { computeComponentDiffLines } from './diff.js';

export interface PreviewLine {
  key: string;
  color: string;
  text: string;
}

export type PreviewAction = 'confirm' | 'toggle-diff' | 'edit' | 'quit' | 'scroll';

interface Key {
  return: boolean;
  escape: boolean;
  upArrow: boolean;
  downArrow: boolean;
}

interface Scroll {
  offset: number;
  viewportHeight: number;
  maxScroll: number;
}

type RawRecord = Record<string, unknown>;
type SlotMap = Record<string, RawRecord>;

function nameOf(raw: RawRecord, ...fields: string[]): string {
  for (const field of fields) {
    if (typeof raw[field] === 'string') return raw[field] as string;
  }
  return 'unknown';
}

function allowedComponentNames(slot: RawRecord | undefined): string[] {
  const allowed = slot?.['$allowedComponents'];
  if (!Array.isArray(allowed)) return [];
  return allowed.filter((name): name is string => typeof name === 'string');
}

function countLine(key: string, color: string, symbol: string, count: number, what: string): PreviewLine {
  return { key, color, text: ` ${symbol} ${count} ${what}` };
}

export function buildSummaryLines(preview: ServerPreviewResponse): PreviewLine[] {
  const lines: PreviewLine[] = [];
  const { components, tokens } = preview;

  if (components.new.length > 0) {
    lines.push(
      countLine('summary-components-new', PALETTE.success, '＋', components.new.length, 'components will be created'),
    );
    for (const [index, item] of components.new.entries()) {
      lines.push({
        key: `summary-components-new-${index}`,
        color: PALETTE.success,
        text: `  + ${nameOf(item as unknown as RawRecord, 'key', '$name')}`,
      });
    }
  }

  if (components.changed.length > 0) {
    lines.push(
      countLine(
        'summary-components-changed',
        PALETTE.warning,
        '～',
        components.changed.length,
        'components will be updated',
      ),
    );
    for (const [index, item] of components.changed.entries()) {
      const isBreaking = item.changeClassification?.classification === 'breaking';
      lines.push({
        key: `summary-components-changed-${index}`,
        color: isBreaking ? PALETTE.error : PALETTE.warning,
        text: ` ${isBreaking ? '⚠' : '~'} ${item.current.name}`,
      });
    }
  }

  if (components.removed.length > 0) {
    lines.push(
      countLine(
        'summary-components-removed',
        PALETTE.warning,
        '⊘',
        components.removed.length,
        'components will be skipped',
      ),
    );
    for (const [index, item] of components.removed.entries()) {
      lines.push({ key: `summary-components-removed-${index}`, color: PALETTE.warning, text: ` ⊘ ${item.name}` });
    }
  }

  if (components.unchanged.length > 0) {
    lines.push(countLine('summary-components-unchanged', 'gray', '·', components.unchanged.length, 'unchanged'));
  }

  if (tokens.new.length > 0) {
    lines.push(
      countLine('summary-tokens-new', PALETTE.success, '＋', tokens.new.length, 'design tokens will be created'),
    );
  }
  if (tokens.changed.length > 0) {
    lines.push(
      countLine(
        'summary-tokens-changed',
        PALETTE.warning,
        '～',
        tokens.changed.length,
        'design tokens will be updated',
      ),
    );
  }
  if (tokens.removed.length > 0) {
    lines.push(
      countLine('summary-tokens-removed', PALETTE.warning, '⊘', tokens.removed.length, 'design tokens will be skipped'),
    );
  }
  if (tokens.unchanged.length > 0) {
    lines.push(countLine('summary-tokens-unchanged', 'gray', '·', tokens.unchanged.length, 'design tokens unchanged'));
  }

  return lines;
}

function appendChangedLine(
  lines: PreviewLine[],
  keyPrefix: string,
  name: string,
  hasPendingDraftChanges: boolean,
  changeClassification?: ChangeClassification,
): void {
  lines.push({
    key: `${keyPrefix}-h-${name}`,
    color: PALETTE.warning,
    text: ` ~ ${name}${hasPendingDraftChanges ? ' ⚡ has pending draft changes' : ''}`,
  });
  if (changeClassification?.classification !== 'breaking') return;

  const reasons = changeClassification.breakingChanges
    .map((change) => `${'slotId' in change ? change.slotId : change.propertyId}: ${change.reason}`)
    .join(', ');
  lines.push({ key: `${keyPrefix}-b-${name}`, color: PALETTE.error, text: ` ⚠ BREAKING: ${reasons}` });
}

function newComponentLines(item: RawRecord): PreviewLine[] {
  const name = nameOf(item, 'key', '$name');
  const lines: PreviewLine[] = [{ key: `comp-new-${name}`, color: PALETTE.success, text: ` + ${name}` }];
  const slots = (item['$slots'] ?? {}) as SlotMap;

  for (const slotName of Object.keys(slots).sort()) {
    lines.push({ key: `comp-new-${name}-slot-${slotName}`, color: PALETTE.success, text: `   slot: ${slotName}` });
    const allowed = allowedComponentNames(slots[slotName]);
    if (allowed.length > 0) {
      lines.push({
        key: `comp-new-${name}-slot-${slotName}-allow`,
        color: PALETTE.success,
        text: `     allowedComponents: [${allowed.join(', ')}]`,
      });
    }
  }
  return lines;
}

function changedComponentLines(item: ServerPreviewResponse['components']['changed'][number]): PreviewLine[] {
  const name = item.current.name;
  const lines: PreviewLine[] = [];
  appendChangedLine(lines, 'comp', name, item.hasPendingDraftChanges, item.changeClassification);

  const proposed = item.proposed as unknown as RawRecord;
  for (const diff of computeComponentDiffLines(item.current, proposed, item.changeClassification)) {
    lines.push({ key: `comp-d-${name}-${diff.key}`, color: diff.color, text: ` ${diff.text}` });
  }

  const proposedSlots = (proposed['$slots'] ?? {}) as SlotMap;
  for (const slotName of Object.keys(proposedSlots).sort()) {
    const allowed = allowedComponentNames(proposedSlots[slotName]);
    if (allowed.length === 0) continue;
    const key = `comp-d-${name}-slot-${slotName}-allow-list`;
    if (lines.some((line) => line.key === key)) continue;
    lines.push({ key, color: 'gray', text: `   slot ${slotName} allowedComponents: [${allowed.join(', ')}]` });
  }
  return lines;
}

export function buildDiffLines(preview: ServerPreviewResponse): PreviewLine[] {
  const lines: PreviewLine[] = [];
  const { components, tokens } = preview;

  for (const item of components.new) lines.push(...newComponentLines(item as unknown as RawRecord));
  for (const item of components.removed) {
    lines.push({ key: `comp-rm-${item.name}`, color: PALETTE.error, text: ` - ${item.name}` });
  }
  for (const item of components.changed) lines.push(...changedComponentLines(item));

  for (const item of tokens.new) {
    const name = nameOf(item as unknown as RawRecord, 'name', 'path');
    lines.push({ key: `tok-new-${name}`, color: PALETTE.success, text: ` + ${name}` });
  }
  for (const item of tokens.removed) {
    lines.push({ key: `tok-rm-${item.name}`, color: PALETTE.error, text: ` - ${item.name}` });
  }
  for (const item of tokens.changed) {
    const name = (item.current as DesignTokenSummary).name;
    appendChangedLine(lines, 'tok', name, item.hasPendingDraftChanges, item.changeClassification);
  }

  return lines;
}

export function hasChanges(preview: ServerPreviewResponse): boolean {
  const { components, tokens } = preview;
  const count = (group: { new: unknown[]; changed: unknown[]; removed: unknown[] }) =>
    group.new.length + group.changed.length + group.removed.length;
  return count(components) + count(tokens) > 0;
}

export function previewAction(input: string, key: Key, diffExpanded: boolean): PreviewAction | null {
  if (key.return) return 'confirm';
  if (key.escape) return 'quit';
  if (input === 'd' || input === 'D') return 'toggle-diff';
  if (input === 'e' || input === 'E') return 'edit';
  if (key.upArrow || key.downArrow || input === 'f' || input === 'b') return 'scroll';
  if (diffExpanded && (input === 'j' || input === 'k')) return 'scroll';
  return null;
}

export function nextScrollOffset(input: string, key: Key, diffExpanded: boolean, scroll: Scroll): number {
  const { offset, viewportHeight, maxScroll } = scroll;
  const down = key.downArrow || (diffExpanded && input === 'j');
  const up = key.upArrow || (diffExpanded && input === 'k');

  if (down) return Math.min(offset + 1, maxScroll);
  if (up) return Math.max(offset - 1, 0);
  if (input === 'f') return Math.min(offset + viewportHeight, maxScroll);
  if (input === 'b') return Math.max(offset - viewportHeight, 0);
  return offset;
}

// padding 2, header 2, intro 1, gaps 3, panel border + indicator 3, footer 2, global top bar 1, wrapped footer slack 2
const CHROME_ROWS = 16;
const BREAKING_NOTICE_ROWS = 2;
const MIN_VIEWPORT_ROWS = 3;

/** Rows left for the line list once the header, panel border, notice and footer are accounted for. */
export function viewportHeight(terminalRows: number, hasBreakingChanges: boolean): number {
  const reserved = CHROME_ROWS + (hasBreakingChanges ? BREAKING_NOTICE_ROWS : 0);
  return Math.max(MIN_VIEWPORT_ROWS, terminalRows - reserved);
}

export function scrollIndicator(totalLines: number, offset: number, viewportHeight: number): string {
  const maxScroll = Math.max(0, totalLines - viewportHeight);
  const above = offset > 0 ? `↑ ${offset} above` : '';
  const below = maxScroll > offset ? `↓ ${totalLines - offset - viewportHeight} below` : '';
  const parts = [above, below].filter(Boolean);
  return parts.length > 0 ? ` ${parts.join(' · ')}` : ' ';
}
