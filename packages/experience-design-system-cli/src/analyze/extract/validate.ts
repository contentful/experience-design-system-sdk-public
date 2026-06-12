import type { RawComponentDefinition, ExtractionValidationIssue } from '../../types.js';

export type { ExtractionValidationIssue } from '../../types.js';

export function validateExtractedComponents(components: RawComponentDefinition[]): RawComponentDefinition[] {
  const nameCounts = new Map<string, number>();
  for (const component of components) {
    const key = component.name.trim();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  return components.map((component) => {
    const issues: ExtractionValidationIssue[] = [];

    if (!component.name.trim()) {
      issues.push({
        severity: 'error',
        code: 'EMPTY_COMPONENT_NAME',
        message: 'Component name must not be empty',
      });
    }

    for (let i = 0; i < component.props.length; i++) {
      if (!component.props[i].name.trim()) {
        issues.push({
          severity: 'error',
          code: 'EMPTY_PROP_NAME',
          message: `Prop at index ${i} has an empty name`,
          field: `props[${i}].name`,
        });
      }
    }

    for (let i = 0; i < component.slots.length; i++) {
      if (!component.slots[i].name.trim()) {
        issues.push({
          severity: 'error',
          code: 'EMPTY_SLOT_NAME',
          message: `Slot at index ${i} has an empty name`,
          field: `slots[${i}].name`,
        });
      }
    }

    const propNames = new Set(component.props.map((p) => p.name));
    for (let i = 0; i < component.slots.length; i++) {
      if (component.slots[i].name && propNames.has(component.slots[i].name)) {
        issues.push({
          severity: 'error',
          code: 'PROP_SLOT_NAME_COLLISION',
          message: `"${component.slots[i].name}" is used as both a prop name and a slot name`,
          field: `slots[${i}].name`,
        });
      }
    }

    const nameKey = component.name.trim();
    if (nameKey && (nameCounts.get(nameKey) ?? 0) > 1) {
      issues.push({
        severity: 'warning',
        code: 'DUPLICATE_COMPONENT_NAME',
        message: `Component name "${component.name}" appears more than once in the extracted set`,
      });
    }

    if (component.props.length === 0 && component.slots.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'EMPTY_COMPONENT',
        message: 'Component has no props or slots and will be filtered out during generation',
      });
    }

    return { ...component, validationIssues: issues };
  });
}

export function shouldExcludeDueToValidation(component: RawComponentDefinition): boolean {
  return (component.validationIssues ?? []).some((i) => i.severity === 'error');
}
