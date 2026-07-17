import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractReactComponents } from '@contentful/experience-design-system-extraction';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'extract-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeFixture(filename: string, content: string): Promise<string> {
  const filePath = join(tempDir, filename);
  await mkdir(join(filePath, '..'), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

describe('ReactComponentExtractor', () => {
  it('extracts props from TypeScript interface', async () => {
    const filePath = await writeFixture(
      'Button.tsx',
      `
      import React from 'react';

      interface ButtonProps {
        label: string;
        variant?: 'primary' | 'secondary';
        disabled?: boolean;
      }

      export function Button({ label, variant = 'primary', disabled }: ButtonProps) {
        return <button>{label}</button>;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);

    expect(result.components).toHaveLength(1);
    const button = result.components[0];
    expect(button.name).toBe('Button');
    expect(button.framework).toBe('react');

    const labelProp = button.props.find((p) => p.name === 'label');
    expect(labelProp).toBeDefined();
    expect(labelProp!.type).toBe('string');
    expect(labelProp!.required).toBe(true);

    const variantProp = button.props.find((p) => p.name === 'variant');
    expect(variantProp).toBeDefined();
    expect(variantProp!.required).toBe(false);
    expect(variantProp!.allowedValues).toEqual(['primary', 'secondary']);
    expect(variantProp!.defaultValue).toBe('primary');
  });

  it('treats defaulted destructured props as not required even when the type marks them required', async () => {
    const filePath = await writeFixture(
      'GridLayout.tsx',
      `
      import React from 'react';

      type Props = {
        visualizeGrid: boolean;
      };

      export const GridLayout = ({ visualizeGrid = true }: Props) => {
        return <div>{visualizeGrid ? 'on' : 'off'}</div>;
      };
    `,
    );

    const result = await extractReactComponents([filePath]);
    const gridLayout = result.components[0];
    const visualizeGridProp = gridLayout.props.find((p) => p.name === 'visualizeGrid');

    expect(visualizeGridProp).toBeDefined();
    expect(visualizeGridProp!.required).toBe(false);
    expect(visualizeGridProp!.defaultValue).toBe('true');
  });

  it('treats falsy destructured defaults as optional and preserves their default values', async () => {
    const filePath = await writeFixture(
      'Avatar.tsx',
      `
      import React from 'react';

      interface AvatarProps {
        alt: string;
        disabled: boolean;
        count: number;
      }

      export const Avatar = ({
        alt = '',
        disabled = false,
        count = 0,
      }: AvatarProps) => {
        return <div>{alt}{String(disabled)}{count}</div>;
      };
    `,
    );

    const result = await extractReactComponents([filePath]);
    const avatar = result.components[0];

    expect(avatar.props.find((p) => p.name === 'alt')).toEqual(
      expect.objectContaining({ required: false, defaultValue: '' }),
    );
    expect(avatar.props.find((p) => p.name === 'disabled')).toEqual(
      expect.objectContaining({ required: false, defaultValue: 'false' }),
    );
    expect(avatar.props.find((p) => p.name === 'count')).toEqual(
      expect.objectContaining({ required: false, defaultValue: '0' }),
    );
  });

  it('extracts defaults from props destructured inside the function body', async () => {
    const filePath = await writeFixture(
      'InitColorSchemeScript.tsx',
      `
      import React from 'react';

      const defaultConfig = {
        attribute: 'data-mui-color-scheme',
      } as const;

      interface InitColorSchemeScriptProps {
        attribute?: string;
        defaultMode?: 'system' | 'light' | 'dark';
        nonce?: string;
      }

      export function InitColorSchemeScript(props: InitColorSchemeScriptProps) {
        const {
          defaultMode = 'system',
          attribute: initialAttribute = defaultConfig.attribute,
          nonce,
        } = props;

        return <script data-attribute={initialAttribute} nonce={nonce} data-mode={defaultMode} />;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const script = result.components[0];

    expect(script.props.find((p) => p.name === 'defaultMode')).toEqual(
      expect.objectContaining({ required: false, defaultValue: 'system' }),
    );
    expect(script.props.find((p) => p.name === 'attribute')).toEqual(
      expect.objectContaining({
        required: false,
        defaultValue: 'defaultConfig.attribute',
      }),
    );
  });

  it('extracts children as default slot', async () => {
    const filePath = await writeFixture(
      'Card.tsx',
      `
      import React from 'react';
      export function Card({ children }: { children: React.ReactNode }) {
        return <div>{children}</div>;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const card = result.components[0];
    expect(card.slots).toContainEqual({ name: 'children', isDefault: true });
    expect(card.props.find((p) => p.name === 'children')).toBeUndefined();
  });

  it('preserves the default slot for React.FC wrappers with identifier props', async () => {
    const filePath = await writeFixture(
      'FormProvider.tsx',
      `
      import React from 'react';

      interface FormProviderProps {
        prefixCls?: string;
      }

      export const FormProvider: React.FC<FormProviderProps> = (props) => {
        return <section data-prefix={props.prefixCls}>{props.children}</section>;
      };
    `,
    );

    const result = await extractReactComponents([filePath]);
    const provider = result.components[0];

    expect(provider.name).toBe('FormProvider');
    expect(provider.props.find((p) => p.name === 'prefixCls')).toBeDefined();
    expect(provider.slots).toContainEqual({ name: 'children', isDefault: true });
  });

  it('preserves the default slot when opaque props are forwarded through JSX spread', async () => {
    const filePath = await writeFixture(
      'CssVarsProvider.tsx',
      `
      import React from 'react';

      function InternalProvider(props: any) {
        return <div>{props.children}</div>;
      }

      export function CssVarsProvider(props: any) {
        return <InternalProvider {...props} />;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const provider = result.components.find((component) => component.name === 'CssVarsProvider');

    expect(provider).toBeDefined();
    expect(provider!.props).toEqual([]);
    expect(provider!.slots).toContainEqual({
      name: 'children',
      isDefault: true,
    });
  });

  it('detects render props as named slots', async () => {
    const filePath = await writeFixture(
      'DataTable.tsx',
      `
      import React from 'react';
      interface DataTableProps {
        renderHeader: (data: any) => React.ReactNode;
        renderFooter: () => JSX.Element;
      }
      export function DataTable({ renderHeader, renderFooter }: DataTableProps) {
        return <div>{renderHeader({})}{renderFooter()}</div>;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const table = result.components[0];
    expect(table.slots).toContainEqual({ name: 'header', isDefault: false });
    expect(table.slots).toContainEqual({ name: 'footer', isDefault: false });
    expect(table.props.find((p) => p.name === 'renderHeader')).toBeUndefined();
    expect(table.props.find((p) => p.name === 'renderFooter')).toBeUndefined();
  });

  it('handles arrow function exports', async () => {
    const filePath = await writeFixture(
      'Badge.tsx',
      `
      import React from 'react';
      export const Badge = ({ text }: { text: string }) => <span>{text}</span>;
    `,
    );

    const result = await extractReactComponents([filePath]);
    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe('Badge');
  });

  it('ignores Vue TSX component exports', async () => {
    const filePath = await writeFixture(
      'VBanner.tsx',
      `
      function propsFactory<T extends Record<string, unknown>>(props: T, _name: string) {
        return () => props;
      }

      function genericComponent<T = unknown>(_exposeDefaults?: boolean) {
        return (options: {
          name?: string;
          props?: unknown;
          setup?: (props: unknown, context: { slots: T }) => unknown;
        }) => options;
      }

      export const makeVBannerProps = propsFactory({
        title: String,
      }, 'VBanner');

      export const VBanner = genericComponent<{ default: never }>()({
        name: 'VBanner',
        props: makeVBannerProps(),
        setup (_props, { slots }) {
          return () => slots.default?.();
        },
      });
    `,
    );

    const result = await extractReactComponents([filePath]);

    expect(result.components).toEqual([]);
  });

  it('extracts factory-returned React component exports', async () => {
    const filePath = await writeFixture(
      'Slot.tsx',
      `
      import React from 'react';

      interface SlotProps extends React.HTMLAttributes<HTMLElement> {
        children?: React.ReactNode;
      }

      function createSlot(ownerName: string) {
        const Slot = React.forwardRef<HTMLElement, SlotProps>((props, forwardedRef) => {
          return <div ref={ forwardedRef }>{props.children}{ownerName}</div>;
        });

        Slot.displayName = ownerName;
        return Slot;
      }

      const Slot = createSlot('Slot');

      export { Slot };
    `,
    );

    const result = await extractReactComponents([filePath]);
    const slot = result.components.find((component) => component.name === 'Slot');

    expect(slot).toBeDefined();
    expect(slot?.framework).toBe('react');
    expect(slot?.props).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'className' }),
        expect.objectContaining({ name: 'hidden' }),
        expect.objectContaining({ name: 'id' }),
      ]),
    );
    expect(slot?.slots).toContainEqual({ name: 'children', isDefault: true });
  });

  it('ignores non-component exports', async () => {
    const filePath = await writeFixture(
      'utils.tsx',
      `
      export function useTheme() { return {}; }
      export const formatDate = (d: Date) => d.toISOString();
      export type ButtonVariant = 'primary' | 'secondary';
    `,
    );

    const result = await extractReactComponents([filePath]);
    expect(result.components).toHaveLength(0);
  });

  it('skips Stencil component files', async () => {
    const filePath = await writeFixture(
      'spinner.tsx',
      `
      import { Component, Prop, h, type JSX } from '@stencil/core';

      @Component({ tag: 'p-spinner', shadow: true })
      export class Spinner {
        @Prop() public size?: string = 'small';
        @Prop() public theme?: string = 'light';

        public render(): JSX.Element {
          return <span class="root"></span>;
        }
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    expect(result.components).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('skips Stencil functional component files', async () => {
    const filePath = await writeFixture(
      'loading-message.tsx',
      `
      import { type FunctionalComponent, h } from '@stencil/core';

      type LoadingMessageProps = { loading: boolean; initialLoading: boolean };

      export const LoadingMessage: FunctionalComponent<LoadingMessageProps> = ({ loading, initialLoading }) => {
        return <span>{loading ? 'Loading' : initialLoading ? 'Done' : ''}</span>;
      };
    `,
    );

    const result = await extractReactComponents([filePath]);
    expect(result.components).toHaveLength(0);
  });

  it('identifies Next.js page components', async () => {
    const filePath = await writeFixture(
      'page.tsx',
      `
      export function generateMetadata() { return { title: 'Home' }; }
      export default function HomePage({ params }: { params: { slug: string } }) {
        return <div>{params.slug}</div>;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const page = result.components.find((c) => c.name === 'HomePage');
    expect(page?.framework).toBe('next');
  });

  it('extracts props from PropTypes assignment', async () => {
    const filePath = await writeFixture(
      'LegacyButton.jsx',
      `
      import React from 'react';
      import PropTypes from 'prop-types';

      export function LegacyButton({ label, variant, disabled }) {
        return <button disabled={disabled}>{label}</button>;
      }

      LegacyButton.propTypes = {
        label: PropTypes.string.isRequired,
        variant: PropTypes.oneOf(['primary', 'secondary']),
        disabled: PropTypes.bool,
        onClick: PropTypes.func,
      };
    `,
    );

    const result = await extractReactComponents([filePath]);
    expect(result.components).toHaveLength(1);
    const button = result.components[0];

    const labelProp = button.props.find((p) => p.name === 'label');
    expect(labelProp).toBeDefined();
    expect(labelProp!.type).toBe('string');
    expect(labelProp!.required).toBe(true);

    const variantProp = button.props.find((p) => p.name === 'variant');
    expect(variantProp).toBeDefined();
    expect(variantProp!.allowedValues).toEqual(['primary', 'secondary']);
    expect(variantProp!.required).toBe(false);

    const disabledProp = button.props.find((p) => p.name === 'disabled');
    expect(disabledProp!.type).toBe('boolean');
  });

  it('extracts props from forwardRef exports and unwraps ExpandProps wrappers', async () => {
    const wrapperTypePath = await writeFixture(
      'core.ts',
      `
      export type ExpandProps<T> = T & {
        testId?: string;
      };
    `,
    );

    const filePath = await writeFixture(
      'CheckboxGroup.tsx',
      `
      import React from 'react';
      import type { ExpandProps } from './core';

      interface CheckboxGroupProps {
        children: React.ReactNode;
        name?: string;
        type: 'checkbox' | 'radio';
      }

      const CheckboxGroupBase = (
        props: ExpandProps<CheckboxGroupProps>,
        ref: React.Ref<HTMLDivElement>,
      ) => {
        const { children } = props;
        return <div ref={ref}>{children}</div>;
      };

      export const CheckboxGroup = React.forwardRef(CheckboxGroupBase);
    `,
    );

    const result = await extractReactComponents([filePath, wrapperTypePath]);
    const group = result.components.find((component) => component.name === 'CheckboxGroup');

    expect(group).toBeDefined();
    expect(group!.props.find((p) => p.name === 'name')?.type).toBe('string');
    expect(group!.props.find((p) => p.name === 'type')?.allowedValues).toEqual(['checkbox', 'radio']);
    expect(group!.props.find((p) => p.name === 'testId')).toBeUndefined();
    expect(group!.slots).toContainEqual({ name: 'children', isDefault: true });
  });

  it('recovers named interface DOM props from forwardRef generic type arguments', async () => {
    const filePath = await writeFixture(
      'Badge.tsx',
      `
      import React, { forwardRef, type HTMLAttributes } from 'react';

      interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
        variant?: 'neutral' | 'success';
      }

      export const Badge = forwardRef<HTMLDivElement, BadgeProps>(({ className, id, variant }, ref) => {
        return (
          <div ref={ref} className={className} id={id} data-variant={variant} />
        );
      });
    `,
    );

    const result = await extractReactComponents([filePath]);
    const badge = result.components[0];

    expect(badge.name).toBe('Badge');
    expect(badge.props.find((p) => p.name === 'className')).toBeDefined();
    expect(badge.props.find((p) => p.name === 'id')).toBeDefined();
    expect(badge.props.find((p) => p.name === 'variant')?.allowedValues).toEqual(['neutral', 'success']);
  });

  it('recovers LiHTMLAttributes props from forwardRef generic type arguments', async () => {
    const filePath = await writeFixture(
      'ListItem.tsx',
      `
      import React, { forwardRef, type LiHTMLAttributes } from 'react';

      export const ListItem = forwardRef<HTMLLIElement, LiHTMLAttributes<HTMLLIElement>>(
        ({ className, id, ...props }, ref) => {
          return <li ref={ref} className={className} id={id} {...props} />;
        },
      );
    `,
    );

    const result = await extractReactComponents([filePath]);
    const listItem = result.components[0];

    expect(listItem.name).toBe('ListItem');
    expect(listItem.props.find((p) => p.name === 'className')).toBeDefined();
    expect(listItem.props.find((p) => p.name === 'id')).toBeDefined();
    expect(listItem.props.find((p) => p.name === 'title')).toBeDefined();
  });

  it('recovers LiHTMLAttributes props from forwardRef generic type arguments with non-type imports', async () => {
    const filePath = await writeFixture(
      'DropIndicator.tsx',
      `
      import React, { forwardRef, LiHTMLAttributes } from 'react';

      const StyledDropIndicator = (_props: LiHTMLAttributes<HTMLLIElement>) => null;
      const useDraggableListContext = () => ({ isHorizontal: true });

      export const DropIndicator = forwardRef<HTMLLIElement, LiHTMLAttributes<HTMLLIElement>>(
        (props, ref) => {
          const { isHorizontal } = useDraggableListContext();

          return <StyledDropIndicator {...props} data-horizontal={String(isHorizontal)} ref={ref} />;
        }
      );
      `,
    );

    const result = await extractReactComponents([filePath]);
    const dropIndicator = result.components[0];

    expect(dropIndicator.name).toBe('DropIndicator');
    expect(dropIndicator.props.find((p) => p.name === 'className')).toBeDefined();
    expect(dropIndicator.props.find((p) => p.name === 'id')).toBeDefined();
    expect(dropIndicator.props.find((p) => p.name === 'title')).toBeDefined();
  });

  it('recovers FieldsetHTMLAttributes props from forwardRef generic type arguments', async () => {
    const filePath = await writeFixture(
      'FieldSet.tsx',
      `
      import React, { forwardRef, type FieldsetHTMLAttributes } from 'react';

      type FieldSetProps = FieldsetHTMLAttributes<HTMLFieldSetElement>;

      export const FieldSet = forwardRef<HTMLFieldSetElement, FieldSetProps>(
        ({ className, ...props }, ref) => {
          return <fieldset {...props} ref={ref} className={className} />;
        },
      );
      `,
    );

    const result = await extractReactComponents([filePath]);
    const fieldSet = result.components[0];

    expect(fieldSet.name).toBe('FieldSet');
    expect(fieldSet.props.find((p) => p.name === 'className')).toBeDefined();
    expect(fieldSet.props.find((p) => p.name === 'id')).toBeDefined();
    expect(fieldSet.props.find((p) => p.name === 'title')).toBeDefined();
  });

  it('recovers DOM props for scoped forwardRef wrappers around primitive children', async () => {
    const filePath = await writeFixture(
      'FormParts.tsx',
      `
      import React from 'react';

      type ScopedProps<P> = P & { __scopeForm?: string };

      const Primitive = {
        button: 'button',
        input: 'input',
      } as const;

      type PrimitiveInputProps = React.ComponentPropsWithoutRef<typeof Primitive.input>;
      interface FormControlProps extends PrimitiveInputProps {}

      export const FormControl = React.forwardRef<HTMLInputElement, FormControlProps>(
        (props: ScopedProps<FormControlProps>, forwardedRef) => {
          const { __scopeForm, ...controlProps } = props;
          return <Primitive.input {...controlProps} ref={forwardedRef} data-scope={__scopeForm} />;
        },
      );

      type PrimitiveButtonProps = React.ComponentPropsWithoutRef<typeof Primitive.button>;
      interface FormSubmitProps extends PrimitiveButtonProps {}

      export const FormSubmit = React.forwardRef<HTMLButtonElement, FormSubmitProps>(
        (props: ScopedProps<FormSubmitProps>, forwardedRef) => {
          const { __scopeForm, ...submitProps } = props;
          return <Primitive.button type="submit" {...submitProps} ref={forwardedRef} data-scope={__scopeForm} />;
        },
      );
      `,
    );

    const result = await extractReactComponents([filePath]);
    const formControl = result.components.find((component) => component.name === 'FormControl');
    const formSubmit = result.components.find((component) => component.name === 'FormSubmit');

    expect(formControl).toBeDefined();
    expect(formControl!.props.find((p) => p.name === 'className')).toBeDefined();
    expect(formControl!.props.find((p) => p.name === 'id')).toBeDefined();
    expect(formControl!.props.find((p) => p.name === 'name')).toBeDefined();
    expect(formControl!.props.find((p) => p.name === '__scopeForm')).toBeUndefined();

    expect(formSubmit).toBeDefined();
    expect(formSubmit!.props.find((p) => p.name === 'className')).toBeDefined();
    expect(formSubmit!.props.find((p) => p.name === 'id')).toBeDefined();
    expect(formSubmit!.props.find((p) => p.name === 'title')).toBeDefined();
    expect(formSubmit!.props.find((p) => p.name === '__scopeForm')).toBeUndefined();
  });

  it('recovers DOM props for scoped forwardRef wrappers with destructured rest params', async () => {
    const filePath = await writeFixture(
      'CheckboxParts.tsx',
      `
      import React from 'react';

      type ScopedProps<P> = P & { __scopeCheckbox?: string };

      const Primitive = {
        button: 'button',
        input: 'input',
      } as const;

      interface CheckboxProviderProps {
        checked?: boolean;
        defaultChecked?: boolean;
        required?: boolean;
        name?: string;
        form?: string;
        disabled?: boolean;
        value?: string;
      }

      interface CheckboxTriggerProps
        extends Omit<React.ComponentPropsWithoutRef<typeof Primitive.button>, keyof CheckboxProviderProps> {
        children?: React.ReactNode;
      }

      export const CheckboxTrigger = React.forwardRef<HTMLButtonElement, CheckboxTriggerProps>(
        ({ __scopeCheckbox, onClick, ...checkboxProps }: ScopedProps<CheckboxTriggerProps>, forwardedRef) => {
          return (
            <Primitive.button
              type="button"
              {...checkboxProps}
              ref={forwardedRef}
              data-scope={__scopeCheckbox}
              onClick={onClick}
            />
          );
        },
      );

      type InputProps = React.ComponentPropsWithoutRef<typeof Primitive.input>;
      interface CheckboxBubbleInputProps extends Omit<InputProps, 'checked'> {}

      export const CheckboxBubbleInput = React.forwardRef<HTMLInputElement, CheckboxBubbleInputProps>(
        ({ __scopeCheckbox, ...props }: ScopedProps<CheckboxBubbleInputProps>, forwardedRef) => {
          return <Primitive.input {...props} ref={forwardedRef} data-scope={__scopeCheckbox} />;
        },
      );
      `,
    );

    const result = await extractReactComponents([filePath]);
    const trigger = result.components.find((component) => component.name === 'CheckboxTrigger');
    const bubbleInput = result.components.find((component) => component.name === 'CheckboxBubbleInput');

    expect(trigger).toBeDefined();
    expect(trigger!.props.find((p) => p.name === 'className')).toBeDefined();
    expect(trigger!.props.find((p) => p.name === 'id')).toBeDefined();
    expect(trigger!.props.find((p) => p.name === 'onClick')).toBeDefined();
    expect(trigger!.props.find((p) => p.name === '__scopeCheckbox')).toBeUndefined();

    expect(bubbleInput).toBeDefined();
    expect(bubbleInput!.props.find((p) => p.name === 'className')).toBeDefined();
    expect(bubbleInput!.props.find((p) => p.name === 'id')).toBeDefined();
    expect(bubbleInput!.props.find((p) => p.name === 'disabled')).toBeDefined();
    expect(bubbleInput!.props.find((p) => p.name === '__scopeCheckbox')).toBeUndefined();
  });

  it('recovers DOM props for scoped forwardRef wrappers around imported label primitives', async () => {
    const primitivePath = await writeFixture(
      'label-primitive.tsx',
      `
      import React from 'react';

      export const LabelPrimitive = React.forwardRef<
        HTMLLabelElement,
        React.ComponentPropsWithoutRef<'label'>
      >((props, forwardedRef) => {
        return <label {...props} ref={forwardedRef} />;
      });
      `,
    );
    const filePath = await writeFixture(
      'FormLabel.tsx',
      `
      import React from 'react';
      import { LabelPrimitive } from '${primitivePath.replace(/\\/g, '\\\\')}';

      type ScopedProps<P> = P & { __scopeForm?: string };

      type FormLabelElement = React.ComponentRef<typeof LabelPrimitive>;
      type LabelProps = React.ComponentPropsWithoutRef<typeof LabelPrimitive>;
      interface FormLabelProps extends LabelProps {}

      export const FormLabel = React.forwardRef<FormLabelElement, FormLabelProps>(
        (props: ScopedProps<FormLabelProps>, forwardedRef) => {
          const { __scopeForm, ...labelProps } = props;
          const htmlFor = labelProps.htmlFor ?? 'field';

          return (
            <LabelPrimitive
              data-scope={__scopeForm}
              {...labelProps}
              ref={forwardedRef}
              htmlFor={htmlFor}
            />
          );
        },
      );
      `,
    );

    const result = await extractReactComponents([filePath, primitivePath]);
    const formLabel = result.components.find((component) => component.name === 'FormLabel');

    expect(formLabel).toBeDefined();
    expect(formLabel!.props.find((p) => p.name === 'className')).toBeDefined();
    expect(formLabel!.props.find((p) => p.name === 'htmlFor')).toBeDefined();
    expect(formLabel!.props.find((p) => p.name === 'id')).toBeDefined();
    expect(formLabel!.props.find((p) => p.name === '__scopeForm')).toBeUndefined();
  });

  it('emits one component for overloaded function exports', async () => {
    const filePath = await writeFixture(
      'ProgressBar.tsx',
      `
      import React from 'react';

      interface BaseProps {
        label: string;
      }

      interface StepProgressProps {
        value?: number;
      }

      interface TimeProgressProps {
        duration?: number;
      }

      export function ProgressBar(props: BaseProps & StepProgressProps): JSX.Element;
      export function ProgressBar(props: BaseProps & TimeProgressProps): JSX.Element;
      export function ProgressBar({ label }: BaseProps & StepProgressProps & TimeProgressProps) {
        return <div>{label}</div>;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe('ProgressBar');
  });

  it('does not duplicate a component when a named export is also re-exported as default', async () => {
    const filePath = await writeFixture(
      'HeaderContainer.tsx',
      `
      import React from 'react';

      export interface HeaderContainerProps {
        title?: string;
      }

      export function HeaderContainer({ title }: HeaderContainerProps) {
        return <header>{title}</header>;
      }

      export default HeaderContainer;
    `,
    );

    const result = await extractReactComponents([filePath]);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe('HeaderContainer');
    expect(result.components[0].props.find((prop) => prop.name === 'title')?.type).toBe('string');
  });

  it('does not emit a second component for barrel re-exports from another source file', async () => {
    const implementationPath = await writeFixture(
      'BulkActionMenu.tsx',
      `
      import React from 'react';

      interface BulkActionMenuProps {
        title: string;
      }

      export function BulkActionMenu({ title }: BulkActionMenuProps) {
        return <div>{title}</div>;
      }
    `,
    );

    const barrelPath = await writeFixture(
      'index.tsx',
      `
      export * from './BulkActionMenu';
    `,
    );

    const result = await extractReactComponents([implementationPath, barrelPath]);

    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toEqual(
      expect.objectContaining({
        name: 'BulkActionMenu',
        source: implementationPath,
      }),
    );
  });

  it('extracts inherited props from imported local type files', async () => {
    const baseTypesPath = await writeFixture(
      'BaseCard.types.ts',
      `
      export type BaseCardProps = {
        title?: string;
        onClick?: () => void;
      };
    `,
    );

    const filePath = await writeFixture(
      'AssetCard.tsx',
      `
      import React from 'react';
      import type { BaseCardProps } from './BaseCard.types';

      interface AssetCardProps extends BaseCardProps {
        children?: React.ReactNode;
        size?: 'small' | 'default';
        src?: string;
      }

      export function AssetCard({ children, title, size = 'default', src }: AssetCardProps) {
        return <div aria-label={title} data-size={size} data-src={src}>{children}</div>;
      }
    `,
    );

    const result = await extractReactComponents([filePath, baseTypesPath]);
    const card = result.components[0];

    expect(card.props.find((p) => p.name === 'title')?.type).toBe('string');
    expect(card.props.find((p) => p.name === 'onClick')?.type).toBe('() => void');
    expect(card.props.find((p) => p.name === 'size')?.allowedValues).toEqual(['default', 'small']);
    expect(card.slots).toContainEqual({ name: 'children', isDefault: true });
  });

  it('covers imported AssetCard-style inherited prop chains', async () => {
    const baseTypesPath = await writeFixture(
      'base-card-internal-props.ts',
      `
      export type BaseCardInternalProps = {
        title?: string;
        actions?: string[];
        isLoading?: boolean;
        withDragHandle?: boolean;
        header?: string;
        padding?: string;
        ref?: never;
      };
    `,
    );

    const assetCardTypesPath = await writeFixture(
      'asset-card-props.ts',
      `
      import type { BaseCardInternalProps } from './base-card-internal-props';

      export type AssetCardBaseProps = Omit<BaseCardInternalProps, 'header' | 'padding' | 'ref'>;
    `,
    );

    const filePath = await writeFixture(
      'AssetCard.tsx',
      `
      import React, { type PropsWithChildren } from 'react';
      import type { AssetCardBaseProps } from './asset-card-props';

      type AssetCardProps = PropsWithChildren<AssetCardBaseProps> & {
        size?: 'small' | 'medium' | 'large';
        src?: string;
        status?: 'draft' | 'published';
        type?: 'file' | 'folder';
      };

      export function AssetCard({ size, src, status, type, title, actions, isLoading, withDragHandle, children }: AssetCardProps) {
        return <div data-size={size} data-src={src} data-status={status} data-type={type} data-title={title} data-loading={isLoading} data-drag={withDragHandle}>{actions?.length}{children}</div>;
      }
    `,
    );

    const result = await extractReactComponents([filePath, assetCardTypesPath, baseTypesPath]);
    const assetCard = result.components[0];

    expect(assetCard.name).toBe('AssetCard');
    expect(assetCard.props.find((p) => p.name === 'header')).toBeUndefined();
    expect(assetCard.props.find((p) => p.name === 'padding')).toBeUndefined();
    expect(assetCard.props.find((p) => p.name === 'ref')).toBeUndefined();
    expect(assetCard.props.find((p) => p.name === 'children')).toBeUndefined();
    expect(assetCard.props.find((p) => p.name === 'size')?.allowedValues).toEqual(['large', 'medium', 'small']);
    expect(assetCard.props.find((p) => p.name === 'status')?.allowedValues).toEqual(['draft', 'published']);
    expect(assetCard.props.find((p) => p.name === 'type')?.allowedValues).toEqual(['file', 'folder']);
    expect(assetCard.props.find((p) => p.name === 'src')).toEqual(
      expect.objectContaining({ type: 'string', required: false }),
    );
    expect(assetCard.props.find((p) => p.name === 'title')).toEqual(
      expect.objectContaining({ type: 'string', required: false }),
    );
    expect(assetCard.props.find((p) => p.name === 'actions')).toEqual(
      expect.objectContaining({ type: 'string[]', required: false }),
    );
    expect(assetCard.props.find((p) => p.name === 'isLoading')).toEqual(
      expect.objectContaining({ type: 'boolean', required: false }),
    );
    expect(assetCard.props.find((p) => p.name === 'withDragHandle')).toEqual(
      expect.objectContaining({ type: 'boolean', required: false }),
    );
  });

  it('covers imported AssetIcon-style inherited prop chains', async () => {
    const baseTypesPath = await writeFixture(
      'generated-icon-props.ts',
      `
      export type GeneratedIconProps = {
        className?: string;
        testId?: string;
        size?: 'small' | 'medium' | 'large';
        illustration?: string;
        ref?: never;
      };
    `,
    );

    const assetIconTypesPath = await writeFixture(
      'asset-icon-props.ts',
      `
      import type { GeneratedIconProps } from './generated-icon-props';

      export type AssetIconBaseProps = Omit<GeneratedIconProps, 'illustration' | 'ref'>;
    `,
    );

    const filePath = await writeFixture(
      'AssetIcon.tsx',
      `
      import React, { type PropsWithChildren } from 'react';
      import type { AssetIconBaseProps } from './asset-icon-props';

      type AssetIconProps = PropsWithChildren<AssetIconBaseProps> & {
        type?: 'asset' | 'icon';
      };

      export function AssetIcon({ type, className, testId, size, children }: AssetIconProps) {
        return <div className={className} data-testid={testId} data-size={size} data-type={type}>{children}</div>;
      }
    `,
    );

    const result = await extractReactComponents([filePath, assetIconTypesPath, baseTypesPath]);
    const assetIcon = result.components[0];

    expect(assetIcon.name).toBe('AssetIcon');
    expect(assetIcon.props.find((p) => p.name === 'illustration')).toBeUndefined();
    expect(assetIcon.props.find((p) => p.name === 'ref')).toBeUndefined();
    expect(assetIcon.props.find((p) => p.name === 'children')).toBeUndefined();
    expect(assetIcon.props.find((p) => p.name === 'type')?.allowedValues).toEqual(['asset', 'icon']);
    expect(assetIcon.props.find((p) => p.name === 'className')).toEqual(
      expect.objectContaining({ type: 'string', required: false }),
    );
    expect(assetIcon.props.find((p) => p.name === 'testId')).toEqual(
      expect.objectContaining({ type: 'string', required: false }),
    );
    expect(assetIcon.props.find((p) => p.name === 'size')?.allowedValues).toEqual(['large', 'medium', 'small']);
  });

  it('recovers omitted props from a package-exported icon type', async () => {
    await writeFixture(
      'packages/icon/package.json',
      `
      {
        "name": "@acme/icon",
        "version": "1.0.0",
        "types": "./dist/index.d.ts",
        "exports": {
          ".": "./dist/index.js"
        }
      }
    `,
    );

    await writeFixture(
      'packages/icon/src/internal-generated-icon-props.ts',
      `
      export type InternalGeneratedIconProps = {
        name?: string;
        viewBox?: string;
        className?: string;
        testId?: string;
        size?: 'small' | 'medium' | 'large';
        illustration?: string;
        ref?: never;
      };
    `,
    );

    await writeFixture(
      'packages/icon/src/index.ts',
      `
      import type { InternalGeneratedIconProps } from './internal-generated-icon-props';

      export type GeneratedIconProps = Omit<InternalGeneratedIconProps, 'name' | 'viewBox'> & {
        type?: 'filled' | 'outline';
      };
    `,
    );

    const filePath = await writeFixture(
      'packages/app/src/PackageIconButton.tsx',
      `
      import React from 'react';
      import type { GeneratedIconProps } from '@acme/icon';

      type PackageIconButtonProps = Omit<GeneratedIconProps, 'illustration' | 'ref'> & {
        type?: 'archive' | 'image';
      };

      export function PackageIconButton({ type, className, testId, size }: PackageIconButtonProps) {
        return <button className={className} data-testid={testId} data-size={size} data-type={type} />;
      }
      `,
    );

    const result = await extractReactComponents([
      filePath,
      join(tempDir, 'packages/icon/src/index.ts'),
      join(tempDir, 'packages/icon/src/internal-generated-icon-props.ts'),
    ]);
    const packageIconButton = result.components[0];

    expect(packageIconButton.name).toBe('PackageIconButton');
    expect(packageIconButton.props.find((p) => p.name === 'type')?.allowedValues).toEqual(['archive', 'image']);
    expect(packageIconButton.props.find((p) => p.name === 'className')).toEqual(
      expect.objectContaining({ type: 'string', required: false }),
    );
    expect(packageIconButton.props.find((p) => p.name === 'testId')).toEqual(
      expect.objectContaining({ type: 'string', required: false }),
    );
    expect(packageIconButton.props.find((p) => p.name === 'size')?.allowedValues).toEqual(['large', 'medium', 'small']);
    expect(packageIconButton.props.find((p) => p.name === 'name')).toBeUndefined();
    expect(packageIconButton.props.find((p) => p.name === 'viewBox')).toBeUndefined();
    expect(packageIconButton.props.find((p) => p.name === 'illustration')).toBeUndefined();
    expect(packageIconButton.props.find((p) => p.name === 'ref')).toBeUndefined();
  });

  it('recovers omitted props through a package-exported mapped omit icon type', async () => {
    await writeFixture(
      'packages/core/package.json',
      `
      {
        "name": "@acme/core",
        "version": "1.0.0",
        "types": "./dist/index.d.ts",
        "exports": {
          ".": "./dist/index.js"
        }
      }
    `,
    );

    await writeFixture(
      'packages/core/src/index.ts',
      `
      export type MappedOmit<T, K extends keyof T> = {
        [P in keyof T as P extends K ? never : P]: T[P];
      };
    `,
    );

    await writeFixture(
      'packages/icon/package.json',
      `
      {
        "name": "@acme/icon",
        "version": "1.0.0",
        "types": "./dist/index.d.ts",
        "exports": {
          ".": "./dist/index.js"
        }
      }
    `,
    );

    await writeFixture(
      'packages/icon/src/internal-generated-icon-props.ts',
      `
      export type IconProps = {
        className?: string;
        testId?: string;
        size?: 'small' | 'medium' | 'large';
        illustration?: string;
        ref?: never;
        name?: string;
        viewBox?: string;
      };
    `,
    );

    await writeFixture(
      'packages/icon/src/index.ts',
      `
      import type { MappedOmit } from '@acme/core';
      import type { IconProps } from './internal-generated-icon-props';

      export type GeneratedIconProps = MappedOmit<IconProps, 'name' | 'viewBox'> & {
        tone?: 'filled' | 'outline';
      };
    `,
    );

    const filePath = await writeFixture(
      'packages/app/src/AssetIcon.tsx',
      `
      import React from 'react';
      import type { GeneratedIconProps } from '@acme/icon';

      type AssetIconProps = Omit<GeneratedIconProps, 'illustration' | 'ref'> & {
        type?: 'asset' | 'icon';
      };

      export function AssetIcon({ type, className, testId, size }: AssetIconProps) {
        return <div className={className} data-testid={testId} data-size={size} data-type={type} />;
      }
      `,
    );

    const result = await extractReactComponents([
      filePath,
      join(tempDir, 'packages/icon/src/index.ts'),
      join(tempDir, 'packages/icon/src/internal-generated-icon-props.ts'),
      join(tempDir, 'packages/core/src/index.ts'),
    ]);
    const assetIcon = result.components[0];

    expect(assetIcon.name).toBe('AssetIcon');
    expect(assetIcon.props.find((p) => p.name === 'type')?.allowedValues).toEqual(['asset', 'icon']);
    expect(assetIcon.props.find((p) => p.name === 'className')).toEqual(
      expect.objectContaining({ type: 'string', required: false }),
    );
    expect(assetIcon.props.find((p) => p.name === 'testId')).toEqual(
      expect.objectContaining({ type: 'string', required: false }),
    );
    expect(assetIcon.props.find((p) => p.name === 'size')?.allowedValues).toEqual(['large', 'medium', 'small']);
    expect(assetIcon.props.find((p) => p.name === 'illustration')).toBeUndefined();
    expect(assetIcon.props.find((p) => p.name === 'ref')).toBeUndefined();
    expect(assetIcon.props.find((p) => p.name === 'name')).toBeUndefined();
    expect(assetIcon.props.find((p) => p.name === 'viewBox')).toBeUndefined();
  });

  it('recovers imported polymorphic chains from the real Primitive alias graph', async () => {
    await writeFixture(
      'packages/core/package.json',
      `
      {
        "name": "@contentful/f36-core",
        "version": "1.0.0",
        "types": "./dist/index.d.ts",
        "exports": {
          ".": "./dist/index.js"
        }
      }
    `,
    );

    await writeFixture(
      'packages/core/src/types.ts',
      `
      export type MappedOmit<T, K extends keyof any> = Omit<T, K>;

      export type CommonProps = {
        className?: string;
        testId?: string;
      };

      export type MarginProps = {
        marginTop?: 'none' | 'tight' | 'regular' | 'loose';
      };

      export type PaddingProps = {
        paddingLeft?: 'none' | 'small' | 'medium' | 'large';
      };
    `,
    );

    await writeFixture(
      'packages/core/src/Primitive/Primitive.tsx',
      `
      import React, { type ElementType } from 'react';

      export type Overwrite<T, U> = Omit<T, keyof U> & U;

      export type PropsWithAs<P, E> = P & { as?: E };

      export type PropsWithHTMLElement<P, E extends ElementType, OmitAdditionalProps> = Overwrite<
        Omit<React.ComponentPropsWithoutRef<E>, OmitAdditionalProps>,
        P
      >;

      export type PolymorphicProps<P, E extends ElementType, OmitAdditionalProps = never> = PropsWithAs<
        PropsWithHTMLElement<P, E, OmitAdditionalProps>,
        E
      >;
    `,
    );

    await writeFixture(
      'packages/core/src/index.ts',
      `
      export type { MappedOmit, CommonProps, MarginProps, PaddingProps } from './types';
      export type { Overwrite, PropsWithAs, PropsWithHTMLElement, PolymorphicProps } from './Primitive/Primitive';
    `,
    );

    await writeFixture(
      'packages/icon/package.json',
      `
      {
        "name": "@contentful/f36-icon",
        "version": "1.0.0",
        "types": "./dist/index.d.ts",
        "exports": {
          ".": "./dist/index.js"
        }
      }
    `,
    );

    await writeFixture(
      'packages/icon/src/types.ts',
      `
      export type IconSize = 'tiny' | 'small' | 'medium';
    `,
    );

    await writeFixture(
      'packages/icon/src/Icon.tsx',
      `
      import type { ReactElement, SVGAttributes, ElementType } from 'react';
      import type { CommonProps, MarginProps, PaddingProps, PolymorphicProps } from '@contentful/f36-core';
      import type { IconSize } from './types';

      export type IconInternalProps = CommonProps &
        MarginProps &
        PaddingProps & {
          children?: ReactElement | ReactElement[];
          color?: string;
          isActive?: boolean;
          size?: IconSize;
          viewBox?: SVGAttributes<SVGSVGElement>['viewBox'];
        };

      const ICON_DEFAULT_TAG = 'svg';

      export type IconProps<E extends ElementType = typeof ICON_DEFAULT_TAG> = PolymorphicProps<
        IconInternalProps,
        E,
        'as' | 'children' | 'width' | 'height'
      >;
    `,
    );

    await writeFixture(
      'packages/icon/src/utils/generateIconComponent.tsx',
      `
      import type { MappedOmit } from '@contentful/f36-core';
      import type { IconProps } from '../Icon';

      export type GeneratedIconProps = MappedOmit<IconProps, 'as' | 'children' | 'name' | 'viewBox'> & {
        children?: never;
        isActive?: boolean;
      };
    `,
    );

    await writeFixture(
      'packages/icon/src/utils/index.ts',
      `
      export type { GeneratedIconProps } from './generateIconComponent';
    `,
    );

    await writeFixture(
      'packages/icon/src/index.ts',
      `
      export * from './utils';
    `,
    );

    const filePath = await writeFixture(
      'packages/app/src/AssetIcon.tsx',
      `
      import React from 'react';
      import type { GeneratedIconProps } from '@contentful/f36-icon';

      export interface AssetIconProps extends Omit<GeneratedIconProps, 'illustration' | 'ref'> {
        type?: 'asset' | 'icon';
      }

      export function AssetIcon({ type, className, testId = 'cf-ui-asset-icon', size, marginTop, ...otherProps }: AssetIconProps) {
        return (
          <div
            className={className}
            data-testid={testId}
            data-size={size}
            data-margin-top={marginTop}
            data-type={type}
            data-other-props={Object.keys(otherProps).length}
          />
        );
      }
      `,
    );

    const result = await extractReactComponents([
      filePath,
      join(tempDir, 'packages/icon/src/index.ts'),
      join(tempDir, 'packages/icon/src/utils/index.ts'),
      join(tempDir, 'packages/icon/src/utils/generateIconComponent.tsx'),
      join(tempDir, 'packages/icon/src/Icon.tsx'),
      join(tempDir, 'packages/core/src/types.ts'),
      join(tempDir, 'packages/core/src/Primitive/Primitive.tsx'),
      join(tempDir, 'packages/core/src/index.ts'),
    ]);
    const assetIcon = result.components[0];

    expect(assetIcon.name).toBe('AssetIcon');
    expect(assetIcon.props.find((p) => p.name === 'type')?.allowedValues).toEqual(['asset', 'icon']);
    expect(assetIcon.props.find((p) => p.name === 'className')).toEqual(
      expect.objectContaining({ type: 'string', required: false }),
    );
    expect(assetIcon.props.find((p) => p.name === 'testId')).toEqual(
      expect.objectContaining({ type: 'string', required: false }),
    );
    expect(assetIcon.props.find((p) => p.name === 'size')?.allowedValues).toEqual(['medium', 'small', 'tiny']);
    expect(assetIcon.props.find((p) => p.name === 'paddingLeft')?.allowedValues).toEqual([
      'large',
      'medium',
      'none',
      'small',
    ]);
    expect(assetIcon.props.find((p) => p.name === 'isActive')).toEqual(
      expect.objectContaining({ type: 'boolean', required: false }),
    );
    expect(assetIcon.props.find((p) => p.name === 'marginTop')?.allowedValues).toEqual([
      'loose',
      'none',
      'regular',
      'tight',
    ]);
    expect(assetIcon.slots).toEqual([]);
    expect(assetIcon.props.find((p) => p.name === 'illustration')).toBeUndefined();
    expect(assetIcon.props.find((p) => p.name === 'ref')).toBeUndefined();
    expect(assetIcon.props.find((p) => p.name === 'as')).toBeUndefined();
    expect(assetIcon.props.find((p) => p.name === 'children')).toBeUndefined();
    expect(assetIcon.props.find((p) => p.name === 'name')).toBeUndefined();
    expect(assetIcon.props.find((p) => p.name === 'viewBox')).toBeUndefined();
  });

  it('keeps near-shape repo-local polymorphic wrappers opaque', async () => {
    await writeFixture(
      'packages/core/package.json',
      `
      {
        "name": "@acme/core",
        "version": "1.0.0",
        "types": "./dist/index.d.ts",
        "exports": {
          ".": "./dist/index.js"
        }
      }
    `,
    );

    await writeFixture(
      'packages/core/src/Primitive/Primitive.tsx',
      `
      import type { ComponentPropsWithoutRef, ElementType } from 'react';

      export type Overwrite<T, U> = Omit<T, keyof U> & U;

      export type PropsWithAs<P, E> = P & { as?: E };

      export type PropsWithHTMLElement<P, E extends ElementType, OmitAdditionalProps> = Overwrite<
        Omit<ComponentPropsWithoutRef<E>, OmitAdditionalProps>,
        P & { slot?: string }
      >;

      export type PolymorphicProps<P, E extends ElementType, OmitAdditionalProps = never> = PropsWithAs<
        PropsWithHTMLElement<P, E, OmitAdditionalProps>,
        E
      >;
    `,
    );

    await writeFixture(
      'packages/core/src/index.ts',
      `
      export type { Overwrite, PropsWithAs, PropsWithHTMLElement, PolymorphicProps } from './Primitive/Primitive';
    `,
    );

    const filePath = await writeFixture(
      'packages/app/src/OpaquePolymorphic.tsx',
      `
      import React from 'react';
      import type { PolymorphicProps } from '@acme/core';

      type OpaquePolymorphicProps = Omit<PolymorphicProps<{ className?: string; testId?: string }, 'svg'>, 'ref'> & {
        variant?: 'solid' | 'ghost';
      };

      export function OpaquePolymorphic({ variant }: OpaquePolymorphicProps) {
        return <div data-variant={variant} />;
      }
      `,
    );

    const result = await extractReactComponents([
      filePath,
      join(tempDir, 'packages/core/src/Primitive/Primitive.tsx'),
      join(tempDir, 'packages/core/src/index.ts'),
    ]);
    const opaquePolymorphic = result.components[0];

    expect(opaquePolymorphic.name).toBe('OpaquePolymorphic');
    expect(opaquePolymorphic.props.find((p) => p.name === 'variant')?.allowedValues).toEqual(['ghost', 'solid']);
    expect(opaquePolymorphic.props.find((p) => p.name === 'className')).toBeUndefined();
    expect(opaquePolymorphic.props.find((p) => p.name === 'testId')).toBeUndefined();
  });

  it('keeps imported Omit wrappers opaque for true external packages', async () => {
    const filePath = await writeFixture(
      'ExternalIconButton.tsx',
      `
      import React from 'react';
      import type { GeneratedIconProps } from '@vendor/icon';

      type ExternalIconButtonProps = Omit<GeneratedIconProps, 'illustration' | 'ref'> & {
        type?: 'archive' | 'image';
      };

      export function ExternalIconButton({ type }: ExternalIconButtonProps) {
        return <button data-type={type} />;
      }
      `,
    );

    const result = await extractReactComponents([filePath]);
    const externalIconButton = result.components[0];

    expect(externalIconButton.name).toBe('ExternalIconButton');
    expect(externalIconButton.props.find((p) => p.name === 'type')?.allowedValues).toEqual(['archive', 'image']);
    expect(externalIconButton.props.find((p) => p.name === 'className')).toBeUndefined();
    expect(externalIconButton.props.find((p) => p.name === 'testId')).toBeUndefined();
    expect(externalIconButton.props.find((p) => p.name === 'size')).toBeUndefined();
    expect(externalIconButton.props.find((p) => p.name === 'illustration')).toBeUndefined();
    expect(externalIconButton.props.find((p) => p.name === 'ref')).toBeUndefined();
  });

  it('covers imported alias-chain inherited prop recovery', async () => {
    const baseTypesPath = await writeFixture(
      'alias-chain-base.ts',
      `
      export type AliasChainBaseProps = {
        className?: string;
        title?: string;
        actions?: string[];
        testId?: string;
        ref?: never;
      };
    `,
    );

    const aliasBridgePath = await writeFixture(
      'alias-chain-bridge.ts',
      `
      import type { AliasChainBaseProps } from './alias-chain-base';

      export type AliasChainProps = Omit<AliasChainBaseProps, 'ref'>;
    `,
    );

    const filePath = await writeFixture(
      'AliasChainCard.tsx',
      `
      import React, { type PropsWithChildren } from 'react';
      import type { AliasChainProps } from './alias-chain-bridge';

      type AliasChainCardProps = PropsWithChildren<AliasChainProps> & {
        variant?: 'primary' | 'secondary';
      };

      export function AliasChainCard({ variant, className, title, actions, testId, children }: AliasChainCardProps) {
        return <div className={className} data-title={title} data-testid={testId} data-variant={variant}>{actions?.length}{children}</div>;
      }
    `,
    );

    const result = await extractReactComponents([filePath, aliasBridgePath, baseTypesPath]);
    const aliasChainCard = result.components[0];

    expect(aliasChainCard.name).toBe('AliasChainCard');
    expect(aliasChainCard.props.find((p) => p.name === 'ref')).toBeUndefined();
    expect(aliasChainCard.props.find((p) => p.name === 'children')).toBeUndefined();
    expect(aliasChainCard.props.find((p) => p.name === 'variant')?.allowedValues).toEqual(['primary', 'secondary']);
    expect(aliasChainCard.props.find((p) => p.name === 'className')).toEqual(
      expect.objectContaining({ type: 'string', required: false }),
    );
    expect(aliasChainCard.props.find((p) => p.name === 'title')).toEqual(
      expect.objectContaining({ type: 'string', required: false }),
    );
    expect(aliasChainCard.props.find((p) => p.name === 'actions')).toEqual(
      expect.objectContaining({ type: 'string[]', required: false }),
    );
    expect(aliasChainCard.props.find((p) => p.name === 'testId')).toEqual(
      expect.objectContaining({ type: 'string', required: false }),
    );
  });

  it('expands HTMLAttributes<HTMLDivElement> wrappers with intrinsic div props', async () => {
    const filePath = await writeFixture(
      'Panel.tsx',
      `
      import React, { type HTMLAttributes } from 'react';

      interface PanelProps extends HTMLAttributes<HTMLDivElement> {
        tone?: 'neutral' | 'critical';
      }

      export function Panel({ className, id, onClick, tone }: PanelProps) {
        return <div className={className} id={id} onClick={onClick} data-tone={tone} />;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const panel = result.components[0];
    const classNameProp = panel.props.find((p) => p.name === 'className');
    const idProp = panel.props.find((p) => p.name === 'id');
    const onClickProp = panel.props.find((p) => p.name === 'onClick');

    expect(panel.name).toBe('Panel');
    expect(classNameProp).toBeDefined();
    expect(idProp).toBeDefined();
    expect(onClickProp).toBeDefined();
    expect(panel.props.find((p) => p.name === 'tone')?.allowedValues).toEqual(['critical', 'neutral']);
  });

  it('merges supported props from interface heritage Omit wrappers', async () => {
    const filePath = await writeFixture(
      'Wrapper.tsx',
      `
      import React, { type HTMLAttributes } from 'react';

      interface WrapperProps extends Omit<HTMLAttributes<HTMLDivElement>, 'id'> {
        tone?: 'info' | 'warn';
      }

      export function Wrapper({ className, tone }: WrapperProps) {
        return <div className={className} data-tone={tone} />;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const wrapper = result.components[0];

    expect(wrapper.name).toBe('Wrapper');
    expect(wrapper.props.find((p) => p.name === 'className')).toBeDefined();
    expect(wrapper.props.find((p) => p.name === 'id')).toBeUndefined();
    expect(wrapper.props.find((p) => p.name === 'tone')?.allowedValues).toEqual(['info', 'warn']);
  });

  it('expands ImgHTMLAttributes<HTMLImageElement> wrappers with intrinsic img props', async () => {
    const filePath = await writeFixture(
      'AvatarImage.tsx',
      `
      import React, { type ImgHTMLAttributes } from 'react';

      interface AvatarImageProps extends ImgHTMLAttributes<HTMLImageElement> {
        badge?: string;
      }

      export function AvatarImage({ src, alt, loading, badge }: AvatarImageProps) {
        return <img src={src} alt={alt} loading={loading} data-badge={badge} />;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const avatarImage = result.components[0];
    const srcProp = avatarImage.props.find((p) => p.name === 'src');
    const altProp = avatarImage.props.find((p) => p.name === 'alt');
    const loadingProp = avatarImage.props.find((p) => p.name === 'loading');

    expect(avatarImage.name).toBe('AvatarImage');
    expect(srcProp).toBeDefined();
    expect(altProp).toBeDefined();
    expect(loadingProp).toBeDefined();
    if (loadingProp?.allowedValues) {
      expect(loadingProp.allowedValues).toEqual(expect.arrayContaining(['eager', 'lazy']));
    } else {
      expect(loadingProp?.type).toMatch(/string|lazy|eager|ImageLoading/i);
    }
    expect(avatarImage.props.find((p) => p.name === 'badge')?.type).toBe('string');
  });

  it('expands merged AnchorHTMLAttributes and ButtonHTMLAttributes wrappers with intrinsic anchor and button props', async () => {
    const filePath = await writeFixture(
      'LinkButton.tsx',
      `
      import React, { type AnchorHTMLAttributes, type ButtonHTMLAttributes } from 'react';

      interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement>, ButtonHTMLAttributes<HTMLButtonElement> {
        emphasis?: 'low' | 'high';
      }

      export function LinkButton({ href, target, type, disabled, emphasis }: LinkButtonProps) {
        return (
          <a href={href} target={target} data-emphasis={emphasis}>
            <button type={type} disabled={disabled} />
          </a>
        );
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const linkButton = result.components[0];
    const hrefProp = linkButton.props.find((p) => p.name === 'href');
    const targetProp = linkButton.props.find((p) => p.name === 'target');
    const typeProp = linkButton.props.find((p) => p.name === 'type');
    const disabledProp = linkButton.props.find((p) => p.name === 'disabled');

    expect(linkButton.name).toBe('LinkButton');
    expect(hrefProp).toBeDefined();
    expect(targetProp).toBeDefined();
    expect(typeProp).toBeDefined();
    expect(disabledProp?.type).toBe('boolean');
    if (targetProp?.allowedValues) {
      expect(targetProp.allowedValues).toEqual(expect.arrayContaining(['_blank', '_self']));
    } else {
      expect(targetProp?.type).toMatch(/string|target|blank|self/i);
    }
    if (typeProp?.allowedValues) {
      expect(typeProp.allowedValues).toEqual(expect.arrayContaining(['button', 'reset', 'submit']));
    } else {
      expect(typeProp?.type).toMatch(/string|button|reset|submit/i);
    }
    expect(linkButton.props.find((p) => p.name === 'emphasis')?.allowedValues).toEqual(['high', 'low']);
  });

  it('unwraps PropsWithChildren around imported custom props and preserves the default slot', async () => {
    const sharedTypesPath = await writeFixture(
      'provider-types.ts',
      `
      export interface ProviderProps {
        theme?: 'light' | 'dark';
      }
    `,
    );

    const filePath = await writeFixture(
      'ThemeProvider.tsx',
      `
      import React, { type PropsWithChildren } from 'react';
      import type { ProviderProps } from './provider-types';

      export function ThemeProvider(props: PropsWithChildren<ProviderProps>) {
        return <div data-theme={props.theme}>{props.children}</div>;
      }
    `,
    );

    const result = await extractReactComponents([filePath, sharedTypesPath]);
    const provider = result.components[0];

    expect(provider.name).toBe('ThemeProvider');
    expect(provider.props.find((p) => p.name === 'theme')?.allowedValues).toEqual(['dark', 'light']);
    expect(provider.slots).toContainEqual({ name: 'children', isDefault: true });
  });

  it('falls back to destructured prop names when imported external heritage is unresolved', async () => {
    const sharedTypesPath = await writeFixture(
      'provider-types.ts',
      `
      import type { UseAccordionReturnValue } from '@vendor/accordion';

      export interface AccordionProps<T> {
        level: number;
        isCompact?: boolean;
        isAnimated?: boolean;
        isBare?: boolean;
        isCollapsible?: boolean;
      }

      export interface AccordionContext<T>
        extends Omit<UseAccordionReturnValue<T>, 'disabledSections'>,
          Pick<AccordionProps<T>, 'level' | 'isCompact' | 'isAnimated' | 'isBare' | 'isCollapsible'> {}
    `,
    );

    const filePath = await writeFixture(
      'AccordionProvider.tsx',
      `
      import React, { type PropsWithChildren } from 'react';
      import type { AccordionContext } from './provider-types';

      export function AccordionProvider({
        children,
        expandedSections,
        getHeaderProps,
        getPanelProps,
        getTriggerProps,
        isBare,
        isAnimated,
        isCollapsible,
        isCompact,
        level,
      }: PropsWithChildren<AccordionContext<string>>) {
        return <div data-level={level}>{children}{String(expandedSections)}{String(getHeaderProps)}{String(getPanelProps)}{String(getTriggerProps)}{String(isBare)}{String(isAnimated)}{String(isCollapsible)}{String(isCompact)}</div>;
      }
    `,
    );

    const result = await extractReactComponents([filePath, sharedTypesPath]);
    const provider = result.components[0];

    expect(provider.name).toBe('AccordionProvider');
    expect(provider.props.find((p) => p.name === 'expandedSections')).toEqual(
      expect.objectContaining({ type: 'any', required: false }),
    );
    expect(provider.props.find((p) => p.name === 'getHeaderProps')).toEqual(
      expect.objectContaining({ type: 'any', required: false }),
    );
    expect(provider.props.find((p) => p.name === 'getPanelProps')).toEqual(
      expect.objectContaining({ type: 'any', required: false }),
    );
    expect(provider.props.find((p) => p.name === 'getTriggerProps')).toEqual(
      expect.objectContaining({ type: 'any', required: false }),
    );
    expect(provider.props.find((p) => p.name === 'disabledSections')).toBeUndefined();
    expect(provider.props.find((p) => p.name === 'level')).toEqual(expect.objectContaining({ required: true }));
    expect(provider.slots).toContainEqual({ name: 'children', isDefault: true });
  });

  it('falls back to body-destructured prop names when imported external heritage is unresolved', async () => {
    const sharedTypesPath = await writeFixture(
      'form-types.ts',
      `
      import type { FieldProps } from '@vendor/form';

      export type RcFieldProps = Omit<FieldProps, 'children'>;

      export interface FormItemProps extends RcFieldProps {
        label?: string;
      }
    `,
    );

    const filePath = await writeFixture(
      'ItemHolder.tsx',
      `
      import React from 'react';
      import type { FormItemProps } from './form-types';

      interface ItemHolderProps extends FormItemProps {
        prefixCls: string;
      }

      export function ItemHolder(props: ItemHolderProps) {
        const { prefixCls, name, label } = props;
        return <div data-prefix={prefixCls} data-name={String(name)} data-label={label} />;
      }
    `,
    );

    const result = await extractReactComponents([filePath, sharedTypesPath]);
    const itemHolder = result.components[0];

    expect(itemHolder.name).toBe('ItemHolder');
    expect(itemHolder.props.find((p) => p.name === 'prefixCls')).toEqual(expect.objectContaining({ required: true }));
    expect(itemHolder.props.find((p) => p.name === 'label')).toEqual(expect.objectContaining({ required: false }));
    expect(itemHolder.props.find((p) => p.name === 'name')).toEqual(
      expect.objectContaining({ type: 'any', required: false }),
    );
  });

  it('keeps PropsWithChildren suppression narrow for aliased intersection props', async () => {
    const filePath = await writeFixture(
      'ThemeProvider.tsx',
      `
      import React, { type HTMLAttributes, type PropsWithChildren } from 'react';

      type ProviderProps = { theme?: 'light' | 'dark' } & HTMLAttributes<HTMLDivElement>;

      export function ThemeProvider(props: PropsWithChildren<ProviderProps>) {
        return <div className={props.className} data-theme={props.theme}>{props.children}</div>;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const provider = result.components[0];

    expect(provider.name).toBe('ThemeProvider');
    expect(provider.props).not.toEqual([]);
    expect(provider.props.find((p) => p.name === 'theme')?.allowedValues).toEqual(['dark', 'light']);
    expect(provider.props.find((p) => p.name === 'className')).toBeDefined();
    expect(provider.slots).toContainEqual({ name: 'children', isDefault: true });
  });

  it('does not widen Pick<AnchorHTMLAttributes> to the full anchor surface', async () => {
    const filePath = await writeFixture(
      'LinkHref.tsx',
      `
      import React, { type AnchorHTMLAttributes } from 'react';

      type LinkHrefProps = Pick<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>;

      export function LinkHref({ href }: LinkHrefProps) {
        return <a href={href} />;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const linkHref = result.components[0];

    expect(linkHref.name).toBe('LinkHref');
    expect(linkHref.props.find((p) => p.name === 'href')).toBeDefined();
    expect(linkHref.props.find((p) => p.name === 'target')).toBeUndefined();
    expect(linkHref.props.find((p) => p.name === 'rel')).toBeUndefined();
    expect(linkHref.props.find((p) => p.name === 'download')).toBeUndefined();
  });

  it('preserves both sides of a multi-Pick DOM intersection', async () => {
    const filePath = await writeFixture(
      'LinkButton.tsx',
      `
      import React, { type AnchorHTMLAttributes, type ButtonHTMLAttributes } from 'react';

      type LinkButtonProps =
        Pick<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> &
        Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'>;

      export function LinkButton({ href, disabled }: LinkButtonProps) {
        return <a href={href}><button disabled={disabled} /></a>;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const linkButton = result.components[0];

    expect(linkButton.name).toBe('LinkButton');
    expect(linkButton.props.find((p) => p.name === 'href')).toBeDefined();
    expect(linkButton.props.find((p) => p.name === 'disabled')).toBeDefined();
  });

  it('merges imported mixed Pick-based DOM fragments with local props', async () => {
    const sharedTypesPath = await writeFixture(
      'shared-types.ts',
      `
      import type {
        AnchorHTMLAttributes,
        ButtonHTMLAttributes,
        HTMLAttributes,
      } from 'react';

      export type SharedProps =
        { tone?: 'a' | 'b' } &
        Pick<HTMLAttributes<HTMLDivElement>, 'id'> &
        Pick<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> &
        Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'>;
    `,
    );

    const filePath = await writeFixture(
      'MixedLinkButton.tsx',
      `
      import React from 'react';
      import type { SharedProps } from './shared-types';

      export function MixedLinkButton({ tone, id, href, disabled }: SharedProps) {
        return (
          <a id={id} href={href} data-tone={tone}>
            <button disabled={disabled} />
          </a>
        );
      }
    `,
    );

    const result = await extractReactComponents([filePath, sharedTypesPath]);
    const mixedLinkButton = result.components[0];

    expect(mixedLinkButton.name).toBe('MixedLinkButton');
    expect(mixedLinkButton.props.find((p) => p.name === 'tone')?.allowedValues).toEqual(['a', 'b']);
    expect(mixedLinkButton.props.find((p) => p.name === 'id')).toBeDefined();
    expect(mixedLinkButton.props.find((p) => p.name === 'href')).toBeDefined();
    expect(mixedLinkButton.props.find((p) => p.name === 'disabled')).toBeDefined();
  });

  it('preserves imported local redeclarations that shadow omitted DOM props', async () => {
    const sharedTypesPath = await writeFixture(
      'shadowed-types.ts',
      `
      import type { HTMLAttributes } from 'react';

      export interface SharedProps extends Omit<HTMLAttributes<HTMLDivElement>, 'id'> {
        id?: number;
        tone?: 'a' | 'b';
      }
    `,
    );

    const filePath = await writeFixture(
      'ShadowedId.tsx',
      `
      import React from 'react';
      import type { SharedProps } from './shadowed-types';

      export function ShadowedId({ id, tone, className }: SharedProps) {
        return <div id={String(id)} className={className} data-tone={tone} />;
      }
    `,
    );

    const result = await extractReactComponents([filePath, sharedTypesPath]);
    const shadowedId = result.components[0];

    expect(shadowedId.name).toBe('ShadowedId');
    expect(shadowedId.props.find((p) => p.name === 'id')?.type).toBe('number');
    expect(shadowedId.props.find((p) => p.name === 'tone')?.allowedValues).toEqual(['a', 'b']);
    expect(shadowedId.props.find((p) => p.name === 'className')).toBeDefined();
  });

  it('removes omitted props from imported aliases that mix local and DOM props', async () => {
    const sharedTypesPath = await writeFixture(
      'omitted-alias-types.ts',
      `
      import type { HTMLAttributes } from 'react';

      export type BaseProps = { id?: number; tone?: 'a' | 'b' } & HTMLAttributes<HTMLDivElement>;
      export type SharedProps = Omit<BaseProps, 'id'>;
    `,
    );

    const filePath = await writeFixture(
      'OmittedAlias.tsx',
      `
      import React from 'react';
      import type { SharedProps } from './omitted-alias-types';

      export function OmittedAlias({ tone, className }: SharedProps) {
        return <div className={className} data-tone={tone} />;
      }
    `,
    );

    const result = await extractReactComponents([filePath, sharedTypesPath]);
    const omittedAlias = result.components[0];

    expect(omittedAlias.name).toBe('OmittedAlias');
    expect(omittedAlias.props.find((p) => p.name === 'id')).toBeUndefined();
    expect(omittedAlias.props.find((p) => p.name === 'tone')?.allowedValues).toEqual(['a', 'b']);
    expect(omittedAlias.props.find((p) => p.name === 'className')).toBeDefined();
  });

  it('treats PropsWithChildren DOM wrappers as child slots without expanding DOM attributes', async () => {
    const filePath = await writeFixture(
      'End.tsx',
      `
      import React, { type HTMLAttributes, type PropsWithChildren } from 'react';

      export function End(props: PropsWithChildren<HTMLAttributes<HTMLInputElement>>) {
        return <>{props.children}</>;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const end = result.components[0];

    expect(end.name).toBe('End');
    expect(end.props).toEqual([]);
    expect(end.slots).toContainEqual({ name: 'children', isDefault: true });
  });

  it('expands inherited label attributes and preserves the default slot for direct function props', async () => {
    const filePath = await writeFixture(
      'FieldLabel.tsx',
      `
      import React, { type LabelHTMLAttributes } from 'react';

      interface FieldLabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
        htmlFor: string;
      }

      export const FieldLabel = ({ className, htmlFor, children, ...props }: FieldLabelProps) => (
        <label {...props} className={className} htmlFor={htmlFor}>
          {children}
        </label>
      );
    `,
    );

    const result = await extractReactComponents([filePath]);
    const fieldLabel = result.components[0];

    expect(fieldLabel.name).toBe('FieldLabel');
    expect(fieldLabel.props.find((p) => p.name === 'className')).toBeDefined();
    expect(fieldLabel.props.find((p) => p.name === 'id')).toBeDefined();
    expect(fieldLabel.props.find((p) => p.name === 'title')).toBeDefined();
    expect(fieldLabel.props.find((p) => p.name === 'form')).toBeDefined();
    expect(fieldLabel.props.find((p) => p.name === 'htmlFor')).toEqual(
      expect.objectContaining({ type: 'string', required: true }),
    );
    expect(fieldLabel.slots).toContainEqual({
      name: 'children',
      isDefault: true,
    });
  });

  it('expands inherited HTMLProps wrappers and preserves the default slot for destructured children', async () => {
    const filePath = await writeFixture(
      'Bubble.tsx',
      `
      import React, { type HTMLProps } from 'react';

      interface BubbleProps extends Omit<HTMLProps<HTMLDivElement>, 'target'> {
        align: 'top' | 'bottom';
        open: boolean;
        target: string;
      }

      export function Bubble({ children, align, open, target, className, ...rest }: BubbleProps) {
        return (
          <div {...rest} className={className} data-align={align} data-open={open} data-target={target}>
            {children}
          </div>
        );
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const bubble = result.components[0];

    expect(bubble.name).toBe('Bubble');
    expect(bubble.props.find((p) => p.name === 'align')).toBeDefined();
    expect(bubble.props.find((p) => p.name === 'target')).toBeDefined();
    expect(bubble.props.find((p) => p.name === 'className')).toBeDefined();
    expect(bubble.props.find((p) => p.name === 'id')).toBeDefined();
    expect(bubble.props.find((p) => p.name === 'title')).toBeDefined();
    expect(bubble.slots).toContainEqual({ name: 'children', isDefault: true });
  });

  it('expands SVGAttributes wrappers for direct function props', async () => {
    const filePath = await writeFixture(
      'IndeterminateIcon.tsx',
      `
      import type { SVGAttributes, ReactElement } from 'react';

      export const IndeterminateIcon = (
        props: SVGAttributes<SVGElement>,
      ): ReactElement => (
        <svg viewBox="0 0 16 16" fill="currentColor" {...props}>
          <rect width="10" height="2" x="3" y="7" rx="1" />
        </svg>
      );
    `,
    );

    const result = await extractReactComponents([filePath]);
    const icon = result.components[0];

    expect(icon.name).toBe('IndeterminateIcon');
    expect(icon.props.find((p) => p.name === 'className')).toBeDefined();
    expect(icon.props.find((p) => p.name === 'focusable')).toBeDefined();
    expect(icon.props.find((p) => p.name === 'id')).toBeDefined();
    expect(icon.props.find((p) => p.name === 'viewBox')).toBeDefined();
  });

  it('filters implementation-only underscore aliases that only feed a public id prop', async () => {
    const filePath = await writeFixture(
      'PrivateIdAlias.tsx',
      `
      import React, { type ReactElement, type ReactNode } from 'react';

      interface PrivateIdAliasProps {
        _id: string;
        children: ReactNode;
      }

      export function PrivateIdAlias({ _id, children }: PrivateIdAliasProps): ReactElement {
        return <section id={_id}>{children}</section>;
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const alias = result.components[0];

    expect(alias.name).toBe('PrivateIdAlias');
    expect(alias.props.find((p) => p.name === '_id')).toBeUndefined();
    expect(alias.props.find((p) => p.name === 'id')).toBeUndefined();
    expect(alias.slots).toContainEqual({ name: 'children', isDefault: true });
  });

  it('filters implementation-only underscore aliases when the public prop names are still exposed', async () => {
    const typesPath = await writeFixture(
      'tooltip-types.ts',
      `
      import type { HTMLAttributes, ReactElement, ReactNode } from 'react';

      export type Placement = 'auto' | 'top' | 'bottom';

      export interface TooltipProps extends Omit<HTMLAttributes<HTMLDivElement>, 'content'> {
        content: ReactNode;
        children: ReactElement;
        fallbackPlacements?: Exclude<Placement, 'auto'>[];
        placement?: Placement;
      }
    `,
    );

    const filePath = await writeFixture(
      'Tooltip.tsx',
      `
      import React, { type ReactElement } from 'react';
      import type { TooltipProps } from './tooltip-types';

      export const Tooltip = ({
        placement: _placement = 'top',
        fallbackPlacements: _fallbackPlacements,
        content,
        id,
      }: TooltipProps): ReactElement => {
        const placement = _placement === 'auto' ? 'top' : _placement;
        const fallbackPlacements = _fallbackPlacements ?? [placement];

        return (
          <div id={id} data-placement={placement} data-fallback={fallbackPlacements.join(',')}>
            {content}
          </div>
        );
      };
    `,
    );

    const result = await extractReactComponents([typesPath, filePath]);
    const tooltip = result.components[0];

    expect(tooltip.name).toBe('Tooltip');
    expect(tooltip.props.find((p) => p.name === 'placement')).toBeDefined();
    expect(tooltip.props.find((p) => p.name === 'fallbackPlacements')).toBeDefined();
    expect(tooltip.props.find((p) => p.name === '_placement')).toBeUndefined();
    expect(tooltip.props.find((p) => p.name === '_fallbackPlacements')).toBeUndefined();
  });

  it('preserves authored union prop syntax when imported React-backed types collapse semantically', async () => {
    const typesPath = await writeFixture(
      'page-action-types.ts',
      `
      import type React from 'react';

      export interface DisableableAction {
        disabled?: boolean;
      }

      export interface LoadableAction {
        loading?: boolean;
      }

      export interface ComplexAction {
        content?: string;
      }

      export interface PageActionsProps {
        primaryAction?: (DisableableAction & LoadableAction) | React.ReactNode;
        secondaryActions?: ComplexAction[] | React.ReactNode;
      }
    `,
    );

    const filePath = await writeFixture(
      'PageActions.tsx',
      `
      import React from 'react';
      import type { PageActionsProps } from './page-action-types';

      export function PageActions({
        primaryAction,
        secondaryActions,
      }: PageActionsProps) {
        return (
          <div data-primary={Boolean(primaryAction)} data-secondary={Boolean(secondaryActions)} />
        );
      }
    `,
    );

    const result = await extractReactComponents([typesPath, filePath]);
    const pageActions = result.components[0];

    expect(pageActions.name).toBe('PageActions');
    expect(pageActions.props.find((p) => p.name === 'primaryAction')?.type).toBe(
      '(DisableableAction & LoadableAction) | React.ReactNode',
    );
    expect(pageActions.props.find((p) => p.name === 'secondaryActions')?.type).toBe(
      'ComplexAction[] | React.ReactNode',
    );
  });

  it('falls back to destructured prop names for local Pick-based union wrappers', async () => {
    const indexPath = await writeFixture(
      'cascader/index.tsx',
      `
      export type DefaultOptionType = {
        value?: string;
        label?: string;
      };

      export interface CascaderProps<
        OptionType extends DefaultOptionType = DefaultOptionType,
        ValueField extends keyof OptionType = keyof OptionType,
        Multiple extends boolean = boolean,
      > {
        prefixCls?: string;
        className?: string;
        multiple?: Multiple;
        rootClassName?: string;
        notFoundContent?: string;
        direction?: 'ltr' | 'rtl';
        expandIcon?: string;
        loadingIcon?: string;
        disabled?: boolean;
        valueField?: ValueField;
      }
    `,
    );

    const panelPath = await writeFixture(
      'cascader/Panel.tsx',
      `
      import React from 'react';
      import type { CascaderProps, DefaultOptionType } from './index';

      export type PanelPickType =
        | 'prefixCls'
        | 'className'
        | 'multiple'
        | 'rootClassName'
        | 'notFoundContent'
        | 'direction'
        | 'expandIcon'
        | 'loadingIcon'
        | 'disabled';

      export type CascaderPanelProps<
        OptionType extends DefaultOptionType = DefaultOptionType,
        ValueField extends keyof OptionType = keyof OptionType,
        Multiple extends boolean = boolean,
      > = Pick<CascaderProps<OptionType, ValueField, Multiple>, PanelPickType>;

      export type CascaderPanelAutoProps<
        OptionType extends DefaultOptionType = DefaultOptionType,
        ValueField extends keyof OptionType = keyof OptionType,
      > =
        | (CascaderPanelProps<OptionType, ValueField> & { multiple?: false })
        | (CascaderPanelProps<OptionType, ValueField, true> & { multiple: true });

      export default function CascaderPanel<
        OptionType extends DefaultOptionType = DefaultOptionType,
        ValueField extends keyof OptionType = keyof OptionType,
      >(props: CascaderPanelAutoProps<OptionType, ValueField>) {
        const {
          prefixCls,
          className,
          multiple,
          rootClassName,
          notFoundContent,
          direction,
          expandIcon,
          loadingIcon,
          disabled,
        } = props;

        return (
          <div>
            {prefixCls}
            {className}
            {String(multiple)}
            {rootClassName}
            {notFoundContent}
            {direction}
            {expandIcon}
            {loadingIcon}
            {String(disabled)}
          </div>
        );
      }
    `,
    );

    const result = await extractReactComponents([panelPath, indexPath]);
    const panel = result.components[0];

    expect(panel.name).toBe('CascaderPanel');
    expect(panel.props.find((p) => p.name === 'multiple')).toBeDefined();
    expect(panel.props.find((p) => p.name === 'prefixCls')).toBeDefined();
    expect(panel.props.find((p) => p.name === 'className')).toBeDefined();
    expect(panel.props.find((p) => p.name === 'rootClassName')).toBeDefined();
    expect(panel.props.find((p) => p.name === 'notFoundContent')).toBeDefined();
    expect(panel.props.find((p) => p.name === 'direction')).toBeDefined();
    expect(panel.props.find((p) => p.name === 'expandIcon')).toBeDefined();
    expect(panel.props.find((p) => p.name === 'loadingIcon')).toBeDefined();
    expect(panel.props.find((p) => p.name === 'disabled')).toBeDefined();
  });

  it('filters Radix-style internal scope props from the public React API surface', async () => {
    const filePath = await writeFixture(
      'Accordion.tsx',
      `
      import React from 'react';

      interface AccordionProps {
        __scopeAccordion?: string;
        value?: string;
        defaultValue?: string;
        onValueChange?: (value: string) => void;
      }

      export function Accordion({
        __scopeAccordion,
        value,
        defaultValue,
        onValueChange,
      }: AccordionProps) {
        return (
          <div
            data-scope={__scopeAccordion}
            data-value={value}
            data-default-value={defaultValue}
            data-has-handler={Boolean(onValueChange)}
          />
        );
      }
    `,
    );

    const result = await extractReactComponents([filePath]);
    const accordion = result.components[0];

    expect(accordion.props.find((p) => p.name === '__scopeAccordion')).toBeUndefined();
    expect(accordion.props.find((p) => p.name === 'value')).toBeDefined();
    expect(accordion.props.find((p) => p.name === 'defaultValue')).toBeDefined();
    expect(accordion.props.find((p) => p.name === 'onValueChange')).toBeDefined();
  });

  it('captures sourcePath and per-prop source line ranges (Feature 1)', async () => {
    // Lines 1 (blank), 2: import, 3: blank, 4: interface open, 5: label, 6: variant, 7: }
    const filePath = await writeFixture(
      'Button.tsx',
      [
        '',
        "import React from 'react';",
        '',
        'export interface ButtonProps {',
        '  label: string;',
        "  variant?: 'primary' | 'secondary';",
        '}',
        '',
        'export function Button({ label, variant }: ButtonProps) {',
        '  return <button>{label}</button>;',
        '}',
        '',
      ].join('\n'),
    );

    const result = await extractReactComponents([filePath]);
    const button = result.components[0];
    expect(button.sourcePath).toBe(filePath);

    const labelProp = button.props.find((p) => p.name === 'label');
    expect(labelProp?.sourceStartLine).toBeGreaterThan(0);
    expect(labelProp?.sourceEndLine).toBeGreaterThanOrEqual(labelProp!.sourceStartLine!);

    const variantProp = button.props.find((p) => p.name === 'variant');
    expect(variantProp?.sourceStartLine).toBeGreaterThan(labelProp!.sourceStartLine!);
  });
});
