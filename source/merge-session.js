
import { detectMergeRoles, validateMerge } from './model-merge.js';

const cloneMapping = (mapping) => {
    return Array.isArray(mapping) ? mapping.map((entry) => ({
        upstream: entry.upstream,
        downstream: entry.downstream
    })) : [];
};

const emptyValidation = () => ({
    ok: false,
    errors: [],
    warnings: []
});

const emptyRoleDetection = () => ({
    status: 'pending',
    upstreamSlot: null,
    confidence: null,
    userOverridden: false,
    errors: [],
    warnings: []
});

export class MergeSession {

    constructor(options = {}) {
        this.slotA = null;
        this.slotB = null;
        this.roleDetection = emptyRoleDetection();
        this.mapping = [];
        this.mappingSource = 'empty';
        this.showSourceGraphs = false;
        this.mergedPreview = null;
        this.validation = emptyValidation();
        this._mergeOptions = options.mergeOptions || {};
    }

    getSlot(slot) {
        return slot === 'A' ? this.slotA : slot === 'B' ? this.slotB : null;
    }

    setSlotModel(slot, entry) {
        if (slot !== 'A' && slot !== 'B') {
            throw new Error(`Invalid merge slot '${slot}'.`);
        }
        if (!entry || !entry.proto) {
            throw new Error('Merge slot entries must include a model proto.');
        }
        if (slot === 'A') {
            this.slotA = entry;
        } else {
            this.slotB = entry;
        }
        this.mergedPreview = null;
        this.roleDetection.userOverridden = false;
        this.resolveRoles();
    }

    clearSlot(slot) {
        if (slot === 'A') {
            this.slotA = null;
        } else if (slot === 'B') {
            this.slotB = null;
        } else {
            throw new Error(`Invalid merge slot '${slot}'.`);
        }
        this.mergedPreview = null;
        this.roleDetection.userOverridden = false;
        this.resolveRoles();
    }

    bothSlotsLoaded() {
        return Boolean(this.slotA && this.slotB);
    }

    getUpstreamSlot() {
        return this.roleDetection.upstreamSlot;
    }

    getDownstreamSlot() {
        const upstreamSlot = this.getUpstreamSlot();
        if (!upstreamSlot) {
            return null;
        }
        return upstreamSlot === 'A' ? 'B' : 'A';
    }

    getUpstream() {
        const slot = this.getUpstreamSlot();
        return slot ? this.getSlot(slot) : null;
    }

    getDownstream() {
        const slot = this.getDownstreamSlot();
        return slot ? this.getSlot(slot) : null;
    }

    resolveRoles() {
        if (!this.bothSlotsLoaded()) {
            this.roleDetection = emptyRoleDetection();
            this.mapping = [];
            this.mappingSource = 'empty';
            this.validation = emptyValidation();
            return this.roleDetection;
        }
        if (this.roleDetection.userOverridden && this.roleDetection.upstreamSlot) {
            this.refreshValidation();
            return this.roleDetection;
        }
        const detection = detectMergeRoles(this.slotA.proto, this.slotB.proto, this._mergeOptions);
        if (!detection.ok) {
            this.roleDetection = {
                status: 'failed',
                upstreamSlot: null,
                confidence: null,
                userOverridden: false,
                errors: detection.errors,
                warnings: detection.warnings
            };
            this.mapping = [];
            this.mappingSource = 'empty';
            this.validation = emptyValidation();
            return this.roleDetection;
        }
        this.roleDetection = {
            status: detection.status,
            upstreamSlot: detection.upstreamSlot,
            confidence: detection.confidence,
            userOverridden: false,
            errors: detection.errors,
            warnings: detection.warnings
        };
        this.mapping = cloneMapping(detection.mapping);
        this.mappingSource = 'auto';
        this.refreshValidation();
        return this.roleDetection;
    }

    swapRoles() {
        if (!this.bothSlotsLoaded() || !this.roleDetection.upstreamSlot) {
            return false;
        }
        this.roleDetection.upstreamSlot = this.roleDetection.upstreamSlot === 'A' ? 'B' : 'A';
        this.roleDetection.userOverridden = true;
        this.roleDetection.confidence = null;
        this.roleDetection.status = 'resolved';
        this.mergedPreview = null;
        const validation = this.refreshValidation();
        if (!validation.ok) {
            this.mapping = [];
            this.mappingSource = 'empty';
            this.refreshValidation();
        }
        return true;
    }

    setMapping(mapping, source = 'manual') {
        this.mapping = cloneMapping(mapping);
        this.mappingSource = source;
        this.mergedPreview = null;
        this.refreshValidation();
    }

    updateMappingRow(downstreamName, upstreamName) {
        const mapping = this.mapping.filter((entry) => entry.downstream !== downstreamName);
        if (upstreamName) {
            mapping.push({ upstream: upstreamName, downstream: downstreamName });
        }
        this.mapping = mapping;
        this.mappingSource = 'manual';
        this.mergedPreview = null;
        this.refreshValidation();
    }

    refreshValidation() {
        const upstream = this.getUpstream();
        const downstream = this.getDownstream();
        if (!upstream || !downstream) {
            this.validation = emptyValidation();
            return this.validation;
        }
        this.validation = validateMerge(upstream.proto, downstream.proto, this.mapping, this._mergeOptions);
        return this.validation;
    }

    getRoleSummary() {
        if (!this.bothSlotsLoaded()) {
            return 'Load both models to detect merge direction.';
        }
        const upstream = this.getUpstream();
        const downstream = this.getDownstream();
        const upstreamName = upstream && upstream.filename ? upstream.filename : 'upstream';
        const downstreamName = downstream && downstream.filename ? downstream.filename : 'downstream';
        if (this.roleDetection.status === 'failed') {
            return 'Models cannot be merged in either direction.';
        }
        if (this.roleDetection.status === 'pending' || !this.roleDetection.upstreamSlot) {
            return 'Detecting merge direction…';
        }
        if (this.roleDetection.confidence === 'low') {
            return `Direction auto-detected: ${upstreamName} → ${downstreamName} (review mapping)`;
        }
        return `Models connected: ${upstreamName} → ${downstreamName}`;
    }

    canOpenMerged() {
        return this.validation.ok && this.mapping.length > 0;
    }
}

export const createMergeSession = (options = {}) => {
    return new MergeSession(options);
};
