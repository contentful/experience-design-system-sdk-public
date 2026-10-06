import { describe, expect, it } from 'vitest';
import type { RawPropDefinition, RawSlotDefinition } from '../../../src/extract/types/component.js';
import {
  isHandlerOrRefProp,
  hasNoPropsAndNoSlots,
  isContextProviderWithValueProp,
  isHardwiredContextProvider,
  isSingleDataPropContextWrapper,
  hasOnlyEventHandlers,
} from '../../../src/extract/services/quality/helpers/authorability/evaluate-authorability.js';

function prop(overrides: Partial<RawPropDefinition> = {}): RawPropDefinition {
  return { name: 'label', type: 'string', required: false, ...overrides };
}

function slot(overrides: Partial<RawSlotDefinition> = {}): RawSlotDefinition {
  return { name: 'children', isDefault: true, ...overrides };
}

describe('isHandlerOrRefProp', () => {
  it('detects arrow-function types as handlers', () => {
    expect(isHandlerOrRefProp(prop({ type: '() => void' }))).toBe(true);
  });

  it('detects EventHandler types', () => {
    expect(isHandlerOrRefProp(prop({ type: 'MouseEventHandler<HTMLButtonElement>' }))).toBe(true);
  });

  it('detects Dispatch<SetStateAction<T>> types', () => {
    expect(isHandlerOrRefProp(prop({ type: 'Dispatch<SetStateAction<number>>' }))).toBe(true);
  });

  it('detects onX-prefixed names as handlers', () => {
    expect(isHandlerOrRefProp(prop({ name: 'onClick', type: 'string' }))).toBe(true);
  });

  it('detects setX-prefixed names as state setters', () => {
    expect(isHandlerOrRefProp(prop({ name: 'setCount', type: 'string' }))).toBe(true);
  });

  it('detects ref and innerRef names as refs', () => {
    expect(isHandlerOrRefProp(prop({ name: 'ref', type: 'any' }))).toBe(true);
    expect(isHandlerOrRefProp(prop({ name: 'innerRef', type: 'any' }))).toBe(true);
  });

  it('detects RefObject and MutableRefObject types as refs', () => {
    expect(isHandlerOrRefProp(prop({ type: 'RefObject<HTMLDivElement>' }))).toBe(true);
    expect(isHandlerOrRefProp(prop({ type: 'MutableRefObject<HTMLInputElement>' }))).toBe(true);
  });

  it('does not flag plain string or number props', () => {
    expect(isHandlerOrRefProp(prop({ name: 'label', type: 'string' }))).toBe(false);
    expect(isHandlerOrRefProp(prop({ name: 'count', type: 'number' }))).toBe(false);
  });
});

describe('hasNoPropsAndNoSlots', () => {
  it('returns true when both arrays are empty', () => {
    expect(hasNoPropsAndNoSlots([], [])).toBe(true);
  });

  it('returns false when there are props', () => {
    expect(hasNoPropsAndNoSlots([prop()], [])).toBe(false);
  });

  it('returns false when there are slots', () => {
    expect(hasNoPropsAndNoSlots([], [slot()])).toBe(false);
  });
});

describe('isContextProviderWithValueProp', () => {
  it('returns true when source uses createContext and a prop named value exists', () => {
    expect(isContextProviderWithValueProp([prop({ name: 'value', type: 'string' })], true)).toBe(true);
  });

  it('returns false when source does not use createContext', () => {
    expect(isContextProviderWithValueProp([prop({ name: 'value', type: 'string' })], false)).toBe(false);
  });

  it('returns false when usesCreateContext is undefined', () => {
    expect(isContextProviderWithValueProp([prop({ name: 'value', type: 'string' })], undefined)).toBe(false);
  });

  it('returns false when no prop is named value', () => {
    expect(isContextProviderWithValueProp([prop({ name: 'label', type: 'string' })], true)).toBe(false);
  });
});

describe('isHardwiredContextProvider', () => {
  it('returns true when source uses createContext and props are empty', () => {
    expect(isHardwiredContextProvider([], true)).toBe(true);
  });

  it('returns false when source does not use createContext', () => {
    expect(isHardwiredContextProvider([], false)).toBe(false);
  });

  it('returns false when there are props', () => {
    expect(isHardwiredContextProvider([prop()], true)).toBe(false);
  });
});

describe('isSingleDataPropContextWrapper', () => {
  it('returns true for a createContext source with one non-handler prop', () => {
    expect(isSingleDataPropContextWrapper([prop({ name: 'locale', type: 'Locale' })], true)).toBe(true);
  });

  it('returns false when the single prop is a handler', () => {
    expect(
      isSingleDataPropContextWrapper([prop({ name: 'setCount', type: 'Dispatch<SetStateAction<number>>' })], true),
    ).toBe(false);
  });

  it('returns false when there are two props', () => {
    expect(isSingleDataPropContextWrapper([prop({ name: 'locale' }), prop({ name: 'theme' })], true)).toBe(false);
  });

  it('returns false when source does not use createContext', () => {
    expect(isSingleDataPropContextWrapper([prop()], false)).toBe(false);
  });
});

describe('hasOnlyEventHandlers', () => {
  it('returns true when every prop is a handler', () => {
    expect(hasOnlyEventHandlers([prop({ name: 'onReady', type: '() => void' })])).toBe(true);
  });

  it('returns false when at least one prop is not a handler', () => {
    expect(hasOnlyEventHandlers([prop({ name: 'onReady', type: '() => void' }), prop({ name: 'label' })])).toBe(false);
  });

  it('returns false for an empty props array', () => {
    expect(hasOnlyEventHandlers([])).toBe(false);
  });
});
