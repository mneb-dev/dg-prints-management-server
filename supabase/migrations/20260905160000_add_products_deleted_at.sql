-- Adds a system-only soft-delete marker to products, distinct from the
-- user-facing `status` (Active/Inactive) column that ProductFormDialog
-- toggles. A product is soft-deleted instead of hard-deleted when it's
-- referenced by at least one order_items row, since order_items.product_id
-- has no ON DELETE clause (RESTRICT by Postgres default) and order history
-- must remain resolvable via getProduct(). deleted_at is a timestamp (not a
-- boolean) so "when" is captured for free without a future migration.

alter table products add column if not exists deleted_at timestamptz;

create index if not exists products_deleted_at_idx on products (deleted_at);

-- Drop the orphaned 6-arg list_products() overload left behind by an earlier
-- `create or replace function` whose signature didn't match (Postgres treats
-- a different parameter list as a distinct overload rather than a replace).
-- It's unreachable today (productStore.ts always calls with p_sort_by/
-- p_sort_dir, which only the 8-arg overload has), but leaving it around
-- would mean a future 6-arg caller bypasses the deleted_at filter below.
drop function if exists list_products(text, text, text, text, int, int);

-- Exclude soft-deleted rows from every product listing (both the paginated
-- table and the unpaginated ?all=true catalog go through this same RPC).
-- There is no "view archived" UI, so the filter is unconditional rather
-- than a new p_include_deleted parameter. Body otherwise unchanged from
-- 20260830160000_add_sorting.sql's list_products (the latest prior
-- definition, which added p_sort_by/p_sort_dir).
create or replace function list_products(
  p_search text default null,
  p_category text default null,
  p_status text default null,
  p_pricing_type text default null,
  p_limit int default 10,
  p_offset int default 0,
  p_sort_by text default 'created_at',
  p_sort_dir text default 'desc'
)
returns jsonb
language sql
stable
as $$
  with filtered as (
    select pr.*
    from products pr
    where
      pr.deleted_at is null
      and (p_search is null or p_search = '' or pr.name ilike '%' || p_search || '%')
      and (p_category is null or p_category = '' or pr.category = p_category)
      and (p_status is null or p_status = '' or pr.status = p_status)
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
  ),
  sorted as (
    select
      f.*,
      case p_sort_by
        when 'name' then f.name
        when 'category' then f.category
        when 'status' then f.status
      end as sort_text
    from filtered f
  ),
  paged as (
    select *
    from sorted
    order by
      case when p_sort_dir = 'asc' then sort_text end asc,
      case when p_sort_dir = 'desc' then sort_text end desc,
      case when p_sort_by = 'created_at' and p_sort_dir = 'asc' then created_at end asc,
      case when p_sort_by = 'created_at' and p_sort_dir = 'desc' then created_at end desc,
      created_at desc
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'category', p.category,
        'description', p.description,
        'status', p.status,
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
        ), '[]'::jsonb)
      ) order by
        case when p_sort_dir = 'asc' then p.sort_text end asc,
        case when p_sort_dir = 'desc' then p.sort_text end desc,
        case when p_sort_by = 'created_at' and p_sort_dir = 'asc' then p.created_at end asc,
        case when p_sort_by = 'created_at' and p_sort_dir = 'desc' then p.created_at end desc,
        p.created_at desc)
      from paged p
    ), '[]'::jsonb),
    'total', (select count(*) from filtered)
  );
$$;
