import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { ConfirmInput, TextInput } from '@inkjs/ui';
import {
  readExperiencesCredentials,
  writeExperiencesCredentials,
  type ExperiencesCredentials,
} from '../../../credentials-store.js';
import { StepLayout, type StepDone } from '../StepLayout.js';

export const CUSTOM_PROMPTS_HELP =
  'Replaces the built-in instructions the coding agent follows when it selects and generates components.';

export type SkillPromptKind = 'select' | 'generate';

/**
 * Interpret an answer to a custom prompt path question: empty keeps whatever is
 * stored, `-` clears it, anything else is the new path.
 */
export function parseCustomSkillPath(answer: string): string | undefined | null {
  const trimmed = answer.trim();
  if (trimmed === '') return undefined;
  if (trimmed === '-') return null;
  return trimmed;
}

export function customSkillPathQuestion(kind: SkillPromptKind, current: string | undefined): string {
  const label = kind === 'select' ? 'select (analyze select-agent)' : 'generate (generate components)';
  return `Custom ${label} prompt path${current ? ` [${current}]` : ' [none]'} (empty=keep, "-"=clear): `;
}

/** Apply a parsed answer to the credentials, clearing the field on `null`. */
export function applyCustomSkillPath(
  credentials: ExperiencesCredentials,
  kind: SkillPromptKind,
  parsed: string | undefined | null,
): ExperiencesCredentials {
  const field = kind === 'select' ? 'selectPromptPath' : 'generatePromptPath';
  const next = { ...credentials };
  if (parsed === null) delete next[field];
  else if (parsed !== undefined) next[field] = parsed;
  return next;
}

type Phase = 'confirm' | 'select' | 'generate';

export function CustomPromptsScreen({ onDone }: { onDone: StepDone }): React.ReactElement {
  const [stored, setStored] = useState<ExperiencesCredentials | null>(null);
  const [phase, setPhase] = useState<Phase>('confirm');
  // The inputs' callbacks close over the render that mounted them, so the
  // in-progress credentials live in a ref rather than in state.
  const draftRef = useRef<ExperiencesCredentials | null>(null);

  useEffect(() => {
    void readExperiencesCredentials().then((credentials) => {
      setStored(credentials);
      draftRef.current = credentials;
    });
  }, []);

  if (!stored) return <Text dimColor>Reading saved prompt paths…</Text>;

  const submit = (kind: SkillPromptKind, answer: string): void => {
    draftRef.current = applyCustomSkillPath(draftRef.current ?? stored, kind, parseCustomSkillPath(answer));
    if (kind === 'select') {
      setPhase('generate');
      return;
    }
    void writeExperiencesCredentials(draftRef.current).then(() => onDone('completed'));
  };

  if (phase === 'confirm') {
    return (
      <StepLayout
        help={CUSTOM_PROMPTS_HELP}
        prompt={
          <Box>
            <Text>Use your own prompt files instead of the built-in ones? </Text>
            <ConfirmInput
              defaultChoice="cancel"
              onConfirm={() => setPhase('select')}
              onCancel={() => onDone('skipped')}
            />
          </Box>
        }
      >
        {null}
      </StepLayout>
    );
  }

  const current = phase === 'select' ? stored.selectPromptPath : stored.generatePromptPath;

  return (
    <StepLayout
      help={CUSTOM_PROMPTS_HELP}
      prompt={
        <Box>
          <Text>{customSkillPathQuestion(phase, current)}</Text>
          <TextInput key={phase} onSubmit={(value) => submit(phase, value)} />
        </Box>
      }
    >
      {null}
    </StepLayout>
  );
}
