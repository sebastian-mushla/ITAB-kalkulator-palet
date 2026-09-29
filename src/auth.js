// Login, roles and shared settings (Supabase). Data access is enforced by RLS in supabase/schema.sql;
// hiding admin tabs in the UI is only convenience.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://nxzprxxqconnodigvrjp.supabase.co';
// publishable key: meant to be public, safe in the browser with RLS on
const SUPABASE_KEY = 'sb_publishable_yPUD-KfaJeE6tYEbdMJ8Ww_nGf9NOdJ';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = s => document.querySelector(s);

function showLogin(msg) {
  $('#login').hidden = false;
  $('#appRoot').hidden = true;
  $('#loginErr').textContent = msg || '';
}

// Resolves with { user, role } once somebody is signed in.
export async function requireLogin() {
  const { data } = await sb.auth.getSession();
  if (data.session) {
    const me = await profileOf(data.session.user);
    if (me) return me;
  }
  showLogin();
  return new Promise(resolve => {
    $('#loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = $('#loginBtn');
      btn.disabled = true; $('#loginErr').textContent = '';
      const { data: d, error } = await sb.auth.signInWithPassword({ email: $('#loginEmail').value.trim(), password: $('#loginPass').value });
      btn.disabled = false;
      if (error) { $('#loginErr').textContent = error.message === 'Invalid login credentials' ? 'Nesprávný e-mail nebo heslo.' : error.message; return; }
      const me = await profileOf(d.user);
      if (me) resolve(me);
    });
  });
}

async function profileOf(user) {
  const { data, error } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (error) { showLogin('Nepodařilo se načíst účet: ' + error.message); return null; }
  $('#login').hidden = true;
  $('#appRoot').hidden = false;
  return { user, role: data ? data.role : 'user' };
}

export async function signOut() { await sb.auth.signOut(); location.reload(); }

export async function changePassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  return error ? error.message : null;
}

// ---------- shared settings ----------
export async function loadSettings() {
  const { data, error } = await sb.from('settings').select('key,value');
  if (error) throw new Error('Nepodařilo se načíst nastavení: ' + error.message);
  return Object.fromEntries((data || []).map(r => [r.key, r.value]));
}

const timers = {};
// Debounced upsert; onDone(errorMessage|null) reports the result.
export function saveSetting(key, value, userId, onDone) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(async () => {
    const { error } = await sb.from('settings').upsert({ key, value, updated_at: new Date().toISOString(), updated_by: userId });
    onDone(error ? error.message : null);
  }, 600);
}

// ---------- users (admin) ----------
export async function listProfiles() {
  const { data, error } = await sb.from('profiles').select('id,email,role,created_at').order('created_at');
  if (error) throw new Error(error.message);
  return data;
}
export async function setRole(id, role) {
  const { error } = await sb.from('profiles').update({ role }).eq('id', id);
  return error ? error.message : null;
}
