import { useLayoutEffect, useRef } from 'react';
import { useStdin } from 'ink';

export type ImmediateInputKey = {
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

export type ImmediateInputHandler = (input: string, key: ImmediateInputKey) => void;

function parseInput(data: string): { input: string; key: ImmediateInputKey } {
  // Shift-Tab in most terminals emits CSI Z (\x1b[Z). We surface it as both
  // `tab` and `shiftTab` so callers that already branch on `tab` still fire,
  // and new callers can distinguish direction via `shiftTab`.
  const isShiftTab = data === '\x1b[Z';
  const key: ImmediateInputKey = {
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

type RegisteredHandler = (input: string, key: ImmediateInputKey) => void;

type InputRegistry = {
  handlers: Set<RegisteredHandler>;
  onData: (data: Buffer | string) => void;
  setRawMode: (enabled: boolean) => void;
};

const inputRegistries = new WeakMap<object, InputRegistry>();

function registerInputHandler(
  stdin: NodeJS.ReadStream,
  setRawMode: (enabled: boolean) => void,
  handler: RegisteredHandler,
): () => void {
  let registry = inputRegistries.get(stdin);
  if (!registry) {
    const handlers = new Set<RegisteredHandler>();
    const onData = (data: Buffer | string): void => {
      const str = Buffer.isBuffer(data) ? data.toString('utf8') : data;
      const { input, key } = parseInput(str);
      for (const registered of [...handlers]) registered(input, key);
    };
    registry = { handlers, onData, setRawMode };
    inputRegistries.set(stdin, registry);
    setRawMode(true);
    stdin.on('data', onData);
  }

  registry.handlers.add(handler);
  return () => {
    const current = inputRegistries.get(stdin);
    if (!current) return;
    current.handlers.delete(handler);
    if (current.handlers.size === 0) {
      stdin.off('data', current.onData);
      current.setRawMode(false);
      inputRegistries.delete(stdin);
    }
  };
}

export function useImmediateInput(handler: ImmediateInputHandler, enabled = true): void {
  const { stdin, setRawMode } = useStdin();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useLayoutEffect(() => {
    if (!enabled) return;
    const unregister = registerInputHandler(stdin, setRawMode, (input, key) => handlerRef.current(input, key));
    return unregister;
  }, [enabled, stdin, setRawMode]);
}
