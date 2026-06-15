2026-06-08

Tags:  [[ambarella]] [[netron]]
## fixing node rebuild resize bug

### Notes

Adding/removing attributes uses a lightweight path that re-measures only the affected node and skips the graph layout. dagre (`[source/grapher.js](source/grapher.js)` ~241, `ranksep`/`nodesep` ~258) is what reserves space between nodes based on `node.label.height`, so stale positions cause the grown node to overlap its neighbor.


```
async layout(worker) {
        let nodes = [];
        for (const node of this.nodes.values()) {
            nodes.push({
                v: node.v,
                width: node.label.width || 0,
                height: node.label.height || 0,
                parent: this.parent(node.v) });
        }
```

```
        layout.nodesep = 20;
```


Two changes in [source/view.js](vscode-file://vscode-app/c:/Users/c-lhe/AppData/Local/Programs/cursor/resources/app/out/vs/code/electron-sandbox/workbench/source/view.js) keep the full dagre reflow but reduce the logo flash and jarring re-render:

1. Stay on the default screen during incremental refresh At the start of `refresh()`, when `skipShow: true`, it now calls `_ensureDefaultScreen()`. That removes `welcome` / `spinner` from the body and keeps `default`, so the logo (which shows under `welcome.spinner` when the graph pane is transparent) does not appear behind the graph.

2. Skip the 300ms transition animation for editor reflows Attribute and name edits now pass `skipAnimation: true`. `refresh()` still rebuilds and re-runs dagre, but skips `animateTransition()` — the animation that moved every node and briefly faded elements, which felt like a full re-render.
### References