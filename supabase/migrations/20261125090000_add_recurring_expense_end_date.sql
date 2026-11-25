-- Optional end date for recurring expenses. end_date is inclusive: a run that
-- falls on it is still logged. Once a schedule's next run would land past its
-- end date, process_recurring_expenses() stops generating rows and flips the
-- schedule to active = false, so activeCount and the active-only due index
-- need no further changes. The portal shows such a schedule as "Ended"
-- (end_date set and next_run_date > end_date) rather than "Paused".
-- Safe to re-run: every statement is idempotent.

alter table recurring_expenses add column if not exists end_date date;

alter table recurring_expenses drop constraint if exists recurring_expenses_end_date_check;
alter table recurring_expenses
  add constraint recurring_expenses_end_date_check
  check (end_date is null or end_date >= start_date);

create or replace function process_recurring_expenses()
returns integer
language plpgsql
as $$
declare
  schedule record;
  run_date date;
  generated_count integer := 0;
begin
  for schedule in
    select *
    from recurring_expenses
    where active and next_run_date <= current_date
    for update
  loop
    run_date := schedule.next_run_date;
    while run_date <= current_date
      and (schedule.end_date is null or run_date <= schedule.end_date)
    loop
      insert into expenses (
        date, amount, category, payment_method, notes, created_by, recurring_expense_id
      )
      values (
        run_date, schedule.amount, schedule.category, schedule.payment_method,
        schedule.notes, schedule.created_by, schedule.id
      );
      generated_count := generated_count + 1;

      run_date := case schedule.frequency
        when 'daily' then (run_date + interval '1 day')::date
        when 'weekly' then (run_date + interval '7 days')::date
        when 'monthly' then (run_date + interval '1 month')::date
      end;
    end loop;

    update recurring_expenses
      set next_run_date = run_date,
          active = not (schedule.end_date is not null and run_date > schedule.end_date)
      where id = schedule.id;
  end loop;

  return generated_count;
end;
$$;
