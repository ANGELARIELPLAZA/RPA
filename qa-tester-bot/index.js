require("dotenv").config();

const axios = require("axios");
const fs = require("fs");

const BASE_URL = process.env.BASE_URL;
const POST_ENDPOINT = process.env.POST_ENDPOINT || "/cotizar-cetelem-async";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 3000);
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS || 180000);
const TOTAL_CLIENTS = Number(process.env.TOTAL_CLIENTS || 10);
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);

if (!BASE_URL) {
    throw new Error("Falta BASE_URL en .env");
}

const http = axios.create({
    baseURL: BASE_URL,
    timeout: 600000,
    headers: {
        "Content-Type": "application/json",
    },
});

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowMs() {
    return Date.now();
}

function round(num, decimals = 2) {
    return Number(num.toFixed(decimals));
}

function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
}

function avg(values) {
    if (!values.length) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

function min(values) {
    return values.length ? Math.min(...values) : 0;
}

function max(values) {
    return values.length ? Math.max(...values) : 0;
}

function buildErrorKey(err) {
    if (!err) return "unknown_error";
    if (typeof err === "string") return err;
    if (err.message) return err.message;
    return JSON.stringify(err);
}

/**
 * AQUÍ VA TU LÓGICA REAL
 */
async function recoverVehiclePriceTax() {
    await sleep(300);
    return "350000";
}
async function runWithConcurrency(items, worker, concurrency = 5) {
    const results = [];
    let index = 0;

    async function runner() {
        while (index < items.length) {
            const current = index++;
            results[current] = await worker(items[current], current);
        }
    }

    const workers = Array.from(
        { length: Math.min(concurrency, items.length) },
        () => runner()
    );

    await Promise.all(workers);
    return results;
}

async function buildPayload() {
    const vehiclePriceTax = await recoverVehiclePriceTax();

    return {
        flujos: ["cliente", "vehiculo", "credito", "seguro"],
        cliente: {
            customerType: "1",
            genero: "1",
            customerTitle: "1",
            customerName: "JUAN",
            customerAPaterno: "PEREZ",
            customerAMaterno: "LOPEZ",
            customerBirthDate: "01/01/1990",
            customerRfc: "PELJ900101ABC",
        },
        vehiculo: {
            vehicleType: "N",
            seminuevoCertificado: false,
            insuranceVehicleUse: "1",
            tipoCarga: "",
            servicio: "",
            vehicleBrand: "KIA",
            vehicleAnio: "2025",
            vehicleModel: "K3 SEDAN",
            vehicleVersion: "GT LINE",
            vehiclePriceTax,
            vehicleAccesories: "RINES Y PELICULA",
            vehicleIsConverted: false,
            vehicleAccesoriesAmount: "15000",
            vehicleChargeStationAmount: "",
            vehicleExtendedWarrantyOption: "0",
            gapInsurance: "N",
            gapInsurancePlan: "",
            gapInsuranceType: "",
        },
        credito: {
            creditDepositAmount: "50000",
            creditDepositPlan: "2504",
            creditDepositTerm: "48",
        },
        seguro: {
            insuranceCP: "64000",
            insuranceRecruitment: "01",
            insuranceType: "01",
            insurancePaymentTermRemnant: "02",
            insuranceCoverageLorant: "AMPLIO",
            insuranceOption: "INBURSA",
        },
    };
}

async function createTask(index) {
    const payloadStart = nowMs();
    const payload = await buildPayload();
    const payloadEnd = nowMs();

    const postStart = nowMs();
    const response = await http.post(POST_ENDPOINT, payload);
    const postEnd = nowMs();

    const data = response.data;

    if (!data?.task_id) {
        throw new Error("No llegó task_id");
    }

    console.log(`[${index}] Task creada: ${data.task_id}`);

    return {
        task: data,
        metrics: {
            payloadBuildMs: payloadEnd - payloadStart,
            postResponseMs: postEnd - postStart,
        },
    };
}

async function pollStatus(statusUrl, index) {
    const pollingStart = nowMs();
    let pollCount = 0;
    const pollLatencies = [];
    let lastStatus = "unknown";

    while (true) {
        if (nowMs() - pollingStart > POLL_TIMEOUT_MS) {
            throw new Error("Timeout en polling");
        }

        pollCount += 1;
        const reqStart = nowMs();

        try {
            const response = await http.get(statusUrl);
            const reqEnd = nowMs();
            const latency = reqEnd - reqStart;
            pollLatencies.push(latency);

            const data = response.data;
            const status = data?.status || "unknown";
            lastStatus = status;

            console.log(`[${index}] Poll #${pollCount} => ${status}`);

            if (!["pending", "queued", "processing", "running"].includes(status)) {
                return {
                    finalStatusPayload: data,
                    metrics: {
                        pollingTotalMs: nowMs() - pollingStart,
                        pollCount,
                        avgPollLatencyMs: round(avg(pollLatencies)),
                        minPollLatencyMs: min(pollLatencies),
                        maxPollLatencyMs: max(pollLatencies),
                        p95PollLatencyMs: percentile(pollLatencies, 95),
                        lastObservedStatus: lastStatus,
                    },
                };
            }
        } catch (error) {
            const reqEnd = nowMs();
            pollLatencies.push(reqEnd - reqStart);

            console.error(
                `[${index}] Error consultando status:`,
                error.response?.data || error.message
            );
        }

        await sleep(POLL_INTERVAL_MS);
    }
}

async function runClient(index) {
    const clientStart = nowMs();

    try {
        const created = await createTask(index);
        const task = created.task;

        const polled = await pollStatus(task.statusUrl, index);

        const clientEnd = nowMs();

        return {
            index,
            ok: true,
            task_id: task.task_id,
            statusUrl: task.statusUrl,
            finalStatus: polled.finalStatusPayload?.status || "unknown",
            timings: {
                payloadBuildMs: created.metrics.payloadBuildMs,
                postResponseMs: created.metrics.postResponseMs,
                pollingTotalMs: polled.metrics.pollingTotalMs,
                totalEndToEndMs: clientEnd - clientStart,
            },
            polling: {
                pollCount: polled.metrics.pollCount,
                avgPollLatencyMs: polled.metrics.avgPollLatencyMs,
                minPollLatencyMs: polled.metrics.minPollLatencyMs,
                maxPollLatencyMs: polled.metrics.maxPollLatencyMs,
                p95PollLatencyMs: polled.metrics.p95PollLatencyMs,
            },
            rawFinalPayload: polled.finalStatusPayload,
        };
    } catch (error) {
        const clientEnd = nowMs();

        return {
            index,
            ok: false,
            finalStatus: "failed",
            error: error.response?.data || error.message,
            timings: {
                totalEndToEndMs: clientEnd - clientStart,
            },
        };
    }
}

function buildSummary(results, startedAt, finishedAt) {
    const total = results.length;
    const okResults = results.filter((r) => r.ok);
    const failResults = results.filter((r) => !r.ok);

    const totalTimes = okResults.map((r) => r.timings.totalEndToEndMs);
    const postTimes = okResults.map((r) => r.timings.postResponseMs);
    const pollingTimes = okResults.map((r) => r.timings.pollingTotalMs);
    const payloadTimes = okResults.map((r) => r.timings.payloadBuildMs);
    const pollCounts = okResults.map((r) => r.polling.pollCount);

    const statusCount = {};
    const errorCount = {};

    for (const item of okResults) {
        const key = item.finalStatus || "unknown";
        statusCount[key] = (statusCount[key] || 0) + 1;
    }

    for (const item of failResults) {
        const key = buildErrorKey(item.error);
        errorCount[key] = (errorCount[key] || 0) + 1;
    }

    const testDurationMs = finishedAt - startedAt;
    const throughputPerSecond = total > 0 ? total / (testDurationMs / 1000) : 0;

    return {
        execution: {
            startedAt: new Date(startedAt).toISOString(),
            finishedAt: new Date(finishedAt).toISOString(),
            durationMs: testDurationMs,
            durationSec: round(testDurationMs / 1000),
            totalRequests: total,
            concurrency: CONCURRENCY,
            throughputReqPerSec: round(throughputPerSecond, 2),
        },
        success: {
            ok: okResults.length,
            failed: failResults.length,
            successRate: total ? round((okResults.length / total) * 100, 2) : 0,
            failureRate: total ? round((failResults.length / total) * 100, 2) : 0,
        },
        timings: {
            totalEndToEndMs: {
                avg: round(avg(totalTimes)),
                min: min(totalTimes),
                max: max(totalTimes),
                p50: percentile(totalTimes, 50),
                p95: percentile(totalTimes, 95),
                p99: percentile(totalTimes, 99),
            },
            postResponseMs: {
                avg: round(avg(postTimes)),
                min: min(postTimes),
                max: max(postTimes),
                p50: percentile(postTimes, 50),
                p95: percentile(postTimes, 95),
                p99: percentile(postTimes, 99),
            },
            pollingTotalMs: {
                avg: round(avg(pollingTimes)),
                min: min(pollingTimes),
                max: max(pollingTimes),
                p50: percentile(pollingTimes, 50),
                p95: percentile(pollingTimes, 95),
                p99: percentile(pollingTimes, 99),
            },
            payloadBuildMs: {
                avg: round(avg(payloadTimes)),
                min: min(payloadTimes),
                max: max(payloadTimes),
                p50: percentile(payloadTimes, 50),
                p95: percentile(payloadTimes, 95),
                p99: percentile(payloadTimes, 99),
            },
        },
        polling: {
            avgPollCount: round(avg(pollCounts)),
            minPollCount: min(pollCounts),
            maxPollCount: max(pollCounts),
            p50PollCount: percentile(pollCounts, 50),
            p95PollCount: percentile(pollCounts, 95),
            p99PollCount: percentile(pollCounts, 99),
        },
        finalStatuses: statusCount,
        groupedErrors: errorCount,
    };
}

async function main() {
    console.log("=== QA TESTER BOT CON MÉTRICAS ===");
    console.log(`Clientes: ${TOTAL_CLIENTS}`);
    console.log(`Concurrencia: ${CONCURRENCY}`);

    const startedAt = nowMs();
    const clients = Array.from({ length: TOTAL_CLIENTS }, (_, i) => i + 1);

    const results = await runWithConcurrency(
        clients,
        async (clientNumber) => await runClient(clientNumber),
        CONCURRENCY
    );
    const finishedAt = nowMs();

    const summary = buildSummary(results, startedAt, finishedAt);

    console.log("\n=== SUMMARY ===");
    console.log(JSON.stringify(summary, null, 2));

    fs.writeFileSync(
        "qa-metrics-report.json",
        JSON.stringify(
            {
                summary,
                results,
            },
            null,
            2
        ),
        "utf-8"
    );

    console.log("\nReporte guardado en qa-metrics-report.json");
}

main().catch((err) => {
    console.error("Error fatal:", err.message);
    process.exit(1);
});