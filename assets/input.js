/* =====================================================================
   input.js — tabel ringkas yang bisa dibuka per baris (accordion).

   Baris = salesman, ringkas + status. Diklik, baris itu terbuka
   menampilkan form lengkap; baris lain otomatis tertutup supaya
   ketua cabang selalu fokus mengisi satu orang saja.

   Pengaman kekeliruan yang tersemat:
   1. Papan periode besar di atas, supaya tidak salah cabang/minggu.
   2. Ringkasan baris (kolom TM/Act PRTM/Total OL PRTM) kelihatan tanpa
      buka form — jadi ketua cabang bisa cek wajar-tidaknya sekilas.
   3. Tanda "!" oranye di baris kalau ada angka yang melompat jauh dari
      minggu lalu, kelihatan bahkan sebelum baris dibuka.
   4. Setelah simpan, baris otomatis tertutup dan pindah ke baris
      berikutnya — alur checklist dari atas ke bawah.
   ===================================================================== */

import { sb, requireSession, renderShell, showNote, escapeHtml, defaultPeriod } from './app.js';
import { COLUMNS, MONTHS, WEEKS, STORED, computeRow, fmt } from './schema.js';

const { profile } = await requireSession();
renderShell(profile, 'input');

const isAdmin = profile.role === 'admin';
const COL = new Map(COLUMNS.map(c => [c.key, c]));

/* Kolom mingguan yang punya pasangan "minggu lalu" untuk dibandingkan. */
const WEEK_FIELDS = {
  lq_tm:    w => `lq_tm_w${w}`,
  act_prtm: w => `act_prtm_w${w}`,
  qc_gt80:  w => `qc_w${w}_gt80`,
  qc_50_80: w => `qc_w${w}_50_80`,
  qc_lt50:  w => `qc_w${w}_lt50`,
};

const el = {
  year: document.getElementById('f-year'),
  month: document.getElementById('f-month'),
  week: document.getElementById('f-week'),
  branch: document.getElementById('f-branch'),
  band: document.getElementById('periodband'),
  table: document.getElementById('acctable'),
};

const state = {
  ...defaultPeriod(),
  branchId: null,
  branchName: '',
  salesmen: [],
  rows: new Map(),      // salesman_id -> baris bulan berjalan
  prevRows: new Map(),  // salesman_id -> baris bulan sebelumnya (pembanding W1)
  dirty: new Set(),
  openId: null,          // salesman_id yang barisnya sedang terbuka
};

/* ---------- Pemilih periode ------------------------------------------ */
const thisYear = new Date().getFullYear();
for (let y = thisYear - 2; y <= thisYear + 1; y++) {
  el.year.insertAdjacentHTML('beforeend', `<option value="${y}"${y === state.year ? ' selected' : ''}>${y}</option>`);
}
MONTHS.forEach((m, i) => el.month.insertAdjacentHTML('beforeend',
  `<option value="${i + 1}"${i + 1 === state.month ? ' selected' : ''}>${m}</option>`));
el.week.innerHTML = WEEKS.map(w =>
  `<button type="button" data-week="${w}" aria-pressed="${w === state.week}">W${w}</button>`).join('');

/* ---------- Daftar cabang -------------------------------------------- */
const { data: branches, error: brErr } = await sb
  .from('branches').select('id, code, name, area_code')
  .eq('is_active', true).order('sort_order');

if (brErr) showNote('note', 'Gagal memuat daftar cabang: ' + brErr.message, 'err');

const allowed = isAdmin ? (branches ?? []) : (branches ?? []).filter(b => b.id === profile.branch_id);

if (!allowed.length) {
  el.table.innerHTML = '<div class="skeleton">Akun Anda belum dihubungkan ke cabang mana pun. ' +
                        'Hubungi admin head office.</div>';
} else {
  el.branch.innerHTML = allowed.map(b =>
    `<option value="${b.id}">${escapeHtml(b.code)} — ${escapeHtml(b.name)}</option>`).join('');
  el.branch.disabled = !isAdmin;
  state.branchId = allowed[0].id;
  state.branchName = allowed[0].name;
  await load();
}

/* ---------- Peristiwa toolbar ----------------------------------------- */
el.year.addEventListener('change', () => { state.year = +el.year.value; load(); });
el.month.addEventListener('change', () => { state.month = +el.month.value; load(); });
el.branch.addEventListener('change', () => {
  state.branchId = el.branch.value;
  state.branchName = allowed.find(b => b.id === state.branchId)?.name ?? '';
  load();
});
el.week.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-week]');
  if (!b) return;
  state.week = +b.dataset.week;
  [...el.week.children].forEach(x => x.setAttribute('aria-pressed', x === b));
  renderBand();
  renderTable();
});

window.addEventListener('beforeunload', (e) => {
  if (state.dirty.size) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------- Memuat data ------------------------------------------------ */
function prevPeriod(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

async function load() {
  if (state.dirty.size && !confirm('Ada perubahan yang belum disimpan. Tinggalkan halaman ini?')) return;
  state.dirty.clear();
  el.band.innerHTML = '';
  el.table.innerHTML = '<div class="skeleton">Memuat data…</div>';
  showNote('note', '');

  const prev = prevPeriod(state.year, state.month);

  const [{ data: salesmen, error: e1 }, { data: entries, error: e2 }, { data: prevEntries }] = await Promise.all([
    sb.from('salesmen').select('id, name, sort_order')
      .eq('branch_id', state.branchId).eq('is_active', true).order('sort_order'),
    sb.from('mos_entries').select('*')
      .eq('branch_id', state.branchId)
      .eq('period_year', state.year).eq('period_month', state.month),
    sb.from('mos_entries').select('*')
      .eq('branch_id', state.branchId)
      .eq('period_year', prev.year).eq('period_month', prev.month),
  ]);

  if (e1 || e2) { showNote('note', 'Gagal memuat data: ' + (e1 || e2).message, 'err'); return; }

  state.salesmen = salesmen ?? [];
  state.rows = new Map();
  state.prevRows = new Map();
  for (const s of state.salesmen) {
    const found = (entries ?? []).find(x => x.salesman_id === s.id);
    state.rows.set(s.id, found ? { ...found } : blankRow(s.id));
    const prevFound = (prevEntries ?? []).find(x => x.salesman_id === s.id);
    if (prevFound) state.prevRows.set(s.id, prevFound);
  }

  if (!state.salesmen.length) {
    el.table.innerHTML = '<div class="skeleton">Cabang ini belum punya salesman terdaftar.</div>';
    return;
  }

  state.openId = null;
  renderBand();
  renderTable();
}

function blankRow(salesmanId) {
  const r = { salesman_id: salesmanId, branch_id: state.branchId,
              period_year: state.year, period_month: state.month };
  for (const c of STORED) r[c.key] = c.type === 'text' ? '' : 0;
  return r;
}

function hasAnyData(row) {
  return STORED.some(c => c.type === 'text' ? !!row[c.key] : Number(row[c.key]) > 0);
}

/* ---------- Papan konfirmasi periode ----------------------------------- */
function renderBand() {
  const filled = state.salesmen.filter(s => {
    const r = state.rows.get(s.id);
    return r.id || hasAnyData(r);
  }).length;
  el.band.innerHTML = `
    <span>Mengisi cabang</span> <b>${escapeHtml(state.branchName)}</b>
    <span class="sep">·</span>
    <span>Periode</span> <b>${MONTHS[state.month - 1]} ${state.year}</b>
    <span class="sep">·</span>
    <span>Minggu</span> <b>${state.week}</b>
    <span class="progress">${filled} dari ${state.salesmen.length} sudah diisi</span>
  `;
}

/* ---------- Pembanding minggu lalu -------------------------------------- */
function prevValue(fieldBase, row, sid) {
  const tpl = WEEK_FIELDS[fieldBase];
  if (!tpl) return null;
  if (state.week > 1) return row[tpl(state.week - 1)] ?? null;
  const prevRow = state.prevRows.get(sid);
  return prevRow ? (prevRow[tpl(4)] ?? null) : null;
}

function isAnomaly(curr, prev) {
  if (prev === null || prev === undefined || Number(prev) <= 0) return false;
  const ratio = Number(curr) / Number(prev);
  return ratio >= 2 || ratio <= 0.5;
}

function hintHtml(fieldBase, key, row, sid) {
  if (!WEEK_FIELDS[fieldBase]) return '';
  const prev = prevValue(fieldBase, row, sid);
  if (prev === null) return `<p class="fieldhint">Belum ada data minggu lalu untuk dibandingkan.</p>`;
  const label = state.week > 1 ? `Minggu ${state.week - 1}` : 'Minggu lalu (bulan sebelumnya)';
  const c = COL.get(key);
  const warn = isAnomaly(row[key], prev)
    ? `<span class="warn">— beda jauh dari minggu lalu, cek lagi</span>` : '';
  return `<p class="fieldhint">${label}: <b>${fmt(prev, c)}</b> ${warn}</p>`;
}

/** Salesman ini punya angka mingguan yang mencurigakan? (untuk tanda di ringkasan) */
function rowHasAnomaly(row, sid) {
  return Object.entries(WEEK_FIELDS).some(([base, tpl]) => {
    const key = tpl(state.week);
    return isAnomaly(row[key], prevValue(base, row, sid));
  });
}

/* ---------- Field helpers ---------------------------------------------- */
function fieldHtml(key, row, label, weekFieldBase, sid) {
  const c = COL.get(key);
  const value = row[key] ?? (c.type === 'text' ? '' : 0);
  const text = c.type === 'text';
  return `
    <div class="field">
      <label for="f-${key}">${escapeHtml(label ?? lastPath(c))}<span class="colref">${c.col}</span></label>
      ${text
        ? `<textarea id="f-${key}" rows="2" data-key="${key}">${escapeHtml(value)}</textarea>`
        : `<input type="number" step="any" inputmode="decimal" id="f-${key}" data-key="${key}" value="${value}">`}
      ${weekFieldBase ? `<div data-hint="${key}">${hintHtml(weekFieldBase, key, row, sid)}</div>` : ''}
    </div>`;
}

function calcHtml(key, calc, label) {
  const c = COL.get(key);
  return `
    <div class="calcbox" data-calc="${key}">
      <span>${escapeHtml(label ?? lastPath(c))} <span class="colref">${c.col}</span></span>
      <b class="${calc[key] < 0 ? 'neg' : ''}">${fmt(calc[key], c)}</b>
    </div>`;
}

function lastPath(c) { return c.path[c.path.length - 1]; }

/* ---------- Tabel accordion --------------------------------------------- */
function renderTable() {
  const w = state.week;

  const rowsHtml = state.salesmen.map(s => {
    const row = state.rows.get(s.id);
    const calc = computeRow(row, w);
    const isOpen = s.id === state.openId;
    const statusCls = state.dirty.has(s.id) ? 'pending' : (row.id || hasAnyData(row)) ? 'saved' : '';
    const statusTxt = state.dirty.has(s.id) ? 'Belum disimpan' : row.id ? 'Tersimpan' : 'Kosong';
    const anomaly = rowHasAnomaly(row, s.id);

    return `
      <div class="acc-row" data-sid="${s.id}" data-open="${isOpen}">
        <button type="button" class="acc-summary">
          <span>${escapeHtml(s.name)}</span>
          <span class="num">${fmt(row[`lq_tm_w${w}`], COL.get('lq_tm_w1'))}</span>
          <span class="num">${fmt(row[`act_prtm_w${w}`], COL.get('act_prtm_w1'))}</span>
          <span class="stat ${statusCls}">${anomaly ? '<span class="warnflag" title="Ada angka beda jauh dari minggu lalu">!</span>' : ''}<span class="dot"></span><span class="stat-label">${statusTxt}</span></span>
          <span class="chev">›</span>
        </button>
        ${isOpen ? `<div class="acc-body">${formBody(s, row, calc)}</div>` : ''}
      </div>`;
  }).join('');

  el.table.innerHTML = `
    <div class="acc-head">
      <span>Salesman</span><span>TM W${w}</span><span>Act PRTM W${w}</span><span>Status</span><span></span>
    </div>
    ${rowsHtml}
  `;

  el.table.querySelectorAll('.acc-summary').forEach(btn => {
    btn.addEventListener('click', () => {
      const sid = btn.closest('.acc-row').dataset.sid;
      state.openId = state.openId === sid ? null : sid;
      showNote('note', '');
      renderTable();
      if (state.openId) {
        document.querySelector(`.acc-row[data-sid="${state.openId}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });

  const openForm = el.table.querySelector('.acc-body form');
  if (openForm) {
    const sid = state.openId;
    const row = state.rows.get(sid);
    openForm.querySelectorAll('input, textarea').forEach(inp => {
      inp.addEventListener('input', () => onEdit(inp, row, sid));
    });
    openForm.addEventListener('submit', (e) => onSaveAndNext(e, sid));
  }
}

function formBody(s, row, calc) {
  const w = state.week;
  const idx = state.salesmen.findIndex(x => x.id === s.id);
  const isLast = idx === state.salesmen.length - 1;

  return `
    <form>
      <div class="row" style="margin-bottom:16px">
        ${fieldHtml('market_size_year',  row, 'Market Size / Tahun')}
        ${fieldHtml('market_size_month', row, 'Market Size / Bulan')}
        ${fieldHtml('plan_sales_master', row, 'Plan Sales Master')}
      </div>

      <details class="group" open>
        <summary>Live Quotation by CRM</summary>
        <div class="body">
          <div class="row">
            ${fieldHtml(`lq_tm_w${w}`, row, `TM Minggu Berjalan (W${w})`, 'lq_tm', s.id)}
            ${fieldHtml('lq_lm', row, 'LM (Bulan Lalu)')}
          </div>
          <div style="margin-top:12px">${calcHtml('lq_total', calc, 'Total (TM + LM)')}</div>
        </div>
      </details>

      <details class="group" open>
        <summary>Outlook PRTM</summary>
        <div class="body">
          ${fieldHtml(`act_prtm_w${w}`, row, `Act PRTM by SO SAP (W${w})`, 'act_prtm', s.id)}

          <p class="subhead">Quot Confidence (W${w})</p>
          <div class="row">
            ${fieldHtml(`qc_w${w}_gt80`,  row, '> 80%',       'qc_gt80', s.id)}
            ${fieldHtml(`qc_w${w}_50_80`, row, '> 50% – 80%', 'qc_50_80', s.id)}
            ${fieldHtml(`qc_w${w}_lt50`,  row, '< 50%',       'qc_lt50', s.id)}
          </div>

          <p class="subhead">Total PRTM</p>
          <div class="row">
            ${fieldHtml('po_non_sap', row, 'PO Non SAP')}
          </div>
          <div style="margin:12px 0">${calcHtml('total_ol_prtm', calc, 'Total OL PRTM')}</div>

          <div class="row">
            ${fieldHtml('ol_min_prtm', row, 'OL Min PRTM')}
          </div>
          <div style="margin:12px 0">${calcHtml('balance_prtm', calc, 'Balance PRTM (OL − Plan PRTM)')}</div>

          <div class="row">
            ${fieldHtml('po_last_month', row, 'PO Bulan Lalu (by SAP)')}
          </div>
          <div class="row" style="margin-top:12px">
            ${calcHtml('total_po', calc, 'Total PO (POCO+PRTM)')}
            ${calcHtml('total_po_outlook', calc, 'Total PO Outlook')}
          </div>
        </div>
      </details>

      <details class="group">
        <summary>Jadwal &amp; Catatan</summary>
        <div class="body">
          ${fieldHtml('ms_teams_schedule', row, 'MS Teams Schedule')}
          <div style="margin-top:14px">
            ${fieldHtml('kemampuan_po', row, 'Kemampuan Memenuhi PO dari Quotation (80%, 50–80%)')}
          </div>
        </div>
      </details>

      <div class="formbar">
        <button type="submit">${isLast ? 'Simpan (salesman terakhir)' : 'Simpan & Lanjut →'}</button>
        <span class="hint">${statusText(row)}</span>
      </div>
    </form>`;
}

function statusText(row) {
  return row.updated_at
    ? 'Tersimpan ' + new Date(row.updated_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Belum pernah disimpan.';
}

function onEdit(inp, row, sid) {
  const key = inp.dataset.key;
  const c = COL.get(key);
  row[key] = c.type === 'text' ? inp.value : (parseFloat(inp.value) || 0);
  state.dirty.add(sid);

  const body = inp.closest('.acc-body');
  const calc = computeRow(row, state.week);
  body.querySelectorAll('[data-calc]').forEach(box => {
    const k = box.dataset.calc;
    const b = box.querySelector('b');
    b.textContent = fmt(calc[k], COL.get(k));
    b.classList.toggle('neg', calc[k] < 0);
  });

  for (const [base, tpl] of Object.entries(WEEK_FIELDS)) {
    if (tpl(state.week) === key) {
      const holder = body.querySelector(`[data-hint="${key}"]`);
      if (holder) holder.innerHTML = hintHtml(base, key, row, sid);
    }
  }

  const summary = document.querySelector(`.acc-row[data-sid="${sid}"] .stat`);
  if (summary) {
    summary.classList.add('pending');
    summary.classList.remove('saved');
    const label = summary.querySelector('.stat-label');
    if (label) label.textContent = 'Belum disimpan';
  }
}

/* ---------- Menyimpan ---------------------------------------------------- */
function toPayload(sid) {
  const r = state.rows.get(sid);
  const out = { period_year: state.year, period_month: state.month,
                branch_id: state.branchId, salesman_id: sid };
  for (const c of STORED) out[c.key] = c.type === 'text' ? (r[c.key] || null) : (Number(r[c.key]) || 0);
  if (r.id) out.id = r.id;
  return out;
}

async function persist(sids) {
  const payload = sids.map(toPayload);
  const { data, error } = await sb
    .from('mos_entries')
    .upsert(payload, { onConflict: 'period_year,period_month,salesman_id' })
    .select('id, salesman_id, updated_at');

  if (error) {
    showNote('note',
      error.code === '42501'
        ? 'Anda tidak punya izin menulis untuk cabang ini. Data hanya bisa diisi oleh cabang bersangkutan atau admin head office.'
        : 'Gagal menyimpan: ' + error.message, 'err');
    return false;
  }

  for (const d of data ?? []) {
    const row = state.rows.get(d.salesman_id);
    if (row) { row.id = d.id; row.updated_at = d.updated_at; }
    state.dirty.delete(d.salesman_id);
  }
  return true;
}

/** Simpan salesman yang sedang terbuka, tutup barisnya, lalu buka baris berikutnya. */
async function onSaveAndNext(e, sid) {
  e.preventDefault();
  showNote('note', '');

  if (state.dirty.has(sid)) {
    const ok = await persist([sid]);
    if (!ok) return;
  }

  const idx = state.salesmen.findIndex(x => x.id === sid);
  const isLast = idx === state.salesmen.length - 1;

  showNote('note', isLast
    ? 'Tersimpan. Semua salesman di cabang ini sudah dilalui — silakan cek di View Data.'
    : 'Tersimpan.', 'ok');

  state.openId = isLast ? null : state.salesmen[idx + 1].id;
  renderBand();
  renderTable();
  if (state.openId) {
    document.querySelector(`.acc-row[data-sid="${state.openId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
