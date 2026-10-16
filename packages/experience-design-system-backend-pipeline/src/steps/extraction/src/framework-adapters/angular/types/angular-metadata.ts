/**
 * Internal shape pulled from a single `@Component({...})` decorator.
 * Lives only inside the Angular adapter — never leaves the extraction step.
 */
export interface AngularComponentMetadata {
  /** The class identifier (e.g. `CardComponent`). The pipeline's `name` field. */
  className: string;
  /**
   * Normalized `name` after stripping trailing `Component` / `Directive` suffixes.
   * `MatCardComponent` → `MatCard`. Falls back to `className` when the suffix is absent.
   */
  normalizedName: string;
  /**
   * Raw comma-separated selector string from `@Component({selector: ...})`,
   * or `null` when none (abstract/host-less directive).
   */
  rawSelector: string | null;
  /**
   * Parsed selector alternatives:
   * - element: `mat-card` (name only)
   * - attribute: `[matCard]`
   * - class: `.hlm-card`
   * - compound: `button[mat-button]` (combinations)
   */
  selectors: Array<
    | { kind: 'element'; value: string }
    | { kind: 'attribute'; value: string }
    | { kind: 'class'; value: string }
    | { kind: 'compound'; value: string }
  >;
  /** Inline template string, or `null` when the component uses `templateUrl` / has no template. */
  inlineTemplate: string | null;
  /** Resolved absolute path to the external template file, when `templateUrl` is set. */
  templatePath: string | null;
  /** Whether the component declared `standalone: true` (default on Angular 19+). */
  standalone: boolean;
  /**
   * `imports: [...]` identifier list for standalone components. Used to resolve
   * selector references in `<ng-content select="...">` to known classes.
   */
  importedIdentifiers: string[];
  /**
   * Raw entries from the legacy `@Component({ inputs: [...] })` array. Each
   * entry is either `'propName'` or `'propName: aliasName'`.
   */
  inputsArray: string[];
}
