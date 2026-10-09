/**
 * Which of the four content-projection idioms produced a slot. Research showed
 * all four coexist across Material / NG-ZORRO / PrimeNG / Spartan / radix-ng
 * and the extractor must distinguish them because the derivation rules differ.
 */
export type AngularSlotSource =
  | 'ng-content' //             <ng-content select="..."> or bare <ng-content>
  | 'content-child-query' //    contentChild(X) / @ContentChild(X) → slot name = property name
  | 'template-ref-input' //     foo: TemplateRef<...> input → slot name = input name
  | 'di-composition'; //        hostDirectives / provideXxxContext — flat emit; punted for v1
