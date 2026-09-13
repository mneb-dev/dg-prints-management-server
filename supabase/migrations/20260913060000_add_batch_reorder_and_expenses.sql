-- catalogStore.ts's reorder() and orderStatusStore.ts's reorderOrderStatuses() each fired one
-- UPDATE per row via Promise.all -- N round-trips to Supabase per drag-and-drop reorder action.
-- One RPC updating all rows in a single statement instead. p_table is whitelisted, not
-- interpolated from arbitrary caller input.
create or replace function reorder_catalog_items(p_table text, p_ids uuid[])
returns void
language plpgsql
as $$
begin
  if p_table not in ('payment_methods', 'order_channels', 'order_statuses') then
    raise exception 'reorder_catalog_items: invalid table %', p_table;
  end if;

  execute format(
    'update %I t set sort_order = v.ord - 1
     from unnest($1) with ordinality as v(id, ord)
     where t.id = v.id',
    p_table
  ) using p_ids;
end;
$$;
