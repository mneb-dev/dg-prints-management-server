-- Ranks the most-frequent order sizes for a set of category-name aliases, over the most
-- recent matching order_items (not necessarily 100 distinct orders — sizes live at the
-- line-item level, and one order can carry several items of the same category, so the
-- p_limit cap applies to matching order_items rows). Powers the Calculator page's "hot
-- sizes" quick-select chips (top 5 taken and deduped against admin-configured common sizes
-- in categoryStore.ts's listHotSizes, not here — this function stays decoupled from the
-- categories table so it's independently testable/reusable).
--
-- product_category is a historical per-item snapshot string, not an FK (see
-- create_order_tables.sql), and category names can drift after a rename (see
-- 20260905150000_add_category_status_flow.sql's backfill for the same issue) — callers pass
-- every known lowercase alias for the logical category they want (e.g. both 'sticker' and
-- 'sticker label') in p_category_names; this function does the lower() comparison but does
-- not itself know which aliases belong together.
--
-- Size data is not a normalized column — it's buried in two different jsonb shapes
-- depending on how the item was priced:
--   - Sticker Label / Laminated Sticker items: order_items.sticker_quotation, which is
--     itself wrapped in an extra "stickerQuotation" key (see foldStickerQuotation/
--     unfoldStickerQuotation in src/data/orderStore.ts) — i.e. the path is
--     sticker_quotation -> 'stickerQuotation' ->> 'width', not sticker_quotation ->> 'width'.
--   - Tarpaulin (Per-Unit/sq.ft.) items: order_items.pricing -> 'displaySize' holds the
--     value + unit the user actually typed; older rows saved before displaySize existed
--     fall back to the bare pricing.width/height (already converted to feet, so unit 'ft'
--     is synthesized rather than read).
-- Each candidate source is tried in order via coalesce-of-whole-objects (never coalesce
-- individual fields from different sources, which could mix an object's width with another
-- object's height/unit).
--
-- Orientation-insensitive by design (a 3x4 and a 4x3 order of the same unit are the same
-- physical size for ranking purposes — confirmed with product): grouped by
-- (unit, least(width,height), greatest(width,height)). The *displayed* width/height for each
-- group is the most-frequent raw orientation actually recorded within it (ties broken by
-- most recent), not the sorted canonical pair, so a chip shows an orientation staff actually
-- used. Matching is exact on unit — a 3in and a 7.62cm entry are different groups, no
-- cross-unit normalization.
create or replace function hot_sizes(p_category_names text[], p_limit int default 100)
returns jsonb
language sql
stable
as $$
  with matched as (
    select
      o.created_at,
      coalesce(
        case when (oi.sticker_quotation -> 'stickerQuotation' ->> 'width') is not null
             then oi.sticker_quotation -> 'stickerQuotation' end,
        case when (oi.pricing -> 'displaySize' ->> 'width') is not null
             then oi.pricing -> 'displaySize' end,
        case when (oi.pricing ->> 'width') is not null
             then jsonb_build_object(
                    'width', oi.pricing ->> 'width',
                    'height', oi.pricing ->> 'height',
                    'unit', 'ft'
                  )
        end
      ) as size
    from order_items oi
    join orders o on o.id = oi.order_id
    where lower(oi.product_category) = any(p_category_names)
  ),
  sized as (
    select
      created_at,
      (size ->> 'width')::numeric as width,
      (size ->> 'height')::numeric as height,
      size ->> 'unit' as unit
    from matched
    where size is not null
  ),
  recent as (
    select *
    from sized
    where width > 0 and height > 0 and unit is not null
    order by created_at desc
    limit p_limit
  ),
  canon as (
    select
      unit,
      width,
      height,
      least(width, height) as w_min,
      greatest(width, height) as w_max,
      created_at
    from recent
  ),
  groups as (
    select unit, w_min, w_max, count(*) as cnt
    from canon
    group by unit, w_min, w_max
  ),
  orientation_counts as (
    select
      unit, w_min, w_max, width, height,
      count(*) as orientation_cnt,
      max(created_at) as most_recent
    from canon
    group by unit, w_min, w_max, width, height
  ),
  representative as (
    select distinct on (unit, w_min, w_max)
      unit, w_min, w_max, width, height
    from orientation_counts
    order by unit, w_min, w_max, orientation_cnt desc, most_recent desc
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'width', r.width,
      'height', r.height,
      'unit', g.unit,
      'count', g.cnt
    ) order by g.cnt desc
  ), '[]'::jsonb)
  from groups g
  join representative r
    on r.unit = g.unit and r.w_min = g.w_min and r.w_max = g.w_max;
$$;
