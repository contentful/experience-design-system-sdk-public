import { childPath, jsonEqual, own, type PropertyIssue } from './json-value.js';

type DefinitionStyle = 'target' | 'cdf';
type Definition = Record<string, unknown>;

function object(value: unknown): value is Definition {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** An intrinsic tag belongs to one own field of a complete Record member. */
export function discriminatedUnionTag(
  member: unknown,
  discriminator: string,
  style: DefinitionStyle,
): Definition | undefined {
  if (!object(member) || member[style === 'target' ? 'type' : '$type'] !== (style === 'target' ? 'Record' : 'record'))
    return;
  const fields = member[style === 'target' ? 'fields' : '$fields'];
  if (!object(fields) || !own(fields, discriminator)) return;
  const field = fields[discriminator];
  return object(field) ? field : undefined;
}

export function discriminatedUnionIssues(definition: Definition, style: DefinitionStyle, path = ''): PropertyIssue[] {
  const issues: PropertyIssue[] = [];
  const discriminator = definition.discriminator;
  if (typeof discriminator !== 'string' || !discriminator.length)
    issues.push({ path: childPath(path, 'discriminator'), message: 'Union requires a nonempty discriminator' });
  if (!Array.isArray(definition.members) || definition.members.length < 2) {
    issues.push({ path: childPath(path, 'members'), message: 'Union requires at least two complete Record members' });
    return issues;
  }
  const tags = new Set<string>();
  definition.members.forEach((member, index) => {
    const at = childPath(childPath(path, 'members'), index);
    const tag = typeof discriminator === 'string' ? discriminatedUnionTag(member, discriminator, style) : undefined;
    if (
      !tag ||
      tag[style === 'target' ? 'type' : '$type'] !== 'Literal' ||
      tag[style === 'target' ? 'required' : '$required'] !== true
    ) {
      issues.push({ path: at, message: 'Each member requires one required intrinsic Literal discriminator' });
      return;
    }
    const value = tag.value;
    if (
      !(
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
      )
    ) {
      issues.push({ path: at, message: 'Discriminator must be a finite string, number or boolean literal' });
      return;
    }
    const key = JSON.stringify([typeof value, value]);
    if (tags.has(key)) issues.push({ path: at, message: 'Union tags must be distinct typed values' });
    tags.add(key);
  });
  return issues;
}

export function matchingDiscriminatedUnionMember(
  definition: Definition,
  value: Definition,
  style: DefinitionStyle,
): Definition | undefined {
  if (discriminatedUnionIssues(definition, style).length || !own(value, definition.discriminator as string)) return;
  return (definition.members as Definition[]).find((member) =>
    jsonEqual(
      discriminatedUnionTag(member, definition.discriminator as string, style)!.value,
      value[definition.discriminator as string],
    ),
  );
}
