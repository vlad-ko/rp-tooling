import { createServer, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { config } from "./config.js";
import { isLabel, recentEdits, stats, type Label } from "./db.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const indexHtml = readFileSync(
  new URL("../public/index.html", import.meta.url),
);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Returns null when the value is not a plain positive integer. */
function parseLimit(raw: string | null): number | null {
  if (raw === null || raw === "") return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw)) return null;
  return Math.min(Math.max(Number(raw), 1), MAX_LIMIT);
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

  sendJson(res, 200, { edits: await recentEdits(label, limit) });
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

server.listen(config.port, () => {
  console.log(`web listening on :${config.port}`);
});
