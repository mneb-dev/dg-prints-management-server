import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';

import { getShopCheckout, recheckShopCheckout } from '../data/shopCheckoutStore.js';
import { isUuid } from '../utils/uuid.js';

// Public status of a shop checkout, polled by the shop's /checkout/return page. The checkout id is
// a random UUID only the buyer's browser knows. If the PayMongo webhook hasn't landed yet, this
// asks PayMongo directly and completes the checkout itself — complete_shop_checkout is idempotent,
// so racing the webhook is harmless.
const router = Router();

const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment.' },
});

router.get('/:id', statusLimiter, async (req, res, next) => {
  try {
    const found = isUuid(req.params.id) ? await getShopCheckout(req.params.id) : undefined;
    if (!found) {
      res.status(404).json({ error: 'Checkout not found.' });
      return;
    }

    const checkout = found.status === 'pending' ? await recheckShopCheckout(found) : found;
    if (checkout.status === 'paid') {
      res.json({ status: 'paid', orderNumber: checkout.orderNumber ?? '', total: checkout.total });
    } else if (checkout.status === 'failed') {
      res.json({ status: 'failed' });
    } else if (checkout.status === 'expired' || !checkout.checkoutUrl) {
      res.json({ status: 'expired' });
    } else {
      res.json({ status: 'pending', checkoutUrl: checkout.checkoutUrl, total: checkout.total });
    }
  } catch (err) {
    next(err);
  }
});

export default router;
