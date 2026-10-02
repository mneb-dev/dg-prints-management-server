import { Router } from 'express';

import { findShopCheckoutBySession, getShopCheckout, settleShopCheckout } from '../data/shopCheckoutStore.js';
import type { RawBodyRequest } from '../types/http.js';
import { parseCheckoutSession, retrieveCheckoutSession, verifyWebhookSignature } from '../utils/paymongo.js';
import { isUuid } from '../utils/uuid.js';

// PayMongo webhook (registered per environment for `checkout_session.payment.paid`). Public, but
// every event must carry a valid `Paymongo-Signature`. Anything we can't act on is acknowledged
// with 200 so PayMongo stops retrying; only real failures (e.g. the DB) return 5xx for a retry.
const router = Router();

type WebhookEvent = { data?: { attributes?: { type?: string; livemode?: boolean; data?: unknown } } };

router.post('/', async (req, res, next) => {
  try {
    const event = (req.body ?? {}) as WebhookEvent;
    const attributes = event.data?.attributes ?? {};
    const rawBody = (req as RawBodyRequest).rawBody;
    if (!rawBody || !verifyWebhookSignature(rawBody, req.header('paymongo-signature'), attributes.livemode === true)) {
      res.status(401).json({ error: 'Invalid signature.' });
      return;
    }

    if (attributes.type !== 'checkout_session.payment.paid') {
      res.json({ received: true });
      return;
    }

    const session = parseCheckoutSession(attributes.data);
    const metadataId = session.metadata.checkoutId;
    const checkout =
      (metadataId && isUuid(metadataId) ? await getShopCheckout(metadataId) : undefined) ??
      (session.id ? await findShopCheckoutBySession(session.id) : undefined);
    if (!checkout) {
      console.warn(`PayMongo webhook: no shop checkout for session ${session.id}`);
      res.json({ received: true });
      return;
    }

    // The event embeds the session; if its payment isn't marked paid there, ask PayMongo directly.
    const settled = session.payment ? session : await retrieveCheckoutSession(session.id);
    await settleShopCheckout(checkout, settled);
    res.json({ received: true });
  } catch (err) {
    next(err);
  }
});

export default router;
