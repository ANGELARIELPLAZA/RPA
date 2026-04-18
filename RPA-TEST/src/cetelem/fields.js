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

function normalizeCheckbox(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = normalizeString(value).toLowerCase();
  return ["1", "true", "si", "sí", "y", "yes", "on"].includes(normalized);
}

const VEHICULO_FIELDS = [
  {
    key: "vehicleType",
    selector: "#vehicleType",
    type: "select",
    required: true,
    timeout: 20000,
    retries: 5,
    transform: normalizeString,
  },
  {
    key: "seminuevoCertificado",
    selector: 'input[type="checkbox"]#18n_seminuevo_certificado',
    type: "checkbox",
    required: false,
    timeout: 10000,
    retries: 3,
    transform: normalizeCheckbox,
  },
  {
    key: "insuranceVehicleUse",
    selector: "#insuranceVehicleUse",
    type: "select",
    required: true,
    timeout: 20000,
    retries: 5,
    transform: normalizeString,
  },
  {
    key: "tipoCarga",
    selector: "#tipoCarga",
    type: "select",
    required: false,
    timeout: 15000,
    retries: 3,
    transform: normalizeString,
  },
  {
    key: "servicio",
    selector: "#servicio",
    type: "input",
    required: false,
    timeout: 15000,
    retries: 3,
    transform: normalizeUppercase,
  },
  {
    key: "vehicleBrand",
    selector: "#vehicleBrand",
    type: "select",
    required: true,
    timeout: 30000,
    retries: 6,
    transform: normalizeString,
  },
  {
    key: "vehicleAnio",
    selector: "#vehicleAnio",
    type: "select",
    required: true,
    timeout: 30000,
    retries: 6,
    transform: normalizeString,
  },
  {
    key: "vehicleModel",
    selector: "#vehicleModel",
    type: "select",
    required: true,
    timeout: 30000,
    retries: 6,
    transform: normalizeString,
  },
  {
    key: "vehicleVersion",
    selector: "#vehicleVersion",
    type: "select",
    required: true,
    timeout: 30000,
    retries: 6,
    transform: normalizeString,
  },
  {
    key: "vehiclePriceTax",
    selector: "#vehiclePriceTax",
    type: "input",
    required: false,
    timeout: 15000,
    retries: 3,
    transform: normalizeString,
  },
  {
    key: "vehicleAccesories",
    selector: "#vehicleAccesories",
    type: "input",
    required: false,
    timeout: 15000,
    retries: 3,
    transform: normalizeUppercase,
  },
  {
    key: "vehicleIsConverted",
    selector: "#vehicleIsConverted",
    type: "checkbox",
    required: false,
    timeout: 10000,
    retries: 3,
    transform: normalizeCheckbox,
  },
  {
    key: "vehicleAccesoriesAmount",
    selector: "#vehicleAccesoriesAmount",
    type: "input",
    required: false,
    timeout: 15000,
    retries: 3,
    transform: normalizeString,
  },
  {
    key: "vehicleChargeStationAmount",
    selector: "#vehicleChargeStationAmount",
    type: "input",
    required: false,
    timeout: 15000,
    retries: 3,
    transform: normalizeString,
  },
  {
    key: "vehicleExtendedWarrantyOption",
    radioName: "vehicleExtendedWarrantyOption",
    type: "radio",
    required: false,
    timeout: 10000,
    retries: 3,
    transform: normalizeString,
  },
  {
    key: "gapInsurance",
    radioName: "gapInsurance",
    type: "radio",
    required: false,
    timeout: 10000,
    retries: 3,
    transform: normalizeUppercase,
  },
  {
    key: "gapInsurancePlan",
    selector: "#gapInsurancePlan",
    type: "select",
    required: false,
    timeout: 20000,
    retries: 5,
    transform: normalizeString,
  },
  {
    key: "gapInsuranceType",
    radioName: "gapInsuranceType",
    type: "radio",
    required: false,
    timeout: 10000,
    retries: 3,
    transform: normalizeUppercase,
  },
];

const CREDITO_FIELDS = [
  {
    key: "creditDepositPercent",
    selector: "#creditDepositPercent",
    type: "input",
    required: false,
    timeout: 15000,
    retries: 3,
    transform: normalizeString,
  },
  {
    key: "creditDepositAmount",
    selector: "#creditDepositAmount",
    type: "input",
    required: false,
    timeout: 15000,
    retries: 3,
    transform: normalizeString,
  },
  {
    key: "creditDepositPlan",
    selector: "#creditDepositPlan",
    type: "select",
    required: false,
    timeout: 30000,
    retries: 6,
    transform: normalizeString,
  },
  {
    key: "creditDepositTerm",
    selector: "#creditDepositTerm",
    type: "select",
    required: false,
    timeout: 30000,
    retries: 6,
    transform: normalizeString,
  },
];

module.exports = {
  CLIENTE_BASE_FIELDS,
  CLIENTE_FIELDS_BY_TYPE,
  CREDITO_FIELDS,
  VEHICULO_FIELDS,
};
