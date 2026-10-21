import { projectSharedSource, renderSharedSource } from '../../../source-evidence/shared-source.js';
import { flattenDTCG } from '../../../steps/shared/index.js';
import type { PromptOptions } from '../../types/prompts.js';
import { filterDesignTokenProps } from './filter-design-token-props.js';
import { renderTokenCandidateSection } from './format-token-candidates.js';
import { inferFenceLang } from './infer-fence-lang.js';
import { renderSelectionEvidenceInline } from './build-selection-evidence-inline.js';

/** Build the inline evidence/context sections that precede the per-skill preamble. */
export function buildInputSections(options: PromptOptions): string[] {
  const {
    skill,
    rawComponentsInline,
    compilerEvidenceInline,
    explorationJudgmentsInline,
    propBucketsInline,
    rawTokensInline,
    rawTokensFilename,
    tokensInline,
    tokenMapInline,
    generatedCdf,
    tokenTree,
    componentSourceRefs,
    existingComponentsInline,
    existingTokensInline,
    componentAllowlistInline,
    selectionEvidenceInline,
  } = options;

  const sections: string[] = [];

  if (existingComponentsInline) {
    sections.push(
      `Existing components in the target Contentful space (JSON) — use for alignment, not as a hard filter:\n\`\`\`json\n${existingComponentsInline}\n\`\`\``,
    );
  }
  if (existingTokensInline) {
    sections.push(
      `Existing design tokens in the target Contentful space (JSON) — prefer binding to these paths over inventing new ones:\n\`\`\`json\n${existingTokensInline}\n\`\`\``,
    );
  }
  if (componentAllowlistInline) {
    sections.push(
      `Known component names for slot allowed_components (hard allowlist; never use any other name):\n\`\`\`json\n${componentAllowlistInline}\n\`\`\``,
    );
  }
  if (rawComponentsInline) {
    sections.push(`Raw component data (JSON):\n\`\`\`json\n${rawComponentsInline}\n\`\`\``);
  }
  if (compilerEvidenceInline) {
    sections.push(
      `Compiler evidence and source candidates (JSON; advisory and separate from authoring props):\n\`\`\`json\n${compilerEvidenceInline}\n\`\`\``,
    );
  }
  if (propBucketsInline) {
    sections.push(
      `Deterministic prop buckets (advisory evidence only; verify against source and do not treat as inclusion or category decisions):\n\`\`\`json\n${propBucketsInline}\n\`\`\``,
    );
  }
  if (explorationJudgmentsInline) {
    sections.push(
      `Reconciled exploration judgments for this component (JSON; advisory, not an accepted CDF):\nUse consensus and independently checked resolutions as starting judgments when current source evidence and the target contract support them. Focus on representation selection, validation and unresolved questions. Reported disagreements, single-reporter claims and interpretive hypotheses are retained for investigation; conflicting or downgraded checks are not established conclusions. Report types describe source inputs, not necessarily CDF types. Explain departures from earlier judgments in reason or rationale. Source declarations, defaults, open domains, the required decision inventory and accepted source-owned slots remain authoritative; agent agreement alone does not prove a restriction.\n\`\`\`json\n${explorationJudgmentsInline}\n\`\`\``,
    );
  }
  if (selectionEvidenceInline) {
    sections.push(renderSelectionEvidenceInline(selectionEvidenceInline));
  }
  if (rawTokensInline) {
    const lang = inferFenceLang(rawTokensFilename);
    const label = rawTokensFilename ? `Raw token source (${rawTokensFilename})` : 'Raw token source';
    sections.push(`${label}:\n\`\`\`${lang}\n${rawTokensInline}\n\`\`\``);
  }
  if (tokensInline) {
    sections.push(`DTCG token data (for token kind lookups):\n\`\`\`json\n${tokensInline}\n\`\`\``);
  }
  if (tokenMapInline) {
    sections.push(`Token-name sidecar (raw name → DTCG path):\n\`\`\`json\n${tokenMapInline}\n\`\`\``);
  }

  const filteredTokenProps = generatedCdf ? filterDesignTokenProps(generatedCdf) : undefined;
  if (filteredTokenProps && Object.keys(filteredTokenProps.filtered).length > 0) {
    sections.push(
      `Generated CDF so far — design-category token props only (JSON):\n\`\`\`json\n${JSON.stringify(filteredTokenProps.filtered)}\n\`\`\``,
    );
  }
  if (tokenTree) {
    const index = flattenDTCG(tokenTree, '').sort((a, b) => a.path.localeCompare(b.path));
    if (index.length > 0) {
      if (filteredTokenProps) {
        const { kinds, hasUnscoped } = filteredTokenProps;
        for (const kind of kinds) {
          const scoped = index.filter((entry) => entry.$type === kind);
          if (scoped.length > 0) sections.push(renderTokenCandidateSection(kind, scoped));
        }
        if (hasUnscoped) sections.push(renderTokenCandidateSection(null, index));
      } else {
        sections.push(renderTokenCandidateSection(null, index));
      }
    }
  }

  if (options.sharedSource) {
    sections.push(
      renderSharedSource(projectSharedSource(options.sharedSource, options.sourceProjectionMaxBytes ?? 256 * 1024)),
    );
  } else if (componentSourceRefs && componentSourceRefs.length > 0) {
    const withContent = componentSourceRefs.filter((ref) => ref.content != null);
    const withoutContent = componentSourceRefs.filter((ref) => ref.content == null);
    if (withContent.length > 0) {
      const blocks = withContent.map((ref) => {
        const sourceMetadata = ref.sourceEvidence
          ? `\nSaved capture metadata: ${JSON.stringify(ref.sourceEvidence)}`
          : '';
        const contextsMetadata = ref.compilerContexts
          ? `\nSaved compiler contexts: ${JSON.stringify(ref.compilerContexts)}`
          : '';
        const mainBlock = `#### ${ref.component} (\`${ref.sourcePath}\`)${sourceMetadata}${contextsMetadata}\n\`\`\`${inferFenceLang(ref.sourcePath)}\n${ref.content}\n\`\`\``;
        const siblingBlocks = (ref.siblingFiles ?? []).map(
          (sibling) =>
            `##### ${ref.component} — imported file \`${sibling.path}\`${sibling.sourceEvidence ? `\nSaved capture metadata: ${JSON.stringify(sibling.sourceEvidence)}` : ''}\n\`\`\`${inferFenceLang(sibling.path)}\n${sibling.content}\n\`\`\``,
        );
        const truncationNote =
          ref.truncatedSiblingCount && ref.truncatedSiblingCount > 0
            ? [
                `##### ${ref.component} — +${ref.truncatedSiblingCount} more imported file${ref.truncatedSiblingCount === 1 ? '' : 's'} not shown (evidence may be incomplete)`,
              ]
            : [];
        const notShownNote =
          ref.usesNotShown && ref.usesNotShown.length > 0
            ? [
                `##### ${ref.component} — uses not shown: ${ref.usesNotShown.join(', ')}\n\nThe files above are excerpts, and each of these properties has at least one use that fell outside the excerpt budget. Treat their consumption as unknown, not absent: do not classify them \`token\` on what is shown, and do not conclude they are unread.`,
              ]
            : [];
        return [mainBlock, ...siblingBlocks, ...truncationNote, ...notShownNote].join('\n\n');
      });
      sections.push(`### Component source references\n\n${blocks.join('\n\n')}`);
    }
    if (withoutContent.length > 0) {
      const guidance =
        skill === 'components'
          ? 'there is no consumption evidence for these, so `token` cannot be earned for any of their props — classify from the prop signature alone, and any prop that would otherwise be enum-versus-token is `string` with declared values (or open `string`)'
          : 'there is no source evidence to narrow from — emit nothing for their props';
      sections.push(
        `Component source unavailable for (JSON) — ${guidance}:\n\`\`\`json\n${JSON.stringify(withoutContent.map((ref) => ({ component: ref.component, sourcePath: ref.sourcePath })))}\n\`\`\``,
      );
    }
  }

  return sections;
}
