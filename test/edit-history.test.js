/* 
 * This file is used to test the EditHistory class on ModelEditor
 * We mainly test four things
 * Undo attribute add
 * Redo rename
 * Undo delete
 * Undo insert
 * There is a need for more rigorous testing of redo
 * Author: Luray He
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockChainModel, identityNodeSpec } from './fixtures/mock-graph.js';
import { ModelEditor } from '../source/model-editor.js';

describe('EditHistory', () => {
    // undo has to restore the state before an edit. 
    // in this test we add an attribute, and we will now have 1 attribute on the second node. 
    // undoing it should make the node have 0 attributes, and the delta needs to be empty
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
    // Redo has to apply the change that was just undone. 
    // since is the only test that we have for redo, we need to test it further for other changeTypes
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
    // undo delete has to restore a deleted node. delete a node, and when we restore it, we should have 3 node
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
    // undo insert has to remove an inserted node. insert a node, and when we undo it, we should have 3 nodes
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

    it('new edit after undo clears redo stack', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        editor.history.checkpoint(editor);
        editor.applyPatch({
            entityId: 'graph:0/node:0',
            entityType: 'node',
            changeType: 'modify',
            property: 'name',
            newValue: 'FirstRename'
        });
        editor.history.undo(editor);
        assert.equal(editor.modified.getGraph().nodes[0].name, 'Conv1');
        assert.equal(editor.history.canRedo, true);

        editor.history.checkpoint(editor);
        editor.applyPatch({
            entityId: 'graph:0/node:0',
            entityType: 'node',
            changeType: 'modify',
            property: 'name',
            newValue: 'SecondRename'
        });
        assert.equal(editor.modified.getGraph().nodes[0].name, 'SecondRename');
        assert.equal(editor.history.canRedo, false);
        assert.equal(editor.history.redo(editor), false);
        assert.equal(editor.modified.getGraph().nodes[0].name, 'SecondRename');
    });

    it('survives many undo redo alternations without drift', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        const originalName = editor.modified.getGraph().nodes[0].name;
        editor.history.checkpoint(editor);
        editor.applyPatch({
            entityId: 'graph:0/node:0',
            entityType: 'node',
            changeType: 'modify',
            property: 'name',
            newValue: 'ToggledName'
        });

        for (let i = 0; i < 50; i++) {
            assert.equal(editor.history.undo(editor), true);
            assert.equal(editor.modified.getGraph().nodes[0].name, originalName);
            assert.equal(editor.history.redo(editor), true);
            assert.equal(editor.modified.getGraph().nodes[0].name, 'ToggledName');
        }
        assert.equal(editor.delta.getChanges().length, 1);
    });

    it('redo reapplies delete after undo', () => {
        const editor = ModelEditor.createSession(mockChainModel);
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
        assert.equal(editor.history.redo(editor), true);
        assert.equal(editor.modified.getGraph().nodes.length, 2);
        assert.equal(editor.delta.getState('graph:0/node:1'), 'deleted');
    });
});
