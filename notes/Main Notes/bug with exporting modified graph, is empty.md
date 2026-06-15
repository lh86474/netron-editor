2026-06-15

Tags: [[netron]] [[ambarella]]
## bug with exporting modified graph, is empty

### Notes

![[Pasted image 20260615114546.png]]
- What's with this?
- The export modified graph works perfectly, just the subgraph doesn't work too well

Okay, the export actually does work, but for some cases, it doesn't really work. 

Ah, in the onnx folder in documents, I see 0KB, but in the downloads, I see the real subgraph, what's with this?

![[Pasted image 20260615115147.png]]

![[Pasted image 20260615115200.png]]

- The real subgraph is somehow in the parent folder

In browser.js save(): I pikc a folder and filename
The export(): actual bytes, isn't communicating with 

Solution
```
async save(name, extension, defaultPath) {
    const suggestedName = normalizeExportFilename(defaultPath, extension) || `${defaultPath}.${extension}`;
    const window = this.window;
    this._saveFileHandle = null;
    if (typeof window.showSaveFilePicker === 'function') {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName,
                types: [{
                    description: name,
                    accept: { 'application/octet-stream': [`.${extension}`] }
                }]
            });
            this._saveFileHandle = handle;
            return handle.name;
        } catch (error) {
            if (error && error.name === 'AbortError') {
                return null;
            }
        }
    }
    return this._promptSaveFilename(name, extension, defaultPath);
}
```

export()
```
async export(file, blob) {
    const handle = this._saveFileHandle;
    this._saveFileHandle = null;
    if (handle && typeof handle.createWritable === 'function') {
        try {
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return;
        } catch (error) {
            await this.message(
                error && error.message ? error.message : 'Failed to write export file.',
                true,
                'OK'
            );
            return;
        }
    }
    const window = this.window;
    const document = this.document;
    const element = document.createElement('a');
    element.download = file;
    const url = window.URL.createObjectURL(blob);
    element.href = url;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    window.URL.revokeObjectURL(url);
}
```

|Step|Before|After|
|---|---|---|
|User picks path|Handle discarded|Handle stored on host|
|`export()` runs|`<a download>` to default folder|`handle.createWritable()` writes to chosen path|
|Placeholder file|Stays 0 KB|Gets real bytes|
### References