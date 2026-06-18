2026-06-17

Tags: [[ambarella]] [[netron]]
## auditing merge feature

### Notes

![[Pasted image 20260617093417.png]]

For upstream

![[Pasted image 20260617093438.png]]

#### Root cause

These errors come from two gaps in how Graph Properties is wired for read-only / source panes. 
Error when it reaches metadata and when I interact with I/O

Error: Cannot read properties of null (reading 'attachment')
- Thrown while building the sidebar

Cannot read properties of undefined (reading 'focus') / 'blur'
- thrown when I hover over expanded I/O row in the sidebar. Each hover **fires focus/blur handlers**

#### TargetSidebar assumes view.model is always set
```
        const metadata = this._view.model.attachment.metadata.graph(target);
        if (Array.isArray(metadata) && metadata.length > 0) {
            this.addSection('Metadata');
            for (const argument of metadata) {
                this.addArgument(argument.name, argument, 'attribute');
            }
        }
        const metrics = this.metrics;
        // ...
    get metrics() {
        const target = new metrics.Target(this._target);
        return this._view.model.attachment.metrics.graph(target);
    }
```
The panes in merge workspace source graphs render on their own via Graph.Pane.render
- So, the main view.model is often null in merge workspace

### focus/blur always use this._target, which isn't in source pane

```
            sidebar.on('focus', (sender, value) => {
                this._target.focus([value]);
            });
            sidebar.on('blur', (sender, value) => {
                this._target.blur([value]);
            });
```
```
            if (status === '' && this._rightPane.graph) {
                this.target = this._rightPane.graph;
```

target is only set to the right (modified pane)

```
        title.on('click', () => this.context.view.showTargetProperties(this.target));
```

merge graphs have readOnly: true

Graph Properties used to always assume that we just have one model view.model and one grapher, which is the 
```
view._target
```

Because we usually just work with two panes

```
    resolveModelForTarget(target) {
        if (!this._session || !target) {
            return null;
        }
        for (const entry of [this._session.getUpstream(), this._session.getDownstream()]) {
            if (entry && entry.target === target) {
                return entry.model;
            }
        }
        return null;
    }

    resolveGrapherForTarget(target) {
        if (!target) {
            return null;
        }
        for (const pane of [this._upstreamSourcePane, this._downstreamSourcePane, this._previewPane]) {
            const graph = pane && pane.graph;
            if (graph && graph.target === target) {
                return graph;
            }
        }
        return null;
    }
	
```
#### Solution


