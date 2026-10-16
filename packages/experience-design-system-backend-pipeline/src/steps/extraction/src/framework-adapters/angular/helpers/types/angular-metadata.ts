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
  /** Raw `selector` string from the decorator, or `null` when none. */
  rawSelector: string | null;
  /** Inline template HTML, or `null` when the component uses `templateUrl` or has no template. */
  inlineTemplate: string | null;
  /** Resolved absolute path to the external template file, when `templateUrl` is set. */
  templatePath: string | null;
  /** Raw entries from the legacy `@Component({ inputs: [...] })` array. */
  inputsArray: string[];
  /** 1-indexed line in the source file where the decorator starts. */
  decoratorLine: number;
}
