import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = resolve(process.cwd(), "tests", "fixtures");
const ports = [4173, 4174];
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function createFixtureServer(port) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
      const filePath = resolve(root, `.${pathname}`);
      if (!filePath.startsWith(`${root}${sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      if (!(await stat(filePath)).isFile()) throw new Error("not-file");
      const body = await readFile(filePath);
      response.writeHead(200, {
        "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
}

const servers = ports.map((port) => createFixtureServer(port));
await Promise.all(servers.map((server, index) => new Promise((resolveListen) => {
  server.listen(ports[index], "127.0.0.1", resolveListen);
})));
console.log(`PageLinkMode fixtures: ${ports.join(", ")}`);

async function closeServers() {
  await Promise.all(servers.map((server) => new Promise((resolveClose) => server.close(resolveClose))));
}
process.on("SIGINT", () => void closeServers().finally(() => process.exit(0)));
process.on("SIGTERM", () => void closeServers().finally(() => process.exit(0)));
