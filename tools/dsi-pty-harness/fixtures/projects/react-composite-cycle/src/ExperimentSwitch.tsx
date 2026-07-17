import type { ReactElement, ReactNode } from 'react';

export interface ExperimentSwitchProps {
  variantA: ReactNode;
  variantB: ReactNode;
}

export function ExperimentSwitch({ variantA, variantB }: ExperimentSwitchProps): ReactElement {
  const pick = Math.random() < 0.5 ? variantA : variantB;
  return <>{pick}</>;
}
