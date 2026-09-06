-- Widen product_pricing.applies_to from a single-value text match to a jsonb value that can
-- express a multi-dimension combination match (e.g. Type=Glossy AND Package=Package 2), with
-- full application-layer support this time — see the now-superseded
-- 20260831110000_revert_widen_product_pricing_applies_to.sql for the earlier out-of-band
-- attempt at this same shape that had to be reverted for lack of app support.
--
-- New shape: applies_to is either the JSON string "All" (unchanged meaning: applies regardless
-- of variant) or a JSON array of { "optionId": uuid, "value": text } conditions, all of which
-- must match the customer's selected option values for the entry to apply.

alter table product_pricing alter column applies_to drop default;
alter table product_pricing
  alter column applies_to type jsonb
  using (
    case
      -- Recovers the two rows left over from the earlier out-of-band widen/revert, whose
      -- applies_to already holds raw JSON array/object text.
      when applies_to ~ '^\s*[\[{]' then applies_to::jsonb
      else to_jsonb(applies_to)
    end
  );
alter table product_pricing alter column applies_to set default '"All"'::jsonb;
alter table product_pricing alter column applies_to set not null;

-- Backfill: a bare JSON string other than "All" is a legacy single-option-value match
-- (e.g. "Matte") — rewrite it as a one-condition combination array by resolving which option
-- on the same product owns that value.
update product_pricing pp
set applies_to = jsonb_build_array(
  jsonb_build_object('optionId', po.id, 'value', pov.value)
)
from product_option_values pov
join product_options po on po.id = pov.option_id
where po.product_id = pp.product_id
  and jsonb_typeof(pp.applies_to) = 'string'
  and pp.applies_to #>> '{}' <> 'All'
  and pov.value = pp.applies_to #>> '{}';

do $$
declare
  v_unresolved int;
begin
  select count(*) into v_unresolved
    from product_pricing
   where jsonb_typeof(applies_to) = 'string'
     and applies_to #>> '{}' <> 'All';
  if v_unresolved > 0 then
    raise notice 'product_pricing: % row(s) still have an unresolved legacy applies_to value after backfill — needs manual review', v_unresolved;
  end if;
end $$;

create or replace function upsert_product(payload jsonb)
returns uuid
language plpgsql
as $$
declare
  v_product_id uuid := (payload->>'id')::uuid;
  v_option_ids uuid[];
  v_pricing_ids uuid[];
  opt jsonb;
  val jsonb;
  prc jsonb;
begin
  insert into products (id, name, category, description, status)
  values (
    v_product_id,
    payload->>'name',
    coalesce(payload->>'category', ''),
    coalesce(payload->>'description', ''),
    coalesce(payload->>'status', 'Active')
  )
  on conflict (id) do update set
    name = excluded.name,
    category = excluded.category,
    description = excluded.description,
    status = excluded.status;

  select coalesce(array_agg((o->>'id')::uuid), '{}')
    into v_option_ids
    from jsonb_array_elements(coalesce(payload->'options', '[]'::jsonb)) o;

  delete from product_options
   where product_id = v_product_id
     and id != all (v_option_ids);

  for opt in select * from jsonb_array_elements(coalesce(payload->'options', '[]'::jsonb))
  loop
    insert into product_options (id, product_id, name, required, sort_order)
    values (
      (opt->>'id')::uuid,
      v_product_id,
      opt->>'name',
      coalesce((opt->>'required')::boolean, false),
      coalesce((opt->>'sort_order')::int, 0)
    )
    on conflict (id) do update set
      name = excluded.name,
      required = excluded.required,
      sort_order = excluded.sort_order;

    delete from product_option_values where option_id = (opt->>'id')::uuid;

    for val in select * from jsonb_array_elements(coalesce(opt->'values', '[]'::jsonb))
    loop
      insert into product_option_values (id, option_id, value, sort_order)
      values (
        coalesce((val->>'id')::uuid, gen_random_uuid()),
        (opt->>'id')::uuid,
        val->>'value',
        coalesce((val->>'sort_order')::int, 0)
      );
    end loop;
  end loop;

  select coalesce(array_agg((p->>'id')::uuid), '{}')
    into v_pricing_ids
    from jsonb_array_elements(coalesce(payload->'pricing', '[]'::jsonb)) p;

  delete from product_pricing
   where product_id = v_product_id
     and id != all (v_pricing_ids);

  for prc in select * from jsonb_array_elements(coalesce(payload->'pricing', '[]'::jsonb))
  loop
    insert into product_pricing (id, product_id, applies_to, pricing_type, package_name, price, unit, sort_order)
    values (
      (prc->>'id')::uuid,
      v_product_id,
      coalesce(prc->'applies_to', '"All"'::jsonb),
      coalesce(prc->>'pricing_type', 'Package'),
      prc->>'package_name',
      coalesce((prc->>'price')::numeric, 0),
      coalesce(prc->>'unit', 'Package'),
      coalesce((prc->>'sort_order')::int, 0)
    )
    on conflict (id) do update set
      applies_to = excluded.applies_to,
      pricing_type = excluded.pricing_type,
      package_name = excluded.package_name,
      price = excluded.price,
      unit = excluded.unit,
      sort_order = excluded.sort_order;
  end loop;

  return v_product_id;
end;
$$;
