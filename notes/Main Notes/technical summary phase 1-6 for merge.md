2026-06-12![[Pasted image 20260615122714.png]]

Tags: [[ambarella]] [[netron]]
## technical summary phase 1-6 for merge

### Notes

# Technical Summary: ONNX Graph Merge (Phases 1–6)

End-to-end feature to load two binary ONNX models, auto-detect upstream/downstream roles, map tensor connections, preview the merged graph, and export or open the result.

---

## Architecture Overview

```
Entry points (view.js, app.js, index.html)
        ↓
MergeWorkspaceController (merge-workspace.js)  ← UI + GraphPane rendering
        ↓
MergeSession (merge-session.js)              ← slot state, roles, mapping, validation
        ↓
model-merge.js                                 ← detect, validate, merge protobufs
        ↓
onnx-export.js (*ForMerge exports)            ← rename, validate graph structure
```

**Key design choices:**
- Slots A/B are load-order neutral; roles are derived, not fixed to slots.
- Mapping is explicit: `{ upstream: outputName, downstream: inputName }`.
- Preview is in-memory only (encode proto → `BytesFileContext` → model factory).
- Merge workspace is a separate screen mode (`merge-workspace`), not the diff panes.

---

## Phase 1 — Core Merge Logic (`source/model-merge.js`)

New module (~820 lines) implementing the full merge pipeline.

### Type system & graph introspection
- `extractGraphInputs` / `extractGraphOutputs` — enumerate graph I/O
- `resolveValueType` — resolve tensor types from `value_info`, inputs, or producer nodes
- `formatType` — human-readable type/shape strings
- `areTypesCompatible` — elem type, rank, and dim checks (with partial-shape warnings)

### Automatic mapping
- `buildAutomaticMapping(upstream, downstream)` — for each downstream input, pick a unique compatible upstream output; prefers exact name matches; fails on ambiguity or missing types
- `buildAutomaticMappingBidirectional(protoA, protoB)` — tries both orderings, scores candidates, picks the winner

### Role detection (Phase 1 centerpiece)
- `detectMergeRoles(protoA, protoB)` — determines which slot is upstream/downstream
- Scoring via `scoreMappingCandidate`: mapping count + exact-name bonus − warnings
- Tie-breakers: score → exact name matches → fewer warnings → `ioFit` (outputs − inputs) → slot A preference (in `detectMergeRoles` only)
- Returns `{ ok, status, upstreamSlot, mapping, confidence, errors, warnings }`
  - `confidence`: `'high'` | `'low'` when both directions work but scores are close
  - `status`: `'unidirectional'` | `'resolved'` | `'failed'`

### Validation
- `validateMapping` — per-row type checks, duplicate mapping, unmapped inputs, name collisions (warnings)
- `validateMerge` — model-level checks (external weights rejected, custom functions warned) + mapping validation
- Issues use structured `{ code, message, severity, upstream?, downstream? }`

### Merge execution
Pipeline in `mergeModelProtos`:
1. Clone protos
2. `prefixDownstreamGraph` — rename colliding downstream names (`downstream_` prefix)
3. `applyMappingRenames` — rewrite downstream references to upstream output names
4. `removeMappedDownstreamInputs` — drop internalized downstream inputs
5. `mergeGraphProtos` — concatenate nodes; upstream inputs + downstream outputs; union initializers
6. `normalizeGraphReferences` + `validateGraph` (from `onnx-export.js`)
7. Build merged `ModelProto` (opset merge, metadata, doc string)

- `tryMergeOnnxModels` — validate then merge; returns `{ ok, mergedProto?, errors?, warnings? }`

### Error formatting
- `formatMergeErrors(errors, { inline })` — dialog vs inline summary variants; sections for mapping, input, and other issues
- `formatMergeWarnings(warnings, { inline })` — lists warnings with mapping context

### Supporting exports from `onnx-export.js`
Re-exported as `*ForMerge` aliases so tests and merge logic can use existing graph utilities without coupling to the editor export path.

### Tests: `test/model_merge.test.js` (24 tests)
Covers merge success/failure cases, automatic mapping, bidirectional detection, role detection, error formatting.

---

## Phase 2 — Session State (`source/merge-session.js`)

`MergeSession` / `createMergeSession()` centralizes workspace state.

### State model
| Field              | Purpose                                    |
| ------------------ | ------------------------------------------ |
| `slotA`, `slotB`   | `{ model, proto, target, filename }`       |
| `roleDetection`    | Auto-detect result + `userOverridden` flag |
| `mapping`          | Connection table                           |
| `mappingSource`    | `'empty'` \| `'auto'` \| `'manual'`        |
| `validation`       | `{ ok, errors, warnings }`                 |
| `showSourceGraphs` | Toggle state                               |
| `mergedPreview`    | Cached preview render result               |

### Behavior
- `setSlotModel` / `clearSlot` → triggers `resolveRoles()` when both slots loaded
- `resolveRoles()` → calls `detectMergeRoles`, pre-fills mapping on success
- `swapRoles()` → flips `upstreamSlot`, sets `userOverridden`; clears mapping if invalid under new roles
- `updateMappingRow` / `setMapping` → manual edits, revalidates
- `canOpenMerged()` → `validation.ok && mapping.length > 0`
- `getRoleSummary()` — user-facing direction string

### Tests: `test/merge_session.test.js` (9 tests)
Slot loading, auto-detection, swap, manual mapping, merge via session mapping.

---

## Phase 3 — Merge Workspace UI Shell (`source/merge-workspace.js`, `source/index.html`)

### DOM (`#merge-container`)
- Header + Cancel
- Toolbar: Model A/B browse, role badges, Swap roles, Show source graphs toggle
- Mapping strip: table + validation summary
- Graph area: merged preview pane (always); source panes (conditional)
- Footer: Export merged / Open merged

### `MergeWorkspaceController`
- `start(options)` — creates session, shows `merge-workspace` screen, optional `presetModel` in slot A
- `teardown()` — clears panes, returns to prior screen
- File loading via `LocalFileContext` / `BytesFileContext` (custom contexts delegating `require`, `asset`, `error` to host)
- `refreshUI()` — slot labels, badges, mapping table, validation, preview, buttons

### Mapping table
- One row per downstream input
- Dropdown of upstream outputs; live type compatibility badges (✓ / ⚠ / ✗)
- Edits call `session.updateMappingRow` and revalidate

### Live merged preview
- Debounced ~400ms via `_refreshPreview`
- Only when `validation.ok`
- `tryMergeOnnxModels` → encode → open via model factory → `GraphPane.render` on `#merge-preview-pane` (read-only)

### Wiring in `view.js`
- `MergeWorkspaceController` instantiated on view
- `bindEvents()` on init
- `_canMergeOnnx()` — `model.exportable && model.proto`

---

## Phase 4 — Optional Source Graphs

### UI
- Checkbox **Show source graphs** (disabled until both models loaded and roles resolved)
- `#merge-source-row` with upstream/downstream read-only `GraphPane`s above merged preview
- CSS: `.show-source-graphs` toggles layout; sources get ~flex 1, preview ~1.2

### Logic
- `_onShowSourceGraphsChanged` — lazy render or clear
- `_renderSourcePanes` — renders upstream/downstream targets from session
- Re-renders on `refreshUI` when toggle is on (e.g. after swap)
- `teardown` / toggle-off clears and unregisters graphs

### Bug fixes included in this phase
- Fixed `BytesFileContext` missing host in `openMerged`
- Removed CSS rule that hid graph panes in merge workspace (scoped hiding to diff container only)

**Not implemented (deferred v1.1):** row-focus highlight in source panes when a mapping row is selected.

---

## Phase 5 — Entry Points

### `view.js`
- `startMergeWorkspace()` — pre-fills slot A from current model when mergeable; otherwise empty workspace
- **File menu** (browser hamburger, both platform branches): **Merge ONNX Graph…**
- **Model Properties sidebar** — Actions → Merge ONNX Graph…
- **Graph Properties sidebar** — same when `target.type === 'graph'`

### `app.js` (Electron)
- File → **Merge ONNX Graph…**
- `_mergeOnnx()` → `view.startMergeWorkspace()`

### `index.html`
- Welcome screen button: **Merge Two ONNX Graphs…** → empty workspace

Preset behavior: when opening from an existing model, slot A gets `{ model, proto, target, filename }` derived from `activeTarget` and document title basename.

---

## Phase 6 — Polish

### Validation summary panel
- State CSS classes: `merge-summary-ready` | `-warning` | `-error` | `-pending`
- Inline errors via `formatMergeErrors(..., { inline: true })` (no dialog header)
- Full warning text via `formatMergeWarnings` (role detection + validation warnings, deduped)
- Ready state shows `✓ Ready to merge` plus warning details when applicable

### Mapping table polish
- Row background highlights for error/warning rows
- Unmapped inputs show ✗ in status column

### Export / open polish
- `buildMergeFilename(upstream, downstream)` → `{upstream}_merged_{downstream}.onnx` (`export-filename.js`)
- **Open merged** sets `document.title` to merged filename
- **Export merged** uses save dialog with that default name
- Unexpected failures still use `_host.message(formatMergeErrors(...))` (full dialog format)

### Tests added in Phase 6
- Inline error formatting
- Warning formatting  
**Total merge-related tests: 33** (24 + 9), all passing.

---

## File Inventory

| File | Role |
|---|---|
| `source/model-merge.js` | Merge/validate/detect API |
| `source/merge-session.js` | Session state machine |
| `source/merge-workspace.js` | UI controller (~745 lines) |
| `source/view.js` | Integration, entry points, sidebars |
| `source/app.js` | Electron menu |
| `source/index.html` | DOM + CSS for merge workspace |
| `source/export-filename.js` | `buildMergeFilename()` |
| `source/onnx-export.js` | `*ForMerge` re-exports |
| `test/model_merge.test.js` | Core logic tests |
| `test/merge_session.test.js` | Session tests |
| `merge_UI_plan.md` | Design reference (not runtime) |

---

## Limitations (by design in v1)

- Binary `.onnx` only (no external weights)
- Custom functions not merged (warned)
- Name collisions auto-prefixed at merge time (warned in validation)
- No UI/integration tests for the workspace itself
- No mapping-row → source-pane highlight sync

---

## Data Flow (happy path)

1. User loads Model A and B (or preset A from current model).
2. `MergeSession.resolveRoles()` → `detectMergeRoles` → upstream slot + auto mapping.
3. Mapping table rendered; user can edit rows or swap roles.
4. Each change → `validateMerge` → summary + row badges update.
5. When valid → debounced preview merge → merged graph in preview pane.
6. **Open merged** or **Export merged** → `tryMergeOnnxModels` → bytes → normal editor view or file save.

That covers the full implementation from Phase 1 through Phase 6.