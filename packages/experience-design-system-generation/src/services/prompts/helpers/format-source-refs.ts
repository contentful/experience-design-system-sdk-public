import type { ComponentSourceRef, Skill } from '../../../types/prompt.js';
import { inferFenceLang } from './format-token-candidates.js';

function formatSourceRefBlock(ref: ComponentSourceRef): string {
  const mainBlock = `#### ${ref.component} (\`${ref.sourcePath}\`)\n\`\`\`${inferFenceLang(ref.sourcePath)}\n${ref.content}\n\`\`\``;
  const siblingBlocks = (ref.siblingFiles ?? []).map(
    (sibling) =>
      `##### ${ref.component} — imported file \`${sibling.path}\`\n\`\`\`${inferFenceLang(sibling.path)}\n${sibling.content}\n\`\`\``,
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
}

export function formatSourceRefsSection(refs: ComponentSourceRef[], skill: Skill): string[] {
  const sections: string[] = [];
  const withContent = refs.filter((ref) => ref.content != null);
  const withoutContent = refs.filter((ref) => ref.content == null);

  if (withContent.length > 0) {
    sections.push(`### Component source references\n\n${withContent.map(formatSourceRefBlock).join('\n\n')}`);
  }
  if (withoutContent.length > 0) {
    const guidance =
      skill === 'components'
        ? 'there is no consumption evidence for these, so `token` cannot be earned for any of their props — classify from the prop signature alone, and any prop that would otherwise be enum-versus-token is `enum` (or `string`)'
        : 'there is no source evidence to narrow from — emit nothing for their props';
    sections.push(
      `Component source unavailable for (JSON) — ${guidance}:\n\`\`\`json\n${JSON.stringify(withoutContent.map((ref) => ({ component: ref.component, sourcePath: ref.sourcePath })))}\n\`\`\``,
    );
  }
  return sections;
}
