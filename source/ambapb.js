/*
 * Detects if a model is an Ambarella checkpoint and provides metadata about it.
 * Attaches metadata to Netron's in-memory model object
 * Exposes helpers the UI uses to restrict editing 
 * Author: Luray He
 */
export const AMBAPB_KIND = 'amba-checkpoint';

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
// When an ONNX model loads, we attach the checkpoint metadata to the model object
export const attachCheckpoint = (model, modelProto) => {
    if (!model || !modelProto || !detectCheckpoint(modelProto)) {
        return false;
    }
    const wrapperNode = findCVFlowNVPNode(modelProto.graph);
    model._kind = AMBAPB_KIND;
    model._exportable = false;
    model._ambapb = {
        metadata: readCheckpointMetadata(modelProto),
        wrapperNode,
        primGraphAttribute: getPrimGraphAttribute(wrapperNode),
        compiledPrimGraphAttribute: getCompiledPrimGraphAttribute(wrapperNode),
        primGraphImmsAttribute: getPrimGraphImmsAttribute(wrapperNode),
        canEdit: false,
        canExport: false
    };
    return true;
};
