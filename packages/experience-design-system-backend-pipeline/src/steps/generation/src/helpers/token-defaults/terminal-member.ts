/** Extract the last dotted segment of a reference like `tokens.color.brand.primary` → `primary`. */
export function terminalMember(reference: string): string | undefined {
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(reference)) return undefined;
  return reference.slice(reference.lastIndexOf('.') + 1);
}
