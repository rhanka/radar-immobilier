// Print through the dedicated local Chrome CDP endpoint. Open and close our own tab only.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
const prefix = process.argv[2] ?? new URL("../../docs/reports/benchmark-v12-2026-11-13", import.meta.url).pathname;
const htmlPath = resolve(`${prefix}.html`);
let html = await readFile(htmlPath, "utf8");
for (const match of [...html.matchAll(/src="(assets\/[^\"]+\.svg)"/g)]) {
  const svg = await readFile(resolve(dirname(htmlPath), match[1]));
  html = html.replace(match[0], `src="data:image/svg+xml;base64,${svg.toString("base64")}"`);
}
const endpoint = process.env.BENCH_CHROME_CDP ?? "http://127.0.0.1:9333";
const tab = await (await fetch(`${endpoint}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
const pending = new Map(); let sequence = 0;
ws.onmessage = ({ data }) => {
  const result = JSON.parse(data); const callback = pending.get(result.id);
  if (callback) { pending.delete(result.id); callback(result); }
};
await new Promise((accept, reject) => { ws.onopen = accept; ws.onerror = reject; });
const send = (method, params = {}) => new Promise((accept, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 60_000);
  pending.set(id, (result) => { clearTimeout(timer); result.error ? reject(new Error(result.error.message)) : accept(result.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: `data:text/html;base64,${Buffer.from(html).toString("base64")}` });
  await new Promise((accept) => setTimeout(accept, 1000));
  const ready = await send("Runtime.evaluate", { expression: "Promise.all([document.fonts.ready,...Array.from(document.images,i=>i.decode())])", awaitPromise: true });
  if (ready.exceptionDetails) throw new Error("Report images or fonts failed to load");
  const result = await send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
  await writeFile(`${prefix}.pdf`, Buffer.from(result.data, "base64"));
  console.log(`PDF written: ${prefix}.pdf`);
} finally {
  ws.close(); await fetch(`${endpoint}/json/close/${tab.id}`);
}
