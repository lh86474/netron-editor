/*
This file defines some functions that are used to support the export of the graph
Author: Luray He
*/
import './onnx-encode.js';
import { onnx } from './onnx-proto.js';
import { BinaryReader } from './protobuf.js';
import { enumerateGraphValues } from './model-editor.js';
// class to create the ONNXExportError
// Holds the error message and has property ONNX Export Error
// from parent class Error
export class OnnxExportError extends Error {

    constructor(message) {
        super(message);
        this.name = 'ONNX Export Error';
    }
}
// Looks at the field numbers assigned in .proto3 and creates a map to store the field numbers for the data types
const dataTypeByName = new Map([
    ['undefined', 0], ['float32', 1], ['uint8', 2], ['int8', 3], ['uint16', 4], ['int16', 5],
    ['int32', 6], ['int64', 7], ['string', 8], ['boolean', 9], ['float16', 10], ['float64', 11],
    ['uint32', 12], ['uint64', 13], ['complex<float32>', 14], ['complex<float64>', 15], ['bfloat16', 16]
]);
// This is also a map, albeit not consistent with using the Map() oject
// The key is the data type and the value is an object with the type and field properties
const attributeTypeMap = {
    'float32': { type: 1, field: 'f' },
    'float': { type: 1, field: 'f' },
    'float64': { type: 1, field: 'f' },
    'int64': { type: 2, field: 'i' },
    'int': { type: 2, field: 'i' },
    'int32': { type: 2, field: 'i' },
    'string': { type: 3, field: 's' },
    'float32[]': { type: 6, field: 'floats' },
    'float[]': { type: 6, field: 'floats' },
    'int64[]': { type: 7, field: 'ints' },
    'int[]': { type: 7, field: 'ints' },
    'string[]': { type: 8, field: 'strings' }
};

// This function is a utility function that helps us get the name of some value
// For example, it is used in lines 205, 216, 309 to access the name of nodes
const referenceName = (value) => {
    if (typeof value === 'string') {
        return value;
    }
    if (value && typeof value === 'object' && typeof value.name === 'string') {
        return value.name;
    }
    return '';
};
// entityIds point to some editable in a loaded graph. 
// Those are keys in DeltaTracker, the handles in editor patches, what export/UI code uses to find the right node
// this function uses some fancy regex and parsing to extract the graph index, target, index, and attribute index
// For example, if the entityId is 'graph:0/node:0/attr:0', the function will return:
// { graphIndex: 0, target: 'node', nodeIndex: 0, attributeIndex: 0 }
const parseEntityId = (entityId) => {
    const nodeMatch = /^graph:(\d+)\/node:(\d+)(?:\/attr:(\d+))?$/.exec(entityId);
    if (nodeMatch) {
        return {
            graphIndex: Number(nodeMatch[1]),
            target: 'node',
            nodeIndex: Number(nodeMatch[2]),
            attributeIndex: nodeMatch[3] !== undefined ? Number(nodeMatch[3]) : null
        };
    }
    const valueAttrMatch = /^graph:(\d+)\/value:(\d+)\/attr:(\d+)$/.exec(entityId);
    if (valueAttrMatch) {
        return {
            graphIndex: Number(valueAttrMatch[1]),
            target: 'value',
            valueIndex: Number(valueAttrMatch[2]),
            attributeIndex: Number(valueAttrMatch[3])
        };
    }
    const valueMatch = /^graph:(\d+)\/value:(\d+)$/.exec(entityId);
    if (valueMatch) {
        return {
            graphIndex: Number(valueMatch[1]),
            target: 'value',
            valueIndex: Number(valueMatch[2])
        };
    }
    return null;
};
// This is just a formatter for metadata. It joins arrays with commas and handles
// null values and undefined by turning them into empty strings
const formatMetadataValue = (value) => {
    if (Array.isArray(value)) {
        return value.join(', ');
    }
    if (value === null || value === undefined) {
        return '';
    }
    return String(value);
};
// In official ONNX, there is a StringStringEntryProto class that is used to store metadata
// "StringString" denotes that it has a string key and a string value
// This serves as a sort of constructor for the class
const buildMetadataProp = (key, value) => {
    const entry = new onnx.StringStringEntryProto();
    entry.key = key;
    entry.value = formatMetadataValue(value);
    return entry;
};
// this function puts the data into the metadata_props array of the valueInfo object
// a valueinfo object is a placeholder for a value in the graph
// it is used to store the name, type, and metadata of the value
const upsertMetadataProp = (valueInfo, key, value) => {
    valueInfo.metadata_props = valueInfo.metadata_props || [];
    const existing = valueInfo.metadata_props.find((entry) => entry.key === key);
    if (existing) {
        existing.value = formatMetadataValue(value);
        return;
    }
    valueInfo.metadata_props.push(buildMetadataProp(key, value));
};
// This function gets the name of a value by its graph index and value index
// editsession is the session that contains the modified graph
const getValueNameById = (editSession, graphIndex, valueIndex) => {
    const valueId = `graph:${graphIndex}/value:${valueIndex}`;
    const modifiedGraph = editSession.modified.getGraph(graphIndex);
    for (const [value, id] of enumerateGraphValues(modifiedGraph, graphIndex)) {
        if (id === valueId) {
            return value.name;
        }
    }
    return null;
};
// This gets the attribute of a value, important for exporting the type of a value to graph
const getModifiedValueAttribute = (editSession, location) => {
    const valueId = `graph:${location.graphIndex}/value:${location.valueIndex}`;
    const modifiedGraph = editSession.modified.getGraph(location.graphIndex);
    for (const [value, id] of enumerateGraphValues(modifiedGraph, location.graphIndex)) {
        if (id === valueId) {
            return (value.attributes || [])[location.attributeIndex] || null;
        }
    }
    return null;
};
// Makes sure we have a valueInfo object for a value, else creates one for us
// valueinfo is a placeholder for a value in the graph
const ensureValueInfo = (graph, name) => {
    let valueInfo = findValueInfo(graph, name);
    if (!valueInfo) {
        valueInfo = new onnx.ValueInfoProto();
        valueInfo.name = name;
        graph.value_info = graph.value_info || [];
        graph.value_info.push(valueInfo);
    }
    return valueInfo;
};
// This clones the model proto, the container of the graph. 
// Since we are modifying a graph, we need a safe deep copy to work with
const cloneModelProto = (model) => {
    //encodeBytes is a method on the ModelProto class that encodes the model into a binary string
    // These are defined in onnx-encode.js
    const bytes = onnx.ModelProto.encodeBytes(model);
    //decode is a method on the ModelProto class that decodes a binary string into a model object
    return onnx.ModelProto.decode(BinaryReader.open(bytes));
};

const encodeText = (value) => new TextEncoder().encode(value);

// This builds the AttributeProto object
// Refer to onnx docs for more info about attributeproto
// We need to build this to match ONNX IR for export
const buildAttributeProto = (name, type, value) => {
    const mapping = attributeTypeMap[type] || attributeTypeMap['string'];
    const attribute = new onnx.AttributeProto();
    attribute.name = name;
    attribute.type = mapping.type;
    // WE check for the field type and set the appropriate attribute
    if (mapping.field === 's') {
        attribute.s = encodeText(String(value));
    } else if (mapping.field === 'f') {
        attribute.f = Number(value);
    } else if (mapping.field === 'i') {
        attribute.i = typeof value === 'bigint' ? value : BigInt(value);
    } else if (mapping.field === 'floats') {
        attribute.floats = Array.isArray(value) ? value.map((item) => Number(item)) : [];
    } else if (mapping.field === 'ints') {
        attribute.ints = Array.isArray(value) ? value.map((item) => typeof item === 'bigint' ? item : BigInt(item)) : [];
    } else if (mapping.field === 'strings') {
        attribute.strings = Array.isArray(value) ? value.map((item) => encodeText(String(item))) : [];
    } else {
        throw new OnnxExportError(`Unsupported attribute type '${type}' for export.`);
    }
    return attribute;
};
// returns a TypeProto, which is needed for the ONNX IR
const parseTensorTypeString = (typeString) => {
    if (!typeString || typeof typeString !== 'string') {
        throw new OnnxExportError('Value type is required for export.');
    }
    const bracket = typeString.indexOf('[');
    const dataTypeName = bracket === -1 ? typeString.trim() : typeString.slice(0, bracket).trim();
    const elemType = dataTypeByName.get(dataTypeName.toLowerCase());
    if (elemType === undefined) {
        throw new OnnxExportError(`Unsupported value type '${typeString}' for export.`);
    }
    const type = new onnx.TypeProto();
    const tensor = new onnx.TypeProto.Tensor();
    tensor.elem_type = elemType;
    if (bracket !== -1 && typeString.endsWith(']')) {
        const shape = new onnx.TensorShapeProto();
        const inner = typeString.slice(bracket + 1, -1).trim();
        if (inner.length > 0) {
            for (const part of inner.split(',')) {
                const trimmed = part.trim();
                const dimension = new onnx.TensorShapeProto.Dimension();
                if (/^\d+$/.test(trimmed)) {
                    dimension.dim_value = BigInt(trimmed);
                } else {
                    dimension.dim_param = trimmed;
                }
                shape.dim.push(dimension);
            }
        }
        tensor.shape = shape;
    }
    type.tensor_type = tensor;
    return type;
};

// Makes sure node inputs / outputs are represented as simple string names
const normalizeGraphReferences = (graph) => {
    for (const node of graph.node || []) {
        node.input = (node.input || []).map(referenceName);
        node.output = (node.output || []).map(referenceName);
    }
};

const renameInGraph = (graph, oldName, newName) => {
    if (!oldName || oldName === newName) {
        return;
    }
    const replace = (name) => referenceName(name) === oldName ? newName : referenceName(name);
    for (const node of graph.node || []) {
        node.input = (node.input || []).map(replace);
        node.output = (node.output || []).map(replace);
    }
    for (const list of [graph.input, graph.output, graph.value_info]) {
        for (const value of list || []) {
            if (value.name === oldName) {
                value.name = newName;
            }
        }
    }
    for (const tensor of graph.initializer || []) {
        if (tensor.name === oldName) {
            tensor.name = newName;
        }
    }
    for (const tensor of graph.sparse_initializer || []) {
        if (tensor.values && tensor.values.name === oldName) {
            tensor.values.name = newName;
        }
        if (tensor.indices && tensor.indices.name === oldName) {
            tensor.indices.name = newName;
        }
    }
    for (const annotation of graph.quantization_annotation || []) {
        if (annotation.tensor_name === oldName) {
            annotation.tensor_name = newName;
        }
    }
};

const findValueInfo = (graph, name) => {
    for (const list of [graph.input, graph.output, graph.value_info]) {
        for (const value of list || []) {
            if (value.name === name) {
                return value;
            }
        }
    }
    return null;
};

const collectGraphNames = (graph) => {
    const names = new Set();
    for (const node of graph.node || []) {
        for (const name of node.input || []) {
            names.add(name);
        }
        for (const name of node.output || []) {
            names.add(name);
        }
    }
    for (const list of [graph.input, graph.output, graph.value_info]) {
        for (const value of list || []) {
            if (value.name) {
                names.add(value.name);
            }
        }
    }
    for (const tensor of graph.initializer || []) {
        if (tensor.name) {
            names.add(tensor.name);
        }
    }
    return names;
};

const validateGraph = (graph) => {
    const available = new Set();
    for (const value of graph.input || []) {
        if (value.name) {
            available.add(value.name);
        }
    }
    for (const tensor of graph.initializer || []) {
        if (tensor.name) {
            available.add(tensor.name);
        }
    }
    for (const tensor of graph.sparse_initializer || []) {
        if (tensor.values && tensor.values.name) {
            available.add(tensor.values.name);
        }
        if (tensor.indices && tensor.indices.name) {
            available.add(tensor.indices.name);
        }
    }
    for (const node of graph.node || []) {
        if (!node.op_type) {
            throw new OnnxExportError(`Node '${node.name || '(unnamed)'}' is missing op_type.`);
        }
        for (const input of node.input || []) {
            const inputName = referenceName(input);
            if (inputName && !available.has(inputName)) {
                throw new OnnxExportError(`Dangling input reference '${inputName}' on node '${node.name || node.op_type}'.`);
            }
        }
        for (const output of node.output || []) {
            const outputName = referenceName(output);
            if (outputName) {
                available.add(outputName);
            }
        }
        const attributeNames = new Set();
        for (const attribute of node.attribute || []) {
            if (!attribute.name) {
                throw new OnnxExportError(`Node '${node.name || node.op_type}' has an attribute without a name.`);
            }
            if (attributeNames.has(attribute.name)) {
                throw new OnnxExportError(`Duplicate attribute '${attribute.name}' on node '${node.name || node.op_type}'.`);
            }
            attributeNames.add(attribute.name);
        }
    }
};

const validateModel = (model) => {
    if (!model.graph) {
        throw new OnnxExportError('Model has no graph to export.');
    }
    validateGraph(model.graph);
    for (const func of model.functions || []) {
        for (const node of func.node || []) {
            if (!node.op_type) {
                throw new OnnxExportError(`Function '${func.name}' contains a node without op_type.`);
            }
        }
    }
};

const applyAttributeChanges = (graph, originalProto, editSession, changes) => {
    const deletes = [];
    const modifications = [];
    const additions = [];
    for (const change of changes) {
        if (change.entityType !== 'attribute') {
            continue;
        }
        if (change.changeType === 'delete') {
            deletes.push(change);
        } else if (change.changeType === 'add') {
            additions.push(change);
        } else {
            modifications.push(change);
        }
    }
    for (const change of deletes) {
        const location = parseEntityId(change.entityId);
        if (!location) {
            continue;
        }
        if (location.target === 'value') {
            const valueName = getValueNameById(editSession, location.graphIndex, location.valueIndex);
            if (!valueName) {
                continue;
            }
            const originalValueInfo = findValueInfo(originalProto.graph, valueName);
            const originalMetadata = (originalValueInfo && originalValueInfo.metadata_props || [])[location.attributeIndex];
            if (originalMetadata && originalMetadata.key) {
                const valueInfo = findValueInfo(graph, valueName);
                if (valueInfo) {
                    valueInfo.metadata_props = (valueInfo.metadata_props || []).filter((entry) => entry.key !== originalMetadata.key);
                }
            }
            continue;
        }
        const originalNode = originalProto.graph.node[location.nodeIndex];
        const originalAttribute = (originalNode.attribute || [])[location.attributeIndex];
        if (originalAttribute && originalAttribute.name) {
            const node = graph.node[location.nodeIndex];
            node.attribute = (node.attribute || []).filter((attribute) => attribute.name !== originalAttribute.name);
        }
    }
    for (const change of modifications) {
        const location = parseEntityId(change.entityId);
        if (!location) {
            continue;
        }
        if (location.target === 'value') {
            const valueName = getValueNameById(editSession, location.graphIndex, location.valueIndex);
            if (!valueName) {
                throw new OnnxExportError(`Value '${change.entityId}' not found for property export.`);
            }
            const modifiedAttribute = getModifiedValueAttribute(editSession, location);
            const name = modifiedAttribute ? modifiedAttribute.name : null;
            if (!name) {
                continue;
            }
            const valueInfo = ensureValueInfo(graph, valueName);
            upsertMetadataProp(valueInfo, name, change.newValue);
            continue;
        }
        const node = graph.node[location.nodeIndex];
        const attribute = node.attribute[location.attributeIndex];
        if (!attribute) {
            continue;
        }
        const modifiedNode = editSession.modified.getGraph(location.graphIndex).nodes[location.nodeIndex];
        const modifiedAttribute = (modifiedNode.attributes || [])[location.attributeIndex];
        const attributeType = change.attributeType || (modifiedAttribute && modifiedAttribute.type) || 'string';
        const rebuilt = buildAttributeProto(attribute.name, attributeType, change.newValue);
        node.attribute[location.attributeIndex] = rebuilt;
    }
    for (const change of additions) {
        const parentId = change.parentId || change.entityId.replace(/\/attr:\d+$/, '');
        const location = parseEntityId(parentId);
        if (!location) {
            continue;
        }
        const property = change.property || '';
        const name = property.startsWith('attributes.') ? property.slice('attributes.'.length) : property;
        if (location.target === 'value') {
            const valueName = getValueNameById(editSession, location.graphIndex, location.valueIndex);
            if (!valueName) {
                throw new OnnxExportError(`Value '${parentId}' not found for property export.`);
            }
            const valueInfo = ensureValueInfo(graph, valueName);
            upsertMetadataProp(valueInfo, name, change.newValue);
            continue;
        }
        const node = graph.node[location.nodeIndex];
        const modifiedNode = editSession.modified.getGraph(location.graphIndex).nodes[location.nodeIndex];
        const modifiedAttribute = (modifiedNode.attributes || []).find((entry) => entry.name === name);
        const attributeType = change.attributeType || (modifiedAttribute && modifiedAttribute.type) || 'string';
        const attribute = buildAttributeProto(name, attributeType, change.newValue);
        node.attribute = node.attribute || [];
        node.attribute.push(attribute);
    }
};

const collectArgumentValueNames = (argument) => {
    const names = [];
    if (!argument || !Array.isArray(argument.value)) {
        return names;
    }
    for (const value of argument.value) {
        if (value && value.name) {
            names.push(value.name);
        }
    }
    return names;
};

const buildNodeProtoFromModified = (modifiedNode) => {
    const node = new onnx.NodeProto();
    node.name = modifiedNode.name || '';
    node.op_type = modifiedNode.type ? (modifiedNode.type.identifier || modifiedNode.type.name) : '';
    if (modifiedNode.type && modifiedNode.type.module && modifiedNode.type.module !== 'ai.onnx') {
        node.domain = modifiedNode.type.module;
    }
    node.input = [];
    for (const input of modifiedNode.inputs || []) {
        node.input.push(...collectArgumentValueNames(input));
    }
    node.output = [];
    for (const output of modifiedNode.outputs || []) {
        node.output.push(...collectArgumentValueNames(output));
    }
    node.attribute = (modifiedNode.attributes || []).map((attribute) => (
        buildAttributeProto(attribute.name, attribute.type, attribute.value)
    ));
    return node;
};

const syncNodeInputsOutputs = (protoNode, modifiedNode) => {
    protoNode.input = [];
    for (const input of modifiedNode.inputs || []) {
        protoNode.input.push(...collectArgumentValueNames(input));
    }
    protoNode.output = [];
    for (const output of modifiedNode.outputs || []) {
        protoNode.output.push(...collectArgumentValueNames(output));
    }
};

const syncNodeFromModified = (protoNode, modifiedNode) => {
    syncNodeInputsOutputs(protoNode, modifiedNode);
    protoNode.name = modifiedNode.name || '';
    protoNode.op_type = modifiedNode.type ? (modifiedNode.type.identifier || modifiedNode.type.name) : protoNode.op_type;
    if (modifiedNode.type && modifiedNode.type.module && modifiedNode.type.module !== 'ai.onnx') {
        protoNode.domain = modifiedNode.type.module;
    } else {
        delete protoNode.domain;
    }
    protoNode.attribute = (modifiedNode.attributes || []).map((attribute) => (
        buildAttributeProto(attribute.name, attribute.type, attribute.value)
    ));
};

const collectArgumentValueNamesFromGraph = (graph) => {
    const names = new Set();
    const track = (argument) => {
        for (const name of collectArgumentValueNames(argument)) {
            names.add(name);
        }
    };
    for (const input of graph.inputs || []) {
        track(input);
    }
    for (const output of graph.outputs || []) {
        track(output);
    }
    for (const node of graph.nodes || []) {
        for (const input of node.inputs || []) {
            track(input);
        }
        for (const output of node.outputs || []) {
            track(output);
        }
    }
    return names;
};

const copyValueInfo = (valueInfo) => {
    if (!valueInfo) {
        return null;
    }
    const copy = new onnx.ValueInfoProto();
    copy.name = valueInfo.name || '';
    if (valueInfo.doc_string !== undefined) {
        copy.doc_string = valueInfo.doc_string;
    }
    if (valueInfo.type) {
        copy.type = valueInfo.type;
    }
    if (Array.isArray(valueInfo.metadata_props)) {
        copy.metadata_props = valueInfo.metadata_props.map((entry) => {
            const item = new onnx.StringStringEntryProto();
            item.key = entry.key;
            item.value = entry.value;
            return item;
        });
    }
    return copy;
};

const buildGraphValueInfo = (argument, sourceGraph, usedNames) => {
    const infos = [];
    for (const name of collectArgumentValueNames(argument)) {
        if (!usedNames.has(name)) {
            continue;
        }
        const existing = findValueInfo(sourceGraph, name);
        if (existing) {
            infos.push(copyValueInfo(existing));
            continue;
        }
        const valueInfo = new onnx.ValueInfoProto();
        valueInfo.name = name;
        infos.push(valueInfo);
    }
    return infos;
};

export const rebuildGraphProtoFromModified = (modifiedGraph, sourceProto) => {
    if (!sourceProto || !sourceProto.graph) {
        throw new OnnxExportError('Original ONNX protobuf is not available for graph rebuild.');
    }
    const sourceGraph = sourceProto.graph;
    const originalByName = new Map();
    for (const node of sourceGraph.node || []) {
        if (node.name) {
            originalByName.set(node.name, node);
        }
    }
    const usedNames = collectArgumentValueNamesFromGraph(modifiedGraph);
    const nodes = [];
    for (const modifiedNode of modifiedGraph.nodes || []) {
        const existing = originalByName.get(modifiedNode.name);
        if (existing) {
            syncNodeFromModified(existing, modifiedNode);
            nodes.push(existing);
        } else {
            nodes.push(buildNodeProtoFromModified(modifiedNode));
        }
    }
    const input = [];
    for (const modifiedInput of modifiedGraph.inputs || []) {
        input.push(...buildGraphValueInfo(modifiedInput, sourceGraph, usedNames));
    }
    const output = [];
    for (const modifiedOutput of modifiedGraph.outputs || []) {
        output.push(...buildGraphValueInfo(modifiedOutput, sourceGraph, usedNames));
    }
    const initializer = (sourceGraph.initializer || []).filter((tensor) => tensor.name && usedNames.has(tensor.name));
    const value_info = (sourceGraph.value_info || []).filter((value) => value.name && usedNames.has(value.name));
    const sparse_initializer = (sourceGraph.sparse_initializer || []).filter((tensor) => {
        const valuesName = tensor.values && tensor.values.name;
        const indicesName = tensor.indices && tensor.indices.name;
        return (valuesName && usedNames.has(valuesName)) || (indicesName && usedNames.has(indicesName));
    });
    return {
        name: modifiedGraph.name || sourceGraph.name || '',
        doc_string: sourceGraph.doc_string || '',
        node: nodes,
        input,
        output,
        initializer,
        value_info,
        sparse_initializer,
        quantization_annotation: sourceGraph.quantization_annotation || []
    };
};

// This supports node insertions and deletions by rebuilding graph.node from the modified graph.
const applyStructuralNodeChanges = (graph, originalProto, editSession) => {
    const changes = editSession.delta.getChanges();
    const structural = changes.filter((change) => (
        change.entityType === 'node' && (
            (change.changeType === 'add' && change.property === 'insert') ||
            (change.changeType === 'delete' && change.property === 'remove')
        )
    ));
    const modifiedGraph = editSession.modified.getGraph(0);
    const modifiedCount = (modifiedGraph.nodes || []).length;
    const protoCount = (graph.node || []).length;
    if (structural.length === 0 && modifiedCount === protoCount) {
        return;
    }
    const originalNodesByName = new Map();
    for (const node of originalProto.graph.node || []) {
        if (node.name) {
            originalNodesByName.set(node.name, node);
        }
    }
    const rebuiltNodes = [];
    for (const modifiedNode of modifiedGraph.nodes || []) {
        const existing = originalNodesByName.get(modifiedNode.name);
        if (existing) {
            syncNodeInputsOutputs(existing, modifiedNode);
            rebuiltNodes.push(existing);
        } else {
            rebuiltNodes.push(buildNodeProtoFromModified(modifiedNode));
        }
    }
    graph.node = rebuiltNodes;
    for (let index = 0; index < (modifiedGraph.outputs || []).length; index++) {
        const modifiedOutput = modifiedGraph.outputs[index];
        const protoOutput = (graph.output || [])[index];
        const modifiedValue = modifiedOutput && Array.isArray(modifiedOutput.value) ? modifiedOutput.value[0] : null;
        if (protoOutput && modifiedValue && modifiedValue.name && protoOutput.name !== modifiedValue.name) {
            renameInGraph(graph, protoOutput.name, modifiedValue.name);
        }
    }
};

// This applies the changes to the graph
// delta is our tracker that contains what we have changed. 
const applyChanges = (cloned, originalProto, editSession) => {
    const graph = cloned.graph;
    const changes = editSession.delta.getChanges();

    for (const change of changes) {
        if (change.entityType === 'node' && change.property === 'name') {
            const location = parseEntityId(change.entityId);
            graph.node[location.nodeIndex].name = change.newValue;
        }
    }

    applyAttributeChanges(graph, originalProto, editSession, changes);

    const valueRenames = new Map();
    for (const change of changes) {
        if (change.entityType !== 'value') {
            continue;
        }
        const location = parseEntityId(change.entityId);
        if (change.property === 'name') {
            const originalName = change.oldValue;
            if (originalName && change.newValue && originalName !== change.newValue) {
                valueRenames.set(originalName, change.newValue);
            }
        } else if (change.property === 'type') {
            const modifiedGraph = editSession.modified.getGraph(location.graphIndex);
            let currentName = null;
            for (const [value, valueId] of enumerateGraphValues(modifiedGraph, location.graphIndex)) {
                if (valueId === change.entityId) {
                    currentName = value.name;
                    break;
                }
            }
            if (!currentName) {
                throw new OnnxExportError(`Value '${change.entityId}' not found for type export.`);
            }
            let valueInfo = findValueInfo(graph, currentName);
            if (!valueInfo) {
                valueInfo = new onnx.ValueInfoProto();
                valueInfo.name = currentName;
                graph.value_info = graph.value_info || [];
                graph.value_info.push(valueInfo);
            }
            valueInfo.type = parseTensorTypeString(change.newValue);
        } else if (change.property === 'description') {
            const modifiedGraph = editSession.modified.getGraph(location.graphIndex);
            let currentName = null;
            for (const [value, valueId] of enumerateGraphValues(modifiedGraph, location.graphIndex)) {
                if (valueId === change.entityId) {
                    currentName = value.name;
                    break;
                }
            }
            if (!currentName) {
                throw new OnnxExportError(`Value '${change.entityId}' not found for description export.`);
            }
            let valueInfo = findValueInfo(graph, currentName);
            if (!valueInfo) {
                valueInfo = new onnx.ValueInfoProto();
                valueInfo.name = currentName;
                graph.value_info = graph.value_info || [];
                graph.value_info.push(valueInfo);
            }
            valueInfo.doc_string = change.newValue;
        }
    }

    for (const [oldName, newName] of valueRenames) {
        if (collectGraphNames(graph).has(newName)) {
            throw new OnnxExportError(`Cannot rename '${oldName}' to '${newName}' because the name already exists.`);
        }
        renameInGraph(graph, oldName, newName);
    }

    applyStructuralNodeChanges(graph, originalProto, editSession);
};

export const canExportOnnx = (model) => {
    return model && model.exportable === true;
};

// This is the main function that actually exports the graph
// It first detects some common errors through our helper functions
// We make sure all graph references are string
// check for dangling referenes and return the encoded .onnx
export const exportModifiedOnnx = (model, editSession) => {
    if (!canExportOnnx(model)) {
        throw new OnnxExportError('This model cannot be exported as ONNX.');
    }
    // Must be modified
    if (!editSession) {
        throw new OnnxExportError('No editor session is available for export.');
    }
    // We can't support proto, just .onnx
    const proto = model.proto;
    if (!proto) {
        throw new OnnxExportError('Original ONNX protobuf is not available for export.');
    }
    const cloned = cloneModelProto(proto);
    normalizeGraphReferences(cloned.graph);
    applyChanges(cloned, proto, editSession);
    validateModel(cloned);
    return onnx.ModelProto.encodeBytes(cloned);
};

export const cloneModelProtoForMerge = cloneModelProto;
export const normalizeGraphReferencesForMerge = normalizeGraphReferences;
export const renameInGraphForMerge = renameInGraph;
export const collectGraphNamesForMerge = collectGraphNames;
export const validateGraphForMerge = validateGraph;
