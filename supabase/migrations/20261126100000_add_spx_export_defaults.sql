-- Default parcel details for the portal's "Export to SPX" bulk order file (SPX's mass order template needs
-- weight, length/width/height and an item type for every parcel; orders don't store them). Staff can still
-- change any row in the export dialog. Item type must be one of SPX's template values.

alter table app_settings
  add column if not exists spx_export_defaults jsonb not null
  default '{"weightKg": 0.5, "lengthCm": 20, "widthCm": 15, "heightCm": 5, "itemType": "General merchandise"}'::jsonb;
