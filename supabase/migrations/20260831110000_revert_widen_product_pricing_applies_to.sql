-- Revert product_pricing.applies_to from jsonb back to text. The widen-to-jsonb
-- change was applied directly to the database without a matching migration file
-- or application-layer support (productStore.ts / types/product.ts still treat
-- appliesTo as a plain string), so it is being rolled back.
--
-- applies_to values are currently either a JSON string (e.g. "All", "3mm") or,
-- for two rows, a JSON array combination-match object that has no equivalent in
-- the old text model. Plain JSON strings unwrap losslessly via #>> '{}'; the
-- array rows serialize to their raw JSON text (e.g. '[{"optionId":...,...}]'),
-- which preserves the data without deleting it but is not a value the app will
-- match against until fixed by hand.

alter table product_pricing alter column applies_to drop default;
alter table product_pricing
  alter column applies_to type text using applies_to #>> '{}';
alter table product_pricing
  alter column applies_to set default 'All';
alter table product_pricing alter column applies_to set not null;

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
      coalesce(prc->>'applies_to', 'All'),
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
