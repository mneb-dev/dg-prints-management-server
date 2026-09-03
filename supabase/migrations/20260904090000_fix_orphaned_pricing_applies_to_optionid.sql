-- Data fix: the frontend's toProductPayload() (dg-prints-management-portal src/lib/products-slice.ts)
-- was stripping `id` off every options[]/pricing[] entry before every create AND update request. Because
-- normalizeOptions/normalizePricing (productStore.ts) mint a brand-new id whenever an incoming entry has no
-- id, this meant every product_options row got a new id on every single update — but each product_pricing
-- row's applies_to[].optionId condition was built client-side against the *previous* option id, so the
-- freshly-saved pricing row's optionId was orphaned the instant the save completed. On the next edit,
-- VariantPricingTable's reconciliation effect can't match any pricing row to the (now differently-keyed)
-- option combinations, so it silently replaces every row with a fresh price: 0 entry the moment the product
-- is reopened for editing — this is the "price reverts to 0" bug. The frontend fix stops stripping ids going
-- forward; this migration repairs rows already orphaned by the bug before that fix ships, by re-linking each
-- condition's optionId to whichever of the product's *current* options actually owns that value (safe here:
-- each affected product's option value sets are disjoint, so matching by value is unambiguous).

update product_pricing pp
set applies_to = (
  select jsonb_agg(
    jsonb_build_object(
      'optionId', (
        select po.id
        from product_options po
        join product_option_values pov on pov.option_id = po.id
        where po.product_id = pp.product_id
          and pov.value = c ->> 'value'
        limit 1
      ),
      'value', c ->> 'value'
    )
  )
  from jsonb_array_elements(pp.applies_to) c
)
where jsonb_typeof(pp.applies_to) = 'array'
  and exists (
    select 1 from jsonb_array_elements(pp.applies_to) c
    where (c ->> 'optionId') not in (
      select po.id::text from product_options po where po.product_id = pp.product_id
    )
  );

-- Guard: fail loudly if any row still has an orphaned or unresolved (null) optionId after the repair,
-- rather than silently leaving broken pricing data behind.
do $$
declare
  v_unresolved int;
begin
  select count(*) into v_unresolved
    from product_pricing pp, jsonb_array_elements(pp.applies_to) c
   where jsonb_typeof(pp.applies_to) = 'array'
     and (
       (c ->> 'optionId') is null
       or (c ->> 'optionId') not in (
            select po.id::text from product_options po where po.product_id = pp.product_id
          )
     );
  if v_unresolved > 0 then
    raise exception 'product_pricing: % applies_to condition(s) still unresolved after repair', v_unresolved;
  end if;
end $$;
