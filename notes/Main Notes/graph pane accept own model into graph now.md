2026-06-16

Tags: [[ambarella]] [[netron]]
## bug - clicking undo a lot after editing a node's attributes will lead to a blank pane

### Notes

Fixed. Merge panes now pass their own model into graph rendering instead of relying on the main view’s (often null) `view.model`.

Changes:

1. `graph-pane.js` — `render()` accepts an optional 4th `model` argument and forwards it to `_renderGraphInPane`.
    
2. `view.js`
    
    - `_renderGraphInPane` and `_graphOptions` accept an optional `model`.
    - `view.Graph` stores it as `_renderModel`; the `model` getter returns `_renderModel || view.model`.
    - `add()` uses a safe fallback if no model identifier is available.
3. `merge-workspace.js`
    
    - `_renderPreview` passes the opened merged model.
    - `_renderSourcePanes` passes `upstream.model` and `downstream.model`.

After uploading two compatible ONNX files from the welcome screen, the merged preview should render without the `identifier` error. The same fix applies when toggling “Show source graphs”.
### References