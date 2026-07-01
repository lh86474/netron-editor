/*
 * Friendly labels for prim_graph primitive attributes.
 * Author: Luray He
 */

const DEFAULT_METADATA = {
    conv2ibesbcp: {
        attributes: {
            w: { label: 'width' },
            h: { label: 'height' },
            stride: { label: 'stride' }
        }
    },
    input: {
        attributes: {
            w: { label: 'width' },
            h: { label: 'height' },
            d: { label: 'depth' }
        }
    },
    output: {
        attributes: {
            dram_format: { label: 'dram format' }
        }
    }
};

export const AmbapbMetadataResolver = {

    _types: DEFAULT_METADATA,

    configure(types) {
        this._types = types && typeof types === 'object' ? types : DEFAULT_METADATA;
    },

    async load(host) {
        if (!host || typeof host.asset !== 'function') {
            return this._types;
        }
        try {
            const data = await host.asset('ambapb-metadata.json');
            this._types = JSON.parse(data);
        } catch {
            this._types = DEFAULT_METADATA;
        }
        return this._types;
    },

    getAttributeLabel(primitiveType, attributeKey) {
        const typeEntry = this._types[primitiveType];
        const schema = typeEntry && typeEntry.attributes && typeEntry.attributes[attributeKey];
        return schema && schema.label ? schema.label : attributeKey;
    },

    getKnownAttributeKeys(primitiveType) {
        const typeEntry = this._types[primitiveType];
        if (!typeEntry || !typeEntry.attributes) {
            return [];
        }
        return Object.keys(typeEntry.attributes);
    },

    getOrderedAttributeKeys(primitiveType, attributes) {
        const known = this.getKnownAttributeKeys(primitiveType);
        const keys = new Set(Object.keys(attributes || {}));
        const ordered = [];
        for (const key of known) {
            if (keys.has(key)) {
                ordered.push(key);
                keys.delete(key);
            }
        }
        for (const key of [...keys].sort()) {
            ordered.push(key);
        }
        return ordered;
    }
};
