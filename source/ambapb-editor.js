/* 
 * The logic for editing the ambapb shell node and its attributes
 * Author: Luray He
 */
import {
    parsePrimGraphJson,
    serializePrimGraphJson,
    validatePrimGraph
} from './ambapb-prim-graph.js';

export const CVFLOW_NVP_OP_TYPE = 'CVFlowNVP';
export const PRIM_GRAPH_ATTRIBUTE = 'prim_graph';
export const COMPILED_PRIM_GRAPH_ATTRIBUTE = 'compiled_prim_graph';
export const PRIM_GRAPH_IMMS_ATTRIBUTE = 'prim_graph_imms';

export const READ_ONLY_SHELL_ATTRIBUTES = new Set([
    COMPILED_PRIM_GRAPH_ATTRIBUTE,
    PRIM_GRAPH_IMMS_ATTRIBUTE
]);

export function isCVFlowNVPNode(node) {
    return Boolean(node && node.type && node.type.name === CVFLOW_NVP_OP_TYPE);
}

export function isAmbapbShellNode(node) {
    return isCVFlowNVPNode(node);
}

export function cloneAmbapbEditingState(ambapb) {
    if (!ambapb) {
        return null;
    }
    const cloned = {
        metadata: ambapb.metadata,
        canEdit: ambapb.canEdit,
        canExport: ambapb.canExport,
        imms: ambapb.imms
    };
    if (ambapb.primGraph) {
        cloned.primGraph = parsePrimGraphJson(serializePrimGraphJson(ambapb.primGraph));
    }
    return cloned;
}

export function attachAmbapbEditingState(model, ambapb) {
    if (!model || !ambapb) {
        return;
    }
    model._ambapb = {
        metadata: ambapb.metadata,
        canEdit: ambapb.canEdit,
        canExport: ambapb.canExport,
        imms: ambapb.imms,
        primGraph: ambapb.primGraph
    };
}

export function getPrimGraphSnapshotValue(ambapb) {
    if (!ambapb || !ambapb.primGraph) {
        return '';
    }
    return serializePrimGraphJson(ambapb.primGraph);
}

export function formatPrimGraphForEditor(ambapb) {
    const text = getPrimGraphSnapshotValue(ambapb);
    if (!text) {
        return '';
    }
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
        return text;
    }
}

const attributeNameFromProperty = (property) => {
    const prefix = 'attributes.';
    if (typeof property === 'string' && property.startsWith(prefix)) {
        return property.slice(prefix.length);
    }
    return property;
};

export function syncPrimGraphFromJson(ambapb, jsonText) {
    if (!ambapb) {
        return false;
    }
    const primGraph = parsePrimGraphJson(jsonText);
    const validation = validatePrimGraph(primGraph.primitives);
    if (!validation.ok) {
        throw new Error(validation.errors.join('\n'));
    }
    ambapb.primGraph = primGraph;
    return true;
}
// sync the prim_graph JSON text into model._ambapb.primGraph
export function syncShellAttribute(model, graphIndex, nodeIndex, attributeName, value) {
    const ambapb = model && model._ambapb;
    const graph = model && model.modules && model.modules[graphIndex];
    const node = graph && graph.nodes[nodeIndex];
    if (!ambapb || !isAmbapbShellNode(node)) {
        return false;
    }
    if (attributeName === PRIM_GRAPH_ATTRIBUTE) {
        return syncPrimGraphFromJson(ambapb, value);
    }
    return false;
}

// Don't want to edit compiled graph
export function isAmbapbEditableGraph(model, graphIndex = 0) {
    const graph = model && model.modules && model.modules[graphIndex];
    return Boolean(model && model._ambapb && model._ambapb.canEdit && graph && !graph._ambapb);
}

// we don't want to support topology editing for now: too risky and changes 
// entire structure of prim_graph
export function assertAmbapbAttributePatchAllowed(model, patch) {
    if (!model || !model._ambapb || !model._ambapb.canEdit) {
        return;
    }
    if (patch.entityType === 'attribute' && (patch.changeType === 'add' || patch.changeType === 'delete')) {
        throw new Error('Adding or removing checkpoint attributes is not supported.');
    }
    if (patch.entityType === 'node') {
        if (patch.property === 'name') {
            throw new Error('Renaming checkpoint nodes is not supported.');
        }
        if (patch.property === 'insert' || patch.property === 'remove') {
            throw new Error('Checkpoint topology editing is not supported.');
        }
    }
    if (patch.entityType === 'attribute' && patch.changeType === 'modify') {
        const attributeName = attributeNameFromProperty(patch.property);
        if (READ_ONLY_SHELL_ATTRIBUTES.has(attributeName)) {
            throw new Error(`Editing '${attributeName}' is not supported.`);
        }
    }
}

// for now, prim_graph edits are JSON text, we will change this later
export function validateAmbapbPatch(model, patch) {
    assertAmbapbAttributePatchAllowed(model, patch);
    if (patch.entityType !== 'attribute' || patch.changeType !== 'modify') {
        return;
    }
    const attributeName = attributeNameFromProperty(patch.property);
    if (attributeName !== PRIM_GRAPH_ATTRIBUTE) {
        return;
    }
    if (typeof patch.newValue !== 'string') {
        throw new Error('prim_graph edits must be JSON text.');
    }
    const primGraph = parsePrimGraphJson(patch.newValue);
    const validation = validatePrimGraph(primGraph.primitives);
    if (!validation.ok) {
        throw new Error(validation.errors.join('\n'));
    }
}
