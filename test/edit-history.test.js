import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockChainModel, identityNodeSpec } from './fixtures/mock-graph.js';
import { ModelEditor } from '../source/model-editor.js';

describe('EditHistory', () => {
    it('undo restores state before patch', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        const graph = editor.modified.getGraph();
        editor.history.checkpoint(editor);
        editor.applyPatch({
            parentId: 'graph:0/node:1',
            entityType: 'attribute',
            changeType: 'add',
            property: 'attributes.axis',
            newValue: 1
        });
        assert.equal(editor.modified.getGraph().nodes[1].attributes.length, 1);
        assert.equal(editor.history.undo(editor), true);
        assert.equal(editor.modified.getGraph().nodes[1].attributes.length, 0);
        assert.equal(editor.delta.getChanges().length, 0);
    });

    it('redo reapplies undone patch', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        const graph = editor.modified.getGraph();
        editor.history.checkpoint(editor);
        editor.applyPatch({
            entityId: 'graph:0/node:0',
            entityType: 'node',
            changeType: 'modify',
            property: 'name',
            newValue: 'RenamedConv'
        });
        editor.history.undo(editor);
        assert.equal(editor.modified.getGraph().nodes[0].name, 'Conv1');
        assert.equal(editor.history.redo(editor), true);
        assert.equal(editor.modified.getGraph().nodes[0].name, 'RenamedConv');
    });

    it('undo delete restores deleted node', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        const graph = editor.modified.getGraph();
        editor.history.checkpoint(editor);
        editor.applyPatch({
            entityId: 'graph:0/node:1',
            entityType: 'node',
            changeType: 'delete',
            property: 'remove'
        });
        assert.equal(editor.modified.getGraph().nodes.length, 2);
        editor.history.undo(editor);
        assert.equal(editor.modified.getGraph().nodes.length, 3);
        assert.equal(editor.modified.getGraph().nodes[1].name, 'Relu1');
    });

    it('undo insert removes inserted node', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        const graph = editor.modified.getGraph();
        editor.history.checkpoint(editor);
        const insertChange = editor.applyPatch({
            parentId: 'graph:0/node:1',
            entityType: 'node',
            changeType: 'add',
            property: 'insert',
            position: 'below',
            newValue: identityNodeSpec('InsertedBelow')
        });
        assert.equal(editor.modified.getGraph().nodes.length, 4);
        editor.history.undo(editor);
        assert.equal(editor.modified.getGraph().nodes.length, 3);
        assert.equal(editor.delta.getState(insertChange.entityId), 'unchanged');
    });
    it('undo restores batchInlineExpanded view state', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        editor.batchInlineExpanded = [];
        editor.history.checkpoint(editor);
        editor.batchInlineExpanded = ['batch_call'];
        assert.equal(editor.history.undo(editor), true);
        assert.deepEqual(editor.batchInlineExpanded, []);
    });
    it('redo reapplies batchInlineExpanded view state', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        editor.batchInlineExpanded = [];
        editor.history.checkpoint(editor);
        editor.batchInlineExpanded = ['batch_call'];
        editor.history.undo(editor);
        assert.deepEqual(editor.batchInlineExpanded, []);
        assert.equal(editor.history.redo(editor), true);
        assert.deepEqual(editor.batchInlineExpanded, ['batch_call']);
    });
    it('undo collapse clears batchInlineExpanded in session', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        editor.batchInlineExpanded = [];
        editor.history.checkpoint(editor);
        editor.batchInlineExpanded = ['batch_call'];
        assert.equal(editor.history.undo(editor), true);
        assert.deepEqual(editor.batchInlineExpanded, []);
    });
});
