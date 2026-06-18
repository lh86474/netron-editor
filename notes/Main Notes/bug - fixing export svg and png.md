2026-06-16

Tags: [[netron]] [[ambarella]]
## bug - fixing export svg and png

### Notes

When we created the dual-pane editor, we didn't bring the PNG / SVG export to work with the dual-pane editor. It still expects the same single-pane SVG element IDs- so it throws at runtime when I try to export

When we look at export() in view.js, we see the we don't have the new ids that are seen in the dual-pane editor

Before, SVG used background, origin, and edge-paths-hit-test. After split-screen, every graph used prefixed ids, but export was never updated to match. 

We need export to be wired to 
```
_activePane. 
export throws mid-flight, the code temporarily removes the live canvas from the DOM files_
```

When we try to export in png and svg, this happens
```
view.js:1950 Uncaught (in promise) TypeError: Cannot read properties of null (reading 'remove')
    at view.View.export (view.js:1950:56)
    at view.Menu.Command.execute [as _execute] (view.js:170:63)
    at view.Menu.Command.execute (view.js:2732:18)
    at view.js:2466:48
```

### Solution
```
view.js after _activePaneGraph()

    _paneGraph(paneId) {
        if (paneId === 'original') {
            return this._leftPane && this._leftPane.graph ? this._leftPane.graph : null;
        }
        if (paneId === 'modified') {
            return this._rightPane && this._rightPane.graph ? this._rightPane.graph : null;
        }
        return this._activePaneGraph();
    }

    _exportImageBasename(paneId) {
        return `${this._suggestedExportBasename()}-${paneId}`;
    }
```

### new export(file)
```
    // the normal export function, for png and svg
    async export(file, options = {}) {
        const window = this.host.window;
        const lastIndex = file.lastIndexOf('.');
        const extension = lastIndex === -1 ? 'png' : file.substring(lastIndex + 1).toLowerCase();
        if (extension === 'onnx') {
            await this.exportOnnx(file);
            return;
        }
        if (!this.activeTarget || (extension !== 'png' && extension !== 'svg')) {
            return;
        }
        const paneId = options.pane || this._activePane || 'modified';
        const graph = this._paneGraph(paneId);
        const canvas = graph && graph._canvas ? graph._canvas : null;
        if (!canvas) {
            return;
        }
        const prefix = graph.markerPrefix || '';
        const clone = canvas.cloneNode(true);
        const document = this._host.document;
        const applyStyleSheet = (element, name) => {
            let rules = [];
            for (const styleSheet of document.styleSheets) {
                if (styleSheet && styleSheet.href && styleSheet.href.endsWith(`/${name}`)) {
                    rules = styleSheet.cssRules;
                    break;
                }
            }
            const nodes = element.getElementsByTagName('*');
            for (const node of nodes) {
                for (const rule of rules) {
                    if (node.matches(rule.selectorText)) {
                        for (const item of rule.style) {
                            node.style[item] = rule.style[item];
                        }
                    }
                }
            }
        };
        applyStyleSheet(clone, 'grapher.css');
        clone.setAttribute('id', 'export');
        clone.removeAttribute('viewBox');
        clone.removeAttribute('width');
        clone.removeAttribute('height');
        clone.style.removeProperty('opacity');
        clone.style.removeProperty('display');
        clone.style.removeProperty('width');
        clone.style.removeProperty('height');
        const background = clone.querySelector(`#${prefix}background`);
        const origin = clone.querySelector(`#${prefix}origin`);
        const hitTest = clone.getElementById(`${prefix}edge-paths-hit-test`);
        if (hitTest) {
            hitTest.remove();
        }
        if (!background || !origin) {
            await this._host.message('Export failed: graph layout is not ready.', true, 'OK');
            return;
        }
        origin.setAttribute('transform', 'translate(0,0) scale(1)');
        background.removeAttribute('width');
        background.removeAttribute('height');
        const parent = canvas.parentElement;
        parent.insertBefore(clone, canvas);
        let width = 0;
        let height = 0;
        try {
            const size = clone.getBBox();
            const delta = (Math.min(size.width, size.height) / 2.0) * 0.1;
            width = Math.ceil(delta + size.width + delta);
            height = Math.ceil(delta + size.height + delta);
            origin.setAttribute('transform', `translate(${(delta - size.x)}, ${(delta - size.y)}) scale(1)`);
            clone.setAttribute('width', width);
            clone.setAttribute('height', height);
            background.setAttribute('width', width);
            background.setAttribute('height', height);
            background.setAttribute('fill', '#fff');
        } finally {
            if (clone.parentElement === parent) {
                parent.removeChild(clone);
            }
            if (parent && !parent.contains(canvas)) {
                parent.appendChild(canvas);
            }
        }
        const data = new window.XMLSerializer().serializeToString(clone);
        if (extension === 'svg') {
            const blob = new window.Blob([data], { type: 'image/svg' });
            await this._host.export(file, blob);
        }
        if (extension === 'png') {
            const blob = await new Promise((resolve, reject) => {
                this.show('welcome spinner');
                this.progress(0);
                const image = new window.Image();
                image.onload = async () => {
                    try {
                        let targetWidth = Math.ceil(width * 2);
                        let targetHeight = Math.ceil(height * 2);
                        let scale = 1;
                        if (targetWidth > 100000 || targetHeight > 100000) {
                            scale = Math.min(scale, 100000 / Math.max(targetWidth, targetHeight));
                        }
                        if (targetWidth * targetHeight * scale * scale > 500000000) {
                            scale = Math.min(scale, Math.sqrt(500000000 / (targetWidth * targetHeight)));
                        }
                        if (scale < 1) {
                            targetWidth = Math.floor(targetWidth * scale);
                            targetHeight = Math.floor(targetHeight * scale);
                        }
                        const drawScale = targetWidth / width;
                        const tileSize = Math.min(targetWidth, 4096);
                        const encoder = new png.Encoder(window, targetWidth, targetHeight);
                        const rasterCanvas = this._host.document.createElement('canvas');
                        rasterCanvas.width = tileSize;
                        rasterCanvas.height = 4096;
                        const context = rasterCanvas.getContext('2d');
                        for (let y = 0; y < targetHeight; y += 4096) {
                            const h = Math.min(4096, targetHeight - y);
                            const tileDataBuffer = new Uint8Array(targetWidth * h * 4);
                            for (let x = 0; x < targetWidth; x += tileSize) {
                                const w = Math.min(tileSize, targetWidth - x);
                                context.setTransform(drawScale, 0, 0, drawScale, -x, -y);
                                context.drawImage(image, 0, 0);
                                const imageData = context.getImageData(0, 0, w, h);
                                for (let row = 0; row < h; row++) {
                                    const src = row * w * 4;
                                    const dst = row * targetWidth * 4 + x * 4;
                                    tileDataBuffer.set(imageData.data.subarray(src, src + w * 4), dst);
                                }
                            }
                            /* eslint-disable-next-line no-await-in-loop */
                            await encoder.write(tileDataBuffer, h);
                            this.progress((y + h) / targetHeight * 100);
                        }
                        const buffer = await encoder.toBuffer();
                        this.progress(0);
                        this.show('default');
                        resolve(new window.Blob([buffer], { type: 'image/png' }));
                    } catch (error) {
                        this.progress(0);
                        this.show('default');
                        reject(error);
                    }
                };
                image.onerror = (error) => {
                    this.progress(0);
                    this.show('default');
                    reject(error);
                };
                image.src = `data:image/svg+xml;base64,${this._host.window.btoa(unescape(encodeURIComponent(data)))}`;
            });
            await this._host.export(file, blob);
        }
    }
```

### References