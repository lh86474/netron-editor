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
    parseCheckpoint
} from '../source/ambapb.js';
import {
    buildDependencyGraph,
    enumeratePrimPorts,
    parsePrimGraphFromAttribute,
    parsePrimGraphImms,
    parsePrimGraphJson,
    serializePrimGraphJson,
    validatePrimGraph
} from '../source/ambapb-prim-graph.js';

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

const loadModelProto = (filePath) => {
    const bytes = fs.readFileSync(filePath);
    return onnx.ModelProto.decode(BinaryReader.open(bytes));
};

const loadSyntheticFixture = () => {
    const filePath = path.join(repoRoot, 'test', 'fixtures', 'ambapb-prim-graph.json');
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

const deepEqualJson = (left, right) => {
    assert.deepEqual(JSON.parse(JSON.stringify(left)), JSON.parse(JSON.stringify(right)));
};

describe('ambapb prim graph parser', () => {
    it('parses synthetic prim_graph fixture', () => {
        const fixture = loadSyntheticFixture();
        const primGraph = parsePrimGraphJson(JSON.stringify(fixture));
        assert.equal(primGraph.primitives.length, 3);
        assert.equal(primGraph.primitives[0].type, 'input');
        assert.equal(primGraph.primitives[1].type, 'conv2ibesbcp');
        assert.equal(primGraph.primitives[1].attributes.stride, '2');
        assert.equal(primGraph.primitives[1].sources[0].id, 'data');
        assert.equal(validatePrimGraph(primGraph.primitives).ok, true);
    });

    it('builds dependency graph and port index for synthetic fixture', () => {
        const primGraph = parsePrimGraphJson(JSON.stringify(loadSyntheticFixture()));
        const graph = buildDependencyGraph(primGraph.primitives);
        assert.deepEqual(graph.get('conv0').producers, ['data']);
        assert.deepEqual(graph.get('data').consumers, ['conv0']);
        assert.deepEqual(graph.get('output0').producers, ['conv0']);
        const ports = enumeratePrimPorts(primGraph.primitives);
        assert.ok(ports.has('data:0'));
        assert.ok(ports.has('conv0/conv0'));
    });

    it('round-trips synthetic prim_graph JSON', () => {
        const fixture = loadSyntheticFixture();
        const primGraph = parsePrimGraphJson(JSON.stringify(fixture));
        const serialized = serializePrimGraphJson(primGraph);
        const roundTrip = parsePrimGraphJson(serialized);
        deepEqualJson(roundTrip.raw, fixture);
        assert.equal(roundTrip.primitives.length, primGraph.primitives.length);
    });

    it('attachCheckpoint populates primGraph and imms on view model', () => {
        const mobilenetPath = resolveMobilenetFixture();
        if (!mobilenetPath) {
            return;
        }
        const modelProto = loadModelProto(mobilenetPath);
        const viewModel = { _exportable: true, _metadata: [] };
        assert.equal(attachCheckpoint(viewModel, modelProto), true);
        assert.ok(viewModel._ambapb.primGraph);
        assert.equal(viewModel._ambapb.primGraph.primitives.length, 68);
        assert.equal(viewModel._ambapb.imms.encoding, 'tensors');
        assert.equal(viewModel._ambapb.imms.entries.length, 720);
    });
});

describe('ambapb prim graph integration', () => {
    it('parses mobilenet prim_graph and imms when fixture is available', () => {
        const mobilenetPath = resolveMobilenetFixture();
        if (!mobilenetPath) {
            return;
        }
        const checkpoint = parseCheckpoint(loadModelProto(mobilenetPath));
        assert.ok(checkpoint);
        assert.equal(checkpoint.primGraph.primitives.length, 68);
        const types = new Set(checkpoint.primGraph.primitives.map((primitive) => primitive.type));
        assert.ok(types.has('input'));
        assert.ok(types.has('output'));
        assert.ok(types.has('conv2ibesbcp'));
        assert.equal(checkpoint.imms.entries.length, 720);
        assert.equal(validatePrimGraph(checkpoint.primGraph.primitives).ok, true);

        const dependencyGraph = buildDependencyGraph(checkpoint.primGraph.primitives);
        const nonInput = checkpoint.primGraph.primitives.filter((primitive) => primitive.type !== 'input');
        for (const primitive of nonInput) {
            const entry = dependencyGraph.get(primitive.id);
            assert.ok(entry);
            assert.ok(entry.producers.length > 0, `Expected producers for ${primitive.id}`);
        }

        const wrapper = checkpoint.wrapperNode;
        const parsedFromAttribute = parsePrimGraphFromAttribute(checkpoint.primGraphAttribute);
        assert.equal(parsedFromAttribute.primitives.length, 68);
        const parsedImms = parsePrimGraphImms(checkpoint.primGraphImmsAttribute);
        assert.equal(parsedImms.entries.length, 720);

        const serialized = serializePrimGraphJson(checkpoint.primGraph);
        const roundTrip = parsePrimGraphJson(serialized);
        deepEqualJson(roundTrip.raw, checkpoint.primGraph.raw);
    });
});
