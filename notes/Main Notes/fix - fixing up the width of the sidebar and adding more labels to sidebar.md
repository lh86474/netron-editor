2026-06-16

Tags: [[ambarella]] [[netron]]
## fix - fixing up the width of the sidebar

### Notes
![[Pasted image 20260616152710.png]]

```
                    file.add({
                        label: 'Export &Original as PNG',
                        execute: async () => await this.export(
                            `${this._exportImageBasename('original')}.png`,
                            { pane: 'original' }
                        ),
                        enabled: () => this.activeTarget && Boolean(this._paneGraph('original'))
                    });
                    file.add({
                        label: 'Export Original as &SVG',
                        execute: async () => await this.export(
                            `${this._exportImageBasename('original')}.svg`,
                            { pane: 'original' }
                        ),
                        enabled: () => this.activeTarget && Boolean(this._paneGraph('original'))
                    });
                    file.add({
                        label: 'Export &Modified as PNG',
                        accelerator: 'CmdOrCtrl+Shift+E',
                        execute: async () => await this.export(
                            `${this._exportImageBasename('modified')}.png`,
                            { pane: 'modified' }
                        ),
                        enabled: () => this.activeTarget && Boolean(this._paneGraph('modified'))
                    });
                    file.add({
                        label: 'Export Modified as &SVG',
                        accelerator: 'CmdOrCtrl+Alt+E',
                        execute: async () => await this.export(
                            `${this._exportImageBasename('modified')}.svg`,
                            { pane: 'modified' }
                        ),
                        enabled: () => this.activeTarget && Boolean(this._paneGraph('modified'))
                    });
```

Edited line 221 and 227 of index.html

update menu offset in view.js
## References