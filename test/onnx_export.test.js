import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onnx } from '../source/onnx-proto.js';
import '../source/onnx-encode.js';
import { BinaryReader } from '../source/protobuf.js';
import { ModelEditor } from '../source/model-editor.js';
import { exportModifiedOnnx, OnnxExportError } from '../source/onnx-export.js';

const buildMinimalModel = () => {
    const model = new onnx.ModelProto();
    model.ir_version = 8n;
    const opset = new onnx.OperatorSetIdProto();
    opset.domain = 'ai.onnx';
    opset.version = 13n;
    model.opset_import = [opset];
    const graph = new onnx.GraphProto();
    graph.name = 'test_graph';
    const input = new onnx.ValueInfoProto();
    input.name = 'x';
    const inputType = new onnx.TypeProto();
    const inputTensor = new onnx.TypeProto.Tensor();
    inputTensor.elem_type = 1;
    const inputShape = new onnx.TensorShapeProto();
    const inputDim = new onnx.TensorShapeProto.Dimension();
    inputDim.dim_value = 1n;
    inputShape.dim = [inputDim];
    inputTensor.shape = inputShape;
    inputType.tensor_type = inputTensor;
    input.type = inputType;
    graph.input = [input];
    const output = new onnx.ValueInfoProto();
    output.name = 'y';
    graph.output = [output];
    const node = new onnx.NodeProto();
    node.op_type = 'Identity';
    node.name = 'identity';
    node.input = ['x'];
    node.output = ['y'];
    const attribute = new onnx.AttributeProto();
    attribute.name = 'test_attr';
    attribute.type = 7;
    attribute.ints = [1n, 2n, 3n];
    node.attribute = [attribute];
    graph.node = [node];
    model.graph = graph;
    return model;
};

const buildViewModel = (proto) => ({
    format: 'ONNX v8',
    exportable: true,
    proto,
    modules: [{
        name: 'test_graph',
        identifier: 'test_graph',
        inputs: [{ name: 'x', value: [{ name: 'x', type: 'float32[1]' }] }],
        outputs: [{ name: 'y', value: [{ name: 'y' }] }],
        nodes: [{
            name: 'identity',
            type: { name: 'Identity', identifier: 'Identity' },
            attributes: [{ name: 'test_attr', type: 'int64[]', value: [1n, 2n, 3n] }],
            inputs: [{ name: '', value: [{ name: 'x', type: 'float32[1]' }] }],
            outputs: [{ name: '', value: [{ name: 'y' }] }]
        }]
    }]
});

describe('ONNX export', () => {
    it('round-trips an unmodified minimal model', () => {
        const model = buildMinimalModel();
        const bytes = onnx.ModelProto.encodeBytes(model);
        const decoded = onnx.ModelProto.decode(BinaryReader.open(bytes));
        assert.equal(decoded.graph.name, 'test_graph');
        assert.equal(decoded.graph.node.length, 1);
        assert.equal(decoded.graph.node[0].op_type, 'Identity');
        assert.deepEqual(decoded.graph.node[0].attribute[0].ints, [1n, 2n, 3n]);
    });

    it('exports modified node and attribute changes', () => {
        const proto = buildMinimalModel();
        const viewModel = buildViewModel(proto);
        const editor = ModelEditor.createSession(viewModel);
        editor.applyPatch({
            entityId: 'graph:0/node:0',
            entityType: 'node',
            changeType: 'modify',
            property: 'name',
            newValue: 'renamed_identity'
        });
        editor.applyPatch({
            entityId: 'graph:0/node:0/attr:0',
            entityType: 'attribute',
            changeType: 'modify',
            property: 'attributes.test_attr',
            newValue: [4, 5, 6]
        });
        const bytes = exportModifiedOnnx(viewModel, editor);
        const decoded = onnx.ModelProto.decode(BinaryReader.open(bytes));
        assert.equal(decoded.graph.node[0].name, 'renamed_identity');
        assert.deepEqual(decoded.graph.node[0].attribute[0].ints, [4n, 5n, 6n]);
    });

    it('exports from a pristine proto even when the loaded model graph was mutated for viewing', () => {
        const loaded = buildMinimalModel();
        const pristine = onnx.ModelProto.decode(BinaryReader.open(onnx.ModelProto.encodeBytes(loaded)));
        loaded.graph.node[0].input = [{ name: 'x', initializer: null }];
        loaded.graph.node[0].output = [{ name: 'y', initializer: null }];
        const viewModel = buildViewModel(loaded);
        viewModel.proto = pristine;
        const editor = ModelEditor.createSession(viewModel);
        const bytes = exportModifiedOnnx(viewModel, editor);
        const decoded = onnx.ModelProto.decode(BinaryReader.open(bytes));
        assert.equal(decoded.graph.node[0].input[0], 'x');
        assert.equal(decoded.graph.node[0].output[0], 'y');
    });

    it('rejects export when model is not exportable', () => {
        const viewModel = buildViewModel(buildMinimalModel());
        viewModel.exportable = false;
        const editor = ModelEditor.createSession(viewModel);
        assert.throws(() => exportModifiedOnnx(viewModel, editor), OnnxExportError);
    });
});
