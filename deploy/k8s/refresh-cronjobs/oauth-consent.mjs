/* global process, fetch, WebSocket, setTimeout, console */

const oauthUrl = process.env.OAUTH_URL;
if (!oauthUrl?.startsWith("https://accounts.google.com/")) {
  throw new Error("OAUTH_URL must be a Google authorization URL");
}

const created = await fetch(
  `http://127.0.0.1:9222/json/new?${encodeURIComponent(oauthUrl)}`,
  { method: "PUT" },
);
if (!created.ok) throw new Error("Could not create the isolated OAuth target");
const target = await created.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(String(data));
  if (!message.id) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error("CDP command failed"));
  else waiter.resolve(message.result);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

await send("Page.enable");
await send("Runtime.enable");
const deadline = Date.now() + 90_000;
let completed = false;
try {
  while (Date.now() < deadline) {
    const result = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        if (location.hostname === "127.0.0.1") return "callback";
        if (location.hostname !== "accounts.google.com") return "waiting";
        const account = document.querySelector("[data-identifier]");
        if (account) { account.click(); return "clicked"; }
        const controls = [...document.querySelectorAll(
          'button,[role="button"],input[type="submit"]'
        )];
        const allowed = /^(Continue|Continuer|Allow|Autoriser|Accepter)$/i;
        const control = controls.find((node) => allowed.test(
          (node.innerText || node.value || node.getAttribute("aria-label") || "").trim()
        ));
        if (control) { control.click(); return "clicked"; }
        return "waiting";
      })()`,
    });
    if (result.result?.value === "callback") {
      completed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
} finally {
  await send("Page.close").catch(() => undefined);
  socket.close();
}
if (!completed) throw new Error("OAuth consent did not reach the loopback callback");
console.log(JSON.stringify({ status: "callback-reached" }));
