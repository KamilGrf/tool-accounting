'use strict';
// Initial data. Idempotent: every block runs only when its table is empty.
//   - manager account: from MANAGER_LOGIN / MANAGER_PASSWORD (no default password in code)
//   - demo catalogue:  only when SEED_DEMO=true
const { hashPassword } = require('./auth');

async function seed(db, logger, env = process.env) {
    const usersCount = (await db.get('SELECT COUNT(*) AS n FROM users')).n;
    if (usersCount === 0) {
        if (!env.MANAGER_LOGIN || !env.MANAGER_PASSWORD) {
            logger.warn('no users and MANAGER_LOGIN / MANAGER_PASSWORD not set: nobody will be able to sign in as manager');
        } else {
            if (env.MANAGER_PASSWORD.length < 8 || env.MANAGER_PASSWORD === 'change-me') {
                throw new Error('MANAGER_PASSWORD must be at least 8 characters and not the example placeholder');
            }
            await db.run("INSERT INTO users(login, password_hash, role) VALUES ($1, $2, 'manager')",
                env.MANAGER_LOGIN, await hashPassword(env.MANAGER_PASSWORD));
            logger.info('manager account created', { login: env.MANAGER_LOGIN });
        }
    }

    if (env.SEED_DEMO !== 'true' || (await db.get('SELECT COUNT(*) AS n FROM categories')).n > 0) return;

    await db.transaction(async (tx) => {
        const cats = ['Электроинструмент', 'Ручной инструмент', 'Измерительный инструмент', 'Режущий инструмент', 'Садовый инвентарь'];
        for (const c of cats) await tx.run('INSERT INTO categories(name) VALUES ($1)', c);

        const tools = [
            ['ИНВ-0001', 'Дрель ударная Bosch GSB 13 RE', 1, 'Bosch', '2023-03-14', 5200, 'Склад А, стеллаж 1'],
            ['ИНВ-0002', 'Шуруповёрт Makita DF330D', 1, 'Makita', '2023-05-02', 6900, 'Склад А, стеллаж 1'],
            ['ИНВ-0003', 'Перфоратор Metabo KHE 2660', 1, 'Metabo', '2022-11-21', 12400, 'Склад А, стеллаж 2'],
            ['ИНВ-0004', 'Угловая шлифмашина Hitachi G13', 1, 'Hitachi', '2021-09-10', 4800, 'Склад А, стеллаж 2'],
            ['ИНВ-0005', 'Набор отвёрток 12 предметов', 2, 'Stanley', '2024-01-15', 1450, 'Склад Б, ящик 3'],
            ['ИНВ-0006', 'Набор гаечных ключей 8–32 мм', 2, 'Gedore', '2022-06-30', 3480, 'Склад Б, ящик 3'],
            ['ИНВ-0007', 'Молоток слесарный 500 г', 2, 'Matrix', '2020-02-18', 600, 'Склад Б, ящик 1'],
            ['ИНВ-0008', 'Штангенциркуль цифровой 150 мм', 3, 'Mitutoyo', '2023-08-09', 4200, 'Склад А, шкаф 4'],
            ['ИНВ-0009', 'Лазерный дальномер Bosch GLM 40', 3, 'Bosch', '2023-10-01', 5600, 'Склад А, шкаф 4'],
            ['ИНВ-0010', 'Уровень строительный 80 см', 3, 'Kapro', '2021-04-12', 1400, 'Склад Б, ящик 2'],
            ['ИНВ-0011', 'Пила циркулярная Makita 5008MG', 4, 'Makita', '2022-03-03', 9800, 'Склад А, стеллаж 3'],
            ['ИНВ-0012', 'Лобзик электрический Bosch PST 700', 4, 'Bosch', '2023-02-25', 5600, 'Склад А, стеллаж 3'],
            ['ИНВ-0013', 'Секатор садовый Fiskars', 5, 'Fiskars', '2024-03-20', 1850, 'Склад В'],
            ['ИНВ-0014', 'Газонокосилка электрическая Gardena', 5, 'Gardena', '2022-05-05', 15200, 'Склад В'],
        ];
        for (const t of tools) {
            await tx.run('INSERT INTO tools(inv_number,name,category_id,manufacturer,purchase_date,price,location) VALUES ($1,$2,$3,$4,$5,$6,$7)', ...t);
        }

        const staff = [
            ['Иванов Пётр Сергеевич', 'Слесарь', 'Ремонтный цех', '+7 900 111-22-33'],
            ['Петрова Анна Викторовна', 'Монтажник', 'Монтажный участок', '+7 900 222-33-44'],
            ['Сидоров Олег Николаевич', 'Электрик', 'Энергослужба', '+7 900 333-44-55'],
            ['Кузнецова Мария Андреевна', 'Монтажник', 'Монтажный участок', '+7 900 444-55-66'],
            ['Фаттахов Рустам Ильдарович', 'Разнорабочий', 'Хозяйственная служба', '+7 900 555-66-77'],
        ];
        for (const e of staff) await tx.run('INSERT INTO employees(full_name,position,department,phone) VALUES ($1,$2,$3,$4)', ...e);

        // Two open issues (one overdue) and one closed, relative to today.
        const issue = (tool, emp, fromDays, dueDays, retDays) => tx.run(
            `INSERT INTO issues(tool_id,employee_id,issued_at,due_at,returned_at)
             VALUES ($1,$2, CURRENT_DATE + $3::int, CURRENT_DATE + $4::int, CURRENT_DATE + $5::int)`,
            tool, emp, fromDays, dueDays, retDays);
        await issue(1, 1, -10, -3, null);
        await issue(3, 3, -2, 5, null);
        await issue(5, 2, -20, -15, -14);
        await tx.run("UPDATE tools SET status='issued' WHERE id IN (1,3)");
        await tx.run("UPDATE tools SET status='repair', note='Заменить патрон' WHERE id=4");
    });
    logger.info('demo data loaded');
}

module.exports = { seed };

if (require.main === module) {
    const { Database } = require('./db');
    const { createLogger } = require('./logger');
    const logger = createLogger();
    const db = new Database(process.env.DATABASE_URL);
    seed(db, logger)
        .then(() => db.close())
        .catch((err) => { logger.error('seed failed', { error: err.message }); process.exit(1); });
}
