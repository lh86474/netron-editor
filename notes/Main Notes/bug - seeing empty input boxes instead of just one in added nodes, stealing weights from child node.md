2026-06-16

Tags: [[ambarella]] [[netron]]
## bug - seeing empty input boxes instead of just one in added nodes, stealing weights from child node

### Notes

![[Pasted image 20260616105745.png|337]]

Strange input B box that's just there. What to do?
And is the wrong operator because it expects two inputs. We need to throw some errors here because And obviously doesn't really work!

![[Pasted image 20260616105938.png|320]]


- ABs did not move Conv's weight tensors, but the splice rewired them onto Abs by mistake. 
- The weights and bias show on whichever node owns those initializer inputs. After inserting abs above Conv, those inputs got attached to the abs instead of conv, so the UI draws them on Abs and Conv looks empty
- This is a splicing error

Here is a concrete plan for fixing the insert-above splicing bug.

## Root cause (recap)

In `insertNode` (`model-editor.js`), the `above` branch uses `refNode.inputs.length` to drive both loops:

```411:434:source/model-editor.js
    if (position === 'above') {
        const refInputs = refNode.inputs || [];
        const inputCount = Math.max(refInputs.length, (nodeSpec.inputs || []).length, 1);
        // ... copies ALL ref inputs to newNode ...
        const outputCount = Math.max((nodeSpec.outputs || []).length, refInputs.length, 1);
        // ... creates that many outputs and rewires ALL ref inputs ...
```

For Conv (inputs: `X`, `W`, `B`), this treats W/B like data edges and moves them to Abs.

---

## Fix strategy

### 1. Classify reference inputs

Add a small helper in `model-editor.js`:

```javascript
const isStaticInput = (argument) => {
    if (!argument || !Array.isArray(argument.value) || argument.value.length === 0) {
        return false;
    }
    return argument.value.every((value) => value && value.initializer);
};
```

This matches how the graph UI already treats weights (`value.initializer` is preserved in `cloneValue` at lines 106–107).

**Static input** → leave untouched on ref node  
**Non-static input** → eligible for splicing

### 2. Change the `above` branch to splice only data inputs

Replace the `Math.max(refInputs.length, …)` logic with schema-driven counts:

| Step             | Current                                       | Fixed                                                |
| ---------------- | --------------------------------------------- | ---------------------------------------------------- |
| New node inputs  | `max(refInputs.length, schema)`               | `max(schemaInputs.length, minInputs)` only           |
| New node outputs | `max(schemaOutputs.length, refInputs.length)` | `max(schemaOutputs.length, minOutputs)` only         |
| Copy values      | All ref inputs                                | Only from **splice targets** (non-static ref inputs) |
| Rewire ref node  | All ref inputs                                | Only **splice targets**                              |

Pseudocode:

```javascript
const refInputs = refNode.inputs || [];
const spliceTargets = refInputs.filter((input) => !isStaticInput(input));

const schemaInputs = nodeSpec.inputs || [];
const minInputs = nodeSpec.min_input ?? Math.max(schemaInputs.length, 1);
const minOutputs = nodeSpec.min_output ?? Math.max((nodeSpec.outputs || []).length, 1);

// Build newNode.inputs from schema (empty values first, like buildNodeFromMetadata)
// For i in 0..minInputs-1:
//   if spliceTargets[i] exists:
//     newNode.inputs[i].value = spliceTargets[i].value.slice()

// Create minOutputs outputs on newNode
// For each spliceTargets[i] (by index in refInputs):
//   refInputs[originalIndex].value = [newNode.outputs[min(i, minOutputs - 1)]]
// Static inputs: never touched
```

Important details:

- **Do not** push extra inputs onto the new node beyond its schema (Abs should end up with exactly 1 input, not 3).
- **Do not** create extra outputs on the new node because the ref node had many inputs.
- When there are multiple splice targets but the new node is unary (Abs), only wire **splice target 0** and rewire **only ref input 0** among data inputs. Leave other data inputs (e.g. Add’s second branch) as-is for now.

### 3. Leave `below` branch unchanged

Insert-below splices on **outputs**, which is correct for Conv (1 activation output). No change needed unless you later find a multi-output edge case.

---

## Edge cases to document (not block v1)

| Case                                                           | v1 behavior                                    | Future work                      |
| -------------------------------------------------------------- | ---------------------------------------------- | -------------------------------- |
| Abs above Conv with W/B                                        | Fixed: W/B stay on Conv                        | —                                |
| Abs above Relu (1 data input)                                  | Works as today                                 | —                                |
| Abs above Add (2 data inputs)                                  | Splices only first data input (A); B unchanged | Edge-aware “insert on this wire” |
| Ref input is empty `[]`                                        | Not static; no splice value to copy            | OK                               |
| Optional Conv input (no B)                                     | Only existing inputs processed                 | OK                               |
| Constant node as input (no `initializer` flag but is constant) | May still splice; rare in ONNX Conv            | Could refine later               |

The Add case is ambiguous today because insert is **per-node**, not per-edge. Fixing Conv/weights is the clear win; full multi-input splice needs a separate feature.

---

## Implementation steps

1. **Add `isStaticInput` helper** near `insertNode` in `model-editor.js`.

2. **Refactor `above` branch** of `insertNode`:
   - Compute `spliceTargets` with original indices preserved (map `{ index, input }`, not filter-only).
   - Build `newNode.inputs` from `nodeSpec` schema count.
   - Copy values only from the first `min(schemaInputs, spliceTargets.length)` splice targets.
   - Create `minOutputs` outputs from schema.
   - Rewire only those splice-target ref inputs to the new outputs.

3. **Export `insertNode` for unit tests** (already exported) — add dedicated tests.

4. **No view.js changes** — this is purely graph mutation logic.

---

## Tests (`test/editor_state.test.js` or new `test/insert_node.test.js`)

Add a Conv fixture with initializer inputs:

```javascript
const weight = { name: 'W', initializer: { /* or truthy stub */ } };
const bias = { name: 'B', initializer: { /* stub */ } };
const activation = { name: 'act_in' };

conv.inputs = [
  { name: 'X', value: [activation] },
  { name: 'W', value: [weight] },
  { name: 'B', value: [bias] },
];
```

**Test 1 — weights preserved (primary bug):**
- Insert Abs above Conv via `insertNode(graph, convIndex, 'above', absNodeSpec)`.
- Assert:
  - Abs has **1** input, **1** output.
  - Abs input value is `[activation]` (same object as before).
  - Conv `X` points to Abs output (new tensor).
  - Conv `W` still `[weight]`, Conv `B` still `[bias]`.
  - Abs inputs do **not** include W or B.

**Test 2 — regression, unary chain:**
- Relu above Conv-like node with only 1 data input → still splices correctly.

**Test 3 — regression, insert below:**
- Abs below Conv → unchanged behavior (1 output wired, downstream consumers updated).

**Test 4 — integration via `ModelEditor.applyPatch`:**
- Same Conv fixture through the patch path used by the UI (`changeType: 'add'`, `property: 'insert'`, `position: 'above'`).

Run: `node --test test/editor_state.test.js` (or whatever the project uses).


