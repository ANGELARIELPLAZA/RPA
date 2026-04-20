const { chromium } = require("playwright");
const { HEADLESS, CETELEM_URL } = require("../config");

async function takePortalScreenshotBase64(url, { timeoutMs = 15000, fullPage = true } = {}) {
    const targetUrl = String(url || CETELEM_URL);
    let browser;

    try {
        browser = await chromium.launch({ headless: HEADLESS });
        const context = await browser.newContext({
            viewport: { width: 1366, height: 900 },
        });
        const page = await context.newPage();

        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs }).catch(() => { });
        await page.waitForTimeout(800);

        const buffer = await page.screenshot({ type: "png", fullPage }).catch(() => null);
        if (!buffer) return null;
        return Buffer.from(buffer).toString("base64");
    } catch {
        return null;
    } finally {
        if (browser) {
            await browser.close().catch(() => { });
        }
    }
}

module.exports = {
    takePortalScreenshotBase64,
};

