import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`
  create role authenticated;
  create role anon;
  create schema auth;
  create schema storage;
  create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}', email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id bigint generated always as identity primary key, bucket_id text, name text, metadata jsonb);
  create function storage.foldername(path text) returns text[] language sql immutable as $$ select string_to_array(path, '/') $$;
`);
await db.exec(readFileSync(new URL('../supabase/migrations/202611100001_core.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/202611130001_quotations.sql', import.meta.url), 'utf8'));
await db.exec(`
  grant usage on schema public, auth, storage to authenticated;
  grant select, insert on storage.objects to authenticated;
  alter table storage.objects enable row level security;
`);

const owner = '00000000-0000-4000-8000-000000000001';
const driver = '00000000-0000-4000-8000-000000000002';
const stranger = '00000000-0000-4000-8000-000000000003';
const dispatcher = '00000000-0000-4000-8000-000000000004';
await db.query(`insert into auth.users(id, raw_user_meta_data, email) values
  ($1, '{"full_name":"Owner"}', 'owner@example.com'),
  ($2, '{"full_name":"Driver"}', 'driver@example.com'),
  ($3, '{"full_name":"Stranger"}', 'stranger@example.com'),
  ($4, '{"full_name":"Dispatcher"}', 'dispatch@example.com')`, [owner, driver, stranger, dispatcher]);
await db.query(`update public.profiles set role = 'owner' where id = $1`, [owner]);
await db.query(`update public.profiles set role = 'dispatcher' where id = $1`, [dispatcher]);
const truck = (await db.query(`insert into public.vehicles(plate_number, vehicle_type) values ('ABC 1234','10-wheeler') returning id`)).rows[0].id;
await db.query(`insert into public.drivers(id, license_number, license_expires_on) values ($1,'N01-23-456789','2030-01-01')`, [driver]);

async function as(userId, operation) {
  await db.exec(`set role authenticated;`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  try { return await operation(); } finally { await db.exec(`reset role;`); }
}

const trip = await as(owner, async () => {
  const result = await db.query(`select public.create_dispatch($1,$2,$3,$4,$5,$6) as id`, ['Acme Logistics', 'Manila Port', 'Quezon City Hub', '2026-11-20T02:00:00Z', truck, driver]);
  return result.rows[0].id;
});
await as(owner, async () => {
  await assert.rejects(db.query(`select public.create_dispatch($1,$2,$3,$4,$5,$6)`, ['Another Client', 'Manila Port', 'Cavite Depot', '2026-11-21T02:00:00Z', truck, driver]), /duplicate key|already exists/i);
  await assert.rejects(db.query(`update public.vehicles set status = 'maintenance' where id = $1`, [truck]), /active trip/i);
  await assert.rejects(db.query(`update public.drivers set active = false where id = $1`, [driver]), /active trip/i);
});
await as(stranger, async () => {
  assert.equal((await db.query(`select id from public.trips`)).rows.length, 0, 'other drivers must not see trips');
  await assert.rejects(db.query(`select public.start_tracking($1)`, [trip]), /No active assigned trip|Driver account inactive/i);
  await assert.rejects(db.query(`insert into public.trips(customer_name,pickup_address,destination_address,scheduled_at,vehicle_id,driver_id,created_by) values ('Fake Client','Manila Port','Cavite Depot',now(),$1,$2,$3)`, [truck, driver, stranger]), /permission denied/i);
  await assert.rejects(db.query(`insert into storage.objects(bucket_id,name) values ('attendance-photos',$1)`, [`${driver}/stolen.jpg`]), /row-level security/i);
});

const session = await as(driver, async () => {
  assert.equal((await db.query(`select id from public.trips`)).rows.length, 1);
  const id = (await db.query(`select public.start_tracking($1) as id`, [trip])).rows[0].id;
  await db.query(`select public.report_location($1,14.60,121.04,12,now())`, [id]);
  return id;
});
await as(driver, async () => {
  await db.query(`select public.stop_tracking($1)`, [session]);
  await assert.rejects(db.query(`select public.report_location($1,14.60,121.04,12,now())`, [session]), /not active/i);
});

const photo = `${driver}/33333333-3333-4333-8333-333333333333.jpg`;
await as(driver, async () => await db.query(`insert into storage.objects(bucket_id,name) values ('attendance-photos',$1)`, [photo]));
await as(driver, async () => {
  const ref = '11111111-1111-4111-8111-111111111111';
  const first = (await db.query(`select public.submit_attendance('time_in',$1,14.60,121.04,12,now(),$2) as id`, [photo, ref])).rows[0].id;
  const again = (await db.query(`select public.submit_attendance('time_in',$1,14.60,121.04,12,now(),$2) as id`, [photo, ref])).rows[0].id;
  assert.equal(first, again, 'same client reference must be idempotent');
  await assert.rejects(db.query(`select public.submit_attendance('time_out',$1,14.60,121.04,12,now(),$2)`, [`${owner}/other.jpg`, '22222222-2222-4222-8222-222222222222']), /photo is missing/i);
  await assert.rejects(db.query(`select public.review_attendance($1,'approved')`, [first]), /Not authorized/i);
});
await as(stranger, async () => assert.equal((await db.query(`select id from public.attendance`)).rows.length, 0, 'other employees must not see attendance'));
await as(stranger, async () => await assert.rejects(db.query(`select public.cancel_trip($1)`, [trip]), /Not authorized/i));
await as(owner, async () => {
  const id = (await db.query(`select id from public.attendance`)).rows[0].id;
  await db.query(`select public.review_attendance($1,'approved')`, [id]);
  assert.equal((await db.query(`select review_status from public.attendance where id = $1`, [id])).rows[0].review_status, 'approved');
  await db.query(`select public.cancel_trip($1, 'Test correction')`, [trip]);
  assert.equal((await db.query(`select status from public.trips where id = $1`, [trip])).rows[0].status, 'cancelled');
  const replacement = await db.query(`select public.create_dispatch($1,$2,$3,$4,$5,$6) as id`, ['Replacement Client', 'Manila Port', 'Cavite Depot', '2026-11-22T02:00:00Z', truck, driver]);
  assert.ok(replacement.rows[0].id, 'cancelled assignment must release truck and driver');
});

const secondTruck = (await db.query(`insert into public.vehicles(plate_number, vehicle_type) values ('XYZ 5678','10-wheeler') returning id`)).rows[0].id;
await db.query(`insert into public.drivers(id, license_number, license_expires_on) values ($1,'N02-23-456789','2030-01-01')`, [stranger]);
await as(owner, async () => {
  await db.query(`insert into public.rate_cards(vehicle_type,base_charge,rate_per_km,margin_pct,tax_pct) values ('10-wheeler',1000,25,10,12)`);
});
const quote = await as(owner, async () => {
  const result = await db.query(`select public.create_quotation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) as id`,
    ['Acme Logistics','Manila Port','Cavite Depot','10-wheeler',2,100,'2026-11-25T02:00:00Z','Boxes',400,100,200,50,75,0,25,0]);
  const id = result.rows[0].id;
  const saved = (await db.query(`select estimated_cost,margin_amount,tax_amount,total from public.quotations where id = $1`, [id])).rows[0];
  assert.equal(Number(saved.estimated_cost), 8700);
  assert.equal(Number(saved.margin_amount), 870);
  assert.equal(Number(saved.tax_amount), 1148.4);
  assert.equal(Number(saved.total), 10718.4);
  await db.query(`update public.rate_cards set rate_per_km = 40 where vehicle_type = '10-wheeler'`);
  assert.equal(Number((await db.query(`select total from public.quotations where id = $1`, [id])).rows[0].total), 10718.4, 'rate changes must not alter quote snapshots');
  return id;
});
await as(driver, async () => await assert.rejects(db.query(`select public.transition_quotation($1,'approved')`, [quote]), /Not authorized|Invalid quote transition/i));
await as(dispatcher, async () => {
  await assert.rejects(db.query(`update public.quotations set status = 'approved' where id = $1`, [quote]), /permission denied/i);
  await assert.rejects(db.query(`select public.create_quotation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    ['Acme Logistics','Manila Port','Cavite Depot','10-wheeler',1,0,'2026-11-25T02:00:00Z','',0,0,0,0,0,0,0,0]), /positive/i);
  await assert.rejects(db.query(`select public.create_quotation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    ['Acme Logistics','Manila Port','Cavite Depot','10-wheeler',1,100,'2026-11-25T02:00:00Z','',-1,0,0,0,0,0,0,0]), /nonnegative/i);
  await db.query(`select public.transition_quotation($1,'pending_approval')`, [quote]);
  await assert.rejects(db.query(`select public.transition_quotation($1,'approved')`, [quote]), /Invalid quote transition/i);
});
await as(owner, async () => {
  for (const status of ['approved','sent','accepted']) await db.query(`select public.transition_quotation($1,$2::public.quotation_status)`, [quote, status]);
  const active = (await db.query(`select id from public.trips where status = 'assigned'`)).rows[0].id;
  await db.query(`select public.cancel_trip($1)`, [active]);
  await assert.rejects(db.query(`select public.convert_quotation($1,$2::uuid[],$3::uuid[])`, [quote, [truck, truck], [driver, stranger]]), /duplicate key|already exists/i);
  assert.equal((await db.query(`select id from public.trips where quotation_id = $1`, [quote])).rows.length, 0, 'failed multi-truck conversion must roll back');
  const converted = await db.query(`select public.convert_quotation($1,$2::uuid[],$3::uuid[]) as ids`, [quote, [truck, secondTruck], [driver, stranger]]);
  assert.equal(converted.rows[0].ids.length, 2);
  await assert.rejects(db.query(`select public.convert_quotation($1,$2::uuid[],$3::uuid[])`, [quote, [truck, secondTruck], [driver, stranger]]), /not accepted/i);
});
await db.close();
console.log('Database migration and core access checks passed.');
