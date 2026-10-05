import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';

type ComponentDecision = 'accepted' | 'rejected';
type ReviewStatus = 'pending' | 'decided';

interface ComponentSelection {
  decision: ComponentDecision;
  reason: string;
  confidence?: number;
}

interface SelectComponentsRequest {
  components: RawComponentDefinition[];
}

interface ComponentReview {
  id: string;
  component: RawComponentDefinition;
  decision?: ComponentDecision;
  reason?: string;
  confidence?: number;
  status: ReviewStatus;
}

interface SelectComponentsResponse {
  reviews: ComponentReview[];
}

interface SubmitReviewDecisionRequest {
  decision: ComponentDecision;
  reason?: string;
}

export interface CliV2Api {
  selectComponents(input: SelectComponentsRequest): Promise<SelectComponentsResponse>;
  getComponentReview(id: string): Promise<ComponentReview | undefined>;
  submitReviewDecision(id: string, input: SubmitReviewDecisionRequest): Promise<ComponentReview>;
}

export interface CreateCliV2ApiOptions {
  selectComponent: (component: RawComponentDefinition) => Promise<ComponentSelection>;
}

function cloneSerializable<T>(value: T): T {
  return structuredClone(value);
}

export function createCliV2Api(options: CreateCliV2ApiOptions): CliV2Api {
  const { selectComponent } = options;
  const reviews = new Map<string, ComponentReview>();
  let nextReviewId = 0;

  return {
    async selectComponents(input) {
      const createdReviews = await Promise.all(
        input.components.map((component) => {
          const id = `review-${nextReviewId++}`;
          const componentSnapshot = cloneSerializable(component);

          return (async () => {
            const selection = await selectComponent(cloneSerializable(componentSnapshot));
            const review: ComponentReview = {
              id,
              component: componentSnapshot,
              decision: selection.decision,
              reason: selection.reason,
              confidence: selection.confidence,
              status: 'decided',
            };
            reviews.set(review.id, review);
            return cloneSerializable(review);
          })();
        }),
      );

      return { reviews: createdReviews };
    },

    async getComponentReview(id) {
      const review = reviews.get(id);
      return review ? cloneSerializable(review) : undefined;
    },

    async submitReviewDecision(id, input) {
      const review = reviews.get(id);
      if (!review) throw new Error(`Component review not found: ${id}`);

      const updatedReview: ComponentReview = {
        ...review,
        decision: input.decision,
        reason: input.reason ?? review.reason,
        status: 'decided',
      };
      reviews.set(id, updatedReview);
      return cloneSerializable(updatedReview);
    },
  };
}
