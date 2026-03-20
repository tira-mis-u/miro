import { WebSocketServer } from 'ws';
import http from 'http';
import express from 'express';
import { setupWSConnection } from 'y-websocket/bin/utils.js';

const port = process.env.PORT || 1234;
const app = express();
const server = http.createServer(app);

const wss = new WebSocketServer({ server });

wss.on('connection', (conn, req) => {
  // room name / board id
  const docName = req.url.slice(1).split('?')[0] || 'board-1';
  console.log(`[+] New user connected to board: ${docName}`);
  
  // y-websocket tự động hook vào kết nối này và lo liệu toàn bộ việc share state
  setupWSConnection(conn, req, { docName });
});

server.listen(port, () => {
  console.log(`🚀 Realtime Board Server running on ws://localhost:${port}`);
});
