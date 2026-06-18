2026-06-16

Tags: [[netron]] [[ambarella]]
## new feature - warning feature for questionable nodes

### Notes

## Current behavior (why AND under a 1-output node is a problem)

Insert flow today:

1. `OperatorPicker._select` → `view.insertNodeAt` → `applyEditorPatch` → `insertNode` in `model-editor.js`
2. No validation step in between.

For **And** (`min_input: 2`), inserting below a unary node like Relu wires only one input:

```468:478:source/model-editor.js
    } else {
        const refOutputs = refNode.outputs || [];
        const inputCount = Math.max(refOutputs.length, (nodeSpec.inputs || []).length, 1);
        for (let index = 0; index < inputCount; index++) {
            const refOutput = refOutputs[index];
            const schemaInput = (nodeSpec.inputs || [])[index];
            const inputValues = refOutput && Array.isArray(refOutput.value) ? refOutput.value.slice() : [];
            newNode.inputs.push({
                name: schemaInput ? schemaInput.name : (refOutput ? refOutput.name : `input_${index}`),
                value: inputValues
            });
```

Relu has 1 output → input `A` gets wired, input `B` is `[]`. Same pattern for **insert above**: only the first dynamic (non-initializer) input is spliced.

That produces a structurally invalid graph (export’s `validateGraph` would eventually catch dangling references, but only at export time).

---

## Recommended architecture

### 1. Schema-driven validator module (covers all ONNX ops)

Don’t hand-write rules per operator. You already have everything needed in `onnx-metadata.json`:

| Metadata field | Validation use |
|---|---|
| `min_input` / `max_input` | Warn if planned wiring connects fewer than `min_input` inputs |
| `inputs[].option: "optional"` | Treat optional slots differently from required |
| `min_output` / `max_output` | Warn when ref outputs don’t match expected fan-out |
| `type_constraints` | Warn when upstream tensor type doesn’t match `allowed_type_strs` |
| `attributes[].required` | Warn if required attribute has no default and won’t be set |

Add something like `source/onnx-operator-validation.js`:

```javascript
// Returns { warnings: Warning[], errors: Warning[] }
export function validateNodeInsert(graph, refNodeIndex, position, opSchema, nodeSpec) {
  const plan = planNodeInsert(graph, refNodeIndex, position, nodeSpec); // dry-run, no mutation
  const warnings = [];

  // 1. Input arity
  const connected = plan.newNodeInputs.filter(i => i.value.length > 0).length;
  const minInputs = opSchema.min_input ?? 1;
  if (connected < minInputs) {
    warnings.push({
      code: 'INSUFFICIENT_INPUTS',
      severity: 'warning',
      message: `${opSchema.name} requires at least ${minInputs} input(s), but only ${connected} will be connected after insert ${position}.`,
    });
  }

  // 2. Unconnected required input slots (by name)
  for (let i = 0; i < plan.newNodeInputs.length; i++) {
    const schemaInput = (opSchema.inputs || [])[i];
    if (schemaInput?.option === 'optional') continue;
    if (plan.newNodeInputs[i].value.length === 0) {
      warnings.push({
        code: 'UNCONNECTED_INPUT',
        severity: 'warning',
        message: `Input '${plan.newNodeInputs[i].name}' of ${opSchema.name} will be unconnected.`,
      });
    }
  }

  // 3. Type constraints (when upstream type is known)
  // 4. Opset / domain checks
  // 5. Small override map for ops metadata can't express well

  return { warnings, errors: [] };
}
```

**Key idea:** extract a **dry-run planner** from `insertNode` (e.g. `planNodeInsert`) that returns the wiring plan without mutating the graph. Reuse the same logic as `insertNode` so validation and insertion never diverge.

That gives you coverage for **every operator** in `onnx-metadata.json` automatically — And, Add, Concat, Conv, If, etc. — without maintaining hundreds of manual rules.

Optional: a small `OPERATOR_OVERRIDES` map for edge cases metadata doesn’t capture (e.g. “inserting control-flow ops mid-graph is unusual”).

---

### 2. Confirm dialog (two buttons)

Today `host.message()` is single-action only:

```594:621:source/browser.js
    async message(message, alert, action) {
        return new Promise((resolve) => {
            // ...
            // One button: resolves 0 on click
        });
    }
```

You need a new host method, e.g. `host.confirm(message, options)` returning `true` / `false`.

**HTML** (alongside existing `#message` in `index.html`):

```html
<div id="confirm" class="confirm">
  <div id="confirm-text" class="confirm-text"></div>
  <ul id="confirm-warnings" class="confirm-warnings"></ul>
  <div class="confirm-buttons">
    <button id="confirm-cancel">Cancel</button>
    <button id="confirm-ok">Insert anyway</button>
  </div>
</div>
```

Implement in both `browser.js` and `desktop.mjs` (same pattern as `message()`). Use body class `confirm` similar to `.alert` / `.notification`.

Example API:

```javascript
async confirm(title, warnings, { confirmLabel = 'Insert anyway', cancelLabel = 'Cancel' } = {}) {
  // show dialog, resolve(true) on confirm, resolve(false) on cancel/Escape
}
```

---

### 3. Wire into `insertNodeAt`

Hook validation **before** `applyEditorPatch`:

```799:821:source/view.js
    async insertNodeAt(nodeView, position, opSchema) {
        // ...
        const nodeSpec = buildNodeFromMetadata(opSchema, uniqueName, graph);
        const { warnings, errors } = validateNodeInsert(
            graph, entity.nodeIndex, position, opSchema, nodeSpec
        );

        if (errors.length > 0) {
            await this._host.message(errors.map(e => e.message).join('\n'), true, 'OK');
            return;
        }

        if (warnings.length > 0) {
            const proceed = await this._host.confirm(
                `Insert ${opSchema.name} ${position} ${refNode.name}?`,
                warnings
            );
            if (!proceed) return;
        }

        await this.applyEditorPatch({ /* ... */ });
    }
```

**Severity policy** (suggested):

- **Warning** → show confirm dialog; user can proceed
- **Error** → block insert (or also allow confirm if you want a power-user override)

---

## Validation rules to implement (schema-driven checklist)

These cover your AND example and generalize to all ops:

| Rule | Example |
|---|---|
| Connected inputs < `min_input` | And below Relu: 1 connected, need 2 |
| Required input slot empty | And input `B` unconnected |
| Insert above only splices first data input | And above Add: only `A` wired, `B` empty |
| Type mismatch vs `type_constraints` | And expects `tensor(bool)`, Conv output is float |
| Missing required attribute (no default) | Some custom/training ops |
| `max_input` exceeded | Rare on insert, more relevant for manual wiring later |
| Opset too new for model imports | Already filtered in picker, but double-check at validate time |

For the **AND + single-output** case, the warning text could be:

> Inserting **And** below **Relu1** will connect only 1 of 2 required inputs (`B` will be unconnected). And expects boolean tensors; upstream type is float32.

---

## Tests

Add `test/onnx-operator-validation.test.js`:

```javascript
it('warns when inserting And below unary node', () => {
  const graph = reluGraph(); // 1 output
  const andSchema = { name: 'And', min_input: 2, inputs: [{ name: 'A' }, { name: 'B' }], /* ... */ };
  const spec = buildNodeFromMetadata(andSchema, 'InsertedAnd', graph);
  const { warnings } = validateNodeInsert(graph, 0, 'below', andSchema, spec);
  assert.ok(warnings.some(w => w.code === 'INSUFFICIENT_INPUTS'));
});
```

Reuse patterns from `test/insert_node.test.js`.

---

## Scope beyond insert

You said “warnings for every operator.” Start with **insert** (highest value, clearest UX). Later, the same validator can run on:

- Attribute edits (`applyEditorPatch` for attributes)
- Export-time (`onnx-export.js` `validateGraph` — currently hard errors only)
- Sidebar “lint” panel listing all graph warnings

---

## File touch list

| File | Change |
|---|---|
| `source/onnx-operator-validation.js` | New: `planNodeInsert`, `validateNodeInsert` |
| `source/model-editor.js` | Optionally refactor `insertNode` to use `planNodeInsert` |
| `source/view.js` | Call validator + confirm in `insertNodeAt` |
| `source/browser.js`, `source/desktop.mjs` | Add `confirm()` |
| `source/index.html` | Confirm dialog markup + CSS |
| `test/onnx-operator-validation.test.js` | Unit tests |

---

One design choice to confirm: should **errors** hard-block insert, or should everything go through the confirm dialog (even “B will be unconnected”)?

Good call — that keeps the UX consistent: **every insert shows a confirm dialog**, and validation only changes what’s inside it, not whether you get a dialog at all.

## Unified confirm flow

Treat validation as **information for the dialog**, not a gate:

```javascript
async insertNodeAt(nodeView, position, opSchema) {
    // ... resolve entity, build nodeSpec ...

    const result = validateNodeInsert(graph, entity.nodeIndex, position, opSchema, nodeSpec);
    const issues = [...result.errors, ...result.warnings]; // or keep severity on each item

    const proceed = await this._host.confirm({
        title: `Insert ${opSchema.name} ${position} ${refNode.name}?`,
        summary: issues.length === 0
            ? 'No issues detected.'
            : `${issues.length} issue(s) detected:`,
        issues,  // all severities shown together
        confirmLabel: issues.length > 0 ? 'Insert anyway' : 'Insert',
        cancelLabel: 'Cancel',
    });

    if (!proceed) return;

    await this.applyEditorPatch({ /* ... */ });
}
```

**Behavior:**

| Situation     | Dialog                                                                  | Confirm button  |
| ------------- | ----------------------------------------------------------------------- | --------------- |
| No issues     | Still shown (optional: skip if you want zero friction for safe inserts) | “Insert”        |
| Warnings only | Lists warnings                                                          | “Insert anyway” |
| Errors only   | Lists errors (same UI, maybe styled differently)                        | “Insert anyway” |
| Mixed         | All items in one list                                                   | “Insert anyway” |

Since you said **everything** goes through confirm, I’d include the no-issues case too — or at minimum, always confirm when `issues.length > 0` and also always confirm when the user might not expect side effects. Your wording suggests **always confirm on insert**, which is fine.

## Validator: errors vs warnings

Keep `severity` on each issue for display, but **don’t branch on it in `insertNodeAt`**:

```javascript
// onnx-operator-validation.js
return {
  issues: [
    { severity: 'error', code: 'INSUFFICIENT_INPUTS', message: '...' },
    { severity: 'warning', code: 'TYPE_MISMATCH', message: '...' },
  ]
};
```

Use severity only in the dialog:

- `error` → red / bold / ⚠ icon
- `warning` → yellow / normal

No early `return` after errors.

## Confirm dialog shape

Extend `host.confirm()` to accept structured issues:

```javascript
async confirm({ title, summary, issues, confirmLabel, cancelLabel }) {
  // title + summary at top
  // <ul> of issues, each with data-severity="error|warning"
  // Cancel → false, Confirm → true
}
```

Example for And below Relu:

**Title:** Insert And below Relu1?

**Issues:**
- `[Error]` And requires at least 2 inputs; only 1 will be connected.
- `[Error]` Input `B` will be unconnected.
- `[Warning]` And expects `tensor(bool)`; upstream type appears to be `float32`.

**Buttons:** Cancel | Insert anyway

## One nuance: “always confirm” vs “always show issues”

Two interpretations:

1. **Always show the confirm dialog** on every insert (even Abs above Relu with no issues).
2. **Always route validation through confirm** — meaning never use the alert-only `message()` path for validation; only use confirm when there are issues.

Given “everything should go through the confirm dialog,” I’d implement **(1)** if you want maximum consistency, or **(2)** if you only care that questionable inserts never hard-block. Your latest message reads like **(1)**.

If you want (1) but less noise for safe inserts, a compromise is:

- **0 issues** → short confirm: “Insert Abs above Relu1?” with no list
- **1+ issues** → same dialog + issue list + “Insert anyway”

Still one code path (`confirm()`), different content.

## What not to do

- Don’t call `this.error()` or `host.message(..., true)` for validation results.
- Don’t `return` early based on `errors.length`.
- Don’t split into separate “warning dialog” and “error dialog” flows.

## Tests

```javascript
it('returns errors but caller still proceeds only after confirm', () => {
  const { issues } = validateNodeInsert(/* And below Relu */);
  assert.ok(issues.some(i => i.severity === 'error'));
  // insertNodeAt mock: confirm returns true → patch applied
  // insertNodeAt mock: confirm returns false → patch not applied
});
```

