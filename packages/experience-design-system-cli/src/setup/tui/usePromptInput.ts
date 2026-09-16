import { useLayoutEffect, useRef } from 'react';
import { useStdin } from 'ink';

export type PromptKey = {
  return: boolean;
  escape: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  ctrl: boolean;
  meta: boolean;
};

export type PromptInputHandler = (chunk: string, key: PromptKey) => void;

/** A terminal with bracketed paste on wraps pasted text in `ESC[200~`/`ESC[201~`. */
const BRACKETED_PASTE_START = '\x1b[200~';

function parseKey(data: string): PromptKey {
  const code = data.length === 1 ? data.charCodeAt(0) : -1;
  // Ctrl-letter chords arrive as bytes 1–26; Enter (13) and Tab (9) fall in
  // that range too, so they are classified before the chord check.
  const isReturn = data === '\r' || data === '\n';
  const isTab = data === '\t' || data === '\x1b[Z';
  const isDelete = data === '\x1b[3~';
  // A pasted value also begins with ESC, so it must not read as a meta chord.
  const isPaste = data.startsWith(BRACKETED_PASTE_START);

  return {
    return: isReturn,
    escape: data === '\x1b',
    tab: isTab,
    backspace: data === '\x7f' || data === '\b',
    delete: isDelete,
    ctrl: !isReturn && !isTab && code >= 1 && code <= 26,
    meta: !isPaste && !isTab && !isDelete && data.length > 1 && data.startsWith('\x1b'),
  };
}

/**
 * Raw-mode stdin for the setup prompts, handing the handler the unparsed chunk.
 *
 * The setup fields accept pasted values, and a paste arrives as one coalesced
 * chunk that may already contain the newline that submits it. The shared
 * `useImmediateInput` hook blanks `input` for those chunks, so setup reads the
 * raw data and splits it itself.
 */
export function usePromptInput(handler: PromptInputHandler): void {
  const { stdin, setRawMode } = useStdin();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useLayoutEffect(() => {
    setRawMode(true);

    const handleData = (data: Buffer | string): void => {
      const chunk = Buffer.isBuffer(data) ? data.toString('utf8') : data;
      handlerRef.current(chunk, parseKey(chunk));
    };

    stdin.on('data', handleData);
    return () => {
      stdin.off('data', handleData);
      setRawMode(false);
    };
  }, [stdin, setRawMode]);
}
