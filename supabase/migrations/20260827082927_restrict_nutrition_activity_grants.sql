-- Supabase default table privileges are broader than this client needs.
begin;

revoke all on table public.nutrition_entries from anon, authenticated;
revoke all on table public.daily_activity from anon, authenticated;

grant select, insert, update, delete on table public.nutrition_entries to authenticated;
grant select, insert, update, delete on table public.daily_activity to authenticated;

commit;
