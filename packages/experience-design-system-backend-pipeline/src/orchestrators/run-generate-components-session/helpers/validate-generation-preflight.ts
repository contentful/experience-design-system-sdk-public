import {
  buildCDF,
  DESIGN_TOKEN_TYPES,
  validateCDF,
  type CDFComponentEntry,
} from '@contentful/experience-design-system-types';
import type { ToolCall } from '../../../agents/types/tool-calls.js';
import type { RawComponentDefinition } from '../../../steps/extraction/src/types/component.js';

export class GenerationPreflightError extends Error {
  constructor(errors: string[]) {
    super(`Generation preflight failed:\n${errors.join('\n')}`);
    this.name = 'GenerationPreflightError';
  }
}

export function validateGenerationCalls(
  component: Pick<RawComponentDefinition, 'props' | 'slots'>,
  calls: ToolCall[],
  allowedComponentNames: ReadonlySet<string>,
  invalidCalls: string[],
): void {
  const errors = [...invalidCalls];
  const props = new Set(component.props.map((prop) => prop.name));
  const slots = new Set(component.slots.map((slot) => slot.name));
  const tokenKinds = new Set<string>(DESIGN_TOKEN_TYPES);
  for (const call of calls) {
    if (call.tool === 'classify_prop') {
      if (call.cdf_type === 'enum' && !call.values?.length) {
        errors.push(`Property "${call.prop}": enum classification requires a non-empty values list.`);
      }
      if (call.cdf_type === 'token' && call.token_kind && !tokenKinds.has(call.token_kind)) {
        errors.push(`Property "${call.prop}": unknown token kind "${call.token_kind}".`);
      }
    }
    if ((call.tool === 'classify_prop' || call.tool === 'exclude_prop') && !props.has(call.prop)) {
      errors.push(`Property "${call.prop}" does not exist in the extracted component.`);
    } else if (call.tool === 'classify_slot') {
      if (!slots.has(call.slot)) errors.push(`Slot "${call.slot}" does not exist in the extracted component.`);
      for (const name of call.allowed_components ?? []) {
        if (!allowedComponentNames.has(name)) {
          errors.push(`Slot "${call.slot}" refers to unknown component "${name}".`);
        }
      }
    }
  }
  if (errors.length > 0) throw new GenerationPreflightError(errors);
}

export function validateGeneratedCDF(component: { key: string; entry: CDFComponentEntry }): void {
  const validation = validateCDF(buildCDF([component], []));
  if (!validation.valid) {
    throw new GenerationPreflightError(
      validation.errors.map(
        (error) => `${error.path}: ${error.message}${error.expected ? ` (${error.expected})` : ''}`,
      ),
    );
  }
}
