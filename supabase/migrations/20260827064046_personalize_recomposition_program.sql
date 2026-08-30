begin;

set local lock_timeout = '5s';

insert into public.exercise_library (
  key,
  name,
  muscles,
  steps,
  mistakes,
  youtube_url,
  active
)
values
  (
    'incline_db_press',
    'Наклонный жим гантелей',
    array['верх грудных мышц', 'трицепс', 'передняя дельта'],
    array[
      'Установи спинку скамьи под углом около 30 градусов.',
      'Прижми стопы к полу, сведи и опусти лопатки.',
      'Опускай гантели подконтрольно к верхней части груди, локти держи примерно под 45 градусов к корпусу.',
      'Выжимай гантели вверх и немного внутрь, сохраняя плечи прижатыми к скамье.'
    ],
    array[
      'Не ставь спинку слишком вертикально — нагрузка уйдёт в плечи.',
      'Не выводи плечи вперёд в верхней точке.',
      'Не отбивай гантели от груди и не сталкивай их сверху.'
    ],
    'https://www.youtube.com/watch?v=sK4Rvug6ufo',
    true
  ),
  (
    'lateral_raise',
    'Подъём гантелей в стороны',
    array['средняя дельта', 'надостная', 'верх трапеции как стабилизатор'],
    array[
      'Встань устойчиво, держи лёгкие гантели по бокам, локти слегка согнуты.',
      'Поднимай руки в стороны и чуть вперёд без движения корпусом.',
      'Остановись примерно на уровне плеч, сохраняя запястья нейтральными.',
      'Опускай гантели медленно и начинай следующий повтор без раскачки.'
    ],
    array[
      'Не поднимай плечи к ушам.',
      'Не раскачивай корпус и не забрасывай вес.',
      'Не поднимай кисти заметно выше локтей или выше уровня плеч.'
    ],
    'https://www.youtube.com/watch?v=3VcKaXpzqRo',
    true
  ),
  (
    'calf_raise',
    'Подъём на носки в Смите',
    array['икроножные', 'камбаловидные'],
    array[
      'Поставь переднюю часть стоп на устойчивую платформу, пятки оставь свободными.',
      'Расположи гриф на верхней части трапеций и держи корпус вертикально.',
      'Медленно опусти пятки до комфортного растяжения икр.',
      'Поднимись максимально высоко на носки, сделай короткую паузу и опустись под контролем.'
    ],
    array[
      'Не пружинь в нижней точке.',
      'Не сгибай и не разгибай колени во время повтора.',
      'Не ставь носки на самый край неустойчивой платформы.'
    ],
    'https://www.youtube.com/watch?v=K_jsGgztcGU',
    true
  )
on conflict (key) do update
set
  name = excluded.name,
  muscles = excluded.muscles,
  steps = excluded.steps,
  mistakes = excluded.mistakes,
  youtube_url = excluded.youtube_url,
  active = excluded.active,
  updated_at = now();

update public.workout_templates
set title = case code
  when 'A' then 'Грудь + ноги + спина'
  when 'B' then 'Верх груди + задняя цепь + спина'
  when 'C' then 'Дополнительная: всё тело'
end
where code in ('A', 'B', 'C');

delete from public.workout_template_items
where template_code in ('A', 'B', 'C');

insert into public.workout_template_items (
  template_code,
  exercise_key,
  sort_order,
  set_count,
  rep_target
)
values
  ('A', 'chest_press', 1, 4, '8–12'),
  ('A', 'leg_press', 2, 3, '8–12'),
  ('A', 'lat_pulldown', 3, 3, '8–12'),
  ('A', 'leg_curl', 4, 3, '10–15'),
  ('A', 'lateral_raise', 5, 3, '12–20'),
  ('A', 'biceps_curl', 6, 2, '10–15'),
  ('A', 'knee_raise', 7, 2, '10–15'),

  ('B', 'incline_db_press', 1, 4, '8–12'),
  ('B', 'rdl', 2, 3, '8–12'),
  ('B', 'seated_row', 3, 3, '8–12'),
  ('B', 'smith_squat', 4, 3, '8–12'),
  ('B', 'lateral_raise', 5, 3, '12–20'),
  ('B', 'triceps_pushdown', 6, 2, '10–15'),
  ('B', 'calf_raise', 7, 2, '12–20'),

  ('C', 'db_bench', 1, 3, '10–12'),
  ('C', 'lat_pulldown_close', 2, 3, '10–12'),
  ('C', 'leg_extension', 3, 3, '12–15'),
  ('C', 'leg_curl', 4, 3, '12–15'),
  ('C', 'shoulder_press', 5, 3, '8–12'),
  ('C', 'biceps_curl', 6, 2, '10–15'),
  ('C', 'triceps_pushdown', 7, 2, '10–15'),
  ('C', 'calf_raise', 8, 2, '12–20');

commit;
