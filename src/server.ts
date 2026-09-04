import http from 'node:http';

import { createApp } from './app.js';
import { NODE_ENV, PORT } from './config/env.js';
import { initSocketServer } from './realtime/io.js';

const app = createApp();
const httpServer = http.createServer(app);
initSocketServer(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT} [env: ${NODE_ENV}]`);
});
