-- "Custom quotation" flag per product. When on, the portal order form quotes the product with
-- its category's dedicated quotation calculator (Sticker Label, Laminated Sticker, Tarpaulin,
-- Sintra) instead of the generic options/pricing picker. Defaults to false.
--
-- Backfills true for existing products in those categories so current order entry keeps
-- working after deploy. Category names drifted across environments ("Sticker" / "Sintra" vs
-- the seeded "Sticker Label" / "Sintra Board"), so both forms are matched, case-insensitively.

alter table products add column if not exists custom_quotation boolean not null default false;

update products
   set custom_quotation = true
 where lower(trim(category)) in ('sticker', 'sticker label', 'laminated sticker', 'tarpaulin', 'sintra', 'sintra board');

-- upsert_product: body unchanged from 20260927090000_add_product_made_to_order.sql
-- apart from writing custom_quotation.
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
  insert into products (id, name, category, description, status, show_in_shop, made_to_order, custom_quotation)
  values (
    v_product_id,
    payload->>'name',
    coalesce(payload->>'category', ''),
    coalesce(payload->>'description', ''),
    coalesce(payload->>'status', 'Active'),
    coalesce((payload->>'show_in_shop')::boolean, false),
    coalesce((payload->>'made_to_order')::boolean, false),
    coalesce((payload->>'custom_quotation')::boolean, false)
  )
  on conflict (id) do update set
    name = excluded.name,
    category = excluded.category,
    description = excluded.description,
    status = excluded.status,
    show_in_shop = excluded.show_in_shop,
    made_to_order = excluded.made_to_order,
    custom_quotation = excluded.custom_quotation;

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

-- list_products: same signature and body as
-- 20260927090000_add_product_made_to_order.sql, plus custom_quotation per row.
create or replace function list_products(
  p_search text default null,
  p_category text default null,
  p_status text default null,
  p_pricing_type text default null,
  p_limit int default 10,
  p_offset int default 0,
  p_sort_by text default 'created_at',
  p_sort_dir text default 'desc',
  p_show_in_shop boolean default null
)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'category', p.category,
        'description', p.description,
        'status', p.status,
        'show_in_shop', p.show_in_shop,
        'made_to_order', p.made_to_order,
        'custom_quotation', p.custom_quotation,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', po.id, 'name', po.name, 'required', po.required, 'sort_order', po.sort_order,
            'values', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', pov.id, 'value', pov.value, 'sort_order', pov.sort_order
              ) order by pov.sort_order)
              from product_option_values pov where pov.option_id = po.id
            ), '[]'::jsonb)
          ) order by po.sort_order)
          from product_options po where po.product_id = p.id
        ), '[]'::jsonb),
        'pricing', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pp.id, 'applies_to', pp.applies_to, 'pricing_type', pp.pricing_type,
            'package_name', pp.package_name, 'price', pp.price, 'unit', pp.unit,
            'sort_order', pp.sort_order
          ) order by pp.sort_order)
          from product_pricing pp where pp.product_id = p.id
        ), '[]'::jsonb),
        'images', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pi.id, 'storage_path', pi.storage_path, 'sort_order', pi.sort_order
          ) order by pi.sort_order)
          from product_images pi where pi.product_id = p.id
        ), '[]'::jsonb)
      ) order by
        case when p_sort_dir = 'asc' then p.sort_text end asc,
        case when p_sort_dir = 'desc' then p.sort_text end desc,
        case when p_sort_by = 'created_at' and p_sort_dir = 'asc' then p.created_at end asc,
        case when p_sort_by = 'created_at' and p_sort_dir = 'desc' then p.created_at end desc,
        p.created_at desc)
      from (
        select * from (
          select
            pr.*,
            case p_sort_by
              when 'name' then pr.name
              when 'category' then pr.category
              when 'status' then pr.status
            end as sort_text
          from products pr
          where
            pr.deleted_at is null
            and (p_search is null or p_search = '' or pr.name ilike '%' || p_search || '%')
            and (p_category is null or p_category = '' or pr.category = p_category)
            and (p_status is null or p_status = '' or pr.status = p_status)
            and (p_show_in_shop is null or pr.show_in_shop = p_show_in_shop)
            and (
              p_pricing_type is null or p_pricing_type = '' or (
                case
                  when p_pricing_type = 'Manual' then
                    not exists (select 1 from product_pricing pp where pp.product_id = pr.id)
                  else
                    exists (
                      select 1 from product_pricing pp
                      where pp.product_id = pr.id and pp.pricing_type = p_pricing_type
                    )
                end
              )
            )
        ) f
        order by
          case when p_sort_dir = 'asc' then f.sort_text end asc,
          case when p_sort_dir = 'desc' then f.sort_text end desc,
          case when p_sort_by = 'created_at' and p_sort_dir = 'asc' then f.created_at end asc,
          case when p_sort_by = 'created_at' and p_sort_dir = 'desc' then f.created_at end desc,
          f.created_at desc
        limit p_limit offset p_offset
      ) p
    ), '[]'::jsonb),
    'total', (
      select count(*)
      from products pr
      where
        pr.deleted_at is null
        and (p_search is null or p_search = '' or pr.name ilike '%' || p_search || '%')
        and (p_category is null or p_category = '' or pr.category = p_category)
        and (p_status is null or p_status = '' or pr.status = p_status)
        and (p_show_in_shop is null or pr.show_in_shop = p_show_in_shop)
        and (
          p_pricing_type is null or p_pricing_type = '' or (
            case
              when p_pricing_type = 'Manual' then
                not exists (select 1 from product_pricing pp where pp.product_id = pr.id)
              else
                exists (
                  select 1 from product_pricing pp
                  where pp.product_id = pr.id and pp.pricing_type = p_pricing_type
                )
            end
          )
        )
    )
  );
$$;
