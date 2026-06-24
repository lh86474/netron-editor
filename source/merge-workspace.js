/*
 * This file contains the MergeWorkspaceController class, which controls the UI for th emerge feature
 * Four main sections
 * LocalFileContext is used to load the model from the file
 * BytesFileContext is used to load the model from the bytes
 * resolveMainGraphTarget is used to resolve the main graph target
 * MergeWorkspaceController is used to control the UI for the merge feature
 * Author: Luray He
 */ 

import * as base from './base.js';
import { GraphPane } from './graph-pane.js';
import { createMergeSession } from './merge-session.js';
import {
    MergeError,
    extractGraphInputs,
    extractGraphOutputs,
    formatType,
    formatMergeErrors,
    formatMergeWarnings,
    resolveValueType,
    areTypesCompatible,
    tryMergeOnnxModels
} from './model-merge.js';
import { buildMergeFilename } from './export-filename.js';
import { onnx } from './onnx-proto.js';
import './onnx-encode.js';
import { isAmbapbCheckpoint, expandCheckpointModel } from './ambapb.js';

// this wraps a browser File object
class LocalFileContext {

    constructor(host, file, blobs) {
        this._host = host;
        this._file = file;
        this._blobs = {};
        for (const blob of blobs) {
            this._blobs[blob.name] = blob;
        }
    }

    get identifier() {
        return this._file.name;
    }

    get stream() {
        return this._stream;
    }

    async open() {
        this._stream = await this.fetch(this._file.name, null);
    }

    async fetch(file, encoding) {
        // called blob here because it is a browser File object
        const blob = this._blobs[file];
        if (!blob) {
            throw new Error(`File not found '${file}'.`);
        }
        return new Promise((resolve, reject) => {
            const window = this._host.window;
            const reader = new window.FileReader();
            reader.onload = (e) => {
                if (encoding) {
                    resolve(e.target.result);
                } else {
                    // because BinaryStream is a class that wraps a Uint8Array
                    resolve(new base.BinaryStream(new Uint8Array(e.target.result)));
                }
            };
            reader.onerror = () => {
                reject(reader.error || new Error(`File read error '${file}'.`));
            };
            if (encoding === 'utf-8') {
                reader.readAsText(blob, encoding);
            } else {
                reader.readAsArrayBuffer(blob);
            }
        });
    }
    async asset(file) {
        return this._host.asset(file);
    }

    async require(id) {
        return this._host.require(id);
    }

    error(error, fatal) {
        this._host.exception(error, fatal);
    }
}

// in memory merged models
class BytesFileContext {

    constructor(host, identifier, bytes) {
        this._host = host;
        this._identifier = identifier;
        this._bytes = bytes;
        this._stream = new base.BinaryStream(bytes);
    }

    get identifier() {
        return this._identifier;
    }

    get stream() {
        return this._stream;
    }

    async asset(file) {
        return this._host.asset(file);
    }

    async require(id) {
        return this._host.require(id);
    }

    error(error, fatal) {
        this._host.exception(error, fatal);
    }

    async fetch(file) {
        if (file !== this._identifier) {
            throw new Error(`File not found '${file}'.`);
        }
        this._stream.seek(0);
        return this;
    }
}

const resolveMainGraphTarget = (model) => {
    if (!model) {
        return null;
    }
    const modules = Array.isArray(model.functions) ? model.modules.concat(model.functions) : model.modules;
    if (!Array.isArray(modules) || modules.length === 0) {
        return null;
    }
    for (const module of modules) {
        if (Array.isArray(module.nodes) && module.nodes.length > 0) {
            return module;
        }
    }
    return modules[0];
};
// MergeWorkspaceController is used to control the UI for the merge feature
export class MergeWorkspaceController {

    constructor(view) {
        this._view = view;
        this._session = null;
        this._previewPane = null;
        this._upstreamSourcePane = null;
        this._downstreamSourcePane = null;
        this._previewTimer = null;
        this._returnPage = 'welcome';
        this._bound = false;
    }

    // wire DOM IDs from index.html
    bindEvents() {
        if (this._bound) {
            return;
        }
        this._bound = true;
        // get the elements from the DOM
        const browseA = this._element('merge-slot-a-browse');
        const browseB = this._element('merge-slot-b-browse');
        const dialogA = this._element('merge-slot-a-file-dialog');
        const dialogB = this._element('merge-slot-b-file-dialog');
        const cancel = this._element('merge-cancel-button');
        const swap = this._element('merge-swap-roles-button');
        const openMerged = this._element('merge-open-button');
        const exportMerged = this._element('merge-export-button');
        const welcomeMerge = this._element('merge-onnx-button');
        const showSourceGraphs = this._element('merge-show-source-graphs');

        // wire the events to the UI
        if (welcomeMerge) {
            welcomeMerge.addEventListener('click', () => {
                this.start({ presetModel: null });
            });
        }
        if (browseA && dialogA) {
            browseA.addEventListener('click', () => dialogA.click());
            dialogA.addEventListener('change', (event) => this._onSlotFileSelected('A', event));
        }
        if (browseB && dialogB) {
            browseB.addEventListener('click', () => dialogB.click());
            dialogB.addEventListener('change', (event) => this._onSlotFileSelected('B', event));
        }
        if (cancel) {
            cancel.addEventListener('click', () => this.teardown());
        }
        if (swap) {
            swap.addEventListener('click', () => {
                if (this._session && this._session.swapRoles()) {
                    this.refreshUI();
                }
            });
        }
        if (openMerged) {
            openMerged.addEventListener('click', () => this.openMerged());
        }
        if (exportMerged) {
            exportMerged.addEventListener('click', () => this.exportMerged());
        }
        if (showSourceGraphs) {
            showSourceGraphs.addEventListener('change', () => {
                this._onShowSourceGraphsChanged(showSourceGraphs.checked);
            });
        }
    }

    // find which loaded merge slot owns it and return the slot's own model
    resolveModelForTarget(target) {
        if (!this._session || !target) {
            return null;
        }
        for (const entry of [this._session.getUpstream(), this._session.getDownstream()]) {
            if (entry && entry.target === target) {
                return entry.model;
            }
        }
        return null;
    }

    // find the visual grapher for the same graph by checkign each merge pane's grapher.target
    resolveGrapherForTarget(target) {
        if (!target) {
            return null;
        }
        for (const pane of [this._upstreamSourcePane, this._downstreamSourcePane, this._previewPane]) {
            const graph = pane && pane.graph;
            if (graph && graph.target === target) {
                return graph;
            }
        }
        return null;
    }

    // this is an entry point from the browser.js or desktop.mjs
    async start(options = {}) {
        this._returnPage = this._view._page || (this._view.model ? 'default' : 'welcome');
        if (this._view._target) {
            this._view._target.unregister();
        }
        this._session = createMergeSession();
        this._previewPane = null;
        this._upstreamSourcePane = null;
        this._downstreamSourcePane = null;
        this._initPreviewPane();
        this._initSourcePanes();
        this._updateSourceGraphLayout(false);
        const showSourceGraphs = this._element('merge-show-source-graphs');
        if (showSourceGraphs) {
            showSourceGraphs.checked = false;
            showSourceGraphs.disabled = true;
        }
        this._view.show('merge-workspace');
        this.refreshUI();
        const preset = options.presetModel;
        if (preset && preset.model && preset.model.exportable && preset.model.proto) {
            this._session.setSlotModel('A', {
                model: preset.model,
                proto: preset.model.proto,
                target: preset.target || resolveMainGraphTarget(preset.model),
                filename: preset.filename || 'current.onnx'
            });
            this.refreshUI();
        }
    }

    // we exit the merge workspace
    teardown() {
        if (this._previewTimer) {
            clearTimeout(this._previewTimer);
            this._previewTimer = null;
        }
        this._clearPreviewPane();
        this._clearSourcePanes();
        this._previewPane = null;
        this._upstreamSourcePane = null;
        this._downstreamSourcePane = null;
        this._session = null;
        const page = this._returnPage === 'merge-workspace' ? 'welcome' : this._returnPage;
        this._view.show(page);
    }

    _initPreviewPane() {
        const container = this._element('merge-preview-pane');
        if (!container) {
            this._previewPane = null;
            return;
        }
        this._previewPane = new GraphPane(this._view, container, { id: 'merge-preview', readOnly: true });
    }

    _initSourcePanes() {
        const upstreamContainer = this._element('merge-upstream-pane');
        const downstreamContainer = this._element('merge-downstream-pane');
        if (!upstreamContainer || !downstreamContainer) {
            this._upstreamSourcePane = null;
            this._downstreamSourcePane = null;
            return;
        }
        this._upstreamSourcePane = new GraphPane(this._view, upstreamContainer, { id: 'merge-upstream', readOnly: true });
        this._downstreamSourcePane = new GraphPane(this._view, downstreamContainer, { id: 'merge-downstream', readOnly: true });
    }

    _onShowSourceGraphsChanged(enabled) {
        if (!this._session) {
            return;
        }
        this._session.showSourceGraphs = enabled;
        this._updateSourceGraphLayout(enabled);
        if (enabled) {
            this._renderSourcePanes().catch(async (error) => {
                const message = error && error.message ? error.message : String(error);
                await this._view._host.message(message, true, 'OK');
            });
        } else {
            this._clearSourcePanes();
        }
    }

    _updateSourceGraphLayout(enabled) {
        const graphArea = this._element('merge-graph-area');
        if (graphArea) {
            graphArea.classList.toggle('show-source-graphs', Boolean(enabled));
        }
    }

    async _renderSourcePanes() {
        if (!this._session || !this._session.showSourceGraphs || !this._upstreamSourcePane || !this._downstreamSourcePane) {
            return;
        }
        if (!this._session.bothSlotsLoaded() || !this._session.getUpstreamSlot()) {
            this._clearSourcePanes();
            return;
        }
        const upstream = this._session.getUpstream();
        const downstream = this._session.getDownstream();
        if (!upstream || !downstream || !upstream.target || !downstream.target) {
            this._clearSourcePanes();
            return;
        }
        await this._upstreamSourcePane.render(upstream.target, null, null, upstream.model);
        await this._downstreamSourcePane.render(downstream.target, null, null, downstream.model);
    }

    _clearSourcePanes() {
        for (const pane of [this._upstreamSourcePane, this._downstreamSourcePane]) {
            if (pane && pane.graph) {
                pane.graph.unregister();
            }
            if (pane) {
                pane.render(null, null, null);
            }
        }
    }

    _element(id) {
        return this._view._element(id);
    }

    // load the model from the file
    async _loadModelFromFile(file) {
        if (!file || !this._view.accept(file.name, file.size)) {
            throw new MergeError('Only supported ONNX model files can be merged.');
        }
        const context = new LocalFileContext(this._view._host, file, [file]);
        await context.open();
        const model = await this._view._modelFactoryService.open(context);
        if (!model.exportable || !model.proto) {
            throw new MergeError('Only binary .onnx models can be merged.');
        }
        return {
            model,
            proto: model.proto,
            target: resolveMainGraphTarget(model),
            filename: file.name
        };
    }

    // read the first selected file, clears input
    async _onSlotFileSelected(slot, event) {
        const input = event.target;
        const file = input && input.files && input.files.length > 0 ? input.files[0] : null;
        input.value = '';
        if (!file || !this._session) {
            return;
        }
        try {
            const entry = await this._loadModelFromFile(file);
            // trigger the auto role dtection
            this._session.setSlotModel(slot, entry);
            this.refreshUI();
        } catch (error) {
            const message = error instanceof MergeError ? error.message : (error && error.message ? error.message : String(error));
            await this._view._host.message(message, true, 'OK');
        }
    }

    // called after almost every user action
    // update the UI, rebuilds the mapping table
    refreshUI() {
        if (!this._session) {
            return;
        }
        this._updateSlotLabels();
        this._updateRoleBadges();
        this._refreshMappingTable();
        this._updateValidationSummary();
        this._refreshPreview();
        this._updateActionButtons();
        this._updateSourceGraphToggle();
        if (this._session.showSourceGraphs) {
            this._renderSourcePanes().catch(async (error) => {
                const message = error && error.message ? error.message : String(error);
                await this._view._host.message(message, true, 'OK');
            });
        }
    }

    _updateSourceGraphToggle() {
        const toggle = this._element('merge-show-source-graphs');
        if (!toggle || !this._session) {
            return;
        }
        const enabled = this._session.bothSlotsLoaded() && Boolean(this._session.getUpstreamSlot());
        toggle.disabled = !enabled;
        if (!enabled) {
            toggle.checked = false;
            this._session.showSourceGraphs = false;
            this._updateSourceGraphLayout(false);
            this._clearSourcePanes();
        }
    }

    _updateSlotLabels() {
        for (const slot of ['A', 'B']) {
            const entry = this._session.getSlot(slot);
            const nameElement = this._element(`merge-slot-${slot.toLowerCase()}-name`);
            if (nameElement) {
                nameElement.textContent = entry ? entry.filename : 'No model loaded';
            }
        }
        const swapButton = this._element('merge-swap-roles-button');
        if (swapButton) {
            swapButton.disabled = !this._session.bothSlotsLoaded() || !this._session.getUpstreamSlot();
        }
    }

    _roleBadgeForSlot(slot) {
        if (!this._session.bothSlotsLoaded()) {
            return '';
        }
        const upstreamSlot = this._session.getUpstreamSlot();
        if (!upstreamSlot) {
            return '';
        }
        if (slot === upstreamSlot) {
            return 'Upstream';
        }
        if (slot === this._session.getDownstreamSlot()) {
            return 'Downstream';
        }
        return '';
    }

    _updateRoleBadges() {
        for (const slot of ['A', 'B']) {
            const badge = this._element(`merge-slot-${slot.toLowerCase()}-role`);
            if (!badge) {
                continue;
            }
            const role = this._roleBadgeForSlot(slot);
            badge.textContent = role;
            badge.classList.toggle('merge-role-active', role.length > 0);
            badge.classList.toggle('merge-role-upstream', role === 'Upstream');
            badge.classList.toggle('merge-role-downstream', role === 'Downstream');
        }
    }

    _mappingLookup() {
        const map = new Map();
        for (const entry of this._session.mapping) {
            map.set(entry.downstream, entry.upstream);
        }
        return map;
    }

    _refreshMappingTable() {
        const body = this._element('merge-mapping-body');
        if (!body) {
            return;
        }
        while (body.lastChild) {
            body.removeChild(body.lastChild);
        }
        const downstream = this._session.getDownstream();
        if (!downstream || !downstream.proto || !downstream.proto.graph) {
            return;
        }
        const upstream = this._session.getUpstream();
        const upstreamOutputs = upstream && upstream.proto && upstream.proto.graph
            ? extractGraphOutputs(upstream.proto.graph)
            : [];
        const mapping = this._mappingLookup();
        for (const input of extractGraphInputs(downstream.proto.graph)) {
            const row = this._view._host.document.createElement('tr');
            const downstreamCell = this._view._host.document.createElement('td');
            downstreamCell.textContent = input.name;
            row.appendChild(downstreamCell);

            const downstreamTypeCell = this._view._host.document.createElement('td');
            downstreamTypeCell.textContent = formatType(input.type);
            row.appendChild(downstreamTypeCell);

            const selectCell = this._view._host.document.createElement('td');
            const select = this._view._host.document.createElement('select');
            select.className = 'merge-mapping-select';
            const emptyOption = this._view._host.document.createElement('option');
            emptyOption.value = '';
            emptyOption.textContent = '— select output —';
            select.appendChild(emptyOption);
            for (const output of upstreamOutputs) {
                const option = this._view._host.document.createElement('option');
                option.value = output.name;
                option.textContent = output.name;
                select.appendChild(option);
            }
            const selected = mapping.get(input.name) || '';
            select.value = selected;
            select.addEventListener('change', () => {
                this._session.updateMappingRow(input.name, select.value || null);
                this._updateValidationSummary();
                this._refreshPreview();
                this._updateActionButtons();
                this._refreshMappingRowStatus(row, input.name, select.value);
                this._updateMappingRowHighlight(row, input.name);
            });
            selectCell.appendChild(select);
            row.appendChild(selectCell);

            const upstreamTypeCell = this._view._host.document.createElement('td');
            upstreamTypeCell.className = 'merge-mapping-upstream-type';
            row.appendChild(upstreamTypeCell);

            const statusCell = this._view._host.document.createElement('td');
            statusCell.className = 'merge-mapping-status';
            row.appendChild(statusCell);

            body.appendChild(row);
            this._refreshMappingRowStatus(row, input.name, selected);
            this._updateMappingRowHighlight(row, input.name);
        }
    }

    _collectMergeWarnings() {
        const warnings = [];
        const seen = new Set();
        const add = (issue) => {
            if (!issue) {
                return;
            }
            const key = `${issue.code || ''}:${issue.message || ''}:${issue.downstream || ''}:${issue.upstream || ''}`;
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            warnings.push(issue);
        };
        for (const issue of this._session.roleDetection.warnings || []) {
            add(issue);
        }
        for (const issue of this._session.validation.warnings || []) {
            add(issue);
        }
        return warnings;
    }

    _issuesForDownstreamInput(downstreamName, issues) {
        return (issues || []).filter((issue) => issue.downstream === downstreamName);
    }

    _updateMappingRowHighlight(row, downstreamName) {
        if (!row || !this._session) {
            return;
        }
        const errors = this._issuesForDownstreamInput(downstreamName, this._session.validation.errors);
        const warnings = this._issuesForDownstreamInput(downstreamName, this._session.validation.warnings);
        row.classList.toggle('merge-mapping-row-error', errors.length > 0);
        row.classList.toggle('merge-mapping-row-warning', errors.length === 0 && warnings.length > 0);
    }

    _updateValidationSummary() {
        const summary = this._element('merge-validation-summary');
        if (!summary || !this._session) {
            return;
        }
        summary.classList.remove('merge-summary-ready', 'merge-summary-warning', 'merge-summary-error', 'merge-summary-pending');
        const lines = [this._session.getRoleSummary()];
        const validation = this._session.validation;
        const warnings = this._collectMergeWarnings();

        if (this._session.roleDetection.status === 'failed') {
            summary.classList.add('merge-summary-error');
            const errors = this._session.roleDetection.errors || [];
            if (errors.length > 0) {
                lines.push('');
                lines.push(formatMergeErrors(errors, { inline: true }));
            }
        } else if (!this._session.bothSlotsLoaded() || this._session.roleDetection.status === 'pending') {
            summary.classList.add('merge-summary-pending');
        } else if (validation.ok) {
            lines.push('');
            lines.push('✓ Ready to merge');
            if (warnings.length > 0) {
                summary.classList.add('merge-summary-warning');
                lines.push('');
                lines.push(formatMergeWarnings(warnings, { inline: true }));
            } else {
                summary.classList.add('merge-summary-ready');
            }
        } else if (validation.errors.length > 0) {
            summary.classList.add('merge-summary-error');
            lines.push('');
            lines.push(formatMergeErrors(validation.errors, { inline: true }));
            if (warnings.length > 0) {
                lines.push('');
                lines.push(formatMergeWarnings(warnings, { inline: true }));
            }
        } else {
            summary.classList.add('merge-summary-pending');
        }
        summary.textContent = lines.join('\n');
    }

    _refreshMappingRowStatus(row, downstreamName, upstreamName) {
        const upstreamTypeCell = row.querySelector('.merge-mapping-upstream-type');
        const statusCell = row.querySelector('.merge-mapping-status');
        const upstream = this._session.getUpstream();
        const downstream = this._session.getDownstream();
        if (!upstreamTypeCell || !statusCell || !upstream || !downstream) {
            return;
        }
        if (!upstreamName) {
            upstreamTypeCell.textContent = '—';
            const unmapped = this._issuesForDownstreamInput(downstreamName, this._session.validation.errors).length > 0;
            if (unmapped) {
                statusCell.textContent = '✗';
                statusCell.className = 'merge-mapping-status merge-status-error';
            } else {
                statusCell.textContent = '—';
                statusCell.className = 'merge-mapping-status';
            }
            return;
        }
        const upstreamType = resolveValueType(upstream.proto.graph, upstreamName, { preferProducer: true });
        const downstreamType = resolveValueType(downstream.proto.graph, downstreamName, { preferProducer: false });
        upstreamTypeCell.textContent = formatType(upstreamType);
        const compatibility = areTypesCompatible(upstreamType, downstreamType);
        if (compatibility.ok) {
            statusCell.textContent = compatibility.warning ? '⚠' : '✓';
            statusCell.className = compatibility.warning ? 'merge-mapping-status merge-status-warning' : 'merge-mapping-status merge-status-ok';
        } else {
            statusCell.textContent = '✗';
            statusCell.className = 'merge-mapping-status merge-status-error';
        }
    }

    _updateActionButtons() {
        const canCommit = this._session.canOpenMerged();
        const openButton = this._element('merge-open-button');
        const exportButton = this._element('merge-export-button');
        if (openButton) {
            openButton.disabled = !canCommit;
        }
        if (exportButton) {
            exportButton.disabled = !canCommit;
        }
    }

    _refreshPreview() {
        if (this._previewTimer) {
            clearTimeout(this._previewTimer);
            this._previewTimer = null;
        }
        if (!this._session || !this._previewPane) {
            return;
        }
        if (!this._session.validation.ok) {
            this._clearPreviewPane();
            return;
        }
        this._previewTimer = setTimeout(() => {
            this._previewTimer = null;
            this._renderPreview().catch(async (error) => {
                const message = error && error.message ? error.message : String(error);
                await this._view._host.message(message, true, 'OK');
            });
        }, 400);
    }

    async _renderPreview() {
        const upstream = this._session.getUpstream();
        const downstream = this._session.getDownstream();
        if (!upstream || !downstream || !this._session.validation.ok) {
            this._clearPreviewPane();
            return;
        }
        const result = tryMergeOnnxModels(upstream.proto, downstream.proto, {
            mapping: this._session.mapping,
            upstreamName: upstream.filename,
            downstreamName: downstream.filename
        });
        if (!result.ok) {
            this._clearPreviewPane();
            return;
        }
        const bytes = onnx.ModelProto.encodeBytes(result.mergedProto);
        const context = new BytesFileContext(this._view._host, 'merged.onnx', bytes);
        const model = await this._view._modelFactoryService.open(context);
        const target = resolveMainGraphTarget(model);
        await this._previewPane.render(target, null, null, model);
        this._session.mergedPreview = {
            proto: result.mergedProto,
            model,
            target
        };
    }

    _clearPreviewPane() {
        if (this._previewPane && this._previewPane.graph) {
            this._previewPane.graph.unregister();
        }
        if (this._previewPane) {
            this._previewPane.render(null, null, null);
        }
        if (this._session) {
            this._session.mergedPreview = null;
        }
    }

    async openMerged() {
        if (!this._session || !this._session.canOpenMerged()) {
            return;
        }
        const upstream = this._session.getUpstream();
        const downstream = this._session.getDownstream();
        const result = tryMergeOnnxModels(upstream.proto, downstream.proto, {
            mapping: this._session.mapping,
            upstreamName: upstream.filename,
            downstreamName: downstream.filename
        });
        if (!result.ok) {
            await this._view._host.message(formatMergeErrors(result.errors), true, 'OK');
            return;
        }
        const bytes = onnx.ModelProto.encodeBytes(result.mergedProto);
        const context = new BytesFileContext(this._view._host, 'merged.onnx', bytes);
        const filename = buildMergeFilename(upstream.filename, downstream.filename);
        this.teardown();
        // it changes when the graph panes exist int he layout tree
        // a normal file in the file dialog uses welcome spinner. 
        // keeps panes laid out but invisibile
        // originally, we just used the plain .show('welcome), which removes from layout since display: none
        this._view.show('welcome spinner');
        await this._view.open(context);
        this._view._host.document.title = filename;
    }

    async exportMerged() {
        if (!this._session || !this._session.canOpenMerged()) {
            return;
        }
        const upstream = this._session.getUpstream();
        const downstream = this._session.getDownstream();
        const result = tryMergeOnnxModels(upstream.proto, downstream.proto, {
            mapping: this._session.mapping,
            upstreamName: upstream.filename,
            downstreamName: downstream.filename
        });
        if (!result.ok) {
            await this._view._host.message(formatMergeErrors(result.errors), true, 'OK');
            return;
        }
        const defaultPath = buildMergeFilename(upstream.filename, downstream.filename);
        const target = await this._view._host.save('ONNX Model', 'onnx', defaultPath.replace(/\.onnx$/i, ''));
        if (!target) {
            return;
        }
        const filename = target.toLowerCase().endsWith('.onnx') ? target : `${target}.onnx`;
        const bytes = onnx.ModelProto.encodeBytes(result.mergedProto);
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        await this._view._host.export(filename, blob);
    }

    canMergeOnnx(model) {
        return Boolean(model && model.exportable && model.proto);
    }
}
