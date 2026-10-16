-- Demo data (generated from the ДЗ6 seed.js). Run once on an empty database.
begin;

-- The seed sets tool statuses directly; the guard trigger allows that only with this flag.
select set_config('app.internal_status_change', 'on', true);

insert into public.categories(name) values
    ('Электроинструмент'),
    ('Ручной инструмент'),
    ('Измерительный инструмент'),
    ('Режущий инструмент'),
    ('Садовый инвентарь');

insert into public.tools(inv_number,name,category_id,manufacturer,purchase_date,price,location) values
    ('ИНВ-0001', 'Дрель ударная Bosch GSB 13 RE', 1, 'Bosch', '2023-03-14', 5200, 'Склад А, стеллаж 1'),
    ('ИНВ-0002', 'Шуруповёрт Makita DF330D', 1, 'Makita', '2023-05-02', 6900, 'Склад А, стеллаж 1'),
    ('ИНВ-0003', 'Перфоратор Metabo KHE 2660', 1, 'Metabo', '2022-11-21', 12400, 'Склад А, стеллаж 2'),
    ('ИНВ-0004', 'Угловая шлифмашина Hitachi G13', 1, 'Hitachi', '2021-09-10', 4800, 'Склад А, стеллаж 2'),
    ('ИНВ-0005', 'Набор отвёрток 12 предметов', 2, 'Stanley', '2024-01-15', 1450, 'Склад Б, ящик 3'),
    ('ИНВ-0006', 'Набор гаечных ключей 8–32 мм', 2, 'Gedore', '2022-06-30', 3480, 'Склад Б, ящик 3'),
    ('ИНВ-0007', 'Молоток слесарный 500 г', 2, 'Matrix', '2020-02-18', 600, 'Склад Б, ящик 1'),
    ('ИНВ-0008', 'Штангенциркуль цифровой 150 мм', 3, 'Mitutoyo', '2023-08-09', 4200, 'Склад А, шкаф 4'),
    ('ИНВ-0009', 'Лазерный дальномер Bosch GLM 40', 3, 'Bosch', '2023-10-01', 5600, 'Склад А, шкаф 4'),
    ('ИНВ-0010', 'Уровень строительный 80 см', 3, 'Kapro', '2021-04-12', 1400, 'Склад Б, ящик 2'),
    ('ИНВ-0011', 'Пила циркулярная Makita 5008MG', 4, 'Makita', '2022-03-03', 9800, 'Склад А, стеллаж 3'),
    ('ИНВ-0012', 'Лобзик электрический Bosch PST 700', 4, 'Bosch', '2023-02-25', 5600, 'Склад А, стеллаж 3'),
    ('ИНВ-0013', 'Секатор садовый Fiskars', 5, 'Fiskars', '2024-03-20', 1850, 'Склад В'),
    ('ИНВ-0014', 'Газонокосилка электрическая Gardena', 5, 'Gardena', '2022-05-05', 15200, 'Склад В');

insert into public.employees(full_name,position,department,phone) values
    ('Иванов Пётр Сергеевич', 'Слесарь', 'Ремонтный цех', '+7 900 111-22-33'),
    ('Петрова Анна Викторовна', 'Монтажник', 'Монтажный участок', '+7 900 222-33-44'),
    ('Сидоров Олег Николаевич', 'Электрик', 'Энергослужба', '+7 900 333-44-55'),
    ('Кузнецова Мария Андреевна', 'Монтажник', 'Монтажный участок', '+7 900 444-55-66'),
    ('Фаттахов Рустам Ильдарович', 'Разнорабочий', 'Хозяйственная служба', '+7 900 555-66-77');

-- Two open issues (one overdue) and one closed, relative to today.
insert into public.issues(tool_id, employee_id, issued_at, due_at, returned_at) values (1, 1, public.today_local() + -10, public.today_local() + -3, null);
insert into public.issues(tool_id, employee_id, issued_at, due_at, returned_at) values (3, 3, public.today_local() + -2, public.today_local() + 5, null);
insert into public.issues(tool_id, employee_id, issued_at, due_at, returned_at) values (5, 2, public.today_local() + -20, public.today_local() + -15, public.today_local() + -14);

update public.tools set status = 'issued' where id in (1, 3);
update public.tools set status = 'repair', note = 'Заменить патрон' where id = 4;

commit;

