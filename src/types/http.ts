import type { Request } from 'express';

/** A request whose JSON body was also kept as raw bytes (see `express.json({ verify })` in app.ts). */
export type RawBodyRequest = Request & { rawBody?: Buffer };
