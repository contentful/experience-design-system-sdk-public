export type ExtractionConfidence = 1 | 2 | 3 | 4 | 5;

export type ExtractionScore = {
  confidence: ExtractionConfidence;
  reasons: string[];
};

export interface ExtractionScoreOptions {
  additionalIssueCount?: number;
  additionalReasons?: string[];
}
