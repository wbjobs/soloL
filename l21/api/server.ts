/**
 * local server entry file, for local development
 */
import 'dotenv/config';
import app from './app.js';
import WebSocketSignalingServer from './services/WebSocketServer.js';
import roomManager from './services/RoomManager.js';

/**
 * start server with port
 */
const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`);
});

const wsServer = new WebSocketSignalingServer(server);
console.log('WebSocket signaling server started on /ws');

/**
 * close server
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  wsServer.close();
  roomManager.destroy();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  wsServer.close();
  roomManager.destroy();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
export { server, wsServer };
