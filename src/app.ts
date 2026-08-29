import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { errorHandler, notFound } from './middleware/errorHandler.js';
import healthRouter from './routes/health.js';
import ordersRouter from './routes/orders.js';
import productsRouter from './routes/products.js';
import testRouter from './routes/test.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(morgan('dev'));
  app.use(express.json());

  app.use('/health', healthRouter);
  app.use('/api/test', testRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/orders', ordersRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
