import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Fixed pathname the Client half loads the diagram library from. */
const LIBRARY_ROUTE = '/dsh-mermaid/mermaid.min.js';
const LIBRARY_FILE = fileURLToPath(new URL('./vendor/mermaid.min.js', import.meta.url));

export const inject = ['webServer', 'connection'];

export function apply(ctx) {
  let library = null;

  async function readLibrary() {
    library ??= await readFile(LIBRARY_FILE);
    return library;
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: LIBRARY_ROUTE,
        handler: async (request, response) => {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
            response.end('method not allowed');
            return;
          }
          const admission = ctx.connection.admit({ headers: request.headers });
          if ('rejection' in admission) {
            response.writeHead(admission.rejection, { 'content-type': 'text/plain; charset=utf-8' });
            response.end('unauthorized');
            return;
          }
          if (admission.peer.principal.kind !== 'owner') {
            response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
            response.end('forbidden');
            return;
          }
          let bytes;
          try {
            bytes = await readLibrary();
          } catch (error) {
            ctx.logger.warn(`chat-mermaid: cannot read the vendored library: ${String(error)}`);
            response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
            response.end('library unavailable');
            return;
          }
          response.writeHead(200, {
            'content-type': 'text/javascript; charset=utf-8',
            'content-length': String(bytes.byteLength),
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          response.end(request.method === 'HEAD' ? undefined : bytes);
        },
      }),
    'chat-mermaid: library route',
  );
}
