export type FinalizeContractInput = {
  sessionDir: string;
  accepted: number;
  rejected: number;
  excluded: number;
};

export function formatFinalizeContract(input: FinalizeContractInput): string {
  return JSON.stringify({ status: 'finalized', ...input }, null, 2) + '\n';
}
