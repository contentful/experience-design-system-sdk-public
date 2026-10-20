import type { ComponentReviewMetadata } from '@contentful/experience-design-system-backend-pipeline';

export type ReviewSourceCandidate = NonNullable<ComponentReviewMetadata['sourceCandidates']>[number];

export function sourceObservationRows(candidate: ReviewSourceCandidate): string[] {
  return (candidate.observations ?? []).flatMap((observation) => {
    const syntax = observation.syntax;
    if (syntax?.reader !== 'web-component') return [];
    const location = observation.location;
    return [
      `syntax ${candidate.name || '<empty>'}: ${syntax.lineage} · ${syntax.declaringClass ?? '<anonymous>'} · ${observation.evidenceKind} · ${observation.origin}`,
      `converter: ${syntax.converter.state} · ${syntax.converter.expression ?? '<none>'} · attribute: ${syntax.attribute.state} · ${syntax.attribute.name === null ? '<none>' : JSON.stringify(syntax.attribute.name)} · reflect: ${syntax.reflect.state} · ${syntax.reflect.value === null ? 'unknown' : String(syntax.reflect.value)}`,
      `exposure: ${syntax.exposure.join(', ') || '<none recorded>'} · default: ${syntax.default.state} · ${syntax.default.expression ?? '<none>'}${syntax.default.reason ? ` · ${syntax.default.reason}` : ''}`,
      ...(syntax.default.value ? [`resolved default: ${syntax.default.value.kind} ${syntax.default.value.value}`] : []),
      ...syntax.default.locations.map(
        (item) =>
          `default location: ${item.canonicalPath ?? '<unknown>'}:${item.startLine ?? '?'}-${item.endLine ?? '?'} · ${item.binding}`,
      ),
      ...syntax.typeLocations.map(
        (item) =>
          `type location: ${item.canonicalPath ?? '<unknown>'}:${item.startLine ?? '?'}-${item.endLine ?? '?'} · ${item.binding}`,
      ),
      ...(location
        ? [
            `declaration: ${location.canonicalPath ?? '<unknown>'}:${location.startLine ?? '?'}-${location.endLine ?? '?'} · ${location.binding}`,
          ]
        : []),
    ];
  });
}
