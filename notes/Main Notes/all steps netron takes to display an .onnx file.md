2026-06-03

Tags: [[ambarella]] [[netron]]
## all steps netron takes to display an .onnx file

### Notes
## Phase 1: App startup (once)

1. Electron main 1 opens a window and loads `source/index.html` with preload `source/desktop.mjs`.
2. `index.js` preloads core modules (`view`, `browser`, `grapher`, `zip`, `protobuf`, …) and creates `desktop.Host` + `view.View` (~`index.js` 109–115).
3. `view.View.start()` shows the welcome screen and waits for a file.

---

## Phase 2: User picks the file

4. User Open / drag-drop / CLI path → Electron sends path to renderer → `desktop.Host._open` (~`desktop.mjs` 470–506).
5. `view.accept(path, size)` checks extension/size against `ModelFactoryService` registry (~`view.js` 722–724, registry ~7234–7310).
6. UI shows spinner (`show('welcome spinner')`).
7. `desktop.Host._context(path)` (~442–448): read file bytes into a stream → `desktop.Context` (identifier = filename, stream, optional sibling files in same folder).

---

## Phase 3: Find format and parse into canonical model

8. `view.open(context)` (~`view.js` 726–758).
9. `ModelFactoryService.open(context)` (~7327–7391):
    - Wrap in `view.Context` (~6713+).
    - If needed: unzip/tar and open inner files (~7339–7356).
10. `_openContext` (~7706–7746): for each candidate format module (including `./onnx`):
    - `factory.match(context)` — for ONNX, try readers (`ProtoReader`, `OrtReader`, …) (~`onnx.js` 7–32).
    - On match, `factory.open(context)` runs.

ONNX branch:

11. `onnx.ModelFactory.open` (~`onnx.js` 35–39): reader `read()` → protobuf `ModelProto` in memory.
12. Load `onnx.Metadata` from `onnx-metadata.json` (~1329–1341).
13. `new onnx.Model(metadata, target)` (~47–117):
    - Build `onnx.Context.Model`, main `onnx.Graph` (~161–214).
14. Inside `onnx.Graph` constructor (~161–214):
    - Map graph inputs/outputs to tensors (~179–194).
    - `onnx.Inference` on outputs (~195–197) — shape/type propagation.
    - `context.push(graph.node, graph.input, graph.output)` (~1270–1308):
        - Filter/fold some nodes (e.g. Constant → initializer, ~1283–1299).
        - `new onnx.Node(...)` for each remaining raw node (~1301–1303).
    - `context.pop()` → `graph.nodes` list (canonical op list).
    - Build graph-level `inputs` / `outputs` arguments (~201–214).
15. Return `onnx.Model` to `view.open` — object with `format`, `modules` (graphs), optional `functions`.

---

## Phase 4: Choose what to display

16. `view.open` picks first module with nodes (~745–757), builds navigation `path` `[{ target, signature }]`.
17. `_updateTarget(model, path)` → `_updatePath` (~804–819).
18. `render(activeTarget, activeSignature)` (~914–947) — this is where the picture is built.

---

## Phase 5: Canonical graph → visual graph

19. `new view.Graph(view, groups)` (~930).
20. `viewGraph.add(graph, signature)` (~1968–2072):
    - Graph inputs → `view.Input` nodes, wire tensor values (~1989–1998).
    - For each canonical `graph.nodes` entry → `view.Node` (~2000–2057):
        - `view.Node._add` sets label (`content`) and CSS classes (~2825–2848).
        - Register each output value: `createValue(value).from = viewNode` (~2010–2018).
        - Downstream ops register same value names on `.to` when processing inputs (~2786–2808 in `view.Node` ctor).
    - Graph outputs → `view.Output` (~2059–2070).
21. `addTunnels()` — extra edges for subgraph attributes (~2074+).
22. `viewGraph.build(document)` (~2313–2340):
    - Create SVG canvas under `#target`.
    - `value.build()` for every tensor (3198–3228).
    - `grapher.Graph.build` — create SVG groups for nodes/edges (~`grapher.js` 106+).
23. `measure()` — text sizes, node dimensions (~2343+, `grapher.js`).
24. `layout(worker)` — Dagre positions nodes (~`grapher.js` 224–272, `worker.js`).
25. `update()` + `updateTunnels()` — apply coordinates, draw paths (~941–943).
26. `view.show(null)` — hide spinner; user sees the graph (~825)
### References