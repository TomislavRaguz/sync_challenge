import knex, { Knex } from 'knex'
import { subMonths, endOfMonth, format } from 'date-fns'

const NUM_TRANSACTIONS = 1000000;

async function main() {
  let syncDB: any = null;
  try {
    const syncDB = await setupDB()
    const userId = 1;
    const endOfLastMonth = subMonths(endOfMonth(new Date()), 1)
    const months = [endOfLastMonth];
    for(let i = 1; i < 12; i++) {
      months.push(subMonths(endOfLastMonth, i))
    }
    const perAccountBalanceQuery = syncDB.raw(`
    SELECT *
    FROM crosstab('
    select id as account_id, to_char(month, ''YYYY-MM'') as d_month, coalesce((
      select sum(amount)
      from "transaction" t 
      where t.user_source_id = user_source.id and t.transaction_time < month
    ), 0) as balance
    from user_source 
    join (
      select * from (VALUES ${months.map(month => `(''${format(month, 'yyyy-MM-dd HH:mm:ss.SSS')}''::timestamp)`)}) months("month")
    ) months on true
    where user_source.user_id = ${userId}
    order by 1,2 desc
    ')
    AS final_result(account_id int, ${months.map(month => `"${format(month, 'yyyy-MM')}" numeric`)});
    `)
    console.log(perAccountBalanceQuery.toString())
    const start = +new Date();
    const perAccountBalance = await perAccountBalanceQuery;
    console.log(`Account query finished in: ${+new Date() - start} ms.`)
    console.log('perAccountBalance', perAccountBalance.rows)
    syncDB.destroy()
  } catch (e) {
    console.log(e)
    if(syncDB) syncDB.destory()
  }
}
main()

async function setupDB() {
  const appPG = knex({
    client: 'postgresql',
      connection: {
        port: 5432,
        host: 'localhost',
        //database: process.env.DATABASE_NAME,
        user: 'postgres',
        password: 'root',
      }
  })
  const syncDBExists = await appPG.raw(`
  select exists(
    SELECT datname FROM pg_catalog.pg_database WHERE datname = 'sync'
   );
  `)
  if(syncDBExists.rows[0].exists) {
    appPG.destroy();
    return knex({
      client: 'postgresql',
        connection: {
          port: 5432,
          host: 'localhost',
          database: 'sync',
          user: 'postgres',
          password: 'root',
        }
    })
  }
  
  await appPG.raw('CREATE DATABASE sync')
  await appPG.destroy()
  const syncDB = knex({
    client: 'postgresql',
      connection: {
        port: 5432,
        host: 'localhost',
        database: 'sync',
        user: 'postgres',
        password: 'root',
      }
  })
  await syncDB.raw('create extension tablefunc;')
  await syncDB.raw(`
  CREATE TABLE "user" (
    id serial PRIMARY KEY
  )
  `)
  await syncDB.raw(`
  CREATE TABLE "source_type" (
    id int4 PRIMARY KEY,
    label varchar(255) NOT NULL
  )
  `)
  await syncDB.raw(`
  CREATE TABLE "user_source" (
    id serial PRIMARY KEY,
    user_id int4 NOT NULL REFERENCES "user" (id),
    source_type_id int4 NOT NULL REFERENCES "source_type" (id),
    source_denorm_data varchar(65355) NOT NULL 
  )`)
  await syncDB.raw(`
  CREATE TABLE "transaction" (
    id serial PRIMARY KEY,
    user_source_id int4 NOT NULL REFERENCES "user_source" (id),
    amount numeric(12,3) NOT NULL,
    transaction_time timestamptz NOT NULL
  )`)
  await syncDB.raw(`
  ALTER TABLE user_source
  ADD COLUMN last_sync_time timestamptz NOT NULL
  `)
  await syncDB.raw(`CREATE INDEX ON "transaction" (user_source_id, transaction_time)`)
  await seedDB(syncDB)
  return syncDB;
}

async function seedDB(syncDB: Knex) {
  await syncDB.raw(`SET session_replication_role = 'replica'`)
  for(let i = 0; i < 100; i++) {
    const userArr: Array<{}> = []
    for(let y = 0; y < 1000; y++) {
      userArr.push({ id: syncDB.raw('DEFAULT') })
    }
    await syncDB("user").insert(userArr)
  }

  await syncDB('source_type').insert([
    { id: 1, label: "bank of America" },
    { id: 2, label: "bank of Congo" },
    { id: 3, label: "bank of Croatia" },
    { id: 4, label: "bank of Romania" },
    { id: 5, label: "bank of Nepal" },
    { id: 6, label: "bank of Tajikistan" },
    { id: 7, label: "bank of Whanganui" },
    { id: 8, label: "bank of France" },
    { id: 9, label: "bank of Guinea-bissau" },
    { id: 10, label: "bank of Costa Rica" },
  ])

  let userSourceArr: Array<{
    user_id: number
    source_type_id: number
    source_denorm_data: string
    last_sync_time: Date
  }> = []
  for(let  i = 1; i <= 100000; i++) {
    for(let y = 1; y <= 10; y++) {
      userSourceArr.push({ 
        last_sync_time: new Date(),
        source_denorm_data: "",
        user_id: i,
        source_type_id: y
      })
    }
    if(i%100 === 0) {
      await syncDB('user_source').insert(userSourceArr)
      userSourceArr = [];
    }
  }

  let transactionArr: Array<{
    user_source_id: number
    amount: number
    transaction_time: Date
  }> = [];
  for(let i = 1; i <= NUM_TRANSACTIONS; i++) {
    transactionArr.push({
      user_source_id: getRandomInt(1, 1000000),
      amount: getRandomInt(1, 100000000),
      transaction_time: new Date(+new Date() - getRandomInt(1, 31536000000)) //sometime in last year
    })
    if(i%10000) {
      await syncDB('transaction').insert(transactionArr)
      transactionArr = []
    }
  }
  await syncDB.raw(`SET session_replication_role = 'origin'`)
}

function getRandomInt(min: number, max: number) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}