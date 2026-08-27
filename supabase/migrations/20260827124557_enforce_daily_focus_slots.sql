drop index if exists public.dostigator_actions_focus_slot_idx;

create unique index dostigator_actions_focus_slot_idx
  on public.dostigator_actions (user_id, focus_date, focus_position)
  where focus_date is not null and status <> 'cancelled';
