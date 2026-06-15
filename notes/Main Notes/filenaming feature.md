2026-06-10

Tags: [[ambarella]]
## filenaming feature

### Notes
# Export Filename Feature

This document describes how export filenames are chosen and how users can rename files before downloading or saving the modified ONNX graph.

## Overview

Export now uses a single naming pipeline in `view.js`:

1. Compute a suggested **basename** (no extension).
2. Ask the host for a filename via `_host.save()`.
3. Normalize to `*.onnx` and write/download the blob.

After **subgraph extract**, the suggested name includes the begin and end node names.

## User experience

### Browser

1. **File → Export Modified Model as ONNX**
2. If supported, the browser shows a native **Save file** picker (`showSaveFilePicker`) with the suggested name.
3. Otherwise, an in-app dialog lets you edit the basename before export.
4. Last-resort fallback: `window.prompt()`.

### Desktop (Electron)

1. **File → Export Modified Model as ONNX**
2. Native **Save As** dialog (via renderer `exportOnnx()` → `desktop.mjs` `save()`).
3. Suggested name uses the same basename logic as the browser.

### After subgraph extract

When you **Extract Subgraph**, the app sets:

```text
{originalBasename}_{beginNode}_to_{endNode}.onnx
```

Example: `resnet50.onnx` with begin `Conv1` and end `Relu1` → `resnet50_Conv1_to_Relu1.onnx`.

The browser tab title updates to match. Opening a new model clears the override.

## Architecture

```
exportOnnx()
  └─ _suggestedExportBasename()
       ├─ _exportBasenameOverride  (set on extract, cleared on open)
       └─ stripExportExtension(document.title)
  └─ _host.save('ONNX Model', 'onnx', basename)
       ├─ browser: showSaveFilePicker → modal → prompt
       └─ desktop: IPC showSaveDialog
  └─ normalizeExportFilename(target, 'onnx')
  └─ _host.export(filename, blob)
```

## Files

| File | Role |
|------|------|
| `source/export-filename.js` | Pure helpers: sanitize, strip extension, subgraph basename, normalize |
| `source/view.js` | `_exportBasenameOverride`, `_suggestedExportBasename()`, `exportOnnx()`, extract/open hooks |
| `source/browser.js` | `save()` with picker + modal; `_promptSaveFilename()` |
| `source/desktop.mjs` | `save()` dialog title and suggested path |
| `source/index.html` | Save dialog markup and styles |
| `test/export_filename.test.js` | Unit tests for filename helpers |

## Helper functions (`export-filename.js`)

- **`stripExportExtension(filename)`** — removes trailing extension for basename.
- **`sanitizeExportBasename(name)`** — removes invalid path characters, collapses whitespace.
- **`buildSubgraphExportBasename(base, beginName, endName)`** — `{base}_{begin}_to_{end}` or `{base}_subgraph`.
- **`normalizeExportFilename(filename, extension)`** — ensures `.onnx` suffix; returns `null` if empty.

## Unified desktop export

Electron previously used a separate main-process save dialog (`app.js` `_exportOnnx`) keyed off the original file path. ONNX export now always calls `view.exportOnnx()` from the menu (browser and desktop), so naming logic lives in one place.

The legacy `export-onnx` IPC path remains for compatibility if something still passes an explicit `file` path.

## Limitations

- Safari may not support `showSaveFilePicker`; modal fallback is used.
- Basename override is cleared on **open**, not on manual graph edits.
- PNG/SVG export still use `document.title` directly (unchanged).

## Related

See [SUBGRAPH_EXTRACT.md](./SUBGRAPH_EXTRACT.md) for marking begin/end nodes and replacing the modified graph.
### References