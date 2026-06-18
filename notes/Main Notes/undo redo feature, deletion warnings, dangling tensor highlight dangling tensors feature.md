2026-06-16

Tags: [[netron]] [[ambarella]]
## undo redo feature, deletion warnings, dangling tensor highlight dangling tensors feature

### Notes
## Goals

| Feature                | Behavior                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Permissive delete**  | Allow delete on Conv, etc. by ignoring weight/initializer inputs for bypass                                   |
| **Warnings**           | Tell the user *before* delete what will happen (weights dropped, merge keeps one branch, dead branches, etc.) |
| **Dangling highlight** | After delete, visually mark nodes whose outputs nothing uses                                                  |
| **Undo / redo**        | Works for **all** graph edits: attribute/name changes, insert, delete, subgraph extract                       |
## Phase 1 — Relaxed delete + warning analysis (`model-editor.js`)

Replace strict `canDeleteNode` with two functions:

### `analyzeDeleteNode(graph, node)` → `{ ok, warnings[], needsConfirm }`

**Bypass rule (data-flow only):**

```javascript
// Primary bypass = first non-initializer input with a tensor
// Each output[i]'s consumers → that tensor (or input[i] if same arity and non-init)
// Initializer inputs (W, B) are ignored for eligibility AND rewiring
```

**Warning types** (shown in confirm dialog):

| Code                 | When                                 | Example message                                                         |
| -------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| `WEIGHTS_IGNORED`    | Node has initializer inputs          | “Weight/bias inputs will be disconnected (not used downstream).”        |
| `MERGE_NODE`         | 2+ distinct **data** inputs          | “Concat keeps only the first input path; other branches become unused.” |
| `MULTI_OUTPUT`       | `outputs.length > 1`                 | “All outputs will be rewired to the primary data input.”                |
| `DANGLING_PREDICTED` | Simulated delete leaves orphan nodes | “3 nodes may become unused (highlighted after delete).”                 |
| `BLOCKED`            | No data input at all                 | `ok: false` — only hard block                                           |

**`needsConfirm: true`** when any warning is `warning` level (merge, dangling, multi-output). Info-only (weights on Conv) can use a lighter confirm or single “OK / Delete”.

### `deleteNode` changes

- Use primary data input for bypass (ignore `initializer` on value objects).
- Return `{ ..., danglingNodes }` from post-delete `findDanglingNodes(graph)`.

### `findDanglingNodes(graph)`

A node is **dangling** if every output tensor has **zero consumers** and is **not** a graph output:

```javascript
// Reuse findValueConsumers + graph.outputs
// Skip nodes with no outputs (rare)
```

Use this **after** delete for highlight, and **before** delete (on a cloned graph or dry-run) for `DANGLING_PREDICTED` warning.

---

## Phase 2 — Confirm dialog (`browser.js`, `index.html`)

`host.message()` only has **one** button today. Add:

```javascript
async confirm(message, { title, confirmLabel: 'Delete', cancelLabel: 'Cancel' })
// returns true / false
```

Reuse the save-dialog panel pattern (two buttons) or a small modal. Delete flow:

1. `const analysis = analyzeDeleteNode(graph, node)`
2. If `!analysis.ok` → alert with reason
3. If warnings → show confirm with bullet list
4. On confirm → `applyEditorPatch(delete)` → store `danglingNodeIds` from result → refresh + highlight

**Context menu:** always `enabled: true` on Delete (warnings happen on click, not via grayed menu).

---

## Phase 3 — Dangling highlight (`view.js`, `index.html`)

Mirror **range markers** (`range-begin` / `range-end`):

| Piece        | Implementation                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------- |
| State        | `view._danglingNodeIds = new Set()` of `graph:G/node:N`                                         |
| After delete | Fill set from `findDanglingNodes`                                                               |
| Style        | `view.Node.applyDanglingStyle()` toggles class `dangling` on node border                        |
| CSS          | e.g. amber dashed border (distinct from red `edited`)                                           |
| Refresh      | `refreshDanglingStyles()` in `view.Graph`, called after `refresh()` like `refreshDeltaStyles()` |
| Clear        | On undo/redo, next edit, or “Clear warnings” (optional)                                         |

```css
.dangling > .node.node-border { stroke: rgba(230, 160, 0, 0.95); stroke-width: 2px; stroke-dasharray: 6 4; }
```

Optional: tooltip / sidebar note listing dangling node names.

---

## Phase 4 — Undo / redo (new `edit-history.js` + wiring)

**No undo exists today.** `DeltaTracker` is a cumulative diff from session start, not a step log. Structural edits also remap node indices.

### Recommended design: **checkpoints before each edit**

New `EditHistory` on `EditorState`:

```javascript
class EditHistory {
  checkpoint(session)   // call BEFORE applyPatch
  undo(session) → boolean
  redo(session) → boolean
  get canUndo / canRedo
}
```

**Each checkpoint stores:**

```javascript
{
  modules: readModel({ modules: session.modified.model.modules }).modules,  // deep clone
  deltaChanges: session.delta.getChanges()  // snapshot of change list
}
```

**Restore:**

1. Replace `session.modified.model.modules` with checkpoint modules (via `readModel` clone).
2. `session.delta.restore(checkpoint.deltaChanges)` — add method on `DeltaTracker`.
3. `view.refresh()` + `refreshDeltaStyles()` + `refreshDanglingStyles()`.
4. Recompute dangling set (or store in checkpoint).

**Hook point** — single funnel (important):

```javascript
async applyEditorPatch(patch) {
  if (!this._applyingHistory) {
    this._editSession.history.checkpoint();
  }
  ...
}
```

Also checkpoint before:

- `insertNodeAt`
- `_extractAndReplaceGraph` / `replaceGraph`
- Any direct `applyPatch` callers (sidebar attribute edits already go through `applyEditorPatch`)

**Guard:** `_applyingHistory = true` during undo/redo so restore doesn’t push new checkpoints.

### UI

- Menu: **Edit → Undo** (`CmdOrCtrl+Z`), **Redo** (`CmdOrCtrl+Shift+Z` or `CmdOrCtrl+Y`)
- Disable menu items when stack empty
- Register accelerators in `view.View.start()` like existing menu entries

### Limits

- Cap stack at ~50 checkpoints (full graph clone — fine for typical ONNX sizes).
- `replaceGraph` (subgraph extract) is one undo step — good.

### What undo restores

| Edit type                      | Restored?                                                             |
| ------------------------------ | --------------------------------------------------------------------- |
| Attribute / name / value edits | Yes                                                                   |
| Insert node                    | Yes                                                                   |
| Delete node                    | Yes                                                                   |
| Subgraph extract               | Yes                                                                   |
| Range markers                  | No (UI-only, not in model) — optional separate stack or clear on undo |


## Files to touch (summary)

| File                      | Changes                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `source/model-editor.js`  | `analyzeDeleteNode`, relaxed `deleteNode`, `findDanglingNodes` |
| `source/edit-history.js`  | **new** — checkpoint / undo / redo                             |
| `source/delta-tracker.js` | `restore(changes)`                                             |
| `source/view.js`          | confirm flow, dangling styles, history hooks, menu             |
| `source/browser.js`       | `confirm()`                                                    |
| `source/index.html`       | confirm dialog HTML + `.dangling` CSS                          |
| `test/*.test.js`          | coverage                                                       |
