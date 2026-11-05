import { describe, expect, it } from 'vitest';
import type { GenerateComponentsProgress } from '@contentful/experience-design-system-backend-pipeline';
import {
  applyActivityEvent,
  generationLogOutputs,
  initialProgress,
} from '../../../src/tui/import/steps/08-generation/logic.js';
import type { ActivityItem } from '../../../src/tui/import/shared/running-step/activity.js';

const started = (name: string, attempt = 1): GenerateComponentsProgress => ({
  kind: 'component:started',
  index: 0,
  total: 3,
  name,
  attempt,
  maxAttempts: 2,
});
const completed = (name: string): GenerateComponentsProgress => ({
  kind: 'component:completed',
  index: 0,
  total: 3,
  name,
  classified: 1,
  excluded: 0,
  slots: 0,
  warnings: [],
});
const failedEvent = (name: string, error: string): GenerateComponentsProgress => ({
  kind: 'component:failed',
  index: 0,
  total: 3,
  name,
  error,
});

describe('the generation activity', () => {
  it('follows a component from running to done, with how long it took', () => {
    const afterStart = applyActivityEvent(started('Button'), [], 1000);
    const afterDone = applyActivityEvent(completed('Button'), afterStart, 13000);

    expect(afterStart).toEqual([{ name: 'Button', state: 'running', startedAt: 1000 }]);
    expect(afterDone).toEqual([{ name: 'Button', state: 'done', ms: 12000, startedAt: 1000 }]);
  });

  it('lists components that run side by side, each in the order it began', () => {
    let items: ActivityItem[] = [];
    items = applyActivityEvent(started('Button'), items, 0);
    items = applyActivityEvent(started('Card'), items, 100);
    items = applyActivityEvent(completed('Card'), items, 5000);

    expect(items.map((item) => [item.name, item.state])).toEqual([
      ['Button', 'running'],
      ['Card', 'done'],
    ]);
  });

  it('records why a component failed', () => {
    const items = applyActivityEvent(failedEvent('Hero', 'timed out after 2 minutes'), [], 9000);

    expect(items).toEqual([
      { name: 'Hero', state: 'failed', error: 'timed out after 2 minutes', ms: 0, startedAt: 9000 },
    ]);
  });

  it('keeps one entry for a component that is started again for a retry, and marks it done if the retry works', () => {
    let items = applyActivityEvent(started('Tabs'), [], 0);
    items = applyActivityEvent(started('Tabs', 2), items, 4000);
    items = applyActivityEvent(completed('Tabs'), items, 9000);

    expect(items).toEqual([{ name: 'Tabs', state: 'done', ms: 9000, startedAt: 0 }]);
  });
});

// The log says which components failed and why, and does not carry the whole list the panel shows.
describe('the generation log', () => {
  const progress = (activity: ActivityItem[]) => ({ ...initialProgress(), activity });

  it('lists the failed components with their reasons, capped, and leaves out the rest of the activity', () => {
    const activity: ActivityItem[] = [
      { name: 'Button', state: 'done' },
      ...Array.from(
        { length: 12 },
        (_, i): ActivityItem => ({ name: `Bad${i}`, state: 'failed', error: 'x'.repeat(400) }),
      ),
    ];

    const { outputs } = generationLogOutputs(
      { ok: false, step: 'generate components', message: 'boom' },
      progress(activity),
    );

    const failed = outputs['failed_components'] as Array<{ name: string; error: string }>;
    expect(failed).toHaveLength(10);
    expect(failed[0]!.error.length).toBeLessThanOrEqual(300);
    expect(outputs['final_progress']).not.toHaveProperty('activity');
  });

  it('adds nothing about failures when none failed', () => {
    const { outputs } = generationLogOutputs(
      { ok: true, generation: { route: 'push', acceptedCount: 0 } },
      progress([{ name: 'Button', state: 'done' }]),
    );

    expect(outputs).not.toHaveProperty('failed_components');
  });
});
