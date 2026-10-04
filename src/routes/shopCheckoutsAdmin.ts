import { Router } from 'express';

import { getShopCheckout, listShopCheckouts, recheckShopCheckout } from '../data/shopCheckoutStore.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { PayMongoError } from '../utils/paymongo.js';
import { isUuid } from '../utils/uuid.js';

// Staff view of online-shop checkouts, for "I was charged but have no order" claims: find the
// buyer's checkout and re-ask PayMongo, which creates the paid order if the money is there.
const router = Router();

router.use(requireAuth, requirePermission('manage_orders'));

const MAX_LIMIT = 50;

router.get('/', async (req, res, next) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 60) : '';
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), MAX_LIMIT);
    res.json({ items: await listShopCheckouts(search, limit) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/check', async (req, res, next) => {
  try {
    const checkout = isUuid(req.params.id) ? await getShopCheckout(req.params.id) : undefined;
    if (!checkout) {
      res.status(404).json({ error: 'Checkout not found.' });
      return;
    }
    res.json(await recheckShopCheckout(checkout));
  } catch (err) {
    if (err instanceof PayMongoError) {
      console.error(err);
      res.status(502).json({ error: "Couldn't reach PayMongo. Please try again in a moment." });
      return;
    }
    next(err);
  }
});

export default router;
