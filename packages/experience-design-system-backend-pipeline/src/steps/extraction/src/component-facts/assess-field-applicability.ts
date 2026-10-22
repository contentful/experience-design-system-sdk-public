import { FIELD_REPLAY_PREMISES, type SourceFieldReplay } from '../types/field-replay.js';
import type { ConditionalFieldClaim } from '../types/field-semantics.js';

interface FieldClaimApplicability {
  status: ConditionalFieldClaim['status'];
  applicability: 'unestablished';
  unestablishedPremises: string[];
  reasons: string[];
}

export interface FieldProjectionPreview {
  componentDeclarationId: string;
  replayIdentity: string;
  replayStatus: SourceFieldReplay['status'];
  mode: 'retention-only';
  uncoveredFields: 'retain';
  fields: Array<{
    inputName: string;
    path: SourceFieldReplay['domain'][number]['path'];
    valueIndependence: FieldClaimApplicability;
    omissionSafety: FieldClaimApplicability;
    disposition: 'conditional-retention' | 'retained-uncertainty';
    reasons: string[];
  }>;
}

function assessClaim(claim: ConditionalFieldClaim, obligation: 'value' | 'omission'): FieldClaimApplicability {
  return {
    status: claim.status,
    applicability: 'unestablished',
    unestablishedPremises: [
      ...new Set([
        ...FIELD_REPLAY_PREMISES,
        ...claim.premises,
        ...(obligation === 'omission' ? ['entry-delivery-admits-omission'] : []),
      ]),
    ],
    reasons: [...claim.reasons],
  };
}

/** Validated source replay reports conditional semantics, never runtime or delivery guarantees. */
export function assessFieldApplicability(replay: SourceFieldReplay): FieldProjectionPreview {
  return {
    componentDeclarationId: replay.componentDeclarationId,
    replayIdentity: replay.identity,
    replayStatus: replay.status,
    mode: 'retention-only',
    uncoveredFields: 'retain',
    fields: replay.results.map((result) => {
      const conditional =
        replay.status === 'matched' &&
        result.valueIndependence.status === 'conditional' &&
        result.omissionSafety.status === 'conditional';
      return {
        inputName: result.inputName,
        path: result.path.map((segment) => ({ ...segment })),
        valueIndependence: assessClaim(result.valueIndependence, 'value'),
        omissionSafety: assessClaim(result.omissionSafety, 'omission'),
        disposition: conditional ? 'conditional-retention' : 'retained-uncertainty',
        reasons: [
          ...new Set([
            ...result.reasons,
            ...result.valueIndependence.reasons,
            ...result.omissionSafety.reasons,
            'runtime-and-delivery-premises-unestablished',
            ...(replay.status !== 'matched' ? [`source-replay-${replay.status}`] : []),
          ]),
        ],
      };
    }),
  };
}
