/**
 * supertest on 127.0.0.1 only (vitest setupFiles) — the cure for the "stray 404 / 401 / hang" flakes.
 *
 * For each request supertest starts the app with `app.listen(0)` — a WILDCARD socket with SO_REUSEADDR —
 * and then connects to 127.0.0.1:<that port>. On macOS another local process already listening on
 * 127.0.0.1 with the same port number wins that connection (the more specific bind), so a test now and
 * then got someone else's answer: a 404 `{}`, a foreign 401, no envelope, or nothing at all. Binding the
 * test server to 127.0.0.1 itself makes the kernel pick a port that is free on 127.0.0.1, so the
 * connection always reaches our app. The bind has to be synchronous (supertest reads the port right
 * away), which `listen(0, '127.0.0.1')` isn't (it goes through dns.lookup) — hence Node's own
 * cluster helper `net._createServerHandle`, test-only.
 */
import net from 'node:net';
import { Server as TlsServer } from 'node:tls';
import type { Server } from 'node:http';
import supertest from 'supertest';

type ServerHandleFactory = (address: string, port: number, addressType: number) => unknown;
const createHandle = (net as unknown as { _createServerHandle?: ServerHandleFactory })._createServerHandle;
const TestProto = (supertest as unknown as { Test: { prototype: Record<string, unknown> } }).Test.prototype;

if (createHandle) {
  TestProto['serverAddress'] = function serverAddress(this: { _server?: Server }, app: Server, path: string): string {
    if (!app.address()) {
      const handle = createHandle('127.0.0.1', 0, 4);
      if (typeof handle === 'number') throw new Error(`could not bind a loopback test server (errno ${handle})`);
      this._server = app.listen(handle as Parameters<Server['listen']>[0]);
    }
    const addr = app.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    return `${app instanceof TlsServer ? 'https' : 'http'}://127.0.0.1:${port}${path}`;
  };
}
