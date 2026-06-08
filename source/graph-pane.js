
export class GraphPane {

    constructor(view, container, options = {}) {
        this._view = view;
        this._container = container;
        this._id = options.id || 'pane';
        this._readOnly = Boolean(options.readOnly);
        this._deltaTracker = options.deltaTracker || null;
        this._graph = null;
        this._rendered = false;
    }

    get id() {
        return this._id;
    }

    get container() {
        return this._container;
    }

    get readOnly() {
        return this._readOnly;
    }

    get deltaTracker() {
        return this._deltaTracker;
    }

    set deltaTracker(value) {
        this._deltaTracker = value;
    }

    get graph() {
        return this._graph;
    }

    async render(target, signature, state) {
        const status = await this._view._renderGraphInPane(this, target, signature, state);
        return status;
    }

    _setGraph(graph) {
        this._graph = graph;
        this._rendered = Boolean(graph);
    }

    getDebugState() {
        const graph = this._graph;
        return {
            nodeCount: graph ? graph.nodes.size : 0,
            edgeCount: graph ? graph.edges.size : 0,
            zoom: graph ? graph.zoom : 1,
            rendered: this._rendered
        };
    }

    _logRender() {
        const state = this.getDebugState();
        // Phase 2 console instrumentation contract
        // eslint-disable-next-line no-console
        console.log(`[editor] Rendered ${this._id} pane: nodes=${state.nodeCount} edges=${state.edgeCount} readOnly=${this._readOnly}`);
    }
}
