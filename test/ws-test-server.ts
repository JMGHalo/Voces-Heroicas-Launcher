import { WebSocketServer } from 'ws';

const PORT = 3000;
const wss = new WebSocketServer({ port: PORT });

console.log(`WebSocket server listening on ws://127.0.0.1:${PORT}`);

wss.on('connection', (ws, req) => {
  console.log(`[OK] Client connected from ${req.socket.remoteAddress}`);

  ws.on('message', (data) => {
    console.log(`[MSG] ${data}`);
  });

  ws.on('close', () => {
    console.log(`[CLOSE] Client disconnected`);
  });

  ws.on('error', (err) => {
    console.error(`[ERROR] ${err.message}`);
  });
});
