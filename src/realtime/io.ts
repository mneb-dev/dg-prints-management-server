import type http from 'node:http';

import { Server } from 'socket.io';

import { CORS_ORIGIN } from '../config/env.js';
import { verifyToken } from '../middleware/auth.js';
import type { Order } from '../types/order.js';

let io: Server | null = null;

export function initSocketServer(httpServer: http.Server): Server {
  io = new Server(httpServer, {
    cors: { origin: CORS_ORIGIN || true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || !token) {
      console.log(`[socket] rejected ${socket.id}: missing token`);
      next(new Error('unauthorized'));
      return;
    }
    try {
      socket.data.user = verifyToken(token);
      next();
    } catch (err) {
      console.log(`[socket] rejected ${socket.id}: ${err instanceof Error ? err.message : err}`);
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[socket] connected ${socket.id} (user ${socket.data.user?.username}); ${io?.engine.clientsCount} client(s) total`);
    socket.on('disconnect', (reason) => {
      console.log(`[socket] disconnected ${socket.id} (user ${socket.data.user?.username}): ${reason}; ${io?.engine.clientsCount} client(s) total`);
    });
  });

  return io;
}

export function emitOrderCreated(order: Order): void {
  if (!io) {
    console.warn('emitOrderCreated called before initSocketServer');
    return;
  }
  io.emit('order:created', order);
}

export function emitOrderUpdated(order: Order): void {
  if (!io) {
    console.warn('emitOrderUpdated called before initSocketServer');
    return;
  }
  io.emit('order:updated', order);
}

export function emitOrderDeleted(orderId: string): void {
  if (!io) {
    console.warn('emitOrderDeleted called before initSocketServer');
    return;
  }
  io.emit('order:deleted', orderId);
}
