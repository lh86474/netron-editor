/*
 * Detects if a model is an Ambarella checkpoint and provides metadata about it.
 * Attaches metadata to Netron's in-memory model object
 * Exposes helpers the UI uses to restrict editing 
 * Author: Luray He
 */
import {
    parsePrimGraphFromAttribute,
    parsePrimGraphImms
} from './ambapb-prim-graph.js';

const PRIMITIVE_MODULE = 'ambarella.primitive';

export const AMBAPB_KIND = 'amba-checkpoint';

const outputValueKey = (primitiveId, portIndex) => `${primitiveId}\u0000out:${portIndex}`;

const valueAttributesFromOport = (oport) => {
    const attributes = [];
    if (oport && oport.dimension && typeof oport.dimension === 'object') {
        for (const [name, value] of Object.entries(oport.dimension)) {
            attributes.push({
                name: `dimension.${name}`,
                type: 'string',
                value: String(value)
            });
        }
    }
    if (oport && oport.dataFormat && typeof oport.dataFormat === 'object') {
        attributes.push({
            name: 'data-format',
            type: 'string',
            value: JSON.stringify(oport.dataFormat)
        });
    }
    return attributes;
};

const createOutputValue = (primitive, portIndex, oport, valueMap) => {
    const key = outputValueKey(primitive.id, portIndex);
    if (valueMap.has(key)) {
        return valueMap.get(key);
    }
    const value = {
        name: oport && oport.id ? oport.id : `${primitive.id}_out${portIndex}`,
        attributes: valueAttributesFromOport(oport)
    };
    valueMap.set(key, value);
    return value;
};

const resolveProducerValue = (primitiveId, portIndex, valueMap) => {
    const key = outputValueKey(primitiveId, portIndex);
    const value = valueMap.get(key);
    if (!value) {
        throw new Error(`Missing producer value for primitive '${primitiveId}' port ${portIndex}.`);
    }
    return value;
};

const primitiveAttributes = (primitive) => {
    return Object.entries(primitive.attributes || {}).map(([name, value]) => ({
        name,
        type: 'string',
        value
    }));
};

// make sure that endpoint id is a string
const normalizeEndpointId = (value, fallbackId) => {
    if (typeof value === 'string' && value.length > 0) {
        return value;
    }
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
        return value[0];
    }
    return fallbackId || null;
}

export const toNetronGraph = (checkpoint) => {
    if (!checkpoint || !checkpoint.primGraph) {
        throw new Error('Checkpoint primGraph is required.');
    }
    const { primGraph } = checkpoint;
    const primitives = primGraph.primitives || [];
    const raw = primGraph.raw || {};
    const valueMap = new Map();

    for (const primitive of primitives) {
        for (let portIndex = 0; portIndex < (primitive.oports || []).length; portIndex++) {
            createOutputValue(primitive, portIndex, primitive.oports[portIndex], valueMap);
        }
    }

    const nodes = primitives.map((primitive, primitiveIndex) => {
        const inputs = [];
        for (const source of primitive.sources || []) {
            if (!source.id) {
                continue;
            }
            inputs.push({
                name: '',
                value: [resolveProducerValue(source.id, source.port, valueMap)]
            });
        }
        for (const oport of primitive.oports || []) {
            for (const depId of oport.additionalDepPrimIds || []) {
                if (!depId) {
                    continue;
                }
                inputs.push({
                    name: '',
                    value: [resolveProducerValue(depId, 0, valueMap)]
                });
            }
        }
        const outputs = (primitive.oports || []).map((oport, portIndex) => ({
            name: '',
            value: [resolveProducerValue(primitive.id, portIndex, valueMap)]
        }));
        return {
            name: primitive.id,
            type: {
                name: primitive.type,
                identifier: primitive.type,
                module: PRIMITIVE_MODULE
            },
            attributes: primitiveAttributes(primitive),
            inputs,
            outputs,
            _primitiveId: primitive.id,
            _primitiveIndex: primitiveIndex
        };
    });

    const inputFallbackId = (primitives.find((primitive) => primitive.type === 'input') || {}).id;
    const outputFallbackId = (primitives.find((primitive) => primitive.type === 'output') || {}).id;
    const graphInputId = normalizeEndpointId(raw.graph_input, inputFallbackId);
    const graphOutputId = normalizeEndpointId(raw.graph_output, outputFallbackId);
    const inputPrimitive = primitives.find((primitive) => primitive.id === graphInputId) ||
        primitives.find((primitive) => primitive.type === 'input');
    const outputPrimitive = primitives.find((primitive) => primitive.id === graphOutputId) ||
        primitives.find((primitive) => primitive.type === 'output');

    const graphInputs = [];
    if (inputPrimitive && inputPrimitive.oports && inputPrimitive.oports.length > 0) {
        graphInputs.push({
            name: inputPrimitive.id,
            value: [resolveProducerValue(inputPrimitive.id, 0, valueMap)]
        });
    }

    const graphOutputs = [];
    if (outputPrimitive) {
        let outputValue = null;
        if (outputPrimitive.oports && outputPrimitive.oports.length > 0) {
            outputValue = resolveProducerValue(outputPrimitive.id, 0, valueMap);
        } else if (outputPrimitive.sources && outputPrimitive.sources.length > 0) {
            const source = outputPrimitive.sources[0];
            outputValue = resolveProducerValue(source.id, source.port, valueMap);
        }
        if (outputValue) {
            graphOutputs.push({
                name: outputPrimitive.id,
                value: [outputValue]
            });
        }
    }

    const graph = {
        name: graphInputId || 'ambapb-prim-graph',
        identifier: 'ambapb-prim-graph',
        inputs: graphInputs,
        outputs: graphOutputs,
        nodes,
        _ambapb: true
    };

    return {
        modules: [graph],
        graphMetadata: {
            graphInput: graphInputId || null,
            graphOutput: graphOutputId || null,
            primitiveCount: primitives.length
        }
    };
};

export const expandCheckpointModel = (model) => {
    if (!model || !model._ambapb || !model._ambapb.primGraph) {
        return false;
    }
    const expanded = toNetronGraph(model._ambapb);
    model._modules = expanded.modules;
    model._ambapb.expandedGraph = expanded.modules[0];
    model._ambapb.graphMetadata = expanded.graphMetadata;
    return true;
};

const PRIM_GRAPH_ATTRIBUTE = 'prim_graph';
const COMPILED_PRIM_GRAPH_ATTRIBUTE = 'compiled_prim_graph';
const PRIM_GRAPH_IMMS_ATTRIBUTE = 'prim_graph_imms';
const CVFLOW_NVP_OP_TYPE = 'CVFlowNVP';

const metadataMap = (modelProto) => {
    const metadata = new Map();
    if (!modelProto || !Array.isArray(modelProto.metadata_props)) {
        return metadata;
    }
    for (const entry of modelProto.metadata_props) {
        if (entry && entry.key) {
            metadata.set(entry.key, entry.value);
        }
    }
    return metadata;
};

export const findCVFlowNVPNode = (graph) => {
    if (!graph || !Array.isArray(graph.node)) {
        return null;
    }
    return graph.node.find((node) => node && node.op_type === CVFLOW_NVP_OP_TYPE) || null;
};

const hasAttributeNamed = (node, name) => {
    if (!node || !Array.isArray(node.attribute)) {
        return false;
    }
    return node.attribute.some((attribute) => attribute && attribute.name === name);
};

// A file is treated as an Amba checkpoint when 
// modelProto.graph exists
// There is a node with op_type === 'CVFlowNVP'
// node has attribute prim_graph
// metadata props contains metagraph_type === 'checkpoint' or producer_name = cvflowbackend
export const detectCheckpoint = (modelProto) => {
    if (!modelProto || !modelProto.graph) {
        return false;
    }
    const wrapperNode = findCVFlowNVPNode(modelProto.graph);
    if (!wrapperNode || !hasAttributeNamed(wrapperNode, PRIM_GRAPH_ATTRIBUTE)) {
        return false;
    }
    const metadata = metadataMap(modelProto);
    if (metadata.get('metagraph_type') === 'checkpoint') {
        return true;
    }
    if (modelProto.producer_name === 'cvflowbackend') {
        return true;
    }
    return false;
};
// pulls model-level fields from metadata_props and top-level proto fields
// metagraphType, producer, domain
// amba-specific: AmbaCnn, Vas, flattenedScope
export const readCheckpointMetadata = (modelProto) => {
    const metadata = metadataMap(modelProto);
    return {
        metagraphType: metadata.get('metagraph_type') || null,
        producer: modelProto.producer_name || null,
        domain: modelProto.domain || null,
        ambaCnn: metadata.get('AmbaCnn') || null,
        vas: metadata.get('Vas') || null,
        flattenedScope: metadata.get('flattened_scope') || null
    };
};

export const getPrimGraphAttribute = (wrapperNode) => {
    if (!wrapperNode || !Array.isArray(wrapperNode.attribute)) {
        return null;
    }
    return wrapperNode.attribute.find((attribute) => attribute && attribute.name === PRIM_GRAPH_ATTRIBUTE) || null;
};

export const getCompiledPrimGraphAttribute = (wrapperNode) => {
    if (!wrapperNode || !Array.isArray(wrapperNode.attribute)) {
        return null;
    }
    return wrapperNode.attribute.find((attribute) => attribute && attribute.name === COMPILED_PRIM_GRAPH_ATTRIBUTE) || null;
};

export const getPrimGraphImmsAttribute = (wrapperNode) => {
    if (!wrapperNode || !Array.isArray(wrapperNode.attribute)) {
        return null;
    }
    return wrapperNode.attribute.find((attribute) => attribute && attribute.name === PRIM_GRAPH_IMMS_ATTRIBUTE) || null;
};

export const isAmbapbCheckpoint = (model) => {
    return Boolean(model && model.kind === AMBAPB_KIND);
};

export const isAmbapbGraph = (graph) => {
    return Boolean(graph && graph._ambapb === true);
};

export const canEditCheckpoint = (model) => {
    return Boolean(model && model._ambapb && model._ambapb.canEdit === true);
};

export const canExportCheckpoint = (model) => {
    return Boolean(model && model._ambapb && model._ambapb.canExport === true);
};

// parses the checkpoint metadata and the prim_graph and imms from the model proto
export const parseCheckpoint = (modelProto) => {
    if (!detectCheckpoint(modelProto)) {
        return null;
    }
    const wrapperNode = findCVFlowNVPNode(modelProto.graph);
    const primGraphAttribute = getPrimGraphAttribute(wrapperNode);
    const primGraphImmsAttribute = getPrimGraphImmsAttribute(wrapperNode);
    return {
        metadata: readCheckpointMetadata(modelProto),
        wrapperNode,
        primGraphAttribute,
        compiledPrimGraphAttribute: getCompiledPrimGraphAttribute(wrapperNode),
        primGraphImmsAttribute,
        primGraph: parsePrimGraphFromAttribute(primGraphAttribute),
        imms: parsePrimGraphImms(primGraphImmsAttribute)
    };
};

// When an ONNX model loads, we attach the checkpoint metadata to the model object
export const attachCheckpoint = (model, modelProto) => {
    const checkpoint = parseCheckpoint(modelProto);
    if (!model || !checkpoint) {
        return false;
    }
    model._kind = AMBAPB_KIND;
    model._exportable = false;
    model._ambapb = {
        metadata: checkpoint.metadata,
        wrapperNode: checkpoint.wrapperNode,
        primGraphAttribute: checkpoint.primGraphAttribute,
        compiledPrimGraphAttribute: checkpoint.compiledPrimGraphAttribute,
        primGraphImmsAttribute: checkpoint.primGraphImmsAttribute,
        primGraph: checkpoint.primGraph,
        imms: checkpoint.imms,
        canEdit: false,
        canExport: false
    };
    return true;
};
