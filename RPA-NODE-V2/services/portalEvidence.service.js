const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { BASE_URL, HEADLESS, CETELEM_URL, SCREENSHOTS_DIR } = require("../config");

function safeSlug(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/gi, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 140);
}

function formatFileDate(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`;
}

async function takePortalScreenshot(url, { timeoutMs = 15000, fullPage = true, label } = {}) {
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

        fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
        const stamp = formatFileDate(new Date());
        const tag = safeSlug(label || "portal") || "portal";
        const filename = `portal_${stamp}_${tag}.png`;
        const localPath = path.join(SCREENSHOTS_DIR, filename);
        fs.writeFileSync(localPath, Buffer.from(buffer));

        const screenshotUrl = `${BASE_URL}/screenshots/${encodeURIComponent(filename)}`;
        return { filename, localPath, url: screenshotUrl };
    } catch {
        return null;
    } finally {
        if (browser) {
            await browser.close().catch(() => { });
        }
    }
}

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
    takePortalScreenshot,
    takePortalScreenshotBase64,
};
