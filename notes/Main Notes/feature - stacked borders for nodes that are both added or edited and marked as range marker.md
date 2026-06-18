2026-06-16

Tags: [[ambarella]] [[netron]]
## feature - stacked borders for nodes that are both added or edited and marked as range marker

### Notes

The 
```
        const state = this.context.deltaTracker.getAggregateState(this._entityId);
        // change css
        this.element.classList.toggle('edited', state === 'modified' || state === 'added');
    }

    // apply range marker style for graph extraction
    applyRangeMarkerStyle() {
        ...
        this.element.classList.toggle('range-begin', Boolean(isBegin));
        this.element.classList.toggle('range-end', Boolean(isEnd));
```

- The states are applied correctly

```
.select > .node.node-border { stroke: rgba(220, 0, 0, 0.9); stroke-width: 2px; }
.edited > .node.node-border { stroke: rgba(220, 0, 0, 0.9); stroke-width: 2px; }
.range-begin > .node.node-border { stroke: rgba(0, 140, 0, 0.95); stroke-width: 2px; }
.range-end > .node.node-border { stroke: rgba(0, 80, 200, 0.95); stroke-width: 2px; }
.range-begin.range-end > .node.node-border { stroke: rgba(120, 0, 160, 0.95); stroke-width: 2px; }
```

- both states the same SVG path
- SVG only allows **one stroke per path** with equal specificity. Source order wins. 
- We will override things


### References