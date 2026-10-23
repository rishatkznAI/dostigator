-- Local bootstrap schema. Its constraints and seeds differ from the original
-- production migration with this version. Never replay it on an existing database.
-- Program data is shared read-only; all personal rows are isolated by auth.uid() RLS.
begin;

create extension if not exists pgcrypto;

create table if not exists public.exercise_library (
  key text primary key,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  muscles text[] not null default '{}',
  steps text[] not null default '{}',
  mistakes text[] not null default '{}',
  youtube_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workout_templates (
  code text primary key check (char_length(code) between 1 and 12),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  sort_order smallint not null check (sort_order >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (sort_order)
);

create table if not exists public.workout_template_items (
  template_code text not null references public.workout_templates(code) on delete cascade,
  exercise_key text not null references public.exercise_library(key) on delete restrict,
  sort_order smallint not null check (sort_order >= 1),
  set_count smallint not null check (set_count between 1 and 12),
  rep_target text not null check (char_length(btrim(rep_target)) between 1 and 40),
  primary key (template_code, exercise_key),
  unique (template_code, sort_order)
);

create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  template_code text references public.workout_templates(code) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workout_session_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_key text references public.exercise_library(key) on delete set null,
  exercise_name text not null check (char_length(btrim(exercise_name)) between 1 and 200),
  target text not null default '' check (char_length(target) <= 80),
  sort_order smallint not null check (sort_order >= 1),
  note text not null default '' check (char_length(note) <= 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  session_exercise_id uuid not null references public.workout_session_exercises(id) on delete cascade,
  set_number smallint not null check (set_number >= 1),
  weight_kg numeric(7,2) check (weight_kg is null or weight_kg between 0 and 2000),
  reps smallint check (reps is null or reps between 0 and 1000),
  rir smallint check (rir is null or rir between 0 and 10),
  done boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  measured_at timestamptz not null default now(),
  weight_kg numeric(6,2) check (weight_kg is null or weight_kg between 1 and 500),
  waist_cm numeric(5,1) check (waist_cm is null or waist_cm between 1 and 300),
  note text not null default '' check (char_length(note) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists workout_sessions_user_finished_idx on public.workout_sessions (user_id, finished_at desc);
create index if not exists workout_session_exercises_session_idx on public.workout_session_exercises (session_id, sort_order);
create index if not exists workout_sets_session_exercise_idx on public.workout_sets (session_exercise_id, set_number);
create index if not exists body_measurements_user_measured_idx on public.body_measurements (user_id, measured_at desc);

alter table public.exercise_library enable row level security;
alter table public.workout_templates enable row level security;
alter table public.workout_template_items enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.workout_session_exercises enable row level security;
alter table public.workout_sets enable row level security;
alter table public.body_measurements enable row level security;

drop policy if exists "exercise library public read" on public.exercise_library;
create policy "exercise library public read" on public.exercise_library for select to anon, authenticated using (active = true);
drop policy if exists "workout templates public read" on public.workout_templates;
create policy "workout templates public read" on public.workout_templates for select to anon, authenticated using (active = true);
drop policy if exists "workout template items public read" on public.workout_template_items;
create policy "workout template items public read" on public.workout_template_items for select to anon, authenticated using (true);

drop policy if exists "workout sessions select own" on public.workout_sessions;
create policy "workout sessions select own" on public.workout_sessions for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "workout sessions insert own" on public.workout_sessions;
create policy "workout sessions insert own" on public.workout_sessions for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "workout sessions update own" on public.workout_sessions;
create policy "workout sessions update own" on public.workout_sessions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "workout sessions delete own" on public.workout_sessions;
create policy "workout sessions delete own" on public.workout_sessions for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "workout exercises select own" on public.workout_session_exercises;
create policy "workout exercises select own" on public.workout_session_exercises for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "workout exercises insert own" on public.workout_session_exercises;
create policy "workout exercises insert own" on public.workout_session_exercises for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "workout exercises update own" on public.workout_session_exercises;
create policy "workout exercises update own" on public.workout_session_exercises for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "workout exercises delete own" on public.workout_session_exercises;
create policy "workout exercises delete own" on public.workout_session_exercises for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "workout sets select own" on public.workout_sets;
create policy "workout sets select own" on public.workout_sets for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "workout sets insert own" on public.workout_sets;
create policy "workout sets insert own" on public.workout_sets for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "workout sets update own" on public.workout_sets;
create policy "workout sets update own" on public.workout_sets for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "workout sets delete own" on public.workout_sets;
create policy "workout sets delete own" on public.workout_sets for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "body measurements select own" on public.body_measurements;
create policy "body measurements select own" on public.body_measurements for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "body measurements insert own" on public.body_measurements;
create policy "body measurements insert own" on public.body_measurements for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "body measurements update own" on public.body_measurements;
create policy "body measurements update own" on public.body_measurements for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "body measurements delete own" on public.body_measurements;
create policy "body measurements delete own" on public.body_measurements for delete to authenticated using ((select auth.uid()) = user_id);

insert into public.exercise_library (key, name, muscles, steps, mistakes, youtube_url, active)
values
  ('biceps_curl', 'Сгибание рук с гантелями', array['бицепс', 'плечевая', 'плечелучевая']::text[], array['Стой прямо, локти рядом с корпусом.', 'Поднимай гантели за счёт сгибания локтей.', 'В верхней точке сожми бицепс.', 'Опускай медленно.']::text[], array['Не помогай корпусом.', 'Не выбрасывай локти вперёд.', 'Не бросай гантели вниз.']::text[], 'https://www.youtube.com/watch?v=XblwrlKQReg', true),
  ('cable_crunch', 'Скручивания на блоке', array['прямая мышца живота', 'косые как стабилизаторы']::text[], array['Встань на колени, канат держи у головы.', 'Слегка зафиксируй таз.', 'Скручивай корпус вниз за счёт пресса.', 'Вернись подконтрольно в исходное положение.']::text[], array['Не тяни руками.', 'Не делай рывок.', 'Не садись тазом на пятки.']::text[], 'https://www.youtube.com/watch?v=0RwSvftPZP0', true),
  ('calf_raise', 'Подъём на носки в Смите', array['икроножные', 'камбаловидные']::text[], array['Поставь переднюю часть стоп на устойчивую платформу, пятки оставь свободными.', 'Расположи гриф на верхней части трапеций и держи корпус вертикально.', 'Медленно опусти пятки до комфортного растяжения икр.', 'Поднимись максимально высоко на носки, сделай короткую паузу и опустись под контролем.']::text[], array['Не пружинь в нижней точке.', 'Не сгибай и не разгибай колени во время повтора.', 'Не ставь носки на самый край неустойчивой платформы.']::text[], 'https://www.youtube.com/watch?v=K_jsGgztcGU', true),
  ('chest_press', 'Жим в тренажёре на грудь', array['грудные мышцы', 'трицепс', 'передняя дельта']::text[], array['Настрой сиденье так, чтобы рукояти были на уровне груди.', 'Лопатки прижаты к спинке.', 'Выжимай рукояти вперёд плавно.', 'Вернись подконтрольно.']::text[], array['Не выводи плечи вперёд.', 'Не переразгибай локти.', 'Не отрывай спину от спинки.']::text[], 'https://www.youtube.com/watch?v=zzTHbMhcIvk', true),
  ('db_bench', 'Жим гантелей лёжа', array['грудные мышцы', 'трицепс', 'передняя дельта']::text[], array['Ляг на скамью, лопатки сведены и прижаты.', 'Стопы устойчиво стоят на полу.', 'Опускай гантели контролируемо к линии груди.', 'Выжимай вверх без удара гантелей друг о друга.']::text[], array['Не отрывай таз.', 'Не разводи локти слишком широко.', 'Не бросай гантели вниз.']::text[], 'https://www.youtube.com/watch?v=1ZoLTYHwc8k', true),
  ('incline_db_press', 'Наклонный жим гантелей', array['верх грудных мышц', 'трицепс', 'передняя дельта']::text[], array['Установи спинку скамьи под углом около 30 градусов.', 'Прижми стопы к полу, сведи и опусти лопатки.', 'Опускай гантели подконтрольно к верхней части груди, локти держи примерно под 45 градусов к корпусу.', 'Выжимай гантели вверх и немного внутрь, сохраняя плечи прижатыми к скамье.']::text[], array['Не ставь спинку слишком вертикально — нагрузка уйдёт в плечи.', 'Не выводи плечи вперёд в верхней точке.', 'Не отбивай гантели от груди и не сталкивай их сверху.']::text[], 'https://www.youtube.com/watch?v=sK4Rvug6ufo', true),
  ('knee_raise', 'Подъём коленей в упоре', array['пресс', 'подвздошно-поясничная']::text[], array['Зафиксируй корпус в упоре.', 'Подними колени вверх.', 'В верхней точке слегка подкрути таз.', 'Опусти ноги медленно.']::text[], array['Не раскачивайся.', 'Не бросай ноги вниз.', 'Не делай движение только сгибателями бедра.']::text[], 'https://www.youtube.com/watch?v=odnoxj0Hd4U', true),
  ('lat_pulldown', 'Тяга верхнего блока к груди', array['широчайшие', 'ромбовидные', 'бицепс']::text[], array['Сядь устойчиво и зафиксируй бёдра.', 'Возьми гриф чуть шире плеч.', 'Сначала опусти плечи вниз, затем тяни гриф к верхней части груди.', 'Возвращай гриф медленно, не бросая вес.']::text[], array['Не тяни за голову.', 'Не раскачивай корпус.', 'Не поднимай плечи к ушам.']::text[], 'https://www.youtube.com/watch?v=CAwf7n6Luuc', true),
  ('lat_pulldown_close', 'Тяга верхнего блока узким хватом', array['широчайшие', 'бицепс', 'ромбовидные']::text[], array['Возьми нейтральную или узкую рукоять.', 'Сохраняй грудь раскрытой.', 'Тяни локти вниз и к корпусу.', 'Контролируй возврат вверх.']::text[], array['Не раскачивай корпус.', 'Не тяни рукоять к животу.', 'Не поднимай плечи.']::text[], 'https://www.youtube.com/watch?v=CAwf7n6Luuc', true),
  ('lateral_raise', 'Подъём гантелей в стороны', array['средняя дельта', 'надостная', 'верх трапеции как стабилизатор']::text[], array['Встань устойчиво, держи лёгкие гантели по бокам, локти слегка согнуты.', 'Поднимай руки в стороны и чуть вперёд без движения корпусом.', 'Остановись примерно на уровне плеч, сохраняя запястья нейтральными.', 'Опускай гантели медленно и начинай следующий повтор без раскачки.']::text[], array['Не поднимай плечи к ушам.', 'Не раскачивай корпус и не забрасывай вес.', 'Не поднимай кисти заметно выше локтей или выше уровня плеч.']::text[], 'https://www.youtube.com/watch?v=3VcKaXpzqRo', true),
  ('leg_curl', 'Сгибание ног в тренажёре', array['бицепс бедра', 'полусухожильная', 'полуперепончатая']::text[], array['Ляг в тренажёр, валики расположи над ахиллом.', 'Зафиксируй таз и корпус.', 'Сгибай ноги плавно до сокращения задней поверхности бедра.', 'Медленно возвращай вес.']::text[], array['Не прогибай поясницу.', 'Не отрывай таз.', 'Не бросай вес.']::text[], 'https://www.youtube.com/watch?v=EGmK6J_IAFc', true),
  ('leg_extension', 'Разгибание ног', array['квадрицепс']::text[], array['Настрой тренажёр по оси колена.', 'Поднимай валик вверх за счёт разгибания колена.', 'В верхней точке короткая пауза.', 'Опускай медленно.']::text[], array['Не бей грузом.', 'Не ставь слишком большой вес.', 'Не запирай колено резко.']::text[], 'https://www.youtube.com/watch?v=1n1iyWDb7ds', true),
  ('leg_press', 'Жим ногами', array['квадрицепсы', 'ягодичные', 'бицепс бедра']::text[], array['Прижми таз и поясницу к спинке.', 'Поставь стопы на платформу на ширине плеч.', 'Опускай платформу подконтрольно, колени идут по линии носков.', 'Выжимай вверх через всю стопу, не запирая колени.']::text[], array['Не своди колени внутрь.', 'Не отрывай таз от спинки.', 'Не выпрямляй колени в жёсткий замок.']::text[], 'https://www.youtube.com/watch?v=EBVnuNIBJKA', true),
  ('one_arm_row', 'Тяга гантели одной рукой', array['широчайшие', 'ромбовидные', 'задняя дельта', 'бицепс']::text[], array['Упрись коленом и рукой в скамью.', 'Спина ровная, шея нейтральна.', 'Тяни гантель к тазу, а не к плечу.', 'Опускай до полного растяжения под контролем.']::text[], array['Не разворачивай корпус.', 'Не округляй спину.', 'Не дёргай гантель.']::text[], 'https://www.youtube.com/watch?v=EOTDVjBqpQM', true),
  ('plank', 'Планка', array['прямая и поперечная мышцы живота', 'косые', 'ягодичные']::text[], array['Локти под плечами.', 'Тело одной линией от головы до пяток.', 'Напряги пресс и ягодицы.', 'Дыши ровно и держи положение.']::text[], array['Не проваливай поясницу.', 'Не поднимай таз слишком высоко.', 'Не задерживай дыхание.']::text[], 'https://www.youtube.com/watch?v=R73Q4uiFJ-Q', true),
  ('rdl', 'Румынская тяга с гантелями', array['бицепс бедра', 'ягодичные', 'разгибатели спины']::text[], array['Слегка согни колени.', 'Отводи таз назад, гантели держи близко к ногам.', 'Опускайся до натяжения задней поверхности бедра.', 'Поднимайся за счёт разгибания таза.']::text[], array['Не округляй спину.', 'Не уводи гантели далеко вперёд.', 'Не превращай движение в присед.']::text[], 'https://www.youtube.com/watch?v=_mWBh-VSKQg', true),
  ('seated_row', 'Горизонтальная тяга блока', array['широчайшие', 'ромбовидные', 'средняя трапеция', 'задняя дельта', 'бицепс']::text[], array['Сядь ровно, грудь раскрыта.', 'Возьми рукоять и слегка натяни трос.', 'Тяни рукоять к животу, локти веди назад.', 'В конце мягко своди лопатки и контролируй возврат.']::text[], array['Не округляй спину.', 'Не раскачивай корпус.', 'Не тяни только руками.']::text[], 'https://www.youtube.com/watch?v=cbW-4RcZ4G0', true),
  ('shoulder_press', 'Жим гантелей сидя', array['передняя дельта', 'средняя дельта', 'трицепс']::text[], array['Сядь на скамью со спинкой.', 'Гантели у уровня плеч.', 'Выжимай их вверх, не переразгибая поясницу.', 'Опускай подконтрольно.']::text[], array['Не прогибай поясницу.', 'Не опускай гантели слишком низко.', 'Не сталкивай гантели резко.']::text[], 'https://www.youtube.com/watch?v=RKBOJ8rnJZ0', true),
  ('smith_squat', 'Присед в Смите', array['квадрицепсы', 'ягодичные', 'приводящие']::text[], array['Поставь стопы устойчиво, немного впереди грифа.', 'Гриф лежит на верхней части трапеций.', 'Садись вниз, сохраняя нейтральную спину.', 'Вставай через всю стопу, колени идут по линии носков.']::text[], array['Не своди колени внутрь.', 'Не округляй поясницу.', 'Не отрывай пятки.']::text[], 'https://www.youtube.com/watch?v=82Ssr7rXnhU', true),
  ('triceps_pushdown', 'Разгибание рук на верхнем блоке', array['трицепс']::text[], array['Локти прижаты к корпусу.', 'Разгибай предплечья вниз до полного сокращения трицепса.', 'Плечи почти не двигаются.', 'Возвращай рукоять медленно.']::text[], array['Не разводи локти в стороны.', 'Не качай корпусом.', 'Не подключай плечи.']::text[], 'https://www.youtube.com/watch?v=geIESj05W7M', true)
on conflict (key) do nothing;

insert into public.workout_templates (code, title, sort_order, active)
values
  ('A', 'Грудь + ноги + спина', 1, true),
  ('B', 'Верх груди + задняя цепь + спина', 2, true),
  ('C', 'Дополнительная: всё тело', 3, true)
on conflict (code) do nothing;

commit;
