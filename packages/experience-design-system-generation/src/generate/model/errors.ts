import type { Skill } from './prompt.js';

export type GenerateRequestErrorReason = 'unknown-stage';

/** A generation request the endpoint rejects before building a prompt or invoking an agent. */
export class GenerateRequestError extends Error {
  readonly reason: GenerateRequestErrorReason;
  readonly stage: Skill | string;

  constructor(reason: GenerateRequestErrorReason, stage: Skill | string) {
    super(`unsupported generation stage '${String(stage)}'`);
    this.name = 'GenerateRequestError';
    this.reason = reason;
    this.stage = stage;
  }
}
