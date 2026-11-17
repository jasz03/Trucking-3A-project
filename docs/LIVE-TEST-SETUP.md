# Live test setup (Windows)

This guide uses one hosted Supabase Free project, Geoapify Free for maps, a Cloudflare Pages direct upload for the office dashboard, and an Expo EAS internal Android build for the driver app. Use test accounts and test photos first. Payroll, billing, accounting, proof of delivery, and hardware trackers are not implemented yet.

## 1. Prepare the project

Install Node.js 24. Open PowerShell:

```powershell
Set-Location 'D:\Trucking App'
npm install
npm test
npm run check
```

Docker is not needed for this hosted test. If either check fails, stop before deploying.

## 2. Create the Supabase backend

1. Create a Free project at [Supabase](https://supabase.com/dashboard). Save its database password privately.
2. Open **SQL Editor → New query**. Paste the entire contents of [`202611100001_core.sql`](../supabase/migrations/202611100001_core.sql), then run it once. Wait for success.
3. Open a second new query. Paste the entire contents of [`202611130001_quotations.sql`](../supabase/migrations/202611130001_quotations.sql), then run it once. In a third query, run [`202611160001_map_quotations.sql`](../supabase/migrations/202611160001_map_quotations.sql) once. **If your project already has the first two migrations, run only the third.**
4. In **Table Editor**, verify `profiles`, `vehicles`, `drivers`, `trips`, `attendance`, `rate_cards`, and `quotations` exist. In **Storage**, verify `attendance-photos` is a private bucket.

These migrations are not repeatable SQL. Do not also run `supabase db push` against this project after applying them in SQL Editor; the CLI would try to apply them again.

## 3. Create the owner account

1. In Supabase **Authentication → Users → Add user**, create a user with your email and a password. If the screen offers **Auto confirm**, enable it for this manually created test account. You can use an address you own; do not give anyone else this password.
2. Back in **SQL Editor**, run this with your actual email and name:

```sql
update public.profiles
set role = 'owner', full_name = 'Your Name'
where id = (select id from auth.users where email = 'you@example.com');

select id, full_name, role from public.profiles
where id = (select id from auth.users where email = 'you@example.com');
```

The final query must show exactly one row with role `owner`. Create users only after the core migration so its profile trigger runs.

## 4. Connect and run the office dashboard locally

1. In Supabase, open the project's **Connect** dialog or **Settings → API Keys**. Copy the **Project URL** and **publishable key** (`sb_publishable_...`). A legacy `anon` key also works. Use only the publishable/anon key in the apps; never place a secret or service-role key in a `VITE_` or `EXPO_PUBLIC_` variable.
2. In PowerShell:

```powershell
Set-Location 'D:\Trucking App'
Copy-Item apps/web/.env.example apps/web/.env.local
Copy-Item apps/driver/.env.example apps/driver/.env
notepad apps/web/.env.local
notepad apps/driver/.env
```

3. Replace the two Supabase placeholders in **both** files with the same project URL and publishable key. Set `VITE_COMPANY_NAME` to your actual business name. Create a free browser API key at [Geoapify](https://myprojects.geoapify.com/) and put it in `apps/web/.env.local` as `VITE_GEOAPIFY_KEY=YOUR_KEY`. [Geoapify Free](https://www.geoapify.com/pricing/) currently provides 3,000 credits/day and allows commercial testing with attribution. In Geoapify key settings, allow your local origin (`http://localhost:5173`) and later your exact Pages origin. The browser key is visible to visitors, so restrict its allowed origins. If you previously set `VITE_MAP_TILE_URL`, remove it so the same Geoapify key serves map tiles and routing.
4. Run `npm run dev:web`, open the localhost URL printed by Vite (normally `http://localhost:5173`), and sign in as the owner. You should see an empty dashboard without sample trucks. Keep this PowerShell window open while testing locally.

## 5. Publish the office dashboard for free

1. Stop Vite with Ctrl+C. Run `npm run build:web` in `D:\Trucking App`. This creates `D:\Trucking App\apps\web\dist`. Vite embeds the `VITE_` values at build time.
2. In [Cloudflare Workers & Pages](https://dash.cloudflare.com/), choose **Create application → Get started → Drag and drop your files**. Name the Pages project and upload the **dist folder**, then deploy. Copy the resulting `https://YOUR-NAME.pages.dev` URL. [Cloudflare's Direct Upload instructions](https://developers.cloudflare.com/pages/get-started/direct-upload/).
3. Open that URL in a private browser window and sign in. If it shows a Supabase setup screen, the `.env.local` values were missing when you built: fix them, run `npm run build:web` again, and upload a new deployment. If map tiles or address search fail, add the Pages origin to your Geoapify key's allowed origins, rebuild, and redeploy.
4. In Supabase **Authentication → URL Configuration**, set **Site URL** to your exact Pages origin. Add both the Pages origin and `http://localhost:5173` to **Redirect URLs** so password reset and invites can return to the right app. [Supabase redirect URL guide](https://supabase.com/docs/guides/auth/redirect-urls).

For every web change or `VITE_` value change, rebuild and upload `dist` again. Direct Upload does not automatically build from Git.

## 6. Create a driver test account and records

For the first end-to-end test, use **Authentication → Users → Add user** in Supabase to create a second password-based user. Its profile starts with the `driver` role automatically. If the dashboard shows a UUID instead of a name, run:

```sql
update public.profiles set full_name = 'Test Driver'
where id = (select id from auth.users where email = 'driver@example.com');
```

Replace the email with the one you created. Refresh the office dashboard, then:

1. **Trucks → Add truck**: save a test plate and truck type.
2. **Drivers → Add driver**: select the test user, enter a test license number, and choose a future expiry date.
3. **Dispatch → New dispatch**: select that truck and driver with a future schedule.

The driver's profile must remain active with role `driver`; the truck must be available and the license unexpired on the scheduled Manila date.

## 7. Build the Android driver app for an independent test

Create a free [Expo account](https://expo.dev/signup). From PowerShell:

```powershell
Set-Location 'D:\Trucking App\apps\driver'
npx eas-cli login
npx eas-cli init
```

`eas init` links this source to your Expo project. In the Expo project dashboard, open **Project settings → Environment variables** and add these two variables to the **preview** environment with **plain text** visibility:

```text
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_KEY
```

These are public client values. They must match the web app's Supabase project. Then run:

```powershell
npx eas-cli build --platform android --profile preview
```

Accept EAS's prompts to generate Android signing credentials. The existing `preview` profile in [`eas.json`](../apps/driver/eas.json) is an internal install build. When EAS finishes, open its build link on a physical Android phone and install the APK. Sign in with the **driver** email/password. A preview build runs without a local Metro server. Expo's [environment-variable guide](https://docs.expo.dev/eas/environment-variables/manage/) explains the cloud settings.

If you instead want live code editing, create a `development` build and run `npm run start -w apps/driver` from the repository root; the phone must reach the Metro server. Expo Go cannot test the background-location behavior. [Expo Location guide](https://docs.expo.dev/versions/latest/sdk/location/).

## 8. Check each implemented workflow

1. **Permissions:** Owner can see the records. Driver signs into the Android app and sees only assigned trips. A driver account cannot use the office dashboard.
2. **Trip:** On the phone tap **Accept assignment**, then **Start trip**. The office **Dispatch** page should update. Later tap **Mark arrived** and **Complete trip**.
3. **Tracking:** During an active trip, tap **Start sharing for this trip** and allow precise foreground/background location. Keep the app in the background for several minutes. On the office **Live fleet** map, check the truck pin, coordinates, and timestamp. The dashboard refreshes about every 15 seconds. Tap **Stop sharing**; old points should become **Last known**, never silently stay live. Phone vendors may stop updates after the app is killed.
4. **Attendance:** On the phone open **Attendance**, choose **Time in**, tap **Open camera**, then **Submit time in**. Repeat for **Time out**. On the office **Attendance** page, review the photo and approve or reject. Use a real phone camera and location permission.
5. **Quotations:** On the office **Quotations → Rate cards**, create a rate card for the same truck type. Create a quote: type a pickup and destination, choose an address result for each, or pin each point on the map. The recommended truck road route should draw, show its distance on the map, and fill the distance field; changing truck type or costs should immediately change the price preview. Save the draft, request approval, approve it as owner, mark it sent and accepted, then convert it to a dispatch. If routing fails, enter a manual distance and review it before saving. The truck and driver must be available; finish or cancel their earlier trip first. Set `VITE_COMPANY_NAME` before using **Print / save PDF**.

## 9. Optional emailed invites

The office **Users & access → Send invite** button calls a Supabase Edge Function. To enable it after the Pages URL exists:

```powershell
Set-Location 'D:\Trucking App'
npx supabase init
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase secrets set APP_ORIGIN=https://YOUR-NAME.pages.dev
npx supabase functions deploy invite-user --use-api
```

If `supabase/config.toml` already exists, skip `init`. `APP_ORIGIN` must exactly match the dashboard origin, without a trailing slash. The function receives Supabase's server keys automatically; do not copy them into the web or driver app. The function accepts only requests from that origin and from signed-in owners/administrators. Do not run `db push` after the manual SQL steps above. [Supabase CLI setup](https://supabase.com/docs/guides/local-development/cli/getting-started) and [function deployment](https://supabase.com/docs/guides/functions/deploy).

Supabase's built-in email service is restricted to project-team addresses and currently sends at most two emails per hour. For invitations to other addresses, configure custom SMTP. For your first free test, manually created password-based accounts avoid this email dependency. [Supabase SMTP limits](https://supabase.com/docs/guides/auth/auth-smtp).

## Free-tier limits and current scope

[Supabase Free](https://supabase.com/pricing) currently includes a 500 MB database and 1 GB file storage, but can pause after low activity and has no automatic backups. [Cloudflare Pages Free](https://developers.cloudflare.com/pages/platform/limits/) has a monthly build limit; local Direct Uploads are still a suitable way to publish this static dashboard. [Expo EAS Free](https://docs.expo.dev/billing/plans/) permits a limited number of low-priority builds per month. This is a test setup, not a reliability or backup plan for real employee data.
