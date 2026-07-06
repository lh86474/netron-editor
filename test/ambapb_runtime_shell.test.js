/*
 * This file tests the editing features for the upper level nodes such as batchCall, cvFlowNVP, fragsubgraph, which are the runtime shell nodes.
 * Author: Luray He
 */
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

// build mock ambapbonnx.ckpt.onnx model 
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
// a future step is to include userdefsubgraph and userdefcall since that will be new. 
// Here, we make sure we won't see the conv nodes. This test is pretty skimpty and not too 
// thorough, but it's a start
describe('ambapb runtime shell editing', () => {
    it('recognizes runtime shell op types', () => {
        assert.equal(isAmbapbRuntimeShellNode({ type: { name: 'CVFlowNVP' } }), true);
        assert.equal(isAmbapbRuntimeShellNode({ type: { name: 'FragSubgraph' } }), true);
        assert.equal(isAmbapbRuntimeShellNode({ type: { name: 'BatchCall' } }), true);
        assert.equal(isAmbapbRuntimeShellNode({ type: { name: 'Conv' } }), false);
        assert.equal(EDITABLE_SHELL_OP_TYPES.has('BatchCall'), true);
    });
    // We want to find the compiled_prim_graph
    it('detects compiled graph navigation context', () => {
        const compiled = { _ambapbCompiledGraph: true, nodes: [] };
        const runtime = { nodes: [] };
        assert.equal(isCompiledAmbapbGraph(compiled), true);
        assert.equal(isViewingCompiledAmbapbGraph([], compiled), true);
        assert.equal(isViewingCompiledAmbapbGraph([{ target: runtime }, { target: compiled }], runtime), true);
        assert.equal(isViewingCompiledAmbapbGraph([], runtime), false);
    });

    // this tests builds a mock model with batchcall and fragsubgraph
    // Makes some mock changes like renaming fragsubgraph, adding attribute to batch call
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
    // makes sure we can rename the runtime shell nodes
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
