/** Props for the Welcome screen: the first page of the import flow, which collects the project path. */
export interface WelcomeScreenProps {
  /** Called with the trimmed, non-empty path the user submitted. Normalising the path is the host's job. */
  onContinue: (projectPath: string) => void;
  /** Called when the user asks to leave (Esc or q). What quitting means is the host's decision. */
  onQuit: () => void;
}
