/** Props for the token-input screen: the second page of the import flow, which asks for an optional raw tokens file. */
export interface TokenInputScreenProps {
  /** Called with the absolute path of a token file that exists. The path has already been normalised and checked. */
  onConfirm: (rawTokensPath: string) => void;
  /** Called when the user chooses not to provide tokens (Enter on an empty field, or `s`). */
  onSkip: () => void;
  /** Called when the user asks to leave (Esc, or `q` on an empty field). What quitting means is the host's decision. */
  onQuit: () => void;
}
