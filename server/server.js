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

server.listen().then(() => {
  console.log(`🚀 Realtime Board Server running on ws://localhost:${port}`);
});
