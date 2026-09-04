import { createApp } from './app.js';
import { NODE_ENV, PORT } from './config/env.js';

const app = createApp();

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT} [env: ${NODE_ENV}]`);
});
