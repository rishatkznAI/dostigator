create index dostigator_goals_area_owner_idx
  on public.dostigator_goals (area_id, user_id);

create index dostigator_actions_goal_owner_idx
  on public.dostigator_actions (goal_id, user_id);

create index dostigator_habits_area_owner_idx
  on public.dostigator_habits (area_id, user_id);

create index dostigator_checkins_habit_owner_idx
  on public.dostigator_habit_checkins (habit_id, user_id);

create index dostigator_actions_user_created_idx
  on public.dostigator_actions (user_id, created_at);
