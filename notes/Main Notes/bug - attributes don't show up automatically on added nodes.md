2026-06-16

Tags: [[netron]] [[ambarella]]
## bug - attributes don't show up automatically on added nodes

### Notes
**Fix problem that added attributes doesn't show up immediately on added nodes**

**Probably an issue in grapher.js -> grapher.ArgumentList**
1. When attributes chance , handleEditorDelta tries to update the graph node in place
	1. That calls rebuildArgumentList() in view.js, but that method bails out if the argument list block was never created
2. argumentList is only created lazily inside _populateArgumentList
3. PopulateArgumentList never calls list(), so argumentList stays undefined
4. We add attributes in the sidebar
5. Only on a full-re-render do the attributes actually appear

```
1. Insert node → graph refreshes, node renders with no attribute rows.
2. `_populateArgumentList` never calls `list()` → `_argumentList` stays `undefined`.
3. You add attributes in the sidebar → model updates correctly, sidebar refreshes via `_refreshOpenSidebars()`.
4. Graph update calls `rebuildArgumentList()` → returns `false` immediately → nothing on the node changes.
5. Toggle attributes off/on → `_reload()` → full re-render → attributes appear.
```

### Solution

In view.js: eagerly create the arguent list when attributes are visible
```
// We add to _populateArgumentList_

if (options.attributes) {
	list();
}
```

In rebuildArgumentlist, we handle missing argumentLsit

``` javascript
async rebuildArgumentList() {
    const options = this.context.options;
    if (!options.attributes) {
        return false;
    }

    let block = this._argumentList;
    if (!block || !block.element) {
        block = this.list();
        this._argumentList = block;
        block.on('click', () => this.context.activate(this.value, 'target'));
        if (this.element) {
            const document = this.context.host.document;
            const lastBlock = this.blocks[this.blocks.length - 1];
            if (lastBlock) {
                lastBlock.last = false;
            }
            block.first = false;
            block.last = true;
            block.build(document, this.element);
            this.element.insertBefore(block.element, this.border);
        }
    }

    // ... existing clear + repopulate + measure/layout logic ...
}
```
