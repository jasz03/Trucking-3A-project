import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async request => {
  const origin = request.headers.get('origin') || '';
  const allowedOrigin = Deno.env.get('APP_ORIGIN') || '';
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (origin !== allowedOrigin) return new Response('Origin not allowed', { status: 403, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers });
  const token = request.headers.get('authorization')?.replace(/^Bearer /i, '');
  if (!token) return new Response('Unauthorized', { status: 401, headers });
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = createClient(url, anon);
  const { data: { user }, error: authError } = await auth.auth.getUser(token);
  if (authError || !user) return new Response('Unauthorized', { status: 401, headers });
  const admin = createClient(url, service);
  const { data: profile } = await admin.from('profiles').select('role,active').eq('id', user.id).single();
  if (!profile?.active || !['owner', 'administrator'].includes(profile.role)) return new Response('Forbidden', { status: 403, headers });
  let body: { email?: string; full_name?: string };
  try { body = await request.json(); } catch { return new Response('Invalid JSON', { status: 400, headers }); }
  const email = body.email?.trim().toLowerCase() || '';
  const fullName = body.full_name?.trim() || '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || fullName.length < 2 || fullName.length > 120) return new Response('Valid email and name required', { status: 400, headers });
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName }, redirectTo: allowedOrigin });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
});
