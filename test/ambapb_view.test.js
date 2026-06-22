import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onnx } from '../source/onnx-proto.js';
import '../source/onnx-encode.js';
import { BinaryReader } from '../source/protobuf.js';
import {
    attachCheckpoint,
    expandCheckpointModel,
    isAmbapbGraph,
    parseCheckpoint,
    toNetronGraph
} from '../source/ambapb.js';
import { parsePrimGraphJson } from '../source/ambapb-prim-graph.js';
import { ModelEditor } from '../source/model-editor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const mobilenetCandidates = [
    path.join(repoRoot, 'mobilenetv2.ambapb.ckpt.onnx'),
    path.join(repoRoot, '..', 'mobilenetv2.ambapb.ckpt.onnx')
];

const resolveMobilenetFixture = () => {
    for (const candidate of mobilenetCandidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
};

const loadSyntheticPrimGraph = () => {
    const filePath = path.join(repoRoot, 'test', 'fixtures', 'ambapb-prim-graph.json');
    return parsePrimGraphJson(JSON.stringify(JSON.parse(fs.readFileSync(filePath, 'utf8'))));
};

describe('ambapb visualization', () => {
    it('maps synthetic prim_graph to a Netron graph module', () => {
        const checkpoint = { primGraph: loadSyntheticPrimGraph() };
        const { modules, graphMetadata } = toNetronGraph(checkpoint);
        assert.equal(modules.length, 1);
        assert.equal(graphMetadata.primitiveCount, 3);

        const graph = modules[0];
        assert.equal(isAmbapbGraph(graph), true);
        assert.equal(graph.nodes.length, 3);
        assert.equal(graph.nodes[0].name, 'data');
        assert.equal(graph.nodes[1].name, 'conv0');
        assert.equal(graph.nodes[1].type.name, 'conv2ibesbcp');
        assert.equal(graph.nodes[1]._primitiveId, 'conv0');
        assert.equal(graph.nodes[1].inputs[0].value[0].name, 'data');
        assert.equal(graph.nodes[2].inputs[0].value[0].name, 'conv0');
        assert.equal(graph.inputs[0].value[0].name, 'data');
        assert.equal(graph.outputs[0].value[0].name, 'conv0');
    });

    it('keeps CVFlowNVP shell graph after attachCheckpoint without expansion', () => {
        const viewModel = {
            _exportable: true,
            _metadata: [],
            _modules: [{ name: 'shell', nodes: [{ name: 'data', type: { name: 'CVFlowNVP' } }] }],
            get modules() {
                return this._modules;
            }
        };
        attachCheckpoint(viewModel, {
            graph: { node: [{ op_type: 'CVFlowNVP', attribute: [{ name: 'prim_graph', t: { raw_data: new TextEncoder().encode(JSON.stringify(loadSyntheticPrimGraph().raw)) } }] }] },
            metadata_props: [{ key: 'metagraph_type', value: 'checkpoint' }],
            producer_name: 'cvflowbackend'
        });
        assert.equal(viewModel._modules.length, 1);
        assert.equal(viewModel._modules[0].nodes.length, 1);
        assert.equal(viewModel._modules[0].nodes[0].type.name, 'CVFlowNVP');
    });

    it('expandCheckpointModel remains available as an internal utility', () => {
        const viewModel = {
            _exportable: true,
            _metadata: [],
            _modules: [{ name: 'shell', nodes: [{ name: 'CVFlowNVP' }] }]
        };
        attachCheckpoint(viewModel, {
            graph: { node: [{ op_type: 'CVFlowNVP', attribute: [{ name: 'prim_graph', t: { raw_data: new TextEncoder().encode(JSON.stringify(loadSyntheticPrimGraph().raw)) } }] }] },
            metadata_props: [{ key: 'metagraph_type', value: 'checkpoint' }],
            producer_name: 'cvflowbackend'
        });
        assert.equal(expandCheckpointModel(viewModel), true);
        assert.equal(viewModel._modules[0].nodes.length, 3);
    });

    it('creates an editor session from shell checkpoint graph', () => {
        const viewModel = {
            format: 'ONNX',
            _exportable: false,
            _metadata: [],
            _modules: [{ name: 'shell', nodes: [{ name: 'data', type: { name: 'CVFlowNVP' } }] }],
            get modules() {
                return this._modules;
            }
        };
        attachCheckpoint(viewModel, {
            graph: { node: [{ op_type: 'CVFlowNVP', attribute: [{ name: 'prim_graph', t: { raw_data: new TextEncoder().encode(JSON.stringify(loadSyntheticPrimGraph().raw)) } }] }] },
            metadata_props: [{ key: 'metagraph_type', value: 'checkpoint' }],
            producer_name: 'cvflowbackend'
        });
        viewModel.kind = viewModel._kind;
        const session = ModelEditor.createSession(viewModel);
        assert.equal(session.modified.getGraph(0).nodes.length, 1);
        assert.equal(session.modified.getGraph(0).nodes[0].type.name, 'CVFlowNVP');
    });

    it('maps mobilenet prim_graph to 68 primitive nodes when fixture is available', () => {
        const mobilenetPath = resolveMobilenetFixture();
        if (!mobilenetPath) {
            return;
        }
        const checkpoint = parseCheckpoint(onnx.ModelProto.decode(BinaryReader.open(fs.readFileSync(mobilenetPath))));
        const { modules, graphMetadata } = toNetronGraph(checkpoint);
        assert.equal(graphMetadata.primitiveCount, 68);
        assert.equal(modules[0].nodes.length, 68);
        assert.equal(isAmbapbGraph(modules[0]), true);
        assert.ok(modules[0].nodes.some((node) => node.type.name === 'conv2ibesbcp'));
        assert.ok(modules[0].nodes.every((node) => node._primitiveId));
    });
});
