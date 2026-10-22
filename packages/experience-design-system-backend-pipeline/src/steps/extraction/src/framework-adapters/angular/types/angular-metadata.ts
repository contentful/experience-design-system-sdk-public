export interface AngularComponentMetadata {
  className: string;

  normalizedName: string;

  rawSelector: string | null;

  inlineTemplate: string | null;

  templatePath: string | null;

  inputsArray: string[];

  decoratorLine: number;
}
