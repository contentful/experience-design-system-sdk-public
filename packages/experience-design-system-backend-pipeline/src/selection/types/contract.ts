export interface ComponentSelection {
  name: string;
  component_id: string;
  decision: 'accepted' | 'rejected';
  reason: string | null;
}

export interface SelectionServiceResult {
  selections: ComponentSelection[];
  warnings: string[];
}
