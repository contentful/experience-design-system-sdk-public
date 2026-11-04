/** Quote one literal argument for the supplied POSIX shell command. */
export const shellArgument = (value: string): string => "'" + value.replace(/'/g, "'\"'\"'") + "'";
