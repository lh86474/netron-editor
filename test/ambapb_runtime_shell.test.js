import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    EDITABLE_SHELL_OP_TYPES,
    isAmbapbRuntimeShellNode,
    isCompiledAmbapbGraph,
    isViewingCompiledAmbapbGraph,
    validateAmbapbPatch
} from '../source/ambapb-editor.js';
import { ModelEditor } from '../source/model-editor.js';

const buildCheckpointModel = (nodes) => {
    const viewModel = {
        _kind: 'amba-checkpoint',
        _modules: [{
            name: 'runtime',
            nodes,
            inputs: [],
            outputs: []
        }],
        get modules() {
            return this._modules;
        }
    };
    viewModel._ambapb = {
        canEdit: true,
        canExport: false
    };
    return viewModel;
};

describe('ambapb runtime shell editing', () => {
    it('recognizes runtime shell op types', () => {
        assert.equal(isAmbapbRuntimeShellNode({ type: { name: 'CVFlowNVP' } }), true);
        assert.equal(isAmbapbRuntimeShellNode({ type: { name: 'FragSubgraph' } }), true);
        assert.equal(isAmbapbRuntimeShellNode({ type: { name: 'BatchCall' } }), true);
        assert.equal(isAmbapbRuntimeShellNode({ type: { name: 'Conv' } }), false);
        assert.equal(EDITABLE_SHELL_OP_TYPES.has('BatchCall'), true);
    });

    it('detects compiled graph navigation context', () => {
        const compiled = { _ambapbCompiledGraph: true, nodes: [] };
        const runtime = { nodes: [] };
        assert.equal(isCompiledAmbapbGraph(compiled), true);
        assert.equal(isViewingCompiledAmbapbGraph([], compiled), true);
        assert.equal(isViewingCompiledAmbapbGraph([{ target: runtime }, { target: compiled }], runtime), true);
        assert.equal(isViewingCompiledAmbapbGraph([], runtime), false);
    });

    it('allows FragSubgraph and BatchCall attribute edits', () => {
        const model = buildCheckpointModel([
            {
                name: 'frag',
                type: { name: 'FragSubgraph' },
                attributes: [{ name: 'has_vmem_chaining', type: 'int64', value: 0n }],
                inputs: [],
                outputs: []
            },
            {
                name: 'batch',
                type: { name: 'BatchCall' },
                attributes: [{ name: 'batch_size', type: 'int64', value: 8n }],
                inputs: [],
                outputs: []
            }
        ]);
        ModelEditor.createSession(model);
        validateAmbapbPatch(model, {
            entityId: 'graph:0/node:0',
            entityType: 'node',
            changeType: 'modify',
            property: 'name',
            newValue: 'frag_renamed'
        });
        validateAmbapbPatch(model, {
            parentId: 'graph:0/node:1',
            entityType: 'attribute',
            changeType: 'add',
            property: 'attributes.note',
            newValue: 'test'
        });
        validateAmbapbPatch(model, {
            entityId: 'graph:0/node:1/attr:0',
            entityType: 'attribute',
            changeType: 'modify',
            property: 'attributes.batch_size',
            newValue: 16
        });
    });

    it('applies runtime shell rename through ModelEditor', () => {
        const model = buildCheckpointModel([{
            name: 'batch',
            type: { name: 'BatchCall' },
            attributes: [],
            inputs: [],
            outputs: []
        }]);
        const session = ModelEditor.createSession(model);
        session.history.checkpoint(session);
        session.applyPatch({
            entityId: 'graph:0/node:0',
            entityType: 'node',
            changeType: 'modify',
            property: 'name',
            newValue: 'batch_renamed'
        });
        assert.equal(model._modules[0].nodes[0].name, 'batch_renamed');
    });
});
