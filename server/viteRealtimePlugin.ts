import os from 'node:os';
import { Hocuspocus } from '@hocuspocus/server';
import { WebSocketServer } from 'ws';
import type { Plugin } from 'vite';
import { createRealtimeRuntime } from './realtimeRuntime.js';
import { getLinkPreviewMetadata } from './linkPreviewService';
import { handleMediaUpload } from './mediaUploadService';

/** Mount Hocuspocus upgrades on Vite's existing HTTP listener at /ws. */
export function hocuspocusPlugin(): Plugin {
  return {
    name: 'antiwhite-hocuspocus',
    configureServer(viteServer) {
      viteServer.middlewares.use('/api/link-preview', async (req, res) => {
        try {
          const requestUrl = new URL(req.url ?? '/', 'http://vite.local');
          const targetUrl = requestUrl.searchParams.get('url');
          if (!targetUrl) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing url query parameter' }));
            return;
          }
          const metadata = await getLinkPreviewMetadata(targetUrl);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.end(JSON.stringify(metadata));
        } catch (err) {
          const isForbidden = err instanceof Error && (err.message.includes('forbidden') || err.message.includes('private IP'));
          res.statusCode = isForbidden ? 403 : 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to fetch preview' }));
        }
      });

      viteServer.middlewares.use('/api/media/upload', (req, res) => {
        void handleMediaUpload(req, res);
      });

      viteServer.middlewares.use('/api/network-info', (_req, res) => {
        try {
          const interfaces = os.networkInterfaces();
          const ips: string[] = [];
          for (const devName of Object.keys(interfaces)) {
            for (const iface of interfaces[devName] || []) {
              if (iface.family === 'IPv4' && !iface.internal) {
                ips.push(iface.address);
              }
            }
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ips, port: viteServer.config.server.port ?? 5175 }));
        } catch {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ips: [], port: 5175 }));
        }
      });

      const httpServer = viteServer.httpServer;
      // Middleware-only Vite instances (for tests/tools) have no HTTP listener to attach to.
      if (!httpServer) return;

      const { configuration, pool } = createRealtimeRuntime();
      const hocuspocus = new Hocuspocus(configuration);
      const webSocketServer = new WebSocketServer({ noServer: true });

      webSocketServer.on('connection', (socket, request) => {
        hocuspocus.handleConnection(socket, request);
      });

      const handleUpgrade = (request: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
        let pathname: string;
        try {
          pathname = new URL(request.url ?? '/', 'http://vite.local').pathname;
        } catch {
          socket.destroy();
          return;
        }

        // Leave Vite's HMR and every other upgrade path to Vite.
        if (pathname !== '/ws') return;

        void hocuspocus.hooks('onUpgrade', {
          request,
          socket,
          head,
          instance: hocuspocus,
        }).then(() => {
          if (socket.destroyed) return;
          webSocketServer.handleUpgrade(request, socket, head, websocket => {
            webSocketServer.emit('connection', websocket, request);
          });
        }).catch(error => {
          console.error('[hocuspocus] WebSocket upgrade failed:', error);
          if (!socket.destroyed) socket.destroy();
        });
      };

      const handleListening = () => {
        const address = httpServer.address();
        const port = address && typeof address !== 'string'
          ? address.port
          : viteServer.config.server.port ?? 5175;

        void hocuspocus.hooks('onListen', {
          instance: hocuspocus,
          configuration: hocuspocus.configuration,
          port,
        }).catch(error => console.error('[hocuspocus] onListen hook failed:', error));
      };

      httpServer.on('upgrade', handleUpgrade);
      if (httpServer.listening) handleListening();
      else httpServer.once('listening', handleListening);

      let closing = false;
      const cleanup = async () => {
        if (closing) return;
        closing = true;
        httpServer.off('upgrade', handleUpgrade);
        httpServer.off('listening', handleListening);

        try {
          await new Promise<void>(resolve => {
            hocuspocus.configuration.extensions.push({
              async afterUnloadDocument({ instance }) {
                if (instance.getDocumentsCount() === 0) resolve();
              },
            });

            webSocketServer.close();
            if (hocuspocus.getDocumentsCount() === 0) resolve();
            hocuspocus.closeConnections();
          });
          await hocuspocus.hooks('onDestroy', { instance: hocuspocus });
        } catch (error) {
          console.error('[hocuspocus] shutdown failed:', error);
        } finally {
          await pool.end().catch(() => {});
        }
      };

      httpServer.once('close', () => { void cleanup(); });
    },
  };
}
