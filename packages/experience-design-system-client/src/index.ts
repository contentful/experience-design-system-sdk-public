export * from './generated/index.js';

export {
  createClient,
  createConfig,
  formDataBodySerializer,
  jsonBodySerializer,
  mergeHeaders,
  urlSearchParamsBodySerializer,
} from './generated/client/index.js';
export type {
  Auth,
  Client,
  ClientOptions,
  Config,
  CreateClientConfig,
  Options,
  OptionsLegacyParser,
  QuerySerializerOptions,
  RequestOptions,
  RequestResult,
  ResolvedRequestOptions,
  ResponseStyle,
  TDataShape,
} from './generated/client/index.js';

export {
  PROPERTY_BREAKING_REASONS,
  SLOT_BREAKING_REASONS,
  sanitizeBreakingChanges,
} from '@contentful/experience-design-system-types';
export type {
  CDFComponentEntry,
  CDFPropertyDefinition,
  CDFFieldDefinition,
  CDFSlotDefinition,
  RepresentationPlan,
  BreakingChange,
  ComponentTypeSummary,
  PropertySummary,
  SlotSummary,
  ProjectionDiagnostic,
  ServerPreviewResponse,
} from '@contentful/experience-design-system-types';

export type { ProposedComponentSummary } from '@contentful/experience-design-system-types';
