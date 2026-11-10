# Haulmark Operations

An initial working slice of the trucking system in the attached brief: office dashboard, driver mobile app, and Supabase database. This phase covers sign-in, owner-controlled roles, truck and driver records, dispatch, trip status, authorized GPS reporting, and photo attendance with HR review. All screens use real backend records; no sample operational data is included.

## What is built

| Workflow | Office dashboard | Driver app | Backend guard |
| --- | --- | --- | --- |
| Sign-in and roles | Owner, administrator, fleet manager, dispatcher, HR | Personal sign-in | Supabase Auth and RLS |
| Truck and driver records | Register and update status | Assigned truck shown | RLS and assignment checks |
| Dispatch | Create and view trips | View and advance assigned trip | Atomic dispatch RPC, unique active assignments |
| Tracking | Latest location, map when configured, stale status | Start/stop sharing, background reporting | Active session and assignment required for each point |
| Photo attendance | Review and view private photo | Camera/GPS capture and submission | Server timestamp, private bucket, idempotency key |

## Local setup

1. Install Node.js 24 and Docker Desktop if you want local Supabase. Run `npm install` from the repository root.
2. Create a Supabase project. Apply [`supabase/migrations/202611100001_core.sql`](supabase/migrations/202611100001_core.sql) through the SQL Editor, or use the Supabase CLI with `npx supabase link --project-ref YOUR_REF` and `npx supabase db push`. The migration enables RLS and creates a private `attendance-photos` bucket.
3. Create your first account in Supabase Authentication. In the SQL Editor, run the following with your real email to bootstrap the owner role:

   ```sql
   update public.profiles set role = 'owner'
   where id = (select id from auth.users where email = 'you@example.com');
   ```

4. Copy `apps/web/.env.example` to `apps/web/.env.local`, and `apps/driver/.env.example` to `apps/driver/.env`. Add the Supabase project URL and **publishable/anon key**. Never put the service-role key in either app.
5. Run `npm run dev:web`. Sign in with the owner account. To invite users from the dashboard, deploy the `invite-user` function as described below.
6. For the driver app, run `npm run start -w apps/driver`. Use an Expo **development build** on a physical device for background location. Expo Go does not support background location. Camera attendance also needs a real camera and location permission.

## Invite function

The owner and administrator screen calls `invite-user`, a Supabase Edge Function. Deploy it with the Supabase CLI:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_REF
npx supabase secrets set APP_ORIGIN=https://YOUR-DASHBOARD.pages.dev
npx supabase functions deploy invite-user
```

Add your dashboard URL to Supabase Auth's redirect allowlist. For local invitations, set `APP_ORIGIN=http://localhost:5173` while testing locally, then change it for your hosted dashboard. New users start with the driver role; the owner can change their role in **Users & access**. Add a license record in **Drivers** before dispatching them.

## Test deployment with free tiers

These limits and terms were checked on 10 November 2026. Review current terms before loading real employee data.

| Resource | Free test use | Important limit or condition |
| --- | --- | --- |
| [Supabase Free](https://supabase.com/pricing) | Auth, Postgres, private photo storage | 500 MB database, 1 GB files, 50,000 monthly active users, 5 GB egress; project pauses after a week of inactivity. Free projects do not include Pro's daily backups. |
| [Cloudflare Pages Free](https://developers.cloudflare.com/pages/platform/limits/) | Static web dashboard | 500 builds/month. Set build command `npm run build:web`, output `apps/web/dist`, and the three `VITE_` variables in Pages settings. |
| [Expo EAS Free](https://docs.expo.dev/billing/plans/) | Low-volume Android/iOS test builds and updates | Free low-priority builds are limited monthly. An Expo development build is required for background GPS. App store distribution and Apple signing may have separate costs. |
| [MapTiler Free](https://www.maptiler.com/cloud/pricing/) | Test map tiles | Suitable for testing/R&D; its [terms](https://www.maptiler.com/terms/cloud/) limit free use to non-commercial use and R&D for commercial products. Set `VITE_MAP_TILE_URL` from your own key. |

Vercel Hobby is **not** recommended for a live trucking business: its [terms](https://vercel.com/docs/plans/hobby) restrict Hobby to personal, non-commercial use. Public OpenStreetMap tile servers also have [usage limits and no SLA](https://operations.osmfoundation.org/policies/tiles/); the app therefore does not use them as an unconfigured production default.

### Cloudflare Pages settings

- Repository root: this repository
- Build command: `npm run build:web`
- Output directory: `apps/web/dist`
- Environment: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optionally `VITE_MAP_TILE_URL`
- Rebuild after changing Vite variables; they are embedded in the static bundle.

### Driver build

Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in the app environment, then run:

```powershell
npx eas-cli build --platform android --profile development
```

Use a test device and confirm background permission and foreground-service notification. Android and iOS may stop background location when the app is terminated, and device vendors differ. The dispatcher sees the last received point and its timestamp when updates stop. See [Expo Location's background behavior](https://docs.expo.dev/versions/latest/sdk/location/).

## Validation

```powershell
npm test
npm run check
npm run build:web
```

The migration and Edge Function need a linked Supabase project for integration checks. This workspace had no project credentials or running Docker daemon, so no live database, invite-email, background-GPS, camera, or hosted-deployment test has been performed yet.

## Data handling and next phases

Location and attendance records contain sensitive employee data. Before real use, publish an employee privacy notice, set a tracking purpose and retention period, decide photo and GPS deletion rules, configure backups, and review Philippine legal obligations with a qualified adviser. Device GPS and attendance photos are user-submitted evidence, not independently verified physical presence.

Current limits: map routing, geocoding, geofences, hardware trackers, photo-attendance offline queue, payroll, quotations, billing, proof of delivery, and accounting are later phases. GPS has a bounded offline queue of the latest 1,000 points; an unresolved stop is retried when the app reconnects. See the [core design](docs/superpowers/specs/2026-11-10-core-operations-design.md) and [implementation plan](docs/superpowers/plans/2026-11-10-core-operations.md).
