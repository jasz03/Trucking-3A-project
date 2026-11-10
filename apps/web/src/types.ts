export type Role =
  "owner" | "administrator" | "fleet_manager" | "dispatcher" | "hr" | "driver";
export type Profile = {
  id: string;
  full_name: string;
  role: Role;
  active: boolean;
};
export type Vehicle = {
  id: string;
  plate_number: string;
  vehicle_type: string;
  make_model: string;
  capacity_kg: number | null;
  status: "available" | "maintenance" | "inactive";
  notes: string;
};
export type Driver = {
  id: string;
  license_number: string;
  license_expires_on: string;
  phone: string;
  active: boolean;
};
export type Trip = {
  id: string;
  customer_name: string;
  pickup_address: string;
  destination_address: string;
  scheduled_at: string;
  vehicle_id: string;
  driver_id: string;
  status: string;
  cargo_details: string;
  created_at: string;
};
export type Point = {
  id: number;
  trip_id: string;
  latitude: number;
  longitude: number;
  accuracy_m: number;
  captured_at: string;
  received_at: string;
};
export type Attendance = {
  id: string;
  employee_id: string;
  kind: string;
  photo_path: string;
  latitude: number;
  longitude: number;
  accuracy_m: number;
  captured_at: string;
  received_at: string;
  review_status: string;
  review_note: string;
};
