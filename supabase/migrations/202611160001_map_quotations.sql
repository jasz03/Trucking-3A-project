alter table public.quotations drop constraint quotations_distance_source_check;
alter table public.quotations add constraint quotations_distance_source_check
  check (distance_source in ('manual', 'map_estimate'));
alter table public.quotations
  add column pickup_lat double precision,
  add column pickup_lon double precision,
  add column destination_lat double precision,
  add column destination_lon double precision;

create function public.create_map_quotation(
  p_customer text, p_pickup text, p_destination text, p_vehicle_type text, p_truck_count integer,
  p_distance_km numeric, p_pickup_at timestamptz, p_cargo text,
  p_fuel numeric, p_tolls numeric, p_labor numeric, p_allowances numeric,
  p_loading numeric, p_overnight numeric, p_other numeric, p_discount numeric,
  p_pickup_lat double precision, p_pickup_lon double precision,
  p_destination_lat double precision, p_destination_lon double precision
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_pickup_lat is null or p_pickup_lat not between -90 and 90 or
     p_destination_lat is null or p_destination_lat not between -90 and 90 or
     p_pickup_lon is null or p_pickup_lon not between -180 and 180 or
     p_destination_lon is null or p_destination_lon not between -180 and 180 then
    raise exception 'Invalid map coordinates';
  end if;
  v_id := public.create_quotation(p_customer, p_pickup, p_destination, p_vehicle_type, p_truck_count,
    p_distance_km, p_pickup_at, p_cargo, p_fuel, p_tolls, p_labor, p_allowances,
    p_loading, p_overnight, p_other, p_discount);
  update public.quotations set distance_source = 'map_estimate',
    pickup_lat = p_pickup_lat, pickup_lon = p_pickup_lon,
    destination_lat = p_destination_lat, destination_lon = p_destination_lon where id = v_id;
  update public.quotation_line_items set basis = 'Geoapify truck road estimate'
    where quotation_id = v_id and label = 'Distance';
  return v_id;
end;
$$;

revoke execute on function public.create_map_quotation(text,text,text,text,integer,numeric,timestamptz,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,double precision,double precision,double precision,double precision) from public, anon;
grant execute on function public.create_map_quotation(text,text,text,text,integer,numeric,timestamptz,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,double precision,double precision,double precision,double precision) to authenticated;
