2026-06-08

Tags: [[ambarella]] [[netron]]
## fixing rebuild header bug

### Notes
```
[layout][Entry.measure] {"content":"Conv","existingX":"7","existingY":"16","bboxY":4,"ty":0,...}
[layout][Header.update] {"content":"Conv","entryTy":0,...}
```

`Header.update` always had `blockY: 0`, so Hypothesis 2 (header block drift) is ruled out. The argument list grew correctly (`blockHeight` 62 → 76, `nodeHeight` 85 → 99). Only the header text baseline was wrong because `getBBox()` was reading an already-positioned `<text>` element.

In `grapher.Node.Header.Entry.measure()`, `x` and `y` are now cleared before `getBBox()` and restored afterward, so re-measurement always uses the raw font box. All temporary `console.log` instrumentation has been removed.

```
measure() {
        const yPadding = 4;
        const xPadding = this.padding || 7;
        const x = this.text.getAttribute('x');
        const y = this.text.getAttribute('y');
        this.text.removeAttribute('x');
        this.text.removeAttribute('y');
        const boundingBox = this.text.getBBox();
        if (x !== null) {
            this.text.setAttribute('x', x);
        }
        if (y !== null) {
            this.text.setAttribute('y', y);
        }
        this.width = boundingBox.width + xPadding + xPadding;
        this.height = boundingBox.height + yPadding + yPadding;
        this.tx = xPadding;
        this.ty = yPadding - boundingBox.y;
    }
```
### References