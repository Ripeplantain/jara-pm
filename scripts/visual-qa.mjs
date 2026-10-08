#!/usr/bin/env node

/**
 * Small, dependency-free browser smoke for the Kobi staging checklist.
 *
 * The script intentionally does not know any production credentials. Supply a
 * disposable staging account through QA_EMAIL and QA_PASSWORD, and start a
 * local Chrome/Chromium instance with --remote-debugging-port=9222.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const baseUrl = (process.env.QA_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const cdpUrl = process.env.QA_CDP_URL || "http://127.0.0.1:9222";
const email = process.env.QA_EMAIL;
const password = process.env.QA_PASSWORD;
const outputDir = process.env.QA_OUTPUT_DIR || "/private/tmp/kobi-visual-qa";
const axeSource = process.env.QA_AXE_PATH ? readFileSync(process.env.QA_AXE_PATH, "utf8") : null;

if (!email || !password) {
  throw new Error("QA_EMAIL and QA_PASSWORD are required for the disposable staging account");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cdp() {
  const response = await fetch(`${cdpUrl}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
  if (!response.ok) throw new Error(`Could not create a Chrome target: ${response.status}`);
  const target = await response.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  });

  const send = (name, values = {}) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method: name, params: values }));
  });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Accessibility.enable");

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed");
    return result.result?.result?.value;
  };

  const axeAudit = async () => {
    if (!axeSource) return null;
    return evaluate(`(async () => {
      ${axeSource}
      const result = await axe.run(document);
      return {
        violations: result.violations.map((entry) => ({
          id: entry.id,
          impact: entry.impact,
          nodes: entry.nodes.map((node) => ({
            target: node.target,
            html: node.html.slice(0, 240),
            failureSummary: node.failureSummary,
          })),
        })),
        passes: result.passes.length,
      };
    })()`);
  };

  const navigate = async (path) => {
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await sleep(250);
      const ready = await evaluate("document.readyState === 'complete'");
      if (ready) break;
    }
    await sleep(500);
  };

  const setViewport = async (width, height) => {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  };

  const setTheme = async (theme) => {
    await evaluate(`(() => {
      document.documentElement.dataset.theme = ${JSON.stringify(theme)};
      localStorage.setItem('kobi.theme', ${JSON.stringify(theme)});
    })()`);
    await sleep(150);
  };

  const capture = async (name) => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${outputDir}/${name}.png`, Buffer.from(shot.result.data, "base64"));
  };

  const pressKey = async (key, code, windowsVirtualKeyCode) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
  };

  const close = async () => {
    socket.close();
    await fetch(`${cdpUrl}/json/close/${target.id}`);
  };

  const inspect = async () => evaluate(`(() => {
    const labelFor = (element) => {
      const id = element.getAttribute('id');
      const explicit = id ? document.querySelector('label[for="' + CSS.escape(id) + '"]') : null;
      return element.getAttribute('aria-label') || element.getAttribute('title') ||
        explicit?.textContent?.trim() || element.closest('label')?.textContent?.trim() ||
        element.getAttribute('placeholder') ||
        element.textContent?.trim()?.replace(/\\s+/g, ' ').slice(0, 100) || '';
    };
    const controls = [...document.querySelectorAll('button,a,input,textarea,select,[role="button"],[role="dialog"]')];
    const unlabeled = controls.filter((element) => !labelFor(element)).map((element) => element.outerHTML.slice(0, 180));
    const viewportWidth = document.documentElement.clientWidth;
    const wideElements = [...document.body.querySelectorAll('*')]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ element, rect }) => rect.right > viewportWidth + 1 || rect.left < -1 || element.scrollWidth > element.clientWidth + 1)
      .sort((a, b) => (b.rect.right - viewportWidth) - (a.rect.right - viewportWidth))
      .slice(0, 12)
      .map(({ element, rect }) => ({
        tag: element.tagName,
        className: typeof element.className === 'string' ? element.className : '',
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
    return {
      url: location.href,
      title: document.title,
      theme: document.documentElement.dataset.theme || "system",
      viewport: { width: window.innerWidth, height: window.innerHeight },
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      wideElements,
      headings: [...document.querySelectorAll('h1,h2,h3')].map((element) => element.textContent.trim()).filter(Boolean),
      landmarks: [...document.querySelectorAll('main,nav,aside,header,footer,[role="dialog"]')].map((element) => ({ tag: element.tagName, role: element.getAttribute('role'), label: labelFor(element) })),
      dialogs: [...document.querySelectorAll('[role="dialog"],dialog')].map((element) => labelFor(element)),
      unlabeled,
      bodyText: document.body.innerText.slice(0, 5000),
    };
  })()`);

  const audit = async () => {
    const ax = await send("Accessibility.getFullAXTree");
    const axNodes = ax.result?.nodes || [];
    const missingAccessibleNames = axNodes
      .filter((node) => ["button", "link", "textbox", "combobox", "dialog"].includes(node.role?.value))
      .filter((node) => !node.name?.value)
      .map((node) => node.role?.value);

    const tabStops = [];
    for (let index = 0; index < 24; index += 1) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      tabStops.push(await evaluate(`(() => {
        const element = document.activeElement;
        if (!element || element === document.body) return null;
        const explicit = element.id ? document.querySelector('label[for="' + CSS.escape(element.id) + '"]') : null;
        return { tag: element.tagName, label: element.getAttribute('aria-label') || explicit?.textContent?.trim() || element.closest('label')?.textContent?.trim() || element.textContent?.trim()?.replace(/\\s+/g, ' ').slice(0, 100) || element.getAttribute('placeholder') || '', id: element.id };
      })()`));
    }

    return {
      inspect: await inspect(),
      missingAccessibleNames,
      tabStops: tabStops.filter(Boolean),
      axe: await axeAudit(),
    };
  };

  return {
    audit,
    setViewport,
    setTheme,
    navigate,
    evaluate,
    capture,
    pressKey,
    close,
  };
}

mkdirSync(outputDir, { recursive: true });
const browser = await cdp();
try {
  await browser.navigate("/signin");
  await browser.evaluate(`(() => {
    const setValue = (selector, value) => {
      const input = document.querySelector(selector);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setValue('input[type="email"]', ${JSON.stringify(email)});
    setValue('input[type="password"]', ${JSON.stringify(password)});
    document.querySelector('form').requestSubmit();
  })()`);
  await sleep(2500);

  await browser.setViewport(1440, 900);
  await browser.navigate("/");
  await browser.setTheme("dark");
  const dashboardDark = await browser.audit();
  await browser.capture("dashboard-browser-smoke");
  await browser.setTheme("light");
  const dashboardLight = await browser.audit();
  await browser.setViewport(768, 900);
  const dashboardTablet = await browser.audit();
  await browser.setViewport(375, 844);
  const dashboardMobile = await browser.audit();

  await browser.setViewport(375, 844);
  await browser.navigate("/onboarding");
  await browser.setTheme("light");
  const onboardingLight = await browser.audit();
  await browser.capture("onboarding-browser-smoke");
  await browser.setTheme("dark");
  const onboardingDark = await browser.audit();

  await browser.navigate("/boards/1?card=1");
  await browser.setViewport(375, 844);
  await browser.setTheme("dark");
  const boardDark = await browser.audit();
  await browser.capture("board-drawer-browser-smoke");
  await browser.setTheme("light");
  const boardLight = await browser.audit();

  await browser.pressKey("Escape", "Escape", 27);
  await sleep(300);
  const drawerClosed = await browser.evaluate(`!document.querySelector('[role="dialog"][aria-label^="Card:"]')`);

  await browser.setTheme("dark");
  await browser.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((element) => element.textContent?.includes('What is blocked?'));
    button?.click();
  })()`);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(300);
    const thinking = await browser.evaluate("document.body.innerText.includes('Thinking')");
    if (!thinking) break;
  }
  const aiDark = await browser.audit();
  await browser.capture("ai-browser-smoke");
  await browser.setTheme("light");
  const aiLight = await browser.audit();

  console.log(JSON.stringify({
    dashboard: { dark: dashboardDark, light: dashboardLight, tablet: dashboardTablet, mobile: dashboardMobile },
    onboarding: { light: onboardingLight, dark: onboardingDark },
    board: { dark: boardDark, light: boardLight },
    drawerClosed,
    ai: { dark: aiDark, light: aiLight },
  }, null, 2));
} finally {
  await browser.close();
}
