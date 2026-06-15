2026-06-05

Tags: [[ambarella]] [[netron]]
## what view.js does

### Notes

Since you have `grapher.js` open: `view.js` decides _what_ to show; `grapher.js` decides _how_ to draw it (boxes, lines, arrows, CSS).

`view.js` is Netron’s application controller and UI layer — it sits between the host (`browser.js` / `desktop.mjs`) and the format parsers (`onnx.js`, `pytorch.js`, …). Here’s what it does, grouped by responsibility.

---

## Core app (`view.View`)

The main class that runs the app after startup.

- Bootstraps the UI — wires toolbar buttons, keyboard shortcuts, host integration
- Manages screens — welcome, loading spinner, default graph view (`show()`)
- Opens models — delegates to `ModelFactoryService`, picks initial graph/module to display
- Attaches extra files — metadata sidecars via `attach()` (e.g. metrics, custom metadata)
- Navigation stack — drill into subgraphs (`pushTarget`) and go back (`popTarget` / Backspace)
- Renders the active graph — builds layout, shows canvas (`render()`)
- Reloads the graph — when toggling display options (`_reload()`)
- Shows progress — loading bar while opening large models
- Error handling — user-facing errors, exception reporting to host
- About dialog — version info
- Disposes resources — cancels layout worker on shutdown

---

## Display options & view modes

User toggles (View menu / shortcuts), persisted via host settings:

- Show/hide node names
- Show/hide attributes on nodes
- Show/hide weights (initializers on the graph)
- Graph direction — vertical vs horizontal layout
- Mouse wheel — scroll vs zoom
- Zoom in / out / reset
- Copy selected node names to clipboard (Electron)

---

## Menus & commands (`view.Menu`)

- Builds File / View / Help menus (Open, Export, Reload, Find, toggles, etc.)
- Handles accelerators (Ctrl+O, F5, F11, etc.)
- Recent files list (Electron)
- Developer Tools entry when running from source

---

## Model loading (`view.ModelFactoryService`)

The “which file is this?” router — registers 40+ format modules:

- Detects format by extension, magic bytes, or file content
- Opens archives — zip, tar, gzip containers with multiple files inside
- Dispatches to the right parser (`onnx.js`, `pytorch.js`, `tf.js`, …)
- Prefetches modules/assets in browser mode (including `onnx-metadata.json`)
- Signature files — special `.netron` / message formats

This is how a dropped `.onnx`, `.pt`, `.tflite`, etc. becomes a unified internal model.

---

## Graph building & interaction (`view.Graph` + node types)

Extends `grapher.Graph` — turns a parsed model into an interactive canvas.

- Builds graph elements — nodes, edges, inputs, outputs, values, blocks
- Layout — measures sizes, runs dagre layout (optionally in a Web Worker)
- Selection — click to select nodes/edges, multi-select, focus/blur
- Scroll & pan — navigate large graphs
- Tunnels — visual routing for long edges across groups
- Groups / compound nodes — nested subgraphs, scopes
- Animated transitions when graph updates
- Find-in-graph integration — highlight matches from Find sidebar
- State restore — remembers zoom/pan/blocks when navigating back

Related classes: `view.Node`, `view.Edge`, `view.Input`, `view.Output`, `view.Value`, `view.Argument`, `view.Block`.

---

## Sidebars (property panels)

Click something → inspect it in the right panel:

|Sidebar|Shows|
|---|---|
|ModelSidebar|Model format, producer, version, metadata|
|TargetSidebar|Current graph/module properties|
|NodeSidebar|Node type, name, attributes, inputs/outputs|
|ConnectionSidebar|Edge / tensor flowing between nodes|
|TensorSidebar|Tensor shape, dtype, data preview|
|DocumentationSidebar|Op docs from metadata (description, attrs, examples)|
|FindSidebar|Search nodes by name/type in the graph|

Plus reusable UI widgets: `Expander`, `TensorView`, `ArgumentView`, `PrimitiveView`, etc.

---

## Export

- Export graph as PNG or SVG — raster/vector snapshot of the canvas (`export()`)
- Applies `grapher.css` styles into the exported SVG

---

## Documentation & formatting

- `view.Documentation` — turns metadata (from `onnx-metadata.json`, etc.) into HTML for the docs sidebar
- `view.Formatter` — formats tensor values, numbers, strings for display in property panels
- `view.Quantization` — displays quantization-related info on tensors/nodes

---

## Supporting infrastructure

- `view.Worker` — background thread for graph layout on large models
- `view.Context` / `view.Container` — file reading abstraction (peek bytes, decode zip/tar, nested entries)
- `view.Metadata` — loads format metadata JSON files for the UI
- Markdown / PNG helpers — internal utilities for docs rendering and export

---

## What `view.js` does not do

| Not in view.js                         | Handled by                 |
| -------------------------------------- | -------------------------- |
| Parsing `.onnx` bytes                  | `onnx.js`, `onnx-proto.js` |
| Drawing primitives (SVG paths, arrows) | `grapher.js`               |
| OS file dialogs, Electron menus        | `app.js`, `desktop.mjs`    |
| Operator schema definitions            | `onnx-metadata.json`       |

---

## Mental model

browser.js / desktop.mjsview.ViewModelFactoryServiceonnx.js, pytorch.js, ...view.Graphgrapher.jsSidebars / Documentation

In one sentence: `view.js` is everything the user sees and interacts with — open a model, pick the format, lay out the graph, inspect nodes/tensors, search, export, and navigate subgraphs — while delegating parsing to format modules and low-level drawing to `grapher.js`.

Since you have `grapher.js` open: `view.js` decides _what_ to show; `grapher.js` decides _how_ to draw it (boxes, lines,
