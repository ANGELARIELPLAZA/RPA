const { chromium } = require("playwright");
const { HEADLESS, assertCredentials } = require("../config");

let browser = null;
let initPromise = null;

function isBrowserAlive(currentBrowser) {
    return Boolean(currentBrowser?.isConnected?.());
}

async function launchBrowser() {
    assertCredentials();

    const nextBrowser = await chromium.launch({ headless: HEADLESS });

    nextBrowser.on("disconnected", () => {
        if (browser === nextBrowser) {
            browser = null;
        }
        console.error("[browser] Browser desconectado.");
    });

    browser = nextBrowser;
    console.log("[browser] Browser global iniciado.");
    return browser;
}

async function init() {
    if (isBrowserAlive(browser)) {
        return browser;
    }

    if (!initPromise) {
        initPromise = launchBrowser().finally(() => {
            initPromise = null;
        });
    }

    return initPromise;
}

async function getBrowser() {
    if (isBrowserAlive(browser)) {
        return browser;
    }

    return init();
}

async function restart() {
    const currentBrowser = browser;
    browser = null;

    if (currentBrowser) {
        try {
            await currentBrowser.close();
        } catch (error) {
            console.warn(`[browser] No se pudo cerrar browser previo: ${error.message}`);
        }
    }

    console.warn("[browser] Reiniciando browser global.");
    return init();
}

async function shutdown() {
    const currentBrowser = browser;
    browser = null;

    if (!currentBrowser) {
        return;
    }

    try {
        await currentBrowser.close();
        console.log("[browser] Browser global cerrado.");
    } catch (error) {
        console.warn(`[browser] Error cerrando browser global: ${error.message}`);
    }
}

module.exports = {
    getBrowser,
    init,
    restart,
    shutdown,
};
