-- Data fix: 3 product_pricing rows on the "Sticker Label" product were left with a raw legacy
-- applies_to string ("1" / "2" / "3") by 20260903120000_widen_product_pricing_applies_to_combinations.sql's
-- backfill, which could only resolve legacy values that exactly matched a current
-- product_option_values.value — these predate the Package option's values being renamed to
-- "P1"/"P2"/"P3", so the backfill's join found nothing and silently left them as bare strings.
-- That shape isn't a valid AppliesTo (`"All" | { optionId, value }[]`) and crashes the frontend's
-- pricing resolver ("appliesTo.every is not a function") when editing a Sticker Label order.

update product_pricing
set applies_to = jsonb_build_array(
  jsonb_build_object('optionId', 'ad4001b7-34ce-499f-94a1-f16472f0978d', 'value', 'P1')
)
where id = 'aa144182-0717-4f9f-8296-f74c793134f2';

update product_pricing
set applies_to = jsonb_build_array(
  jsonb_build_object('optionId', 'ad4001b7-34ce-499f-94a1-f16472f0978d', 'value', 'P2')
)
where id = '475d254f-12f9-4680-b58e-9f7a99778ea6';

update product_pricing
set applies_to = jsonb_build_array(
  jsonb_build_object('optionId', 'ad4001b7-34ce-499f-94a1-f16472f0978d', 'value', 'P3')
)
where id = '0175bd17-5a90-48e5-baee-89d2dec35e42';

-- Guard: fail loudly (instead of the previous migration's silent NOTICE) if any product_pricing
-- row anywhere still has an unresolved legacy applies_to value after this fix.
do $$
declare
  v_unresolved int;
begin
  select count(*) into v_unresolved
    from product_pricing
   where jsonb_typeof(applies_to) = 'string'
     and applies_to #>> '{}' <> 'All';
  if v_unresolved > 0 then
    raise exception 'product_pricing: % row(s) still have an unresolved legacy applies_to value', v_unresolved;
  end if;
end $$;
