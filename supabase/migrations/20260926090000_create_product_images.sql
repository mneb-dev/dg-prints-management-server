-- Product images: one main image plus sub images per product. Files live in the
-- public `product-images` Storage bucket (uploaded directly by the portal via a
-- signed upload URL the server issues); this table records which objects belong
-- to which product and in what order. The lowest sort_order is the main image.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

create table if not exists product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  storage_path text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists product_images_product_id_sort_order_idx
  on product_images (product_id, sort_order);

alter table product_images enable row level security;

-- list_products: same signature and body as
-- 20260924090000_add_products_show_in_shop.sql, plus an 'images' array per row.
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
