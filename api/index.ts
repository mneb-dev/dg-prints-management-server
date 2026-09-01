import type { IncomingMessage, ServerResponse } from 'node:http';

import { createApp } from '../src/app.js';

const app = createApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  app(req, res);
}
