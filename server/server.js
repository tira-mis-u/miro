import { Server } from '@hocuspocus/server';
import { createRealtimeRuntime } from './realtimeRuntime.js';

const port = Number(process.env.PORT || 1234);
const { configuration } = createRealtimeRuntime();

const server = new Server({
  ...configuration,
  address: '127.0.0.1',
  port,
});

// Hocuspocus 3.4.4 passes `address` to Node's listen(), but Node's ListenOptions uses `host`.
// Translate it so the service binds to loopback instead of silently binding every interface.
const listenWithHost = server.httpServer.listen.bind(server.httpServer);
server.httpServer.listen = (options, ...args) => {
  if (!options || typeof options !== 'object' || !('address' in options)) {
    return listenWithHost(options, ...args);
  }
  const { address, ...listenOptions } = options;
  return listenWithHost({ ...listenOptions, host: address }, ...args);
};

// Route HTTP endpoints on server.httpServer
import fs from 'node:fs';
import path from 'node:path';
import { getLinkPreviewMetadata } from './linkPreviewService.ts';
import { handleMediaUpload } from './mediaUploadService.ts';

const originalListeners = server.httpServer.listeners('request').slice();
server.httpServer.removeAllListeners('request');
server.httpServer.on('request', async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/link-preview') {
    try {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing url query parameter' }));
        return;
      }
      const metadata = await getLinkPreviewMetadata(targetUrl);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(metadata));
    } catch (err) {
      const isForbidden = err instanceof Error && (err.message.includes('forbidden') || err.message.includes('private IP'));
      res.statusCode = isForbidden ? 403 : 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to fetch preview' }));
    }
    return;
  }
  if (url.pathname === '/api/media/upload') {
    void handleMediaUpload(req, res);
    return;
  }
  if (url.pathname.startsWith('/uploads/')) {
    const filename = path.basename(url.pathname);
    const filePath = path.resolve(process.cwd(), 'public', 'uploads', filename);
    if (fs.existsSync(filePath)) {
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      return;
    }
  }
  for (const listener of originalListeners) {
    listener.call(server.httpServer, req, res);
  }
});

server.listen().then(() => {
  console.log(`🚀 Realtime Board Server running on ws://localhost:${port}`);
});
