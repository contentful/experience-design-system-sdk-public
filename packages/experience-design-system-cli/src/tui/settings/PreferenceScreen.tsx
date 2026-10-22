import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '../theme.js';
import { startDebugRun, finishDebugRun } from '../debug-store.js';
import { ControlHints } from '../shared/components/ControlHints.js';

type Preference = { enabled: boolean };
type Props = {
  title: string;
  label: string;
  flow: string;
  step: string;
  menuOption: string;
  read: () => Promise<Preference>;
  write: (setting: Preference) => Promise<void>;
  description?: React.ReactNode;
  onDone: () => void;
};

export function PreferenceScreen({
  title,
  label,
  flow,
  step,
  menuOption,
  read,
  write,
  description,
  onDone,
}: Props): React.ReactElement {
  const [enabled, setEnabled] = useState(true);
  const [stage, setStage] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const active = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    active.current = true;
    void read()
      .then((setting) => {
        if (!active.current) return;
        setEnabled(setting.enabled);
        setStage('ready');
        setError(null);
        startDebugRun({ flow, step, menuOption, inputs: { enabled: setting.enabled } });
      })
      .catch((failure: unknown) => {
        if (!active.current) return;
        setError(String(failure));
        setStage('error');
      });
    return () => {
      active.current = false;
    };
  }, [read, flow, step, menuOption]);

  useInput((input, key) => {
    if (!active.current) return;
    if (key.escape || input === 'q') {
      active.current = false;
      void finishDebugRun({
        outputs: { enabled },
        status: error || pending.current ? 'error' : 'success',
        exitMethod: saved && !error && !pending.current ? 'saved' : 'discarded',
      }).catch(() => {});
      onDone();
      return;
    }
    if (stage !== 'ready' || pending.current) return;
    if (key.return || input === ' ') {
      const next = !enabled;
      pending.current = true;
      setStage('saving');
      setError(null);
      void write({ enabled: next })
        .then(() => {
          if (!active.current) return;
          setEnabled(next);
          setSaved(true);
        })
        .catch((failure: unknown) => {
          if (active.current) setError(String(failure));
        })
        .finally(() => {
          pending.current = false;
          if (active.current) setStage('ready');
        });
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>{title}</Text>
      <Text> </Text>
      {stage === 'loading' ? (
        <Text color={PALETTE.muted}>Loading…</Text>
      ) : (
        stage !== 'error' && (
          <>
            <Text>
              {label}:{' '}
              <Text bold color={enabled ? PALETTE.success : PALETTE.muted}>
                {enabled ? 'On' : 'Off'}
              </Text>
            </Text>
            {description}
            {stage === 'saving' && <Text color={PALETTE.muted}>Saving…</Text>}
          </>
        )
      )}
      {error && <Text color={PALETTE.error}>{error}</Text>}
      <Text> </Text>
      <ControlHints
        hints={[
          ...(stage === 'ready' ? [{ keys: '⏎/Space', label: 'toggle' }] : []),
          { keys: 'Esc/q', label: stage === 'saving' ? 'back (save may still finish)' : 'back' },
        ]}
      />
    </Box>
  );
}
