2026-06-08

Tags: [[ambarella]] [[netron]]
## changes in grapher.css

### Notes

- .edited on nodes - same read border as .select
```
.select > .node.node-border { stroke: rgba(220, 0, 0, 0.9); stroke-width: 2px; }

.edited > .node.node-border { stroke: rgba(220, 0, 0, 0.9); stroke-width: 2px; }
```

- edited path edges will be red

```
.edge-path.edge-path-edited { stroke: rgba(220, 0, 0, 0.9); stroke-width: 1px; marker-end: url("#arrowhead-select"); }
```


### References