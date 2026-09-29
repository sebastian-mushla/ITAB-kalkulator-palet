// Edge Function "admin-users": create / delete users and set passwords from the Uživatelé tab.
// Only callers whose profile role is 'admin' may use it. The service role key never leaves the server.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// legacy service_role key, or the new secret key that newer projects provide
function serviceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    return keys.default || Object.values(keys)[0] as string;
  } catch { return ''; }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey());

  // who is calling?
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: caller } = await admin.auth.getUser(token);
  if (!caller?.user) return json({ error: 'Nejste přihlášen.' }, 401);
  const { data: prof } = await admin.from('profiles').select('role').eq('id', caller.user.id).maybeSingle();
  if (prof?.role !== 'admin') return json({ error: 'Jen administrátor může spravovat uživatele.' }, 403);

  const body = await req.json().catch(() => ({}));
  const { action, id, email, password, role } = body;

  if (action === 'create') {
    if (!email || !password || String(password).length < 8) return json({ error: 'Zadejte e-mail a heslo (aspoň 8 znaků).' }, 400);
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) return json({ error: error.message }, 400);
    if (role === 'admin') await admin.from('profiles').update({ role: 'admin' }).eq('id', data.user.id);
    return json({ ok: true });
  }
  if (action === 'password') {
    if (!id || !password || String(password).length < 8) return json({ error: 'Heslo musí mít aspoň 8 znaků.' }, 400);
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    return error ? json({ error: error.message }, 400) : json({ ok: true });
  }
  if (action === 'delete') {
    if (!id) return json({ error: 'Chybí uživatel.' }, 400);
    if (id === caller.user.id) return json({ error: 'Sám sebe smazat nelze.' }, 400);
    const { error } = await admin.auth.admin.deleteUser(id);
    return error ? json({ error: error.message }, 400) : json({ ok: true });
  }
  return json({ error: 'Neznámá akce.' }, 400);
});
