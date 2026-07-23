You are writing a JavaScript function that extracts parent→child component composition from a design system.
Study the candidate files below, identify the convention that expresses composition (e.g. a mapping layer,
typed slots, a `withParentType`/`requiredParent`/`allowedTagNames` declaration), and write ONE pure function
that parses that convention.

STRICT RULES:
1. Derive edges ONLY from evidence in ctx.files. Do not infer from naming, category, or convention.
2. The function is PURE: no require, no import, no I/O, no network, no fs, no process — it may only read `ctx`.
   (It runs in a locked sandbox; any capability access throws and the run is discarded.)
3. Emit each parent→child pair at most once; both endpoints MUST be in ctx.componentNames.
4. Prefer a smaller, fully-evidenced result over padding with plausible-but-unstated edges.

CRITICAL — identifiers vs. component names:
The mapping convention often keys relationships by a CONTENT-TYPE ID (e.g.
`new MappingContext('section3Up').withParentType('sectionTab')`), NOT by the
component name. But `ctx.componentNames` contains COMPONENT NAMES (e.g.
`ThreeUp`, `SectionTab`). These are different namespaces.

Before emitting edges you MUST resolve ids → component names:
- First scan every file for the id→component pairing. In this convention the
  component is named in a `component:` field on the same mapping entry, e.g.
  `new MappingContext('section3Up')` … `component: ThreeUp` → id `section3Up`
  maps to component `ThreeUp`.
- Build that id→name map across ALL files first, then translate BOTH endpoints
  of each `withParentType` relationship through it.
- Only after translation, keep edges whose translated parent AND child are in
  ctx.componentNames. Comparing raw ids against ctx.componentNames will match
  nothing — do not do that.
If a convention already uses component names directly (e.g. typed slots
referencing `XProps`), no translation is needed — use the names as-is.

Return your answer as a single fenced code block containing exactly this shape:

```js
export default function (ctx) {
  // ctx.files: { path: string, content: string }[]
  // ctx.componentNames: string[]  (use ONLY these exact names)
  const edges = [];
  // ...parse ctx.files, push { parent, child, slot?, confidence? } objects...
  return edges; // Array<{ parent: string, child: string, slot?: string, confidence?: 1-5 }>
}
```
