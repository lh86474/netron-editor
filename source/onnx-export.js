/*
This file defines some functions that are used to support the export of the graph
Author: Luray He
*/
import './onnx-encode.js';
import { onnx } from './onnx-proto.js';
import { BinaryReader } from './protobuf.js';
import { enumerateGraphValues } from './model-editor.js';
import { findCVFlowNVPNode, isAmbapbCheckpoint } from './ambapb.js';
import {
    buildPrimGraphAttributeProto,
    collectImmediateTensorNames,
    parsePrimGraphJson,
    PRIM_GRAPH_ATTRIBUTE_NAME,
    resolveKeptPrimitiveIds,
    serializePrimGraphJson,
    slicePrimGraph
} from './ambapb-prim-graph.js';
import {
    COMPILED_PRIM_GRAPH_ATTRIBUTE,
    CVFLOW_NVP_OP_TYPE,
    PRIM_GRAPH_IMMS_ATTRIBUTE,
    resolveCheckpointRuntimeGraph
} from './ambapb-editor.js';
import { canonicalizeTensorTypeString, tensorDataTypeByName } from './tensor-type.js';
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
    'string[]': { type: 8, field: 'strings' },
    'graph': { type: 5, field: 'g' }
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

const cloneNodeProto = (node) => {
    if (!node) {
        return null;
    }
    const graph = new onnx.GraphProto();
    graph.node = [node];
    const model = new onnx.ModelProto();
    model.graph = graph;
    const bytes = onnx.ModelProto.encodeBytes(model);
    return onnx.ModelProto.decode(BinaryReader.open(bytes)).graph.node[0];
};

const cloneAttributeProto = (attribute) => {
    if (!attribute || !attribute.name) {
        return null;
    }
    const node = new onnx.NodeProto();
    node.op_type = 'Constant';
    node.attribute = [attribute];
    const graph = new onnx.GraphProto();
    graph.node = [node];
    const model = new onnx.ModelProto();
    model.graph = graph;
    const bytes = onnx.ModelProto.encodeBytes(model);
    return onnx.ModelProto.decode(BinaryReader.open(bytes)).graph.node[0].attribute[0];
};

const cloneTensorProto = (tensor) => {
    if (!tensor) {
        return null;
    }
    const attribute = new onnx.AttributeProto();
    attribute.name = '_tensor';
    attribute.type = onnx.AttributeProto.AttributeType.TENSOR;
    attribute.t = tensor;
    const cloned = cloneAttributeProto(attribute);
    return cloned && cloned.t ? cloned.t : null;
};

const buildImmsAttributeProto = (tensors, originalAttribute) => {
    const attribute = new onnx.AttributeProto();
    attribute.name = PRIM_GRAPH_IMMS_ATTRIBUTE;
    attribute.type = onnx.AttributeProto.AttributeType.TENSORS;
    attribute.tensors = tensors;
    if (originalAttribute && originalAttribute.doc_string) {
        attribute.doc_string = originalAttribute.doc_string;
    }
    return attribute;
};

const isEditorTensorProtoLike = (value) => Boolean(
    value && typeof value === 'object' && (
        value.raw_data !== undefined ||
        value.float_data !== undefined ||
        value.int32_data !== undefined ||
        value.int64_data !== undefined ||
        Array.isArray(value.dims) ||
        value.data_type !== undefined ||
        value.dataType !== undefined
    )
);

const resolveEditorTensorProto = (value) => {
    if (!value) {
        return null;
    }
    if (isEditorTensorProtoLike(value)) {
        return cloneTensorProto(value);
    }
    if (typeof value === 'object' && value.values !== undefined) {
        try {
            const raw = value.values;
            if (raw instanceof Uint8Array) {
                const tensor = new onnx.TensorProto();
                tensor.data_type = onnx.TensorProto.DataType.UINT8;
                tensor.dims = [BigInt(raw.length)];
                tensor.raw_data = raw.slice();
                if (typeof value.name === 'string' && value.name.length > 0) {
                    tensor.name = value.name;
                }
                return tensor;
            }
            if (ArrayBuffer.isView(raw) || Array.isArray(raw)) {
                const tensor = new onnx.TensorProto();
                tensor.data_type = onnx.TensorProto.DataType.FLOAT;
                tensor.float_data = Array.from(raw);
                const shape = value.type && value.type.shape ? value.type.shape.dimensions : null;
                if (Array.isArray(shape) && shape.length > 0) {
                    tensor.dims = shape.map((dim) => BigInt(dim));
                } else {
                    tensor.dims = [BigInt(tensor.float_data.length)];
                }
                if (typeof value.name === 'string' && value.name.length > 0) {
                    tensor.name = value.name;
                }
                return tensor;
            }
        } catch {
            return null;
        }
    }
    return null;
};

const resolveImmsTensorsFromModified = (value) => {
    if (!Array.isArray(value) || value.length === 0) {
        return [];
    }
    const tensors = [];
    for (const entry of value) {
        const tensor = resolveEditorTensorProto(entry);
        if (tensor) {
            tensors.push(tensor);
        }
    }
    return tensors;
};

const buildImmsAttributeFromModified = (value, originalAttribute) => {
    const modifiedTensors = resolveImmsTensorsFromModified(value);
    if (modifiedTensors.length > 0) {
        return buildImmsAttributeProto(modifiedTensors, originalAttribute);
    }
    if (originalAttribute && Array.isArray(originalAttribute.tensors) && originalAttribute.tensors.length > 0) {
        return buildImmsAttributeProto(
            originalAttribute.tensors.map((tensor) => cloneTensorProto(tensor)).filter((tensor) => tensor !== null),
            originalAttribute
        );
    }
    if (originalAttribute) {
        return cloneAttributeProto(originalAttribute);
    }
    return null;
};

const buildGenericTensorAttributeProto = (name, tensor, originalAttribute) => {
    const attribute = new onnx.AttributeProto();
    attribute.name = name;
    attribute.type = onnx.AttributeProto.AttributeType.TENSOR;
    attribute.t = tensor;
    if (originalAttribute && originalAttribute.doc_string) {
        attribute.doc_string = originalAttribute.doc_string;
    }
    return attribute;
};

const buildGenericTensorsAttributeProto = (name, tensors, originalAttribute) => {
    const attribute = new onnx.AttributeProto();
    attribute.name = name;
    attribute.type = onnx.AttributeProto.AttributeType.TENSORS;
    attribute.tensors = tensors;
    if (originalAttribute && originalAttribute.doc_string) {
        attribute.doc_string = originalAttribute.doc_string;
    }
    return attribute;
};

const buildGenericTensorAttributeFromModified = (name, type, value, originalAttribute) => {
    if (type === 'tensor[]') {
        const modifiedTensors = resolveImmsTensorsFromModified(value);
        if (modifiedTensors.length > 0) {
            return buildGenericTensorsAttributeProto(name, modifiedTensors, originalAttribute);
        }
        if (originalAttribute && Array.isArray(originalAttribute.tensors) && originalAttribute.tensors.length > 0) {
            return buildGenericTensorsAttributeProto(
                name,
                originalAttribute.tensors.map((tensor) => cloneTensorProto(tensor)).filter(Boolean),
                originalAttribute
            );
        }
    } else {
        const tensor = resolveEditorTensorProto(value);
        if (tensor) {
            return buildGenericTensorAttributeProto(name, tensor, originalAttribute);
        }
        if (originalAttribute && originalAttribute.t) {
            return buildGenericTensorAttributeProto(name, cloneTensorProto(originalAttribute.t), originalAttribute);
        }
    }
    if (originalAttribute) {
        return cloneAttributeProto(originalAttribute);
    }
    return null;
};

const modifiedGraphArguments = (node) => {
    if (!node) {
        return [];
    }
    return [...(node.attributes || []), ...(node.blocks || [])];
};

const isGraphAttributeType = (type) => type === 'graph';

const isTensorAttributeType = (type) => type === 'tensor' || type === 'tensor[]';

const isProtoGraphAttribute = (attribute) => Boolean(attribute && attribute.g);

const isProtoTensorAttribute = (attribute) => Boolean(
    attribute && (attribute.t || (Array.isArray(attribute.tensors) && attribute.tensors.length > 0))
);

const shouldPreserveOriginalAttribute = (attribute) => (
    isProtoGraphAttribute(attribute) || isProtoTensorAttribute(attribute)
);

const isShellNodeType = (node) => {
    const name = node && node.type ? (node.type.identifier || node.type.name) : null;
    return name === CVFLOW_NVP_OP_TYPE;
};

const isShellLayoutGraph = (graph) => {
    const nodes = graph && graph.nodes ? graph.nodes : [];
    return nodes.length === 1 && isShellNodeType(nodes[0]);
};

const getCompiledGraphFromShellNode = (node) => {
    if (!node) {
        return null;
    }
    for (const entry of modifiedGraphArguments(node)) {
        if (entry.name === COMPILED_PRIM_GRAPH_ATTRIBUTE && entry.type === 'graph' && entry.value) {
            return entry.value;
        }
    }
    return null;
};

const protoHasCompiledPrimGraph = (wrapperNode) => {
    if (!wrapperNode || !Array.isArray(wrapperNode.attribute)) {
        return false;
    }
    return wrapperNode.attribute.some((attribute) => attribute && attribute.name === COMPILED_PRIM_GRAPH_ATTRIBUTE);
};

const buildPrimGraphAttributeFromModified = (value, originalAttribute) => {
    if (typeof value === 'string') {
        return buildPrimGraphAttributeProto(value, originalAttribute);
    }
    try {
        const primGraph = parsePrimGraphJson(value);
        return buildPrimGraphAttributeProto(serializePrimGraphJson(primGraph), originalAttribute);
    } catch (error) {
        if (originalAttribute && originalAttribute.t) {
            try {
                const primGraph = parsePrimGraphJson(originalAttribute.t);
                return buildPrimGraphAttributeProto(serializePrimGraphJson(primGraph), originalAttribute);
            } catch {
                // fall through
            }
        }
        if (originalAttribute) {
            return cloneAttributeProto(originalAttribute);
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new OnnxExportError(`Unsupported tensor attribute '${PRIM_GRAPH_ATTRIBUTE_NAME}' for export (${message}).`);
    }
};

const buildTensorAttributeProto = (name, value, originalAttribute, attributeType = 'tensor') => {
    if (name === PRIM_GRAPH_ATTRIBUTE_NAME) {
        return buildPrimGraphAttributeFromModified(value, originalAttribute);
    }
    if (name === PRIM_GRAPH_IMMS_ATTRIBUTE) {
        const immsAttribute = buildImmsAttributeFromModified(value, originalAttribute);
        if (immsAttribute) {
            return immsAttribute;
        }
        throw new OnnxExportError(`Unsupported tensor attribute '${name}' for export.`);
    }
    const genericAttribute = buildGenericTensorAttributeFromModified(name, attributeType, value, originalAttribute);
    if (genericAttribute) {
        return genericAttribute;
    }
    if (originalAttribute) {
        return cloneAttributeProto(originalAttribute);
    }
    throw new OnnxExportError(`Unsupported tensor attribute '${name}' for export.`);
};

const resolveCheckpointExportGraph = (editSession, proto) => {
    const modifiedGraph = editSession.modified.getGraph(0);
    if (!isShellLayoutGraph(modifiedGraph)) {
        return {
            runtimeGraph: modifiedGraph,
            shellNode: null
        };
    }
    const shellNode = modifiedGraph.nodes[0];
    const compiledGraph = getCompiledGraphFromShellNode(shellNode);
    const wrapperNode = findCVFlowNVPNode(proto.graph);
    if (compiledGraph || (wrapperNode && protoHasCompiledPrimGraph(wrapperNode))) {
        return {
            runtimeGraph: compiledGraph || { name: '', inputs: [], outputs: [], nodes: [] },
            shellNode
        };
    }
    return {
        runtimeGraph: null,
        shellNode
    };
};

const shouldUseCheckpointRebuild = (editSession, proto) => {
    const wrapperNode = findCVFlowNVPNode(proto && proto.graph);
    if (!wrapperNode) {
        return false;
    }
    const modifiedGraph = editSession.modified.getGraph(0);
    if (!isShellLayoutGraph(modifiedGraph)) {
        return false;
    }
    const { runtimeGraph } = resolveCheckpointExportGraph(editSession, proto);
    return runtimeGraph !== null;
};

const buildGraphAttributeProto = (name, graphBody, originalAttribute = null) => {
    const attribute = new onnx.AttributeProto();
    attribute.name = name;
    attribute.type = onnx.AttributeProto.AttributeType.GRAPH;
    attribute.g = graphBody;
    if (originalAttribute && originalAttribute.doc_string) {
        attribute.doc_string = originalAttribute.doc_string;
    }
    return attribute;
};

// This builds the AttributeProto object
// Refer to onnx docs for more info about attributeproto
// We need to build this to match ONNX IR for export
const buildAttributeProto = (name, type, value, sourceProto) => {
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
    } else if (mapping.field === 'g') {
        const nestedSourceProto = (sourceProto && sourceProto.graph) ? sourceProto : { graph: { name: (value && value.name) || '', node: [], input: [], output: [], initializer: [], value_info: [] } };
        attribute.g = rebuildGraphProtoFromModified(value, nestedSourceProto);
    } else {
        throw new OnnxExportError(`Unsupported attribute type '${type}' for export.`);
    }
    return attribute;
};

// returns a TypeProto, which is needed for the ONNX IR
const parseTensorTypeString = (typeString) => {
    const canonical = canonicalizeTensorTypeString(typeString);
    if (!canonical) {
        throw new OnnxExportError('Value type is required for export.');
    }
    const bracket = canonical.indexOf('[');
    const dataTypeName = bracket === -1 ? canonical : canonical.slice(0, bracket);
    const elemType = tensorDataTypeByName.get(dataTypeName);
    const type = new onnx.TypeProto();
    const tensor = new onnx.TypeProto.Tensor();
    tensor.elem_type = elemType;
    if (bracket !== -1) {
        const shape = new onnx.TensorShapeProto();
        const inner = canonical.slice(bracket + 1, -1).trim();
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

        if (attribute.name === PRIM_GRAPH_ATTRIBUTE_NAME && typeof change.newValue === 'string') {
            const originalNode = originalProto.graph.node[location.nodeIndex];
            const originalAttribute = (originalNode.attribute || [])[location.attributeIndex];
            node.attribute[location.attributeIndex] =
                buildPrimGraphAttributeProto(change.newValue, originalAttribute);
            continue;
        }
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

const buildNodeProtoFromModified = (modifiedNode, originalNodesByName = null, nestedSourceGraph = null) => {
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
    const originalNode = originalNodesByName && modifiedNode.name ?
        originalNodesByName.get(modifiedNode.name) :
        null;
    node.attribute = syncNodeAttributesFromModified(originalNode, modifiedNode, originalNodesByName, nestedSourceGraph);
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

const syncNodeAttributesFromModified = (protoNode, modifiedNode, originalNodesByName, nestedSourceGraph) => {
    const originalByName = new Map();
    for (const attribute of (protoNode && protoNode.attribute) || []) {
        if (attribute && attribute.name && !originalByName.has(attribute.name)) {
            originalByName.set(attribute.name, attribute);
        }
    }
    const attributes = [];
    const handled = new Set();
    for (const modifiedAttribute of modifiedGraphArguments(modifiedNode)) {
        if (!modifiedAttribute || !modifiedAttribute.name || handled.has(modifiedAttribute.name)) {
            continue;
        }
        handled.add(modifiedAttribute.name);
        const originalAttribute = originalByName.get(modifiedAttribute.name);
        if (modifiedAttribute.name === PRIM_GRAPH_ATTRIBUTE_NAME) {
            if (typeof modifiedAttribute.value === 'string') {
                attributes.push(buildPrimGraphAttributeFromModified(modifiedAttribute.value, originalAttribute));
                continue;
            }
            if (isTensorAttributeType(modifiedAttribute.type)) {
                try {
                    attributes.push(buildPrimGraphAttributeFromModified(modifiedAttribute.value, originalAttribute));
                } catch (error) {
                    if (originalAttribute) {
                        throw error;
                    }
                    // Ignore unparseable view placeholders; checkpoint wrapper rebuild owns prim_graph.
                }
                continue;
            }
        }
        if (modifiedAttribute.name === PRIM_GRAPH_IMMS_ATTRIBUTE && isTensorAttributeType(modifiedAttribute.type)) {
            try {
                const immsAttribute = buildImmsAttributeFromModified(modifiedAttribute.value, originalAttribute);
                if (immsAttribute) {
                    attributes.push(immsAttribute);
                }
            } catch (error) {
                if (originalAttribute) {
                    throw error;
                }
                // Ignore empty view placeholders; checkpoint wrapper rebuild owns prim_graph_imms.
            }
            continue;
        }
        if (isGraphAttributeType(modifiedAttribute.type) && modifiedAttribute.value) {
            const sourceGraphProto = originalAttribute && originalAttribute.g ?
                originalAttribute.g :
                nestedSourceGraph;
            const nestedOriginalByName = collectOriginalNodesFromProtoGraph(sourceGraphProto);
            const graphBody = buildGraphProtoFromModifiedGraph(
                modifiedAttribute.value,
                sourceGraphProto,
                nestedOriginalByName
            );
            attributes.push(buildGraphAttributeProto(
                modifiedAttribute.name,
                graphBody,
                originalAttribute
            ));
            continue;
        }
        if (isTensorAttributeType(modifiedAttribute.type)) {
            try {
                const tensorAttribute = buildTensorAttributeProto(
                    modifiedAttribute.name,
                    modifiedAttribute.value,
                    originalAttribute,
                    modifiedAttribute.type
                );
                if (tensorAttribute) {
                    attributes.push(tensorAttribute);
                }
            } catch (error) {
                if (originalAttribute) {
                    throw error;
                }
                // Ignore unencodable view placeholders without proto fallback.
            }
            continue;
        }
        if (originalAttribute && shouldPreserveOriginalAttribute(originalAttribute)) {
            attributes.push(cloneAttributeProto(originalAttribute));
            continue;
        }
        attributes.push(buildAttributeProto(
            modifiedAttribute.name,
            modifiedAttribute.type,
            modifiedAttribute.value
        ));
    }
    for (const [name, originalAttribute] of originalByName) {
        if (!handled.has(name)) {
            attributes.push(cloneAttributeProto(originalAttribute));
        }
    }
    return attributes;
};

const syncNodeFromModified = (protoNode, modifiedNode, originalNodesByName = null, nestedSourceGraph = null) => {
    syncNodeInputsOutputs(protoNode, modifiedNode);
    protoNode.name = modifiedNode.name || '';
    protoNode.op_type = modifiedNode.type ? (modifiedNode.type.identifier || modifiedNode.type.name) : protoNode.op_type;
    if (modifiedNode.type && modifiedNode.type.module && modifiedNode.type.module !== 'ai.onnx') {
        protoNode.domain = modifiedNode.type.module;
    } else {
        delete protoNode.domain;
    }
    protoNode.attribute = syncNodeAttributesFromModified(
        protoNode,
        modifiedNode,
        originalNodesByName,
        nestedSourceGraph
    );
};

const collectArgumentValueNamesFromGraph = (graph) => {
    const names = new Set();
    const track = (argument) => {
        for (const name of collectArgumentValueNames(argument)) {
            names.add(name);
        }
    };
    const visit = (entry) => {
        if (!entry) {
            return;
        }
        for (const input of entry.inputs || []) {
            track(input);
        }
        for (const output of entry.outputs || []) {
            track(output);
        }
        for (const node of entry.nodes || []) {
            for (const input of node.inputs || []) {
                track(input);
            }
            for (const output of node.outputs || []) {
                track(output);
            }
            for (const attribute of modifiedGraphArguments(node)) {
                if (isGraphAttributeType(attribute.type) && attribute.value) {
                    visit(attribute.value);
                }
            }
        }
    };
    visit(graph);
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

const syncGraphBoundaryFromModified = (graph, modifiedGraph, sourceGraph) => {
    const usedNames = collectArgumentValueNamesFromGraph(modifiedGraph);
    const input = [];
    for (const modifiedInput of modifiedGraph.inputs || []) {
        input.push(...buildGraphValueInfo(modifiedInput, sourceGraph, usedNames));
    }
    const output = [];
    for (const modifiedOutput of modifiedGraph.outputs || []) {
        output.push(...buildGraphValueInfo(modifiedOutput, sourceGraph, usedNames));
    }
    graph.input = input;
    graph.output = output;
    graph.value_info = (sourceGraph.value_info || []).filter((value) => value.name && usedNames.has(value.name));
    graph.initializer = (sourceGraph.initializer || []).filter((tensor) => tensor.name && usedNames.has(tensor.name));
    graph.sparse_initializer = (sourceGraph.sparse_initializer || []).filter((tensor) => {
        const valuesName = tensor.values && tensor.values.name;
        const indicesName = tensor.indices && tensor.indices.name;
        return (valuesName && usedNames.has(valuesName)) || (indicesName && usedNames.has(indicesName));
    });
};

const collectOriginalNodesFromProtoGraph = (graphProto) => {
    const originalByName = new Map();
    if (!graphProto) {
        return originalByName;
    }
    const visitGraph = (graph) => {
        if (!graph) {
            return;
        }
        for (const node of graph.node || []) {
            if (node && node.name && !originalByName.has(node.name)) {
                originalByName.set(node.name, node);
            }
            for (const attribute of node.attribute || []) {
                if (attribute && attribute.g) {
                    visitGraph(attribute.g);
                }
            }
        }
    };
    visitGraph(graphProto);
    return originalByName;
};

const collectOriginalNodesByName = (sourceGraph, wrapperNode) => {
    const originalByName = collectOriginalNodesFromProtoGraph(sourceGraph);
    if (wrapperNode) {
        const compiledAttr = (wrapperNode.attribute || []).find((attr) => attr && attr.name === COMPILED_PRIM_GRAPH_ATTRIBUTE);
        if (compiledAttr && compiledAttr.g) {
            for (const [name, node] of collectOriginalNodesFromProtoGraph(compiledAttr.g)) {
                if (!originalByName.has(name)) {
                    originalByName.set(name, node);
                }
            }
        }
    }
    return originalByName;
};

const buildGraphProtoFromModifiedGraph = (modifiedGraph, sourceGraphProto, originalNodesByName) => {
    if (!modifiedGraph) {
        return null;
    }
    const usedNames = collectArgumentValueNamesFromGraph(modifiedGraph);
    const nodes = [];
    for (const modifiedNode of modifiedGraph.nodes || []) {
        const existing = originalNodesByName && modifiedNode.name ?
            originalNodesByName.get(modifiedNode.name) :
            null;
        if (existing) {
            const clonedNode = cloneNodeProto(existing);
            syncNodeFromModified(clonedNode, modifiedNode, originalNodesByName, sourceGraphProto);
            nodes.push(clonedNode);
        } else {
            nodes.push(buildNodeProtoFromModified(modifiedNode, originalNodesByName, sourceGraphProto));
        }
    }
    const sourceGraph = sourceGraphProto || {};
    const input = [];
    for (const modifiedInput of modifiedGraph.inputs || []) {
        input.push(...buildGraphValueInfo(modifiedInput, sourceGraph, usedNames));
    }
    const output = [];
    for (const modifiedOutput of modifiedGraph.outputs || []) {
        output.push(...buildGraphValueInfo(modifiedOutput, sourceGraph, usedNames));
    }
    const value_info = (sourceGraph.value_info || []).filter((value) => value.name && usedNames.has(value.name));
    const sparse_initializer = (sourceGraph.sparse_initializer || []).filter((tensor) => {
        const valuesName = tensor.values && tensor.values.name;
        const indicesName = tensor.indices && tensor.indices.name;
        return (valuesName && usedNames.has(valuesName)) || (indicesName && usedNames.has(indicesName));
    });
    return {
        name: modifiedGraph.name || sourceGraph.name || '',
        doc_string: sourceGraph.doc_string || modifiedGraph.doc_string || '',
        node: nodes,
        input,
        output,
        initializer: (sourceGraph.initializer || []).filter((tensor) => tensor.name && usedNames.has(tensor.name)),
        value_info,
        sparse_initializer,
        quantization_annotation: sourceGraph.quantization_annotation || []
    };
};

const buildRuntimeGraphBody = (modifiedGraph, sourceGraph, originalNodesByName) => {
    const compiledSource = sourceGraph && sourceGraph.node ? sourceGraph : null;
    return buildGraphProtoFromModifiedGraph(modifiedGraph, compiledSource, originalNodesByName);
};

const loadCheckpointPrimGraph = (wrapperNode, ambapbPrimGraph) => {
    if (ambapbPrimGraph) {
        return ambapbPrimGraph;
    }
    const primGraphAttr = (wrapperNode.attribute || []).find((attr) => attr && attr.name === PRIM_GRAPH_ATTRIBUTE_NAME);
    if (!primGraphAttr || !primGraphAttr.t) {
        return null;
    }
    try {
        return parsePrimGraphJson(primGraphAttr.t);
    } catch {
        return null;
    }
};

const loadCheckpointImmsTensors = (wrapperNode) => {
    const immsAttr = (wrapperNode.attribute || []).find((attr) => attr && attr.name === PRIM_GRAPH_IMMS_ATTRIBUTE);
    if (!immsAttr || !Array.isArray(immsAttr.tensors)) {
        return [];
    }
    return immsAttr.tensors;
};

const buildCompiledGraphAttributeProto = (graphBody, originalAttribute) => {
    const attribute = new onnx.AttributeProto();
    attribute.name = COMPILED_PRIM_GRAPH_ATTRIBUTE;
    attribute.type = onnx.AttributeProto.AttributeType.GRAPH;
    attribute.g = graphBody;
    if (originalAttribute && originalAttribute.doc_string) {
        attribute.doc_string = originalAttribute.doc_string;
    }
    return attribute;
};

const rebuildCheckpointWrapperAttributes = (wrapperNode, modifiedGraph, sourceGraph, ambapbPrimGraph) => {
    const primGraph = loadCheckpointPrimGraph(wrapperNode, ambapbPrimGraph);
    if (!primGraph) {
        return null;
    }
    const runtimeGraph = resolveCheckpointRuntimeGraph(modifiedGraph);
    const keptIds = resolveKeptPrimitiveIds(runtimeGraph, primGraph);
    const slicedPrimGraph = keptIds.size > 0 ? slicePrimGraph(primGraph, keptIds) : primGraph;
    const slicedPrimitives = slicedPrimGraph.primitives || [];
    const weightNames = collectImmediateTensorNames(slicedPrimitives);
    const valueNames = collectArgumentValueNamesFromGraph(runtimeGraph);
    for (const name of valueNames) {
        weightNames.add(name);
    }
    const immsTensors = loadCheckpointImmsTensors(wrapperNode);
    const filteredImms = keptIds.size > 0 ?
        immsTensors.filter((tensor) => tensor.name && weightNames.has(tensor.name)) :
        immsTensors;

    const originalByName = collectOriginalNodesByName(sourceGraph, wrapperNode);
    const originalCompiledAttr = (wrapperNode.attribute || []).find((attr) => attr && attr.name === COMPILED_PRIM_GRAPH_ATTRIBUTE) || null;
    const originalCompiledGraph = originalCompiledAttr && originalCompiledAttr.g ? originalCompiledAttr.g : null;
    const compiledBody = buildGraphProtoFromModifiedGraph(
        runtimeGraph,
        originalCompiledGraph || sourceGraph,
        originalByName
    );

    const originalAttributes = wrapperNode.attribute || [];
    const originalPrimGraphAttr = originalAttributes.find((attr) => attr && attr.name === PRIM_GRAPH_ATTRIBUTE_NAME) || null;
    const originalImmsAttr = originalAttributes.find((attr) => attr && attr.name === PRIM_GRAPH_IMMS_ATTRIBUTE) || null;

    const updatedByName = new Map([
        [PRIM_GRAPH_ATTRIBUTE_NAME, buildPrimGraphAttributeProto(serializePrimGraphJson(slicedPrimGraph), originalPrimGraphAttr)],
        [PRIM_GRAPH_IMMS_ATTRIBUTE, buildImmsAttributeProto(filteredImms, originalImmsAttr)],
        [COMPILED_PRIM_GRAPH_ATTRIBUTE, buildCompiledGraphAttributeProto(compiledBody, originalCompiledAttr)]
    ]);

    const attributes = [];
    const seen = new Set();
    for (const attribute of originalAttributes) {
        if (!attribute || !attribute.name || seen.has(attribute.name)) {
            continue;
        }
        seen.add(attribute.name);
        attributes.push(updatedByName.has(attribute.name) ? updatedByName.get(attribute.name) : attribute);
    }
    for (const [name, attribute] of updatedByName) {
        if (!seen.has(name)) {
            attributes.push(attribute);
        }
    }

    return {
        attributes,
        slicedPrimGraph
    };
};

const rebuildFlatGraphProtoFromModified = (modifiedGraph, sourceGraph, wrapperNode) => {
    const runtimeGraph = resolveCheckpointRuntimeGraph(modifiedGraph);
    const originalByName = collectOriginalNodesByName(sourceGraph, wrapperNode);
    const usedNames = collectArgumentValueNamesFromGraph(runtimeGraph);
    const body = buildRuntimeGraphBody(runtimeGraph, sourceGraph, originalByName);

    const immsTensors = wrapperNode ? loadCheckpointImmsTensors(wrapperNode) : [];
    let primGraph = wrapperNode ? loadCheckpointPrimGraph(wrapperNode, null) : null;
    if (primGraph && Array.isArray(primGraph.primitives)) {
        const keptIds = resolveKeptPrimitiveIds(runtimeGraph, primGraph);
        for (const prim of primGraph.primitives) {
            if (!prim || !keptIds.has(prim.id)) {
                continue;
            }
            for (const name of collectImmediateTensorNames([prim])) {
                usedNames.add(name);
            }
        }
    }
    const allInitializers = [...(sourceGraph.initializer || []), ...immsTensors];
    body.initializer = allInitializers.filter((tensor) => tensor.name && usedNames.has(tensor.name));
    return body;
};

const rebuildCheckpointGraphProtoFromModified = (modifiedGraph, sourceProto, wrapperNode, ambapbPrimGraph, modifiedShellNode = null) => {
    const runtimeGraph = resolveCheckpointRuntimeGraph(modifiedGraph);
    const sourceGraph = sourceProto.graph;
    const wrapperUpdate = rebuildCheckpointWrapperAttributes(wrapperNode, runtimeGraph, sourceGraph, ambapbPrimGraph);
    if (!wrapperUpdate) {
        return {
            graph: rebuildFlatGraphProtoFromModified(modifiedGraph, sourceGraph, wrapperNode),
            slicedPrimGraph: null
        };
    }

    const wrapper = new onnx.NodeProto();
    wrapper.name = (modifiedShellNode && modifiedShellNode.name) || wrapperNode.name || '';
    wrapper.op_type = wrapperNode.op_type || 'CVFlowNVP';
    if (wrapperNode.domain) {
        wrapper.domain = wrapperNode.domain;
    }
    if (modifiedShellNode && modifiedShellNode.description) {
        wrapper.doc_string = modifiedShellNode.description;
    } else if (wrapperNode.doc_string) {
        wrapper.doc_string = wrapperNode.doc_string;
    }
    wrapper.input = Array.isArray(wrapperNode.input) ? wrapperNode.input.slice() : [];
    wrapper.output = Array.isArray(wrapperNode.output) ? wrapperNode.output.slice() : [];
    wrapper.attribute = wrapperUpdate.attributes;

    return {
        graph: {
            name: sourceGraph.name || '',
            doc_string: sourceGraph.doc_string || '',
            node: [wrapper],
            input: sourceGraph.input || [],
            output: sourceGraph.output || [],
            initializer: sourceGraph.initializer || [],
            value_info: sourceGraph.value_info || [],
            sparse_initializer: sourceGraph.sparse_initializer || [],
            quantization_annotation: sourceGraph.quantization_annotation || []
        },
        slicedPrimGraph: wrapperUpdate.slicedPrimGraph
    };
};

export const rebuildGraphProtoFromModified = (modifiedGraph, sourceProto, options = {}) => {
    if (!sourceProto || !sourceProto.graph) {
        throw new OnnxExportError('Original ONNX protobuf is not available for graph rebuild.');
    }
    const sourceGraph = sourceProto.graph;
    const wrapperNode = findCVFlowNVPNode(sourceGraph);
    if (wrapperNode) {
        const checkpoint = rebuildCheckpointGraphProtoFromModified(
            modifiedGraph,
            sourceProto,
            wrapperNode,
            options.ambapbPrimGraph || null
        );
        return checkpoint.graph;
    }

    const originalByName = collectOriginalNodesByName(sourceGraph, null);
    return buildGraphProtoFromModifiedGraph(modifiedGraph, sourceGraph, originalByName);
};

export const rebuildGraphProtoFromModifiedWithAmbapb = (modifiedGraph, sourceProto, ambapbPrimGraph, modifiedShellNode = null) => {
    const sourceGraph = sourceProto && sourceProto.graph;
    const wrapperNode = findCVFlowNVPNode(sourceGraph);
    if (!wrapperNode) {
        return {
            graph: rebuildGraphProtoFromModified(modifiedGraph, sourceProto),
            slicedPrimGraph: null
        };
    }
    return rebuildCheckpointGraphProtoFromModified(
        modifiedGraph,
        sourceProto,
        wrapperNode,
        ambapbPrimGraph,
        modifiedShellNode
    );
};

const applyCheckpointGraphFromModified = (graph, originalProto, editSession, ambapbPrimGraph) => {
    const modifiedGraph = resolveCheckpointRuntimeGraph(editSession.modified.getGraph(0));
    const rebuilt = rebuildGraphProtoFromModifiedWithAmbapb(modifiedGraph, originalProto, ambapbPrimGraph);
    Object.assign(graph, rebuilt.graph);
    return rebuilt.slicedPrimGraph;
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
            syncNodeFromModified(existing, modifiedNode, originalNodesByName, null);
            rebuiltNodes.push(existing);
        } else {
            rebuiltNodes.push(buildNodeProtoFromModified(modifiedNode, originalNodesByName, null));
        }
    }
    graph.node = rebuiltNodes;
    syncGraphBoundaryFromModified(graph, modifiedGraph, originalProto.graph);
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
const applyChanges = (cloned, originalProto, editSession, options = {}) => {
    const graph = cloned.graph;
    const changes = editSession.delta.getChanges();
    const checkpointWrapper = findCVFlowNVPNode(originalProto.graph);

    for (const change of changes) {
        if (change.entityType === 'node' && change.property === 'name') {
            const location = parseEntityId(change.entityId);
            if (!location) {
                continue;
            }
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
            continue;
        }
        if (!location) {
            continue;
        }
        if (change.property === 'type') {
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

    if (checkpointWrapper) {
        applyCheckpointGraphFromModified(graph, originalProto, editSession, options.ambapbPrimGraph || null);
    } else {
        applyStructuralNodeChanges(graph, originalProto, editSession);
    }
};

export const canExportOnnx = (model) => {
    if (!model) {
        return false;
    }
    if (model.exportable === true) {
        return true;
    }
    return isAmbapbCheckpoint(model) && Boolean(model._ambapb && model._ambapb.canExport === true);
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
    if (shouldUseCheckpointRebuild(editSession, proto)) {
        const { runtimeGraph, shellNode } = resolveCheckpointExportGraph(editSession, proto);
        const ambapbPrimGraph = model._ambapb && model._ambapb.primGraph ? model._ambapb.primGraph : null;
        const rebuilt = rebuildGraphProtoFromModifiedWithAmbapb(
            runtimeGraph,
            proto,
            ambapbPrimGraph,
            shellNode
        );
        cloned.graph = rebuilt.graph;
        if (rebuilt.slicedPrimGraph && model._ambapb) {
            model._ambapb.primGraph = rebuilt.slicedPrimGraph;
        }
    } else {
        applyChanges(cloned, proto, editSession, {
            ambapbPrimGraph: model._ambapb && model._ambapb.primGraph ? model._ambapb.primGraph : null
        });
    }
    normalizeGraphReferences(cloned.graph);
    validateModel(cloned);
    return onnx.ModelProto.encodeBytes(cloned);
};

export const cloneModelProtoForMerge = cloneModelProto;
export const normalizeGraphReferencesForMerge = normalizeGraphReferences;
export const renameInGraphForMerge = renameInGraph;
export const collectGraphNamesForMerge = collectGraphNames;
export const validateGraphForMerge = validateGraph;
