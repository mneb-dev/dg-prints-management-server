-- Backfill each existing status with the color key that reproduces its current appearance
-- exactly (see the matching BUILT_IN_COLORS entries being removed from the frontend's
-- order-statuses.tsx). The two custom statuses added since (curing, to-laminate) get fresh
-- slots rather than trying to reproduce their previous ephemeral hash-based color.

update order_statuses set color = 'muted' where name = 'pending';
update order_statuses set color = 'info' where name = 'layout';
update order_statuses set color = 'trace' where name = 'trace';
update order_statuses set color = 'progress' where name = 'print';
update order_statuses set color = 'cut' where name = 'cut';
update order_statuses set color = 'pack' where name = 'pack';
update order_statuses set color = 'ready' where name = 'pickup';
update order_statuses set color = 'success' where name = 'released';
update order_statuses set color = 'destructive' where name = 'cancelled';
update order_statuses set color = 'refunded' where name = 'refunded';
update order_statuses set color = 'returned' where name = 'returned';
update order_statuses set color = 'slot-7' where name = 'curing';
update order_statuses set color = 'slot-8' where name = 'to-laminate';
