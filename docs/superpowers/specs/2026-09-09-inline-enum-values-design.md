# Inline enum values in the FieldEditor

## Goal

Make enum design properties easier to scan by showing their declared values inline on the property row instead of expanding a multiline values list during normal selection/hover.

## Behavior

For every enum property, whether selected or unselected, render the declared values on the same line as the type and required state:

```text
type: enum  req: []  values: [primary, secondary, tertiary]
```

Values are comma-separated inside square brackets. Empty enum values render as `values: []`.

The existing enum value editing flow remains available when the values field is active, including add, edit, remove, navigation, and reorder controls. Passive rendering does not add a new interaction or change the serialized `$values` data.

## Scope

- Update the FieldEditor enum property row presentation.
- Keep enum keyboard editing and persistence behavior unchanged.
- Add focused rendering coverage for selected and unselected enum rows, including an empty values array.

## Verification

- Run the focused `FieldEditor` TUI test suite.
- Run the CLI package lint task.
- Check the final diff for whitespace errors.
