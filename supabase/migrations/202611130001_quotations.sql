create type public.quotation_status as enum ('draft', 'pending_approval', 'approved', 'sent', 'accepted', 'rejected', 'converted');

create table public.rate_cards (
  id uuid primary key default gen_random_uuid(),
  vehicle_type text not null unique check (length(trim(vehicle_type)) between 2 and 60),
  base_charge numeric(14,2) not null check (base_charge >= 0),
  rate_per_km numeric(14,2) not null check (rate_per_km >= 0),
  margin_pct numeric(6,2) not null check (margin_pct between 0 and 100),
  tax_pct numeric(6,2) not null check (tax_pct between 0 and 100),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create sequence public.quotation_number_seq;
create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  quotation_number text not null unique,
  customer_name text not null check (length(trim(customer_name)) between 2 and 120),
  pickup_address text not null check (length(trim(pickup_address)) between 3 and 300),
  destination_address text not null check (length(trim(destination_address)) between 3 and 300),
  pickup_at timestamptz not null,
  cargo_details text not null default '',
  vehicle_type text not null,
  truck_count integer not null check (truck_count between 1 and 50),
  distance_km numeric(10,2) not null check (distance_km > 0),
  distance_source text not null default 'manual' check (distance_source = 'manual'),
  rate_card_id uuid not null references public.rate_cards(id),
  base_charge numeric(14,2) not null,
  rate_per_km numeric(14,2) not null,
  margin_pct numeric(6,2) not null,
  tax_pct numeric(6,2) not null,
  estimated_cost numeric(14,2) not null check (estimated_cost >= 0),
  margin_amount numeric(14,2) not null check (margin_amount >= 0),
  tax_amount numeric(14,2) not null check (tax_amount >= 0),
  discount_amount numeric(14,2) not null check (discount_amount >= 0),
  total numeric(14,2) not null check (total >= 0),
  status public.quotation_status not null default 'draft',
  created_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  converted_at timestamptz
);
create index quotations_created_idx on public.quotations(created_at desc);

create table public.quotation_line_items (
  id bigint generated always as identity primary key,
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  label text not null,
  amount_per_truck numeric(14,2) not null check (amount_per_truck >= 0),
  amount_total numeric(14,2) not null check (amount_total >= 0),
  basis text not null default 'manual estimate'
);
create index quotation_lines_quote_idx on public.quotation_line_items(quotation_id);

create table public.quotation_events (
  id bigint generated always as identity primary key,
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  status public.quotation_status not null,
  created_at timestamptz not null default now()
);
create index quotation_events_quote_idx on public.quotation_events(quotation_id, created_at);

alter table public.trips add column quotation_id uuid references public.quotations(id);
create index trips_quotation_idx on public.trips(quotation_id) where quotation_id is not null;

alter table public.rate_cards enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_line_items enable row level security;
alter table public.quotation_events enable row level security;

create policy rates_read on public.rate_cards for select to authenticated
  using (public.has_role(array['owner','administrator','dispatcher']::public.app_role[]));
create policy rates_manage on public.rate_cards for all to authenticated
  using (public.has_role(array['owner','administrator']::public.app_role[]))
  with check (public.has_role(array['owner','administrator']::public.app_role[]));
create policy quotations_read on public.quotations for select to authenticated
  using (public.has_role(array['owner','administrator','dispatcher']::public.app_role[]));
create policy quote_lines_read on public.quotation_line_items for select to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id));
create policy quote_events_read on public.quotation_events for select to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id));

create function public.create_quotation(
  p_customer text, p_pickup text, p_destination text, p_vehicle_type text, p_truck_count integer,
  p_distance_km numeric, p_pickup_at timestamptz, p_cargo text,
  p_fuel numeric, p_tolls numeric, p_labor numeric, p_allowances numeric,
  p_loading numeric, p_overnight numeric, p_other numeric, p_discount numeric
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_rate public.rate_cards%rowtype;
  v_id uuid;
  v_cost_one numeric(14,2);
  v_cost numeric(14,2);
  v_margin numeric(14,2);
  v_tax numeric(14,2);
  v_total numeric(14,2);
  v_number text;
begin
  if not public.has_role(array['owner','administrator','dispatcher']::public.app_role[]) then raise exception 'Not authorized'; end if;
  if length(trim(coalesce(p_customer,''))) < 2 or length(trim(coalesce(p_pickup,''))) < 3 or length(trim(coalesce(p_destination,''))) < 3 or p_pickup_at is null then raise exception 'Customer, route, and pickup date are required'; end if;
  if p_truck_count is null or p_truck_count not between 1 and 50 or p_distance_km is null or p_distance_km <= 0 then raise exception 'Truck count and distance must be positive'; end if;
  if p_fuel is null or p_tolls is null or p_labor is null or p_allowances is null or p_loading is null or p_overnight is null or p_other is null or p_discount is null
    or least(p_fuel,p_tolls,p_labor,p_allowances,p_loading,p_overnight,p_other,p_discount) < 0 then raise exception 'Costs and discount must be nonnegative'; end if;
  select * into v_rate from public.rate_cards where vehicle_type = trim(p_vehicle_type) and active;
  if not found then raise exception 'No active rate card for this truck type'; end if;
  v_cost_one := round(v_rate.base_charge + p_distance_km * v_rate.rate_per_km + p_fuel + p_tolls + p_labor + p_allowances + p_loading + p_overnight + p_other, 2);
  v_cost := round(v_cost_one * p_truck_count, 2);
  v_margin := round(v_cost * v_rate.margin_pct / 100, 2);
  v_tax := round((v_cost + v_margin) * v_rate.tax_pct / 100, 2);
  v_total := v_cost + v_margin + v_tax - p_discount;
  if v_total < 0 then raise exception 'Discount exceeds quoted price'; end if;
  v_number := 'Q-' || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-' || lpad(nextval('public.quotation_number_seq')::text, 6, '0');
  insert into public.quotations(quotation_number, customer_name, pickup_address, destination_address, pickup_at, cargo_details,
    vehicle_type, truck_count, distance_km, rate_card_id, base_charge, rate_per_km, margin_pct, tax_pct,
    estimated_cost, margin_amount, tax_amount, discount_amount, total, created_by)
  values (v_number, trim(p_customer), trim(p_pickup), trim(p_destination), p_pickup_at, coalesce(p_cargo,''),
    v_rate.vehicle_type, p_truck_count, p_distance_km, v_rate.id, v_rate.base_charge, v_rate.rate_per_km, v_rate.margin_pct, v_rate.tax_pct,
    v_cost, v_margin, v_tax, p_discount, v_total, auth.uid()) returning id into v_id;
  insert into public.quotation_line_items(quotation_id,label,amount_per_truck,amount_total,basis)
  values
    (v_id,'Base transportation',v_rate.base_charge,v_rate.base_charge*p_truck_count,'rate card'),
    (v_id,'Distance',round(p_distance_km*v_rate.rate_per_km,2),round(p_distance_km*v_rate.rate_per_km*p_truck_count,2),'manual distance estimate'),
    (v_id,'Fuel',p_fuel,p_fuel*p_truck_count,'manual estimate'),
    (v_id,'Tolls',p_tolls,p_tolls*p_truck_count,'manual estimate'),
    (v_id,'Labor',p_labor,p_labor*p_truck_count,'manual estimate'),
    (v_id,'Driver allowances',p_allowances,p_allowances*p_truck_count,'manual estimate'),
    (v_id,'Loading and unloading',p_loading,p_loading*p_truck_count,'manual estimate'),
    (v_id,'Overnight',p_overnight,p_overnight*p_truck_count,'manual estimate'),
    (v_id,'Other',p_other,p_other*p_truck_count,'manual estimate');
  insert into public.quotation_events(quotation_id,actor_id,status) values (v_id,auth.uid(),'draft');
  return v_id;
end;
$$;

create function public.transition_quotation(p_id uuid, p_status public.quotation_status)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.quotation_status;
begin
  if not public.has_role(array['owner','administrator','dispatcher']::public.app_role[]) then raise exception 'Not authorized'; end if;
  select status into v_old from public.quotations where id = p_id for update;
  if not found then raise exception 'Quotation not found'; end if;
  if not ((v_old = 'draft' and p_status = 'pending_approval') or
    (v_old = 'pending_approval' and p_status = 'approved' and public.has_role(array['owner','administrator']::public.app_role[])) or
    (v_old = 'approved' and p_status = 'sent') or
    (v_old = 'sent' and p_status in ('accepted','rejected'))) then raise exception 'Invalid quote transition'; end if;
  update public.quotations set status = p_status,
    approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
    approved_at = case when p_status = 'approved' then now() else approved_at end
    where id = p_id;
  insert into public.quotation_events(quotation_id,actor_id,status) values (p_id,auth.uid(),p_status);
end;
$$;

create function public.convert_quotation(p_id uuid, p_vehicle_ids uuid[], p_driver_ids uuid[])
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare v_quote public.quotations%rowtype; v_trip uuid; v_trips uuid[] := '{}'::uuid[]; v_index integer;
begin
  if not public.has_role(array['owner','administrator','dispatcher']::public.app_role[]) then raise exception 'Not authorized'; end if;
  select * into v_quote from public.quotations where id = p_id for update;
  if not found or v_quote.status <> 'accepted' then raise exception 'Quotation is not accepted'; end if;
  if coalesce(array_length(p_vehicle_ids,1),0) <> v_quote.truck_count or coalesce(array_length(p_driver_ids,1),0) <> v_quote.truck_count then raise exception 'One truck and driver required per quoted truck'; end if;
  for v_index in 1..v_quote.truck_count loop
    if not exists (select 1 from public.vehicles where id = p_vehicle_ids[v_index] and vehicle_type = v_quote.vehicle_type) then raise exception 'Truck type does not match quotation'; end if;
    v_trip := public.create_dispatch(v_quote.customer_name,v_quote.pickup_address,v_quote.destination_address,
      v_quote.pickup_at,p_vehicle_ids[v_index],p_driver_ids[v_index],v_quote.cargo_details,'Converted from quotation ' || v_quote.quotation_number);
    update public.trips set quotation_id = p_id where id = v_trip;
    v_trips := array_append(v_trips,v_trip);
  end loop;
  update public.quotations set status = 'converted', converted_at = now() where id = p_id;
  insert into public.quotation_events(quotation_id,actor_id,status) values (p_id,auth.uid(),'converted');
  return v_trips;
end;
$$;

revoke all on public.rate_cards, public.quotations, public.quotation_line_items, public.quotation_events from anon, authenticated;
grant select on public.rate_cards, public.quotations, public.quotation_line_items, public.quotation_events to authenticated;
grant insert, update on public.rate_cards to authenticated;
revoke execute on function public.create_quotation(text,text,text,text,integer,numeric,timestamptz,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) from public, anon;
revoke execute on function public.transition_quotation(uuid,public.quotation_status) from public, anon;
revoke execute on function public.convert_quotation(uuid,uuid[],uuid[]) from public, anon;
grant execute on function public.create_quotation(text,text,text,text,integer,numeric,timestamptz,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) to authenticated;
grant execute on function public.transition_quotation(uuid,public.quotation_status) to authenticated;
grant execute on function public.convert_quotation(uuid,uuid[],uuid[]) to authenticated;
