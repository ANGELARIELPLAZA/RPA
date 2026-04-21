function sanitizeMongoObject(value, depth = 0) {
    if (depth > 12) return undefined;

    if (Array.isArray(value)) {
        return value
            .map((v) => sanitizeMongoObject(v, depth + 1))
            .filter((v) => v !== undefined);
    }

    if (!value || typeof value !== "object") return value;

    const out = {};
    for (const [k, v] of Object.entries(value)) {
        // Prevent operator injection / dotted-path abuse.
        if (k.startsWith("$")) continue;
        if (k.includes(".")) continue;
        const cleaned = sanitizeMongoObject(v, depth + 1);
        if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
}

module.exports = {
    sanitizeMongoObject,
};

