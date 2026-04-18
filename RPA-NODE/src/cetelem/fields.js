const CLIENTE_BASE_FIELDS = [
    {
        key: "customerType",
        selector: "#customerType",
        type: "select",
        required: true,
        transform: (value) => String(value).trim(),
    },
];

const CLIENTE_FIELDS_BY_TYPE = {
    "1": [
        { key: "genero", selector: "#genero", type: "select", required: true, transform: normalizeString },
        { key: "customerTitle", selector: "#customerTitle", type: "select", required: true, timeout: 25000, retries: 5, transform: normalizeString },
        { key: "customerName", labelFor: "customerName", type: "input", required: true, timeout: 15000, retries: 3, transform: normalizeUppercase },
        { key: "customerAPaterno", labelFor: "customerAPaterno", type: "input", required: true, timeout: 15000, retries: 3, transform: normalizeUppercase },
        { key: "customerAMaterno", labelFor: "customerAMaterno", type: "input", required: false, timeout: 15000, retries: 3, transform: normalizeUppercase },
        { key: "customerBirthDate", labelFor: "customerBirthDate", type: "input", required: true, timeout: 15000, retries: 3, transform: normalizeString },
        { key: "customerRfc", labelFor: "customerRfc", type: "input", required: true, timeout: 15000, retries: 3, transform: normalizeUppercase },
    ],
    "2": [
        { key: "customerRazonSocial", labelFor: "customerRazonSocial", type: "input", required: true, timeout: 15000, retries: 3, transform: normalizeUppercase },
        { key: "customerNombreComercial", selector: "#customerNombreComercial", type: "input", required: false, timeout: 15000, retries: 3, transform: normalizeUppercase },
        { key: "customerBirthDate", labelFor: "customerBirthDate", type: "input", required: true, timeout: 15000, retries: 3, transform: normalizeString },
        { key: "customerRfc", labelFor: "customerRfc", type: "input", required: true, timeout: 15000, retries: 3, transform: normalizeUppercase },
    ],
    "3": [
        { key: "genero", selector: "#genero", type: "select", required: true, transform: normalizeString },
        { key: "customerTitle", selector: "#customerTitle", type: "select", required: true, timeout: 25000, retries: 5, transform: normalizeString },
        { key: "customerName", labelFor: "customerName", type: "input", required: true, timeout: 15000, retries: 3, transform: normalizeUppercase },
        { key: "customerAPaterno", labelFor: "customerAPaterno", type: "input", required: true, timeout: 15000, retries: 3, transform: normalizeUppercase },
        { key: "customerAMaterno", labelFor: "customerAMaterno", type: "input", required: false, timeout: 15000, retries: 3, transform: normalizeUppercase },
        { key: "customerBirthDate", labelFor: "customerBirthDate", type: "input", required: true, timeout: 15000, retries: 3, transform: normalizeString },
        { key: "customerRfc", labelFor: "customerRfc", type: "input", required: true, timeout: 15000, retries: 3, transform: normalizeUppercase },
        { key: "customerNumUnidades", selector: "#customerNumUnidades", type: "select", required: true, timeout: 15000, retries: 3, transform: normalizeString },
        { key: "customerFirstCredit", selector: "#customerFirstCredit", type: "select", required: true, timeout: 15000, retries: 3, transform: normalizeString },
    ],
};

function normalizeString(value) {
    return String(value).trim();
}

function normalizeUppercase(value) {
    return normalizeString(value).toUpperCase();
}

module.exports = {
    CLIENTE_BASE_FIELDS,
    CLIENTE_FIELDS_BY_TYPE,
};
