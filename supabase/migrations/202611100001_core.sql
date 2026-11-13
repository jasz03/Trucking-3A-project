create type public.app_role as enum ('owner', 'administrator', 'fleet_manager', 'dispatcher', 'hr', 'driver');
create type public.vehicle_status as enum ('available', 'maintenance', 'inactive');
create type public.trip_status as enum ('assigned', 'accepted', 'in_transit', 'at_destination', 'completed', 'cancelled');
create type public.attendance_type as enum ('time_in', 'time_out', 'break_out', 'break_in', 'overtime_in', 'overtime_out');
create type public.review_status as enum ('pending', 'approved', 'rejected');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role public.app_role not null default 'driver',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create function public.create_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.create_profile();

create function public.has_role(allowed public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and active and role = any(allowed));
$$;

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  plate_number text not null unique check (length(trim(plate_number)) between 3 and 20),
  vehicle_type text not null check (length(trim(vehicle_type)) between 2 and 60),
  make_model text not null default '',
  capacity_kg numeric(10,2) check (capacity_kg > 0),
  status public.vehicle_status not null default 'available',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table public.drivers (
  id uuid primary key references public.profiles(id) on delete restrict,
  license_number text not null unique check (length(trim(license_number)) between 4 and 40),
  license_expires_on date not null,
  phone text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null check (length(trim(customer_name)) between 2 and 120),
  pickup_address text not null check (length(trim(pickup_address)) between 3 and 300),
  destination_address text not null check (length(trim(destination_address)) between 3 and 300),
  scheduled_at timestamptz not null,
  vehicle_id uuid not null references public.vehicles(id),
  driver_id uuid not null references public.drivers(id),
  status public.trip_status not null default 'assigned',
  cargo_details text not null default '',
  instructions text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index one_active_trip_per_vehicle on public.trips(vehicle_id)
  where status in ('assigned', 'accepted', 'in_transit', 'at_destination');
create unique index one_active_trip_per_driver on public.trips(driver_id)
  where status in ('assigned', 'accepted', 'in_transit', 'at_destination');
create index trips_schedule_idx on public.trips(scheduled_at desc);

create function public.guard_vehicle_availability() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'available' and old.status <> new.status and exists
    (select 1 from public.trips where vehicle_id = new.id and status in ('assigned','accepted','in_transit','at_destination'))
    then raise exception 'Truck has an active trip'; end if;
  return new;
end;
$$;
create trigger vehicle_availability before update on public.vehicles
for each row execute function public.guard_vehicle_availability();

create function public.guard_driver_availability() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.active and not new.active and exists
    (select 1 from public.trips where driver_id = new.id and status in ('assigned','accepted','in_transit','at_destination'))
    then raise exception 'Driver has an active trip'; end if;
  return new;
end;
$$;
create trigger driver_availability before update on public.drivers
for each row execute function public.guard_driver_availability();

create table public.trip_events (
  id bigint generated always as identity primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  status public.trip_status not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index trip_events_trip_idx on public.trip_events(trip_id, created_at);

create table public.tracking_sessions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id),
  driver_id uuid not null references public.drivers(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index one_open_tracking_session on public.tracking_sessions(trip_id) where ended_at is null;

create table public.location_points (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.tracking_sessions(id),
  trip_id uuid not null references public.trips(id),
  driver_id uuid not null references public.drivers(id),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision not null check (accuracy_m >= 0 and accuracy_m <= 10000),
  captured_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index location_trip_received_idx on public.location_points(trip_id, received_at desc);
create view public.latest_locations with (security_invoker = true) as
  select distinct on (trip_id) id, trip_id, latitude, longitude, accuracy_m, captured_at, received_at
  from public.location_points order by trip_id, received_at desc;

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  kind public.attendance_type not null,
  photo_path text not null unique,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision not null check (accuracy_m >= 0 and accuracy_m <= 10000),
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  client_ref uuid not null,
  review_status public.review_status not null default 'pending',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text not null default '',
  unique (employee_id, client_ref)
);
create index attendance_employee_received_idx on public.attendance(employee_id, received_at desc);

alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.drivers enable row level security;
alter table public.trips enable row level security;
alter table public.trip_events enable row level security;
alter table public.tracking_sessions enable row level security;
alter table public.location_points enable row level security;
alter table public.attendance enable row level security;

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.has_role(array['owner','administrator','fleet_manager','dispatcher','hr']::public.app_role[]));
create policy profiles_owner_update on public.profiles for update to authenticated
  using (public.has_role(array['owner']::public.app_role[]))
  with check (public.has_role(array['owner']::public.app_role[]));

create policy vehicles_read on public.vehicles for select to authenticated
  using (public.has_role(array['owner','administrator','fleet_manager','dispatcher']::public.app_role[])
    or exists (select 1 from public.trips t where t.vehicle_id = id and t.driver_id = (select auth.uid())));
create policy vehicles_manage on public.vehicles for all to authenticated
  using (public.has_role(array['owner','administrator','fleet_manager']::public.app_role[]))
  with check (public.has_role(array['owner','administrator','fleet_manager']::public.app_role[]));

create policy drivers_read on public.drivers for select to authenticated
  using (id = (select auth.uid()) or public.has_role(array['owner','administrator','fleet_manager','dispatcher','hr']::public.app_role[]));
create policy drivers_manage on public.drivers for all to authenticated
  using (public.has_role(array['owner','administrator','fleet_manager','hr']::public.app_role[]))
  with check (public.has_role(array['owner','administrator','fleet_manager','hr']::public.app_role[]));

create policy trips_read on public.trips for select to authenticated
  using (driver_id = (select auth.uid()) or public.has_role(array['owner','administrator','fleet_manager','dispatcher']::public.app_role[]));
create policy trip_events_read on public.trip_events for select to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id));
create policy sessions_read on public.tracking_sessions for select to authenticated
  using (driver_id = (select auth.uid()) or public.has_role(array['owner','administrator','fleet_manager','dispatcher']::public.app_role[]));
create policy points_read on public.location_points for select to authenticated
  using (driver_id = (select auth.uid()) or public.has_role(array['owner','administrator','fleet_manager','dispatcher']::public.app_role[]));
create policy attendance_read on public.attendance for select to authenticated
  using (employee_id = (select auth.uid()) or public.has_role(array['owner','administrator','hr']::public.app_role[]));

create function public.create_dispatch(p_customer text, p_pickup text, p_destination text,
  p_scheduled_at timestamptz, p_vehicle_id uuid, p_driver_id uuid, p_cargo text default '', p_instructions text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.has_role(array['owner','administrator','dispatcher']::public.app_role[]) then raise exception 'Not authorized'; end if;
  if length(trim(coalesce(p_customer,''))) < 2 or length(trim(coalesce(p_pickup,''))) < 3 or length(trim(coalesce(p_destination,''))) < 3 then raise exception 'Customer and addresses are required'; end if;
  if p_scheduled_at is null then raise exception 'Schedule is required'; end if;
  if not exists (select 1 from public.vehicles where id = p_vehicle_id and status = 'available') then raise exception 'Truck is unavailable'; end if;
  if not exists (select 1 from public.drivers d join public.profiles p on p.id = d.id where d.id = p_driver_id and d.active and p.active and p.role = 'driver' and d.license_expires_on >= (p_scheduled_at at time zone 'Asia/Manila')::date) then raise exception 'Driver is unavailable or license expired'; end if;
  insert into public.trips(customer_name, pickup_address, destination_address, scheduled_at, vehicle_id, driver_id, cargo_details, instructions, created_by)
  values (trim(p_customer), trim(p_pickup), trim(p_destination), p_scheduled_at, p_vehicle_id, p_driver_id, coalesce(p_cargo,''), coalesce(p_instructions,''), auth.uid()) returning id into v_id;
  insert into public.trip_events(trip_id, actor_id, status) values (v_id, auth.uid(), 'assigned');
  return v_id;
end;
$$;

create function public.driver_set_trip_status(p_trip_id uuid, p_status public.trip_status)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.trip_status;
begin
  if not public.has_role(array['driver']::public.app_role[]) then raise exception 'Driver account inactive'; end if;
  select status into v_old from public.trips where id = p_trip_id and driver_id = auth.uid() for update;
  if not found then raise exception 'Trip not assigned to you'; end if;
  if not ((v_old = 'assigned' and p_status = 'accepted') or
          (v_old = 'accepted' and p_status = 'in_transit') or
          (v_old = 'in_transit' and p_status = 'at_destination') or
          (v_old = 'at_destination' and p_status = 'completed')) then raise exception 'Invalid trip status transition'; end if;
  update public.trips set status = p_status, completed_at = case when p_status = 'completed' then now() else completed_at end where id = p_trip_id;
  if p_status = 'completed' then update public.tracking_sessions set ended_at = now() where trip_id = p_trip_id and ended_at is null; end if;
  insert into public.trip_events(trip_id, actor_id, status) values (p_trip_id, auth.uid(), p_status);
end;
$$;

create function public.start_tracking(p_trip_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.has_role(array['driver']::public.app_role[]) then raise exception 'Driver account inactive'; end if;
  if not exists (select 1 from public.trips where id = p_trip_id and driver_id = auth.uid() and status in ('assigned','accepted','in_transit','at_destination')) then raise exception 'No active assigned trip'; end if;
  insert into public.tracking_sessions(trip_id, driver_id) values (p_trip_id, auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create function public.stop_tracking(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.tracking_sessions set ended_at = now() where id = p_session_id and driver_id = auth.uid() and ended_at is null;
  if not found and not exists (select 1 from public.tracking_sessions where id = p_session_id and driver_id = auth.uid() and ended_at is not null) then raise exception 'No tracking session'; end if;
end;
$$;

create function public.cancel_trip(p_trip_id uuid, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role(array['owner','administrator','dispatcher']::public.app_role[]) then raise exception 'Not authorized'; end if;
  update public.trips set status = 'cancelled' where id = p_trip_id and status in ('assigned','accepted','in_transit','at_destination');
  if not found then raise exception 'Trip cannot be cancelled'; end if;
  update public.tracking_sessions set ended_at = now() where trip_id = p_trip_id and ended_at is null;
  insert into public.trip_events(trip_id, actor_id, status, note) values (p_trip_id, auth.uid(), 'cancelled', coalesce(p_note,''));
end;
$$;

create function public.report_location(p_session_id uuid, p_latitude double precision, p_longitude double precision,
  p_accuracy_m double precision, p_captured_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid;
begin
  if not public.has_role(array['driver']::public.app_role[]) then raise exception 'Driver account inactive'; end if;
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 or p_accuracy_m not between 0 and 10000 or p_captured_at is null then raise exception 'Invalid location'; end if;
  if p_captured_at > now() + interval '5 minutes' or p_captured_at < now() - interval '7 days' then raise exception 'Capture time outside accepted range'; end if;
  select s.trip_id into v_trip_id from public.tracking_sessions s join public.trips t on t.id = s.trip_id
    where s.id = p_session_id and s.driver_id = auth.uid() and s.ended_at is null and t.driver_id = auth.uid()
      and t.status in ('assigned','accepted','in_transit','at_destination') for update of s;
  if not found then raise exception 'Tracking session is not active'; end if;
  insert into public.location_points(session_id, trip_id, driver_id, latitude, longitude, accuracy_m, captured_at)
  values (p_session_id, v_trip_id, auth.uid(), p_latitude, p_longitude, p_accuracy_m, p_captured_at);
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attendance-photos', 'attendance-photos', false, 5242880, array['image/jpeg','image/png','image/webp']);
create policy attendance_photo_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'attendance-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.]jpg$'
    and public.has_role(array['owner','administrator','fleet_manager','dispatcher','hr','driver']::public.app_role[]));
create policy attendance_photo_read on storage.objects for select to authenticated
  using (bucket_id = 'attendance-photos' and public.has_role(array['owner','administrator','fleet_manager','dispatcher','hr','driver']::public.app_role[])
    and ((storage.foldername(name))[1] = (select auth.uid())::text
    or public.has_role(array['owner','administrator','hr']::public.app_role[])));

create function public.submit_attendance(p_kind public.attendance_type, p_photo_path text,
  p_latitude double precision, p_longitude double precision, p_accuracy_m double precision,
  p_captured_at timestamptz, p_client_ref uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and active) then raise exception 'Inactive user'; end if;
  if p_kind is null or p_client_ref is null or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 or p_accuracy_m not between 0 and 10000 then raise exception 'Invalid attendance data'; end if;
  if p_captured_at is null or p_captured_at > now() + interval '5 minutes' or p_captured_at < now() - interval '7 days' then raise exception 'Capture time outside accepted range'; end if;
  if split_part(p_photo_path, '/', 1) <> auth.uid()::text or not exists
    (select 1 from storage.objects where bucket_id = 'attendance-photos' and name = p_photo_path)
    then raise exception 'Attendance photo is missing'; end if;
  select id into v_id from public.attendance where employee_id = auth.uid() and client_ref = p_client_ref;
  if found then return v_id; end if;
  if exists (select 1 from public.attendance where employee_id = auth.uid() and kind = p_kind and received_at > now() - interval '60 seconds') then raise exception 'Duplicate attendance submission'; end if;
  insert into public.attendance(employee_id, kind, photo_path, latitude, longitude, accuracy_m, captured_at, client_ref)
  values (auth.uid(), p_kind, p_photo_path, p_latitude, p_longitude, p_accuracy_m, p_captured_at, p_client_ref) returning id into v_id;
  return v_id;
end;
$$;

create function public.review_attendance(p_id uuid, p_status public.review_status, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role(array['owner','administrator','hr']::public.app_role[]) then raise exception 'Not authorized'; end if;
  if p_status not in ('approved','rejected') then raise exception 'Review must approve or reject'; end if;
  update public.attendance set review_status = p_status, reviewed_by = auth.uid(), reviewed_at = now(), review_note = coalesce(p_note,'')
  where id = p_id and review_status = 'pending';
  if not found then raise exception 'Attendance is not pending'; end if;
end;
$$;

revoke execute on function public.has_role(public.app_role[]) from public, anon;
revoke execute on function public.create_dispatch(text,text,text,timestamptz,uuid,uuid,text,text) from public, anon;
revoke execute on function public.driver_set_trip_status(uuid,public.trip_status) from public, anon;
revoke execute on function public.start_tracking(uuid) from public, anon;
revoke execute on function public.stop_tracking(uuid) from public, anon;
revoke execute on function public.cancel_trip(uuid,text) from public, anon;
revoke execute on function public.report_location(uuid,double precision,double precision,double precision,timestamptz) from public, anon;
revoke execute on function public.submit_attendance(public.attendance_type,text,double precision,double precision,double precision,timestamptz,uuid) from public, anon;
revoke execute on function public.review_attendance(uuid,public.review_status,text) from public, anon;
grant execute on function public.has_role(public.app_role[]) to authenticated;
grant execute on function public.create_dispatch(text,text,text,timestamptz,uuid,uuid,text,text) to authenticated;
grant execute on function public.driver_set_trip_status(uuid,public.trip_status) to authenticated;
grant execute on function public.start_tracking(uuid) to authenticated;
grant execute on function public.stop_tracking(uuid) to authenticated;
grant execute on function public.cancel_trip(uuid,text) to authenticated;
grant execute on function public.report_location(uuid,double precision,double precision,double precision,timestamptz) to authenticated;
grant execute on function public.submit_attendance(public.attendance_type,text,double precision,double precision,double precision,timestamptz,uuid) to authenticated;
grant execute on function public.review_attendance(uuid,public.review_status,text) to authenticated;

revoke all on public.profiles, public.vehicles, public.drivers, public.trips, public.trip_events,
  public.tracking_sessions, public.location_points, public.attendance from anon, authenticated;
grant select on public.profiles, public.vehicles, public.drivers, public.trips, public.trip_events,
  public.tracking_sessions, public.location_points, public.attendance, public.latest_locations to authenticated;
grant update on public.profiles to authenticated;
grant insert, update on public.vehicles, public.drivers to authenticated;
