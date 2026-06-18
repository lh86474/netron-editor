2026-06-16

Tags: [[netron]] [[ambarella]]
## bug - edited nodes aren't being highlighted red when I delete attributes, it undoes the styling

### Notes

Root cause
```
this.element.classList.toggle('edited', state === 'modified' || state === 'added');
```
```
this.element.classList.toggle('edited', state === 'modified' || state === 'added' || state === 'deleted');
```
### References