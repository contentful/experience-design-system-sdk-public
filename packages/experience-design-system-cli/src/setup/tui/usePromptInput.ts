import { useLayoutEffect, useRef } from 'react';
import { useStdin } from 'ink';

export type PromptKey = {
  return: boolean;
  escape: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  upArrow: boolean;
  downArrow: boolean;
  ctrl: boolean;
  meta: boolean;
};

export type PromptInputHandler = (chunk: string, key: PromptKey) => void;

/** A terminal with bracketed paste on wraps pasted text in `ESC[200~`/`ESC[201~`. */
const BRACKETED_PASTE_START = '\x1b[200~';

function parseKey(data: string): PromptKey {
  const code = data.length === 1 ? data.charCodeAt(0) : -1;
  // Enter (13) and Tab (9) fall inside the 1–26 range that marks a Ctrl chord,
  // so they are classified first.
  const isReturn = data === '\r' || data === '\n';
  const isTab = data === '\t' || data === '\x1b[Z';
  const isDelete = data === '\x1b[3~';
  const isPaste = data.startsWith(BRACKETED_PASTE_START);
  const upArrow = data === '\x1b[A';
  const downArrow = data === '\x1b[B';
  const isEscapeSequence = isPaste || isTab || isDelete || upArrow || downArrow;

  return {
    return: isReturn,
    escape: data === '\x1b',
    tab: isTab,
    backspace: data === '\x7f' || data === '\b',
    delete: isDelete,
    upArrow,
    downArrow,
    ctrl: !isReturn && !isTab && code >= 1 && code <= 26,
    meta: !isEscapeSequence && data.length > 1 && data.startsWith('\x1b'),
  };
}

/**
 * Raw-mode stdin that hands the handler the unparsed chunk.
 *
 * Setup needs the raw data because `useImmediateInput` blanks `input` for a
 * chunk that ends in a newline, which is exactly how a pasted value arrives.
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
