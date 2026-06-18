2026-06-16

Tags: [[netron]] [[ambarella]]
## bug- when I deleted a newly added attribute, doesn't automatically update the graph, instead I have to refresh to see the change

### Notes

Root issue is at
```
_handleEditorDelta
Deleting a newly added attribute clears the delta entirely, so the handler never runs refreshNodeArgumentList. 
attribute updates are driven by the last entry in the delta

    async _handleEditorDelta(changes) {
        if (!this._editSession) {
            return;
        }
        const last = changes.length > 0 ? changes[changes.length - 1] : null;
        try {
            if (last && last.entityType === 'attribute' && this.options.attributes) {
                const modelNode = this._resolveNodeFromChange(last);
                if (modelNode && this._target) {
                    const heightChanged = await this._target.refreshNodeArgumentList(modelNode);
                    if (heightChanged) {
                        await this.refresh(null, { skipShow: true, skipAnimation: true });
                    }
                }
            } else if (this._editorChangeNeedsGraphRefresh(last)) {
                await this.refresh(null, { skipShow: true, skipAnimation: true });
            }
 
```

When we delete a newly added attribute, DeltaTracker.record removes that entry from the delta

```
        if (change.changeType === 'delete') {
            if (!existsInOriginal) {
                this._changes.delete(change.entityId);
            } else {
```
So, the subscriber fires with changes === [], last is null, and no graph update runs. 

Hide and show attributes work because it calls 
```
_reload(), which gives us a full graph rebuild
```

### References