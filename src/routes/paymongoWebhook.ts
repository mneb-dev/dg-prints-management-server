import { Router } from 'express';

import {
  failShopCheckout,
  findShopCheckoutByIntent,
  findShopCheckoutBySession,
  getShopCheckout,
  settleShopCheckout,
} from '../data/shopCheckoutStore.js';
import type { RawBodyRequest } from '../types/http.js';
import {
  parseCheckoutSession,
  parsePaymentEvent,
  retrieveCheckoutSession,
  retrievePaymentIntent,
  verifyWebhookSignature,
} from '../utils/paymongo.js';
import { isUuid } from '../utils/uuid.js';

// PayMongo webhook, registered per environment for `payment.paid` and `payment.failed` (Payment
// Intent checkouts) plus `checkout_session.payment.paid` (older hosted-page checkouts). Public, but
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

    if (attributes.type === 'payment.paid' || attributes.type === 'payment.failed') {
      const payment = parsePaymentEvent(attributes.data);
      const checkout = payment.paymentIntentId ? await findShopCheckoutByIntent(payment.paymentIntentId) : undefined;
      if (!checkout) {
        // Not one of ours (e.g. a hosted-page session's payment, handled by its own event).
        res.json({ received: true });
        return;
      }
      if (attributes.type === 'payment.failed') {
        await failShopCheckout(checkout.id);
      } else {
        // The payment intent is the source of truth for what was paid.
        const intent = await retrievePaymentIntent(payment.paymentIntentId);
        await settleShopCheckout(checkout, intent.payment ?? (payment.status === 'paid' ? payment : null));
      }
      res.json({ received: true });
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
    await settleShopCheckout(checkout, settled.payment);
    res.json({ received: true });
  } catch (err) {
    next(err);
  }
});

export default router;
