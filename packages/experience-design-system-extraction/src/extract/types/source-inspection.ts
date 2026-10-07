export interface ComponentSourceInspection {
  wrapperConfidence: 0 | 1 | 2 | 3 | 4 | 5;
  reviewReasons: string[];
  keepDespiteZeroSurface: boolean;
}
