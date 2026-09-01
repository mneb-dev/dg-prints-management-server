import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { errorHandler, notFound } from './middleware/errorHandler.js';
import authRouter from './routes/auth.js';
import healthRouter from './routes/health.js';
import ordersRouter from './routes/orders.js';
import productsRouter from './routes/products.js';
import testRouter from './routes/test.js';
import usersRouter from './routes/users.js';

export function createApp() {
  const app = express();

  // Cast: helmet's package "exports" map lacks a "types" condition, which some
  // NodeNext resolvers (observed on Vercel's Linux build) resolve to a
  // non-callable type even though the runtime export is a callable function.
  app.use((helmet as any)());
  app.use(cors());
  app.use(morgan('dev'));
  app.use(express.json());

  app.use('/health', healthRouter);
  app.use('/api/test', testRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/users', usersRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
