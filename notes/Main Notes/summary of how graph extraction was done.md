2026-06-10

Tags: [[ambarella]] [[netron]]
## summary of how graph extraction was done

### Notes

# Subgraph Extract Feature

This document describes the subgraph marking, extraction, replacement, and export feature added to the Netron editor.

## Overview

Users can mark two nodes in the modified (editable) graph pane as a **beginning** and **end** of a range, then extract the subgraph between them (inclusive). The modified editor graph is replaced with that slice, and the result can be exported as ONNX via the existing export command.

## User workflow

1. Open an editable ONNX model (modified pane, not read-only).
2. Right-click a node in the modified graph.
3. Choose **Mark as Beginning** or **Mark as End**.
   - Begin nodes show a **green** border.
   - End nodes show a **blue** border.
   - If begin and end are in different graphs, marking the second clears the first.
4. When both markers are set, choose **Extract Subgraph** from the same context menu.
5. The modified pane re-renders with only the extracted nodes. Edit history (delta) is reset for the new graph.
6. Use **File → Export Modified Model as ONNX** to save the subgraph.

Context menu items:

| Item                | Description                                            |
| ------------------- | ------------------------------------------------------ |
| Mark as Beginning   | Sets the range start node                              |
| Mark as End         | Sets the range end node                                |
| Clear Range Markers | Removes begin/end markers                              |
| Extract Subgraph    | Enabled when both markers are set; performs extraction |

## Semantics

**Nodes included:** intersection of

- nodes forward-reachable from the begin node (following output tensors), and
- nodes backward-reachable from the end node (following input tensors),

including both begin and end.

**Boundary I/O:**

- **Inputs:** tensors consumed by kept nodes that are not produced inside the kept set (excluding initializers).
- **Outputs:** tensors produced by kept nodes that are consumed outside the kept set or by the original graph output.

**Errors:**

- End not reachable from begin → error dialog, no change.
- Marked nodes missing after prior edits → error dialog.

The left (original) pane is unchanged after extract; only the modified pane and export baseline are updated.

## Files changed

### `source/model-editor.js`

- `SubgraphExtractError` — typed error for invalid ranges.
- `findValueProducers()` — upstream counterpart to `findValueConsumers()`.
- `argumentValues()` — normalizes single-value and array-valued arguments.
- `collectNodesBetween()` — computes the node set between begin and end.
- `extractSubgraph()` — clones the slice with boundary inputs/outputs.
- `EditorState.replaceGraph()` — swaps a module graph and resets the delta tracker.

### `source/onnx-export.js`

- `rebuildGraphProtoFromModified()` — rebuilds `ModelProto.graph` from the normalized modified graph, reusing existing node protos by name and filtering initializers/value_info.

Export continues to use `exportModifiedOnnx()`; after extract, `view.js` assigns the rebuilt graph to `model.proto.graph` so export emits the slice.

### `source/view.js`

- `_rangeBegin` / `_rangeEnd` state on `view.View`.
- Extended node context menu with mark/clear/extract actions.
- `_extractAndReplaceGraph()` — orchestrates extract, `replaceGraph`, proto rebuild, and pane refresh.
- `view.Node.applyRangeMarkerStyle()` — applies `.range-begin` / `.range-end` CSS classes.
- `view.Graph.refreshRangeMarkerStyles()` — refreshes markers after render.
- `view.GraphContextMenu` — supports separators and disabled items.

### `source/grapher.css`

- Styles for `.range-begin`, `.range-end`, and combined markers (light and dark themes).

### `source/index.html`

- Context menu separator and disabled-item styles.

### Tests

- `test/subgraph_extract.test.js` — reachability, extraction boundaries, `replaceGraph` delta reset.
- `test/onnx_export.test.js` — export after extract + proto rebuild.

## Architecture notes

```
User marks begin/end
        ↓
extractSubgraph(modified graph)
        ↓
editSession.replaceGraph(index, extracted)  →  delta cleared
        ↓
model.proto.graph = rebuildGraphProtoFromModified(extracted, proto)
        ↓
_refreshModifiedPane()
        ↓
Export Modified Model as ONNX  →  exportModifiedOnnx(model, session)
```

The delta-based export path alone cannot represent node deletion or I/O boundary changes. Syncing `model.proto.graph` after extract bridges the normalized editor model and ONNX export.

## Limitations

- Only supported on the modified pane when node insertion is enabled (`canExportOnnx` models).
- Multi-graph models: begin and end must share the same `graphIndex`.
- Parallel branches use intersection semantics (nodes on some path, not necessarily all paths).
- No undo for extract; operation is destructive on the modified side.
- Left pane still shows the full original model for comparison.
