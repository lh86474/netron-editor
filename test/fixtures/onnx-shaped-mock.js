
class Value {

    constructor(name, type) {
        this._name = name;
        this._type = type;
    }

    get name() {
        return this._name;
    }

    get type() {
        return this._type;
    }
}

class Argument {

    constructor(name, values) {
        this.name = name;
        this.value = values;
    }
}

const inputValue = new Value('input', 'float32[1,3,224,224]');
const hiddenValue = new Value('hidden', 'float32[1,64,112,112]');
const outputValue = new Value('output', 'float32[1,64,112,112]');

export const onnxShapedModel = {
    format: 'ONNX Mock',
    modules: [{
        name: 'main',
        identifier: 'main',
        inputs: [new Argument('input', [inputValue])],
        outputs: [new Argument('output', [outputValue])],
        nodes: [
            {
                name: 'Conv1',
                type: { name: 'Conv', identifier: 'Conv', category: 'Layer', module: 'ai.onnx', version: 11 },
                attributes: [{ name: 'kernel_shape', type: 'int[]', value: [3, 3] }],
                inputs: [new Argument('X', [inputValue])],
                outputs: [new Argument('Y', [hiddenValue])]
            },
            {
                name: 'Relu1',
                type: { name: 'Relu', identifier: 'Relu', category: 'Activation' },
                attributes: [],
                inputs: [new Argument('X', [hiddenValue])],
                outputs: [new Argument('Y', [outputValue])]
            },
            {
                name: 'Dropout1',
                type: { name: 'Dropout', identifier: 'Dropout' },
                attributes: [],
                inputs: [new Argument('X', [])],
                outputs: [new Argument('Y', [])]
            }
        ]
    }]
};
