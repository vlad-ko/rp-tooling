import { createServer, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { isLabel, recentEdits, stats, type Label } from "./db.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_OFFSET = 0;
const MAX_SEARCH_LENGTH = 200;

const indexHtml = readFileSync(
  new URL("../public/index.html", import.meta.url),
);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Returns null when the value is not a plain positive integer. */
export function parseLimit(raw: string | null): number | null {
  if (raw === null || raw === "") return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw)) return null;
  return Math.min(Math.max(Number(raw), 1), MAX_LIMIT);
}

/**
 * Returns null when the value is not a plain non-negative integer. Empty/absent
 * defaults to 0; "-1" and fractional values are rejected (null), never clamped.
 */
export function parseOffset(raw: string | null): number | null {
  if (raw === null || raw === "") return DEFAULT_OFFSET;
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/** Trims and caps the title search; empty/whitespace-only ⇒ null (no filter). */
export function parseSearch(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return trimmed.slice(0, MAX_SEARCH_LENGTH);
}

async function handleEdits(
  res: ServerResponse,
  params: URLSearchParams,
): Promise<void> {
  const rawLabel = params.get("label");
  let label: Label | null = null;
  if (rawLabel !== null && rawLabel !== "") {
    if (!isLabel(rawLabel)) {
      sendJson(res, 400, {
        error: `invalid label "${rawLabel}"; expected one of vandalism, substantive, trivia, unclear`,
      });
      return;
    }
    label = rawLabel;
  }

  const limit = parseLimit(params.get("limit"));
  if (limit === null) {
    sendJson(res, 400, { error: "invalid limit; expected an integer 1..200" });
    return;
  }

  const offset = parseOffset(params.get("offset"));
  if (offset === null) {
    sendJson(res, 400, {
      error: "invalid offset; expected a non-negative integer",
    });
    return;
  }

  const search = parseSearch(params.get("q"));

  const { rows, hasMore } = await recentEdits({ label, search, limit, offset });
  sendJson(res, 200, { edits: rows, limit, offset, hasMore });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method not allowed" });
    return;
  }

  const route = (async () => {
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(indexHtml);
    } else if (url.pathname === "/api/edits") {
      await handleEdits(res, url.searchParams);
    } else if (url.pathname === "/api/stats") {
      sendJson(res, 200, await stats());
    } else {
      sendJson(res, 404, { error: "not found" });
    }
  })();

  route.catch((err: unknown) => {
    console.error("request failed:", err);
    if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
    else res.end();
  });
});

// Only bind a port when run as the entry point — importing this module (e.g.
// from tests, to reach the pure parsers) must not start the HTTP server.
if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  server.listen(config.port, () => {
    console.log(`web listening on :${config.port}`);
  });
}
