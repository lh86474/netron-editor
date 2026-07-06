/*
 * This file tests the checkpoint session, which is the session that is used to edit the checkpoint model.
 * Author: Luray He
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CVFLOW_NVP_OP_TYPE, resolveCheckpointRuntimeGraph } from '../source/ambapb-editor.js';
import { ModelEditor, cloneGraph } from '../source/model-editor.js';

// used to build mock checkpoint model with a runtime graph
const buildCheckpointViewModel = (runtimeNodes) => {
    const runtime = {
        name: 'compiled_runtime',
        inputs: [],
        outputs: [],
        nodes: runtimeNodes,
        _ambapbCompiledGraph: true
    };
    return {
        format: 'ONNX',
        _exportable: true,
        _kind: 'amba-checkpoint',
        get kind() {
            return this._kind;
        },
        _modules: [{
            name: 'graph',
            inputs: [{ name: 'input', value: [{ name: 'data' }] }],
            outputs: [{ name: 'output', value: [{ name: 'out' }] }],
            nodes: [{
                name: 'wrapper',
                type: { name: CVFLOW_NVP_OP_TYPE, identifier: CVFLOW_NVP_OP_TYPE },
                attributes: [{
                    name: 'compiled_prim_graph',
                    type: 'graph',
                    value: runtime
                }],
                inputs: [{ name: 'input', value: [{ name: 'data' }] }],
                outputs: [{ name: 'output', value: [{ name: 'out' }] }]
            }]
        }],
        get modules() {
            return this._modules;
        },
        _ambapb: {
            canEdit: true,
            canExport: true,
            primGraph: { primitives: [] }
        }
    };
};

describe('checkpoint editor session', () => {
    it('freezes shell graph in originalModules while keeping shell in modified storage', () => {
        const model = buildCheckpointViewModel([
            { name: 'conv0', type: { name: 'Conv' }, attributes: [], inputs: [], outputs: [] },
            { name: 'relu0', type: { name: 'Relu' }, attributes: [], inputs: [], outputs: [] }
        ]);
        const session = ModelEditor.createSession(model);

        assert.equal(session.modified.getGraph(0).nodes.length, 1);
        assert.equal(session.modified.getGraph(0).nodes[0].type.name, CVFLOW_NVP_OP_TYPE);
        assert.equal(session.originalModules[0].nodes.length, 1);
        assert.equal(session.originalModules[0].nodes[0].type.name, CVFLOW_NVP_OP_TYPE);
        assert.equal(session.originalModules[0].nodes[0].name, 'wrapper');

        session.modified.getGraph(0).nodes[0].name = 'mutated_wrapper';
        assert.equal(model.modules[0].nodes[0].name, 'mutated_wrapper');
        assert.equal(session.originalModules[0].nodes[0].name, 'wrapper');
    });

    it('replaceGraph hoists flat runtime at module root for continued editing', () => {
        const model = buildCheckpointViewModel([
            { name: 'conv0', type: { name: 'Conv' }, attributes: [], inputs: [], outputs: [] }
        ]);
        const session = ModelEditor.createSession(model);
        const runtimeGraph = {
            name: 'runtime',
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'userDefCall_0',
                    type: { name: 'UserDefCall' },
                    attributes: [],
                    inputs: [],
                    outputs: []
                },
                {
                    name: 'conv0',
                    type: { name: 'Conv' },
                    attributes: [],
                    inputs: [],
                    outputs: []
                }
            ],
            _ambapbCompiledGraph: true
        };

        session.replaceGraph(0, cloneGraph(runtimeGraph));

        const stored = session.modified.getGraph(0);
        assert.equal(stored.nodes.length, 2);
        assert.equal(stored.nodes[0].type.name, 'UserDefCall');
        assert.equal(resolveCheckpointRuntimeGraph(stored).nodes.length, 2);
        assert.equal(session.originalModules[0].nodes.length, 1);
        assert.equal(session.originalModules[0].nodes[0].type.name, CVFLOW_NVP_OP_TYPE);
    });
});
