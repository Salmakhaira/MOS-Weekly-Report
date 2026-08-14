/* =====================================================================
   app.js — koneksi Supabase, penjaga sesi, dan header yang dipakai
   di semua halaman.
   ===================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_NAME, APP_SUB } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/**
 * Pastikan user sudah login, lalu ambil profil + cabangnya.
 * Kalau belum login, lempar ke halaman login.
 */
export async function requireSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    location.replace('index.html?next=' + encodeURIComponent(location.pathname.split('/').pop()));
    throw new Error('redirect');
  }

  const { data: profile, error } = await sb
    .from('profiles')
    .select('id, email, full_name, role, branch_id, branches(id, code, name, area_code)')
    .eq('id', session.user.id)
    .maybeSingle();

  if (error) throw error;

  if (!profile) {
    document.body.innerHTML =
      '<div class="wrap"><div class="note err">Akun ini belum punya profil. ' +
      'Hubungi admin head office untuk menghubungkan akun Anda ke cabang.</div></div>';
    throw new Error('no-profile');
  }

  return { session, profile, user: session.user };
}

export async function signOut() {
  await sb.auth.signOut();
  location.replace('index.html');
}

/** Gambar header + navigasi. `active` = 'home' | 'input' | 'view'. */
export function renderShell(profile, active) {
  const mount = document.getElementById('shell');
  if (!mount) return;

  const scope = profile.role === 'admin'
    ? 'Admin head office · semua cabang'
    : (profile.branches?.name ?? 'Cabang belum diatur');

  mount.innerHTML = `
    <header class="topbar">
      <a class="brand" href="home.html">${APP_NAME}<small>${APP_SUB}</small></a>
      <nav class="topnav">
        <a href="home.html"  ${active === 'home'  ? 'aria-current="page"' : ''}>Home</a>
        <a href="input.html" ${active === 'input' ? 'aria-current="page"' : ''}>Input Data</a>
        <a href="view.html"  ${active === 'view'  ? 'aria-current="page"' : ''}>View Data</a>
      </nav>
      <div class="spacer"></div>
      <div class="whoami"><b>${escapeHtml(profile.full_name || profile.email)}</b>${escapeHtml(scope)}</div>
      <button class="link" id="btn-signout">Keluar</button>
    </header>`;

  document.getElementById('btn-signout').addEventListener('click', signOut);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

export function showNote(id, text, kind = 'info') {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'note ' + kind;
  el.textContent = text || '';
}

/** Bulan & minggu berjalan, dipakai sebagai nilai awal pemilih periode. */
export function defaultPeriod() {
  const d = new Date();
  const week = Math.min(4, Math.ceil(d.getDate() / 7));
  return { year: d.getFullYear(), month: d.getMonth() + 1, week };
}

/** Supaya dropdown filter (<details class="filterdrop">) otomatis tertutup
    kalau klik di mana pun di luar kotaknya, bukan cuma di summary-nya lagi. */
export function closeFilterDropdownsOnOutsideClick(selector = 'details.filterdrop') {
  document.addEventListener('click', (e) => {
    document.querySelectorAll(selector + '[open]').forEach((d) => {
      if (!d.contains(e.target)) d.removeAttribute('open');
    });
  });
}
