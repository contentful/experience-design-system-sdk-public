/**
 * Which of the six Angular input idioms produced a prop. Captured so downstream
 * logic (and tests) can reason about why a given RawPropDefinition looks the
 * way it does — e.g. signal inputs have no setter, so defaults live on the
 * CallExpression argument, not the class-field initializer.
 */
export type AngularPropSource =
  | 'input-decorator-bare' //         @Input() foo
  | 'input-decorator-aliased' //      @Input('alias') foo
  | 'input-decorator-config' //       @Input({ required, transform, alias }) foo
  | 'signal-input' //                 foo = input<T>(default?, opts?)
  | 'signal-input-required' //        foo = input.required<T>(opts?)
  | 'component-inputs-array'; //      @Component({ inputs: ['foo: alias'] })
