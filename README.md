# Haulmark Operations

Working slices of the trucking system in the attached brief: office dashboard, driver mobile app, and Supabase database. The current source covers sign-in, owner-controlled roles, truck and driver records, dispatch, trip status, authorized GPS reporting, photo attendance with HR review, and transparent quotation pricing and approval. All screens use real backend records; no sample operational data is included.

For a first hosted test, follow the [step-by-step live setup guide](docs/LIVE-TEST-SETUP.md).

## What is built

| Workflow | Office dashboard | Driver app | Backend guard |
| --- | --- | --- | --- |
| Sign-in and roles | Owner, administrator, fleet manager, dispatcher, HR | Personal sign-in | Supabase Auth and RLS |
| Truck and driver records | Register and update status | Assigned truck shown | RLS and assignment checks |
| Dispatch | Create and view trips | View and advance assigned trip | Atomic dispatch RPC, unique active assignments |
| Tracking | Latest location on a map, stale status | Start/stop sharing, background reporting | Active session and assignment required for each point |
| Photo attendance | Review and view private photo | Camera/GPS capture and submission | Server timestamp, private bucket, idempotency key |
| Quotations | Address search, map pins, truck road distance, rate cards, approval, print-to-PDF, dispatch conversion | — | Server calculation, price snapshot, atomic conversion |

## Local setup

1. Install Node.js 24 and Docker Desktop if you want local Supabase. Run `npm install` from the repository root.
2. Create a Supabase project. Apply the SQL migrations in order: [`202611100001_core.sql`](supabase/migrations/202611100001_core.sql), [`202611130001_quotations.sql`](supabase/migrations/202611130001_quotations.sql), then [`202611160001_map_quotations.sql`](supabase/migrations/202611160001_map_quotations.sql). The core migration enables RLS and creates a private `attendance-photos` bucket. If using the CLI instead of the SQL Editor, run `npx supabase init` before `link` and `db push`; do not push the same migrations again after applying them manually.
3. Create your first account in Supabase Authentication. In the SQL Editor, run the following with your real email to bootstrap the owner role:

   ```sql
   update public.profiles set role = 'owner'
   where id = (select id from auth.users where email = 'you@example.com');
   ```

4. Copy `apps/web/.env.example` to `apps/web/.env.local`, and `apps/driver/.env.example` to `apps/driver/.env`. Add the Supabase project URL and **publishable/anon key**. Add your Geoapify browser key as `VITE_GEOAPIFY_KEY` for address search, truck routing, and hosted map tiles. Set `VITE_COMPANY_NAME` to your actual business name before printing quotes. Never put the service-role key in either app.
5. Run `npm run dev:web`. Sign in with the owner account. To invite users from the dashboard, deploy the `invite-user` function as described below.
6. For the driver app, run `npm run start -w apps/driver`. Use an Expo **development build** on a physical device for background location. Expo Go does not support background location. Camera attendance also needs a real camera and location permission.
7. In the dashboard, an owner or administrator adds a **Rate card** before a dispatcher creates a quote. Search pickup and destination addresses or pin both on the map. The truck route fills distance and the rate card previews the price. Enter fuel and toll estimates, request approval, mark the customer response, then select available trucks and drivers to convert an accepted quote. The browser's **Print / save PDF** action is enabled only when `VITE_COMPANY_NAME` is set.

## Invite function

The owner and administrator screen calls `invite-user`, a Supabase Edge Function. Deploy it with the Supabase CLI:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_REF
npx supabase secrets set APP_ORIGIN=https://YOUR-DASHBOARD.pages.dev
npx supabase functions deploy invite-user
```

Add your dashboard URL to Supabase Auth's redirect allowlist. For local invitations, set `APP_ORIGIN=http://localhost:5173` while testing locally, then change it for your hosted dashboard. New users start with the driver role; the owner can change their role in **Users & access**. Add a license record in **Drivers** before dispatching them. Supabase's built-in email sender is limited to project-team addresses and two messages per hour; for initial tests, create password-based test users in Supabase Authentication or configure custom SMTP for invitations to other addresses.

## Test deployment with free tiers

These limits and terms were checked on 16 November 2026. Review current terms before loading real employee data.

| Resource | Free test use | Important limit or condition |
| --- | --- | --- |
| [Supabase Free](https://supabase.com/pricing) | Auth, Postgres, private photo storage | 500 MB database, 1 GB files, 50,000 monthly active users, 5 GB egress; project pauses after a week of inactivity. Free projects do not include Pro's daily backups. |
| [Cloudflare Pages Free](https://developers.cloudflare.com/pages/platform/limits/) | Static web dashboard | 500 builds/month. Set build command `npm run build:web`, output `apps/web/dist`, and the `VITE_` variables in Pages settings. |
| [Expo EAS Free](https://docs.expo.dev/billing/plans/) | Low-volume Android/iOS test builds and updates | Free low-priority builds are limited monthly. An Expo development build is required for background GPS. App store distribution and Apple signing may have separate costs. |
| [Geoapify Free](https://www.geoapify.com/pricing/) | Map tiles, Philippine address search, truck routing | 3,000 credits/day and 5 requests/second. Attribution is required. Restrict the browser key to your dashboard origins. |

Vercel Hobby is **not** recommended for a live trucking business: its [terms](https://vercel.com/docs/plans/hobby) restrict Hobby to personal, non-commercial use. Without a Geoapify key, the app shows [public OpenStreetMap tiles](https://operations.osmfoundation.org/policies/tiles/) for light interactive testing only; those servers have no SLA and forbid bulk/offline use.

### Cloudflare Pages settings

- Repository root: this repository
- Build command: `npm run build:web`
- Output directory: `apps/web/dist`
- Environment: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_COMPANY_NAME`, `VITE_GEOAPIFY_KEY`
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

Current limits: geofences, hardware trackers, photo-attendance offline queue, payroll, billing, proof of delivery, and accounting are later phases. Map distance is a road estimate; fuel and tolls still need manual values. There is no customer email integration. GPS has a bounded offline queue of the latest 1,000 points; an unresolved stop is retried when the app reconnects. See the [core design](docs/superpowers/specs/2026-11-10-core-operations-design.md), [quotation design](docs/superpowers/specs/2026-11-13-quotations-design.md), and their plans.
