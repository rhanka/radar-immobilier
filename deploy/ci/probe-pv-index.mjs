// Standalone Node probe. Keep these headers aligned with pvRequestHeaders.
import { pathToFileURL, URL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import process from "node:process";
import console from "node:console";

export const cities = {
  drummondville: "https://www.drummondville.ca/mairie-et-vie-municipale/seances-du-conseil/",
  "saint-henri": "https://www.saint-henri.ca/seances/",
};
export function requestHeaders(negotiate) {
  return {
    "user-agent": "radar-immobilier/0.1 (+https://github.com/rhanka/radar-immobilier)",
    accept: negotiate
      ? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      : "text/html",
    ...(negotiate ? { "accept-language": "fr-CA,fr;q=0.9" } : {}),
  };
}

function validateUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Expected a public HTTP(S) URL without credentials");
  }
  return value;
}

export function parseCities(args) {
  if (!args.length) throw new Error("Usage: node probe-pv-index.mjs CITY [CITY=PV_INDEX_URL ...]");
  return args.map((arg) => {
    const separator = arg.indexOf("=");
    const city = separator < 0 ? arg : arg.slice(0, separator);
    const url = separator < 0 ? cities[city] : arg.slice(separator + 1);
    if (!city || !url) throw new Error("Unknown city: use CITY=PV_INDEX_URL");
    return { city, url: validateUrl(url) };
  });
}

export async function probe(entries, {
  fetchImpl = globalThis.fetch,
  wait = sleep,
  now = () => performance.now(),
  emit = (line) => console.log(JSON.stringify(line)),
} = {}) {
  let requested = false;
  for (const { city, url: indexUrl } of entries) {
    for (const negotiate of [false, true]) {
      let url = indexUrl;
      for (let hop = 0; hop <= 10; hop += 1) {
        // Also pace redirect hops, globally, with at least 2 s AFTER completion.
        if (requested) await wait(2000);
        requested = true;
        const started = now();
        const diagnostic = {
          city, phase: "index", variant: negotiate ? "negotiation" : "scrape",
          url, hop, httpStatus: null, durationMs: 0, headers: {},
        };
        let response;
        try {
          response = await fetchImpl(url, {
            headers: requestHeaders(negotiate), redirect: "manual",
            signal: globalThis.AbortSignal.timeout(15000),
          });
          diagnostic.httpStatus = response.status;
          for (const name of ["server", "cf-ray", "cf-mitigated", "location", "content-type"]) {
            const value = response.headers.get(name);
            if (value !== null) diagnostic.headers[name] = value;
          }
        } catch {
          // Arbitrary transport errors can contain credentials; never serialize them.
          diagnostic.error = "Transport failure or timeout";
        }
        diagnostic.durationMs = Math.max(0, now() - started);
        emit(diagnostic);
        await response?.body?.cancel();
        const location = diagnostic.headers.location;
        if (!response || ![301, 302, 303, 307, 308].includes(response.status) || !location) break;
        if (hop === 10) throw new Error("Redirect limit reached");
        url = validateUrl(new URL(location, url).href);
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await probe(parseCities(process.argv.slice(2)));
  } catch {
    console.error("Probe failed: check arguments, public URLs, and redirect limits. See probe-pv-index.md.");
    process.exitCode = 1;
  }
}
