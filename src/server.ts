import { createApp } from './app.js';
import { PORT } from './config/env.js';

const app = createApp();

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
