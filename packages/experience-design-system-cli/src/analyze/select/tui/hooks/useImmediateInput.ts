import { useLayoutEffect, useRef } from 'react';
import { useStdin } from 'ink';

type Key = {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  shiftTab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
};

type InputHandler = (input: string, key: Key) => void;

function parseInput(data: string): { input: string; key: Key } {
  // Shift-Tab in most terminals emits CSI Z (\x1b[Z). We surface it as both
  // `tab` and `shiftTab` so callers that already branch on `tab` still fire,
  // and new callers can distinguish direction via `shiftTab`.
  const isShiftTab = data === '\x1b[Z';
  const key: Key = {
    upArrow: data === '\x1b[A',
    downArrow: data === '\x1b[B',
    leftArrow: data === '\x1b[D',
    rightArrow: data === '\x1b[C',
    pageDown: data === '\x1b[6~',
    pageUp: data === '\x1b[5~',
    return: data === '\r' || data === '\n',
    escape: data === '\x1b',
    ctrl: false,
    shift: isShiftTab,
    tab: data === '\t' || isShiftTab,
    shiftTab: isShiftTab,
    backspace: data === '\x7f' || data === '\b',
    delete: data === '\x1b[3~',
    meta: data === '\x1b',
  };

  let input = data;

  if (data.length === 1) {
    const code = data.charCodeAt(0);
    if (code >= 1 && code <= 26) {
      key.ctrl = true;
      input = String.fromCharCode(code + 96);
    }
  }

  if (
    key.upArrow ||
    key.downArrow ||
    key.leftArrow ||
    key.rightArrow ||
    key.pageUp ||
    key.pageDown ||
    key.return ||
    key.escape ||
    key.tab ||
    key.backspace ||
    key.delete
  ) {
    if (!key.ctrl) input = '';
  }

  return { input, key };
}

export function useImmediateInput(handler: InputHandler): void {
  const { stdin, setRawMode } = useStdin();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useLayoutEffect(() => {
    setRawMode(true);

    const handleData = (data: Buffer | string) => {
      const str = Buffer.isBuffer(data) ? data.toString('utf8') : data;
      const { input, key } = parseInput(str);
      handlerRef.current(input, key);
    };

    stdin.on('data', handleData);
    return () => {
      stdin.off('data', handleData);
      setRawMode(false);
    };
  }, [stdin, setRawMode]);
}
