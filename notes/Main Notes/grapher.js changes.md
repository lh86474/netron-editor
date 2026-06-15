2026-06-08

Tags: [[ambarella]] [[netron]]
## grapher.js changes

### Notes

- Two graphs can't share the same global SVG IDs
- Only grapher.Graph was touched
	- markerPrefix property
	- left pain is original-, the right gets modified
```
const markerId = (name) => this._markerPrefix ? `${this._markerPrefix}${name}` : name;
```
- One is original-arrowhead, other is modified-arrowhead


### References