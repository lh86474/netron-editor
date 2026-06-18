2026-06-16

Tags: [[netron]] [[ambarella]]
## bug - graph squashed on initial open merged graph

### Notes

![[Pasted image 20260616141623.png]]

What happens
1. openMerged() -> tearDown() -> view.open(context) in merge-workspace.js
```
open() calls _updatePath() -> render() then show(null)
```
Each pane renders via
```
_renderGraphInPane() which ends with viewGraph.restore(state)
```
restore() is where viewport fit happens
```
restore(state) {

// ...

const size = canvas.getBBox();

// ... sets _width / _height from bbox ...

this._zoom = state ? state.zoom : 1;

this._updateZoom(this._zoom);

// ... scroll/center using getBoundingClientRect() ...

}
```

and updateZoom() depends on container's live size
```
    _updateZoom(zoom, e) {
        const container = this._containerElement();
        // ...
        const limit = container.clientWidth / this._width;
        const min = Math.min(Math.max(limit, 0.15), 1);
        zoom = Math.max(min, Math.min(zoom, 1.4));
        // ...
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        container.scrollLeft = this._scrollLeft;
        container.scrollTop = this._scrollTop;
    }
```

**Nothing re-runs restore()**
```
this.teardown();

this._view.show('welcome spinner');

await this._view.open(context);
```
We added this to openMerged()

### References