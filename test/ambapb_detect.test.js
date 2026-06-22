/*
 * This file makes sure regular ONNX is not detected 
 * tests that ambapb checkpoint is detected as such
 * tests that attachCheckpoint marks model as non-exportable and gated for editing
 * Author: Luray He
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onnx } from '../source/onnx-proto.js';
import '../source/onnx-encode.js';
import { BinaryReader } from '../source/protobuf.js';
import {
    AMBAPB_KIND,
    attachCheckpoint,
    canEditCheckpoint,
    canExportCheckpoint,
    detectCheckpoint,
    findCVFlowNVPNode,
    getCompiledPrimGraphAttribute,
    getPrimGraphAttribute,
    getPrimGraphImmsAttribute,
    readCheckpointMetadata
} from '../source/ambapb.js';

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

const mobilenetPath = resolveMobilenetFixture();

const loadModelProto = (filePath) => {
    const bytes = fs.readFileSync(filePath);
    return onnx.ModelProto.decode(BinaryReader.open(bytes));
};

const buildRegularOnnxModel = () => {
    const model = new onnx.ModelProto();
    model.ir_version = 8n;
    const opset = new onnx.OperatorSetIdProto();
    opset.domain = 'ai.onnx';
    opset.version = 13n;
    model.opset_import = [opset];
    model.producer_name = 'test';
    const graph = new onnx.GraphProto();
    graph.name = 'test_graph';
    const node = new onnx.NodeProto();
    node.op_type = 'Identity';
    node.name = 'identity';
    node.input = ['x'];
    node.output = ['y'];
    graph.node = [node];
    model.graph = graph;
    return model;
};

describe('ambapb checkpoint detection', () => {
    // Test that the mobilenet ambapb checkpoint is detected as such
    it('detects mobilenet ambapb checkpoint fixture', () => {
        if (!mobilenetPath) {
            return;
        }
        const model = loadModelProto(mobilenetPath);
        assert.equal(detectCheckpoint(model), true);
        const wrapper = findCVFlowNVPNode(model.graph);
        assert.ok(wrapper);
        assert.equal(wrapper.op_type, 'CVFlowNVP');
        assert.ok(getPrimGraphAttribute(wrapper));
        assert.ok(getPrimGraphImmsAttribute(wrapper));
        assert.ok(getCompiledPrimGraphAttribute(wrapper));
        const metadata = readCheckpointMetadata(model);
        assert.equal(metadata.metagraphType, 'checkpoint');
        assert.equal(metadata.producer, 'cvflowbackend');
    });

    // has to be false when we pass in regular onnx model
    it('does not detect regular ONNX models', () => {
        const model = buildRegularOnnxModel();
        assert.equal(detectCheckpoint(model), false);
        assert.equal(findCVFlowNVPNode(model.graph), null);
    });

    it('attachCheckpoint marks model as non-exportable and gated for editing', () => {
        if (!mobilenetPath) {
            return;
        }
        const modelProto = loadModelProto(mobilenetPath);
        const viewModel = {
            _exportable: true,
            _metadata: []
        };
        assert.equal(attachCheckpoint(viewModel, modelProto), true);
        assert.equal(viewModel._kind, AMBAPB_KIND);
        assert.equal(viewModel._exportable, false);
        assert.equal(canEditCheckpoint(viewModel), true);
        assert.equal(canExportCheckpoint(viewModel), false);
        assert.ok(viewModel._ambapb.wrapperNode);
        assert.ok(viewModel._ambapb.primGraphAttribute);
        assert.ok(viewModel._ambapb.primGraph);
        assert.equal(viewModel._ambapb.primGraph.primitives.length, 68);
        assert.equal(viewModel._ambapb.imms.entries.length, 720);
    });
});