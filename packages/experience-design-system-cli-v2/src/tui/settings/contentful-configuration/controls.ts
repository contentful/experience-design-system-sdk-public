import { useInput } from 'ink';
import type { DsiConfiguration } from './config-store.js';

type FieldKey = keyof DsiConfiguration;

export type Field = { key: FieldKey; label: string; maskable?: boolean };

type Mode = 'navigate' | 'edit';

type Status = { kind: 'success' | 'error'; message: string } | null;

export function useConfigurationControls({
  loading,
  mode,
  setMode,
  focusIdx,
  setFocusIdx,
  editBuffer,
  setEditBuffer,
  config,
  setConfig,
  setStatus,
  setRevealToken,
  fields,
  save,
  onDone,
}: {
  loading: boolean;
  mode: Mode;
  setMode: (mode: Mode) => void;
  focusIdx: number;
  setFocusIdx: (updater: (i: number) => number) => void;
  editBuffer: string;
  setEditBuffer: (updater: (b: string) => string) => void;
  config: DsiConfiguration;
  setConfig: (updater: (c: DsiConfiguration) => DsiConfiguration) => void;
  setStatus: (status: Status) => void;
  setRevealToken: (updater: (r: boolean) => boolean) => void;
  fields: Field[];
  save: (config: DsiConfiguration) => Promise<boolean>;
  onDone: () => void;
}): void {
  useInput((input, key) => {
    if (loading) return;

    if (mode === 'edit') {
      if (key.return || key.escape) {
        const field = fields[focusIdx]!.key;
        setConfig((c) => ({ ...c, [field]: editBuffer }));
        setMode('navigate');
        if (key.return) {
          setFocusIdx((i) => (i + 1) % fields.length);
        }
        return;
      }
      if (key.backspace || key.delete) {
        setEditBuffer((b) => b.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setEditBuffer((b) => b + input);
      }
      return;
    }

    if (key.upArrow) {
      setFocusIdx((i) => (i - 1 + fields.length) % fields.length);
      setStatus(null);
      return;
    }
    if (key.downArrow) {
      setFocusIdx((i) => (i + 1) % fields.length);
      setStatus(null);
      return;
    }
    if (key.return) {
      setEditBuffer(() => config[fields[focusIdx]!.key]);
      setMode('edit');
      setStatus(null);
      return;
    }
    if (input === 'v' && fields[focusIdx]!.maskable) {
      setRevealToken((r) => !r);
      return;
    }
    if (input === 's') {
      save(config).then((ok) => {
        if (ok) setStatus({ kind: 'success', message: 'Saved' });
      });
      return;
    }
    if (input === 'S') {
      save(config).then((ok) => {
        if (ok) onDone();
      });
      return;
    }
    if (input === 'q' || key.escape) {
      onDone();
      return;
    }
  });
}
