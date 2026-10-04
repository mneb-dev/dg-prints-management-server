-- Online shop payments move from PayMongo Checkout Sessions (PayMongo's hosted page) to Payment
-- Intents: the shop lists the payment methods itself and sends the buyer straight to GCash/Maya.
-- Older session-based checkouts keep paymongo_checkout_session_id; new ones record the intent here.
-- shop_checkouts.status also gains 'failed' (the buyer cancelled or the payment was declined).
alter table shop_checkouts
  add column if not exists paymongo_payment_intent_id text unique;
