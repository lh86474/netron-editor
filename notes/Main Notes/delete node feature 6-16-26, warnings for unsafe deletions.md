2026-06-16

Tags: [[netron]] [[ambarella]]
## delete node feature 6-16-26

### Notes
**I need to support a feature to delete nodes**

Entry point is the right-click:
1. User right-clicks node SVG
2. grapher.Node contextmenu listener
3. view.Node.onContextMenu
4. view._showNodeContext
5. view.GraphContextMenu
6. item.action - your deletion

Not all of the nodes can be deleted. We have to make sure that the rewiring is unambiguous
- If there's one input, 1 output, delete is allowed
- N Inptus, N Outputs
- But when the number of inptus and output is different, not allowed. 
### User-facing

- Right-click a node on the **modified (right) pane** → **Delete Node…**
- Graph removes the node, rewires downstream tensors to upstream inputs, and **rebuilds layout**
- Unsafe deletes are **blocked** with a clear message (menu item disabled or error dialog)
- Deleted original nodes appear in delta as `delete`; inserted-then-deleted nodes leave **no** delta entry

### Technical

- Modified graph stays **valid** (no dangling tensor references; export `validateGraph` passes)
- Delta **entity IDs** remain coherent after index shifts (`remapNodeIndices` with offset `-1`)
- ONNX export reflects the updated topology

### Non-goals (v1)

- Delete via sidebar or keyboard
- Cascade delete of downstream subgraph
- Undo/redo
- Delete on left (read-only) pane

---

## 2. Architecture overview

```
User right-clicks node (modified pane)
    → grapher.Node contextmenu (grapher.js)          [exists]
    → view.Node.onContextMenu (view.js)              [exists]
    → view._showNodeContextMenu (view.js)            [add menu item]
    → view._deleteNodeAt (view.js)                   [new]
    → view.applyEditorPatch (view.js)                [exists]
    → EditorState.applyPatch (model-editor.js)       [add delete branch]
    → deleteNode + canDeleteNode (model-editor.js)   [new]
    → DeltaTracker.record + remapNodeIndices         [exists, extend usage]
    → delta.subscribe → _handleEditorDelta (view.js) [extend refresh trigger]
    → view.refresh()                                 [exists]
    → onnx-export rebuild from modifiedGraph.nodes   [mostly exists]
```

---

## 3. Deletion semantics

### Safe bypass delete (v1)

For node `X` with inputs `[A, …]` and outputs `[B, …]`:

```
Before:  A ──► [X] ──► downstream…
After:   A ──────────► downstream…
```

**Rewiring rule:** For each output slot `i`, every consumer of `output[i]` (including `graph.outputs`) is updated to reference the bypass tensor:

| Outputs | Inputs             | Rule                                            |
| ------- | ------------------ | ----------------------------------------------- |
| 1       | 1                  | `output[0]` → `input[0]`                        |
| N       | N (same arity)     | `output[i]` → `input[i]`                        |
| 1       | M (M > 1)          | **Block** unless all inputs are the same tensor |
| N       | M (N ≠ M, not 1:1) | **Block**                                       |
| ≥1      | 0                  | **Block**                                       |

Reuse `findValueConsumers` / `findValueProducers` from `model-editor.js` (same pattern as `insertNode` consumer loop ~lines 885–891).

### Delta behavior

| Node origin                                 | On delete                                                     |
| ------------------------------------------- | ------------------------------------------------------------- |
| Original (in snapshot)                      | Record `changeType: 'delete'` at `graph:G/node:N` (tombstone) |
| Inserted (`delta.getState(id) === 'added'`) | Remove from `_changes` entirely                               |

After splice at index `N`: `delta.remapNodeIndices(G, N + 1, -1)`.

---

## 4. Implementation phases

### Phase 1 — Model layer (`source/model-editor.js`)

**New exports**

```javascript
export class NodeDeleteError extends Error { … }

export const canDeleteNode(graph, node) → { ok: boolean, reason?: string }

export const deleteNode(graph, nodeIndex) → { deletedIndex, node, rewiredPairs }
```

**`canDeleteNode` checks**

1. Node exists in `graph.nodes`
2. At least one input tensor to bypass from
3. Arity / ambiguity rules from §3
4. (Optional) warn if node is only node in graph — allow or block (recommend **allow**)

**`deleteNode` steps**

1. Call `canDeleteNode`; throw `NodeDeleteError` if not ok
2. For each output index `i`: resolve bypass input; rewire all consumers via `findValueConsumers`
3. `graph.nodes.splice(nodeIndex, 1)`
4. Return metadata for tests / logging

**Extend `EditorState.applyPatch`**

New patch:

```javascript
{
  entityId: 'graph:0/node:2',
  entityType: 'node',
  changeType: 'delete',
  property: 'remove'
}
```

Handler (after insert branch ~1074):

```javascript
} else if (patch.changeType === 'delete' && patch.entityType === 'node') {
    const location = parseNodeEntityId(entityId);
    const graph = this.modified.getGraph(location.graphIndex);
    deleteNode(graph, location.nodeIndex);
    this.delta.remapNodeIndices(location.graphIndex, location.nodeIndex + 1, -1);
    // entityId stays as tombstone for original nodes
}
```

**Value entity IDs (follow-up if needed)**

- If attribute/value deltas break after delete, add `remapValueEntityIds` in `delta-tracker.js`
- Defer unless tests fail in Phase 1

---

### Phase 2 — View / UI (`source/view.js`, `source/index.html`)

#### 2a. Context menu entry point (primary)

**File:** `view.js` → `_showNodeContextMenu` (~809)

Add after Insert Below / before range-marker separator:

```javascript
const node = entity
    ? this._editSession.modified.getGraph(entity.graphIndex).nodes[entity.nodeIndex]
    : null;
const deleteCheck = node ? canDeleteNode(graph, node) : { ok: false };

{
    label: 'Delete Node\u2026',
    action: () => this._deleteNodeAt(nodeView),
    enabled: deleteCheck.ok
}
```

Optional: append `title` on disabled item via extended `GraphContextMenu` or show `deleteCheck.reason` in a tooltip later.

#### 2b. Delete handler

**New method:** `view._deleteNodeAt(nodeView)` — mirror `insertNodeAt` (~971)

```javascript
async _deleteNodeAt(nodeView) {
    if (!this._canEditGraph()) return;

    const entity = this._resolveNodeEntity(nodeView.value);
    if (!entity) {
        this.error(new Error('Node entity not found.'), 'Error deleting node.', null);
        return;
    }

    const graph = this._editSession.modified.getGraph(entity.graphIndex);
    const node = graph.nodes[entity.nodeIndex];
    const check = canDeleteNode(graph, node);
    if (!check.ok) {
        await this._host.message(check.reason, true, 'OK');
        return;
    }

    // v1: no confirm dialog (host.message is single-button)
    // v1.1: add confirm dialog in browser.js

    this._closeGraphOverlays();
    if (this._sidebar.identifier === 'node') {
        this._sidebar.close(); // avoid stale sidebar for deleted node
    }

    await this.applyEditorPatch({
        entityId: entity.nodeId,
        entityType: 'node',
        changeType: 'delete',
        property: 'remove'
    });
}
```


Update call sites: `onContextMenu`, `_showNodeContextMenu`, `insertNodeAt`, `_deleteNodeAt`.

#### 2d. Graph refresh trigger

**File:** `view.js` → `_editorChangeNeedsGraphRefresh` (~736)

```javascript
if (change.entityType === 'node' && change.changeType === 'delete') {
    return true;
}
```


Extend `GraphContextMenu` to accept `destructive: true` on items.

**No changes needed in `grapher.js`** — existing `contextmenu` hook covers delete.

---

### Phase 3 — Export (`source/onnx-export.js`)

**Verify existing behavior**

- `rebuildGraphProtoFromModified` builds `graph.node` only from `modifiedGraph.nodes` → deleted nodes omitted automatically
- `collectArgumentValueNamesFromGraph` filters unused initializers / value_info

**Tasks**

1. Add export test: delete middle node in chain → `validateGraph` passes
2. If proto input/output names drift, ensure `deleteNode` rewires `graph.outputs` consumers (via `findValueConsumers` with `graphOutput: true`)
3. (Optional) Generalize `applyNodeInsertions` → `applyStructuralNodeChanges` — not required if rebuild path is sufficient

---

### Phase 4 — Tests

#### `test/editor_state.test.js`

| Test                            | Assertion                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------- |
| Delete middle of chain          | Softmax input becomes Conv output tensor name                                 |
| Delete inserted node            | Topology restored; delta has no entry for that node                           |
| Delete remaps later node deltas | Attribute change on node 3 survives delete of node 1 with remapped `entityId` |
| Block ambiguous delete          | Multi-I/O mismatch throws `NodeDeleteError`                                   |
| `canDeleteNode` false           | Returns `{ ok: false, reason: '…' }`                                          |

Use `mockChainModel` from `test/fixtures/mock-graph.js`.

#### `test/onnx_export.test.js`

| Test                 | Assertion                           |
| -------------------- | ----------------------------------- |
| Delete + export      | Round-trip ONNX; no dangling inputs |
| Graph output rewired | Output name matches bypass tensor   |

## 5. File change summary

| File                        | Changes                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `source/model-editor.js`    | `NodeDeleteError`, `canDeleteNode`, `deleteNode`, `applyPatch` delete branch                  |
| `source/view.js`            | Menu item, `_deleteNodeAt`, `_editorChangeNeedsGraphRefresh`, optional `_canEditGraph` rename |
| `source/delta-tracker.js`   | Only if value-ID remapping needed                                                             |
| `source/onnx-export.js`     | Tests only (unless gaps found)                                                                |
| `source/index.html`         | Optional destructive menu style                                                               |
| `test/editor_state.test.js` | Model + delta tests                                                                           |
| `test/onnx_export.test.js`  | Export tests                                                                                  |

| Risk                               | Mitigation                                                    |
| ---------------------------------- | ------------------------------------------------------------- |
| Ambiguous multi-I/O graphs         | Strict `canDeleteNode`; disable menu item                     |
| Value entity ID drift after splice | Add `remapValueEntityIds` if tests fail                       |
| Layout jump on rebuild             | Existing `refresh({ skipAnimation: true })` via delta handler |
| Accidental delete                  | v1.1: confirm dialog with Cancel                              |
| Stale node sidebar                 | Close sidebar in `_deleteNodeAt`                              |


