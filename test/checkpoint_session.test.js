/*
 * This file tests the checkpoint session, which is the session that is used to edit the checkpoint model.
 * Author: Luray He
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CVFLOW_NVP_OP_TYPE, resolveCheckpointRuntimeGraph } from '../source/ambapb-editor.js';
import { ModelEditor, cloneGraph } from '../source/model-editor.js';
import { parsePrimGraphJson } from '../source/ambapb-prim-graph.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const loadSyntheticPrimGraph = () => {
    const filePath = path.join(repoRoot, 'test', 'fixtures', 'ambapb-prim-graph.json');
    return parsePrimGraphJson(JSON.stringify(JSON.parse(fs.readFileSync(filePath, 'utf8'))));
};

// used to build mock checkpoint model with a runtime graph
const buildCheckpointViewModel = (runtimeNodes, options = {}) => {
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
            primGraph: options.primGraph || loadSyntheticPrimGraph()
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
        assert.equal(session.modified.getGraph(0).nodes[0].name, 'mutated_wrapper');
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

    it('keeps originalModules frozen after runtime graph edits', () => {
        const model = buildCheckpointViewModel([
            {
                name: 'conv0',
                type: { name: 'Conv' },
                attributes: [{ name: 'strides', type: 'int64[]', value: [1, 1] }],
                inputs: [],
                outputs: [{ name: 'output', value: [{ name: 'conv_out' }] }]
            }
        ]);
        const session = ModelEditor.createSession(model);
        const runtime = resolveCheckpointRuntimeGraph(session.modified.getGraph(0));

        session.applyPatch({
            entityId: 'graph:0/node:0/compiled_prim_graph/node:0',
            entityType: 'node',
            changeType: 'modify',
            property: 'name',
            newValue: 'conv0_edited'
        });

        assert.equal(runtime.nodes[0].name, 'conv0_edited');
        assert.equal(session.originalModules[0].nodes[0].name, 'wrapper');
        assert.equal(
            session.originalModules[0].nodes[0].attributes
                .find((entry) => entry.name === 'compiled_prim_graph')
                .value.nodes[0].name,
            'conv0'
        );
    });

    it('undo restores runtime edit without mutating frozen originalModules', () => {
        const model = buildCheckpointViewModel([
            {
                name: 'conv0',
                type: { name: 'Conv' },
                attributes: [],
                inputs: [],
                outputs: []
            }
        ]);
        const session = ModelEditor.createSession(model);
        const getRuntime = () => resolveCheckpointRuntimeGraph(session.modified.getGraph(0));

        session.history.checkpoint(session);
        session.applyPatch({
            entityId: 'graph:0/node:0/compiled_prim_graph/node:0',
            entityType: 'node',
            changeType: 'modify',
            property: 'name',
            newValue: 'conv0_temp'
        });
        assert.equal(getRuntime().nodes[0].name, 'conv0_temp');
        assert.equal(session.history.undo(session), true);
        assert.equal(getRuntime().nodes[0].name, 'conv0');
        assert.equal(session.delta.getChanges().length, 0);
        assert.equal(
            session.originalModules[0].nodes[0].attributes
                .find((entry) => entry.name === 'compiled_prim_graph')
                .value.nodes[0].name,
            'conv0'
        );
    });
});
