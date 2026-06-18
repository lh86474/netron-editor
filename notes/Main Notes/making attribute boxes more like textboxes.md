2026-06-15

Tags: [[netron]] [[ambarella]]
## making attribute boxes more like textboxes

### Notes

We added 
```
const active = this._document.activeElement;
const tag = active ? active.tagName : '';
if (tag === 'INPUT' || tag === 'TEXTAREA' || (active && active.isContentEditable)) {
    return;
}
```

```
added right below _keydown
```
### References