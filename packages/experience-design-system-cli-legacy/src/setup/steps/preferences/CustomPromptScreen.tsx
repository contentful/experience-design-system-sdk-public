import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { ConfirmInput, TextInput } from '@inkjs/ui';
import {
  readExperiencesCredentials,
  writeExperiencesCredentials,
  type ExperiencesCredentials,
} from '../../../credentials-store.js';
import { StepLayout, type StepDone } from '../StepLayout.js';
import { PALETTE } from '../../../analyze/select/tui/theme.js';

const CUSTOM_PROMPTS_HELP = 'Replaces the built-in instructions the coding agent follows when it generates components.';

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

export function customSkillPathQuestion(current: string | undefined): string {
  return `Custom generate (generate components) prompt path${current ? ` [${current}]` : ' [none]'} (empty=keep, "-"=clear): `;
}

/** Apply a parsed answer to the credentials, clearing the field on `null`. */
export function applyCustomSkillPath(
  credentials: ExperiencesCredentials,
  parsed: string | undefined | null,
): ExperiencesCredentials {
  const next = { ...credentials };
  if (parsed === null) delete next.generatePromptPath;
  else if (parsed !== undefined) next.generatePromptPath = parsed;
  return next;
}

type Phase = 'confirm' | 'generate';

export function CustomPromptsScreen({ onDone }: { onDone: StepDone }): React.ReactElement {
  const [stored, setStored] = useState<ExperiencesCredentials | null>(null);
  const [phase, setPhase] = useState<Phase>('confirm');

  useEffect(() => {
    void readExperiencesCredentials().then(setStored);
  }, []);

  if (!stored) return <Text color={PALETTE.muted}>Reading saved prompt paths…</Text>;

  const submit = (answer: string): void => {
    const next = applyCustomSkillPath(stored, parseCustomSkillPath(answer));
    void writeExperiencesCredentials(next).then(() => onDone('completed'));
  };

  if (phase === 'confirm') {
    return (
      <StepLayout
        helpText={CUSTOM_PROMPTS_HELP}
        prompt={
          <Box>
            <Text>Use your own prompt file instead of the built-in one? </Text>
            <ConfirmInput
              defaultChoice="cancel"
              onConfirm={() => setPhase('generate')}
              onCancel={() => onDone('skipped')}
            />
          </Box>
        }
      />
    );
  }

  return (
    <StepLayout
      helpText={CUSTOM_PROMPTS_HELP}
      prompt={
        <Box>
          <Text>{customSkillPathQuestion(stored.generatePromptPath)}</Text>
          <TextInput onSubmit={submit} />
        </Box>
      }
    />
  );
}
