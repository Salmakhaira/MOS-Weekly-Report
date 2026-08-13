/* =====================================================================
   input.js — grid Excel-style. Dua tabel:
   1. "Data bulanan"  — field yang jarang berubah, terlipat, dibuka sesekali.
   2. "Data minggu ini" — 5 angka yang benar-benar berubah tiap minggu
      (TM, Act PRTM, Quot Confidence >80%/50-80%/<50%), semua salesman
      kelihatan sekaligus, bisa diketik/di-Tab/di-paste seperti Excel.

   Pengaman yang tersemat:
   - Baris yang minggu-nya sudah disubmit terkunci: input disabled, abu-abu.
     Penguncian sesungguhnya ditegakkan di database (lihat
     supabase/04_week_submission_lock.sql); ini cuma agar langsung
     kelihatan di layar tanpa perlu gagal simpan dulu.
   - Toggle "Tampilkan minggu lalu" menambah baris pembanding tipis di
     bawah tiap salesman.
   - Sel yang angkanya melompat jauh dari minggu lalu (naik/turun >2x)
     disorot kuning.
   - Konfirmasi sebelum simpan kalau ada minggu yang baru pertama kali
     disubmit (karena setelah itu terkunci untuk cabang).
   ===================================================================== */

import { sb, requireSession, renderShell, showNote, escapeHtml, defaultPeriod } from './app.js';
import { COLUMNS, MONTHS, WEEKS, STORED, computeRow, fmt } from './schema.js';

/* Kalau ada error tak terduga di mana pun, tampilkan di layar supaya
   halaman tidak diam-diam "macet" tanpa penjelasan. */
function showFatalError(err) {
  console.error(err);
  const msg = (err && err.message) ? err.message : String(err);
  const box = document.getElementById('weeklywrap') || document.body;
  box.innerHTML =
    `<div class="note err" style="display:block;margin:0">
      ⚠️ Terjadi kesalahan teknis: ${msg}<br>
      Coba muat ulang halaman. Kalau masih terjadi, kirim pesan ini ke pengembang.
    </div>`;
}
window.addEventListener('error', (e) => showFatalError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showFatalError(e.reason));

const { profile } = await requireSession();
renderShell(profile, 'input');

const isAdmin = profile.role === 'admin';
const COL = new Map(COLUMNS.map(c => [c.key, c]));

/* Field yang cuma satu nilai per BULAN (bukan per minggu). */
const MONTHLY_FIELDS = ['plan_sales_master', 'po_non_sap', 'ol_min_prtm', 'po_last_month'];

/* Kolom hasil hitung yang ditampilkan di tabel mingguan. */
const WEEKLY_CALC = ['total_ol_prtm', 'balance_prtm', 'total_po', 'total_po_outlook'];

/* Field yang benar-benar per-minggu, dan pasangan "basis" untuk pembanding minggu lalu. */
const WEEK_FIELDS = {
  act_prtm: w => `act_prtm_w${w}`,
  qc_gt80:  w => `qc_w${w}_gt80`,
  qc_50_80: w => `qc_w${w}_50_80`,
  qc_lt50:  w => `qc_w${w}_lt50`,
};
function weeklyInputCols(w) {
  return [
    { key: `act_prtm_w${w}`, label: `Act PRTM W${w}`, base: 'act_prtm' },
    { key: `qc_w${w}_gt80`,  label: '>80%',        base: 'qc_gt80' },
    { key: `qc_w${w}_50_80`, label: '>50–80%',      base: 'qc_50_80' },
    { key: `qc_w${w}_lt50`,  label: '<50%',         base: 'qc_lt50' },
  ];
}
function weekFieldKeysFor(w) { return weeklyInputCols(w).map(c => c.key); }

const el = {
  ddYear: document.getElementById('dd-year'),
  panelYear: document.getElementById('panel-year'),
  lblYear: document.getElementById('lbl-year'),
  ddMonth: document.getElementById('dd-month'),
  panelMonth: document.getElementById('panel-month'),
  lblMonth: document.getElementById('lbl-month'),
  week: document.getElementById('f-week'),
  branch: document.getElementById('f-branch'),
  chips: document.getElementById('periodchips'),
  band: document.getElementById('periodband'),
  monthlyWrap: document.getElementById('monthlywrap'),
  weeklyWrap: document.getElementById('weeklywrap'),
  showPrev: document.getElementById('f-showprev'),
  btnSaveAll: document.getElementById('btn-save-all'),
  status: document.getElementById('status'),
};

const thisYear = new Date().getFullYear();
const ALL_YEARS = [];
for (let y = thisYear - 2; y <= thisYear + 1; y++) ALL_YEARS.push(y);
const ALL_MONTHS = MONTHS.map((_, i) => i + 1);

const DEFAULT = defaultPeriod();
const state = {
  years: new Set([DEFAULT.year]),
  months: new Set([DEFAULT.month]),
  active: { year: DEFAULT.year, month: DEFAULT.month },
  week: DEFAULT.week,
  branchId: null,
  branchName: '',
  salesmen: [],
  rows: new Map(),      // salesman_id -> baris bulan berjalan
  prevRows: new Map(),  // salesman_id -> baris bulan sebelumnya (pembanding W1)
  dirty: new Set(),
};

/* ---------- Filter Tahun & Bulan (multi-pilih) ------------------------- */
function updateYearLabel() {
  const n = state.years.size;
  el.lblYear.textContent = n === ALL_YEARS.length ? 'Semua tahun'
    : n === 1 ? [...state.years][0] : `${n} tahun`;
}
function updateMonthLabel() {
  const n = state.months.size;
  el.lblMonth.textContent = n === ALL_MONTHS.length ? 'Semua bulan'
    : n === 1 ? MONTHS[[...state.months][0] - 1] : `${n} bulan`;
}

function renderYearPanel() {
  el.panelYear.innerHTML = `
    <label class="fd-all"><input type="checkbox" id="cb-year-all"> Semua tahun</label>
    ${ALL_YEARS.map(y => `<label><input type="checkbox" value="${y}" ${state.years.has(y) ? 'checked' : ''}> ${y}</label>`).join('')}
  `;
  el.panelYear.querySelector('#cb-year-all').checked = state.years.size === ALL_YEARS.length;
  el.panelYear.querySelectorAll('input[type=checkbox]:not(#cb-year-all)').forEach(cb => {
    cb.addEventListener('change', () => {
      const y = +cb.value;
      if (cb.checked) state.years.add(y);
      else if (state.years.size > 1) state.years.delete(y);
      else cb.checked = true;
      el.panelYear.querySelector('#cb-year-all').checked = state.years.size === ALL_YEARS.length;
      afterPeriodFilterChange();
    });
  });
  el.panelYear.querySelector('#cb-year-all').addEventListener('change', (e) => {
    state.years = new Set(e.target.checked ? ALL_YEARS : [DEFAULT.year]);
    renderYearPanel();
    afterPeriodFilterChange();
  });
  updateYearLabel();
}

function renderMonthPanel() {
  el.panelMonth.innerHTML = `
    <label class="fd-all"><input type="checkbox" id="cb-month-all"> Semua bulan</label>
    ${ALL_MONTHS.map(m => `<label><input type="checkbox" value="${m}" ${state.months.has(m) ? 'checked' : ''}> ${MONTHS[m - 1]}</label>`).join('')}
  `;
  el.panelMonth.querySelector('#cb-month-all').checked = state.months.size === ALL_MONTHS.length;
  el.panelMonth.querySelectorAll('input[type=checkbox]:not(#cb-month-all)').forEach(cb => {
    cb.addEventListener('change', () => {
      const m = +cb.value;
      if (cb.checked) state.months.add(m);
      else if (state.months.size > 1) state.months.delete(m);
      else cb.checked = true;
      el.panelMonth.querySelector('#cb-month-all').checked = state.months.size === ALL_MONTHS.length;
      afterPeriodFilterChange();
    });
  });
  el.panelMonth.querySelector('#cb-month-all').addEventListener('change', (e) => {
    state.months = new Set(e.target.checked ? ALL_MONTHS : [DEFAULT.month]);
    renderMonthPanel();
    afterPeriodFilterChange();
  });
  updateMonthLabel();
}

function getSelectedPeriods() {
  const ys = [...state.years].sort((a, b) => a - b);
  const ms = [...state.months].sort((a, b) => a - b);
  const out = [];
  for (const y of ys) for (const m of ms) out.push({ year: y, month: m });
  return out;
}

function renderPeriodChips() {
  const periods = getSelectedPeriods();
  if (periods.length <= 1) { el.chips.innerHTML = ''; return; }
  el.chips.innerHTML = periods.map(p => {
    const isActive = p.year === state.active.year && p.month === state.active.month;
    return `<button type="button" data-y="${p.year}" data-m="${p.month}" aria-pressed="${isActive}">
              ${MONTHS[p.month - 1].slice(0, 3)} ${p.year}
            </button>`;
  }).join('');
  el.chips.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const y = +btn.dataset.y, m = +btn.dataset.m;
      if (y === state.active.year && m === state.active.month) return;
      if (state.dirty.size && !confirm('Ada perubahan yang belum disimpan. Pindah periode?')) return;
      state.active = { year: y, month: m };
      renderPeriodChips();
      load();
    });
  });
}

function afterPeriodFilterChange() {
  updateYearLabel();
  updateMonthLabel();
  const periods = getSelectedPeriods();
  const stillValid = periods.some(p => p.year === state.active.year && p.month === state.active.month);
  if (!stillValid) {
    state.active = periods[0];
    renderPeriodChips();
    load();
  } else {
    renderPeriodChips();
  }
}

renderYearPanel();
renderMonthPanel();
renderPeriodChips();

/* ---------- Pemilih minggu -------------------------------------------- */
el.week.innerHTML = WEEKS.map(w =>
  `<button type="button" data-week="${w}" aria-pressed="${w === state.week}">W${w}</button>`).join('');
el.week.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-week]');
  if (!b) return;
  state.week = +b.dataset.week;
  [...el.week.children].forEach(x => x.setAttribute('aria-pressed', x === b));
  renderBand();
  renderWeeklyGrid();
});
el.showPrev.addEventListener('change', renderWeeklyGrid);

/* ---------- Daftar cabang -------------------------------------------- */
const { data: branches, error: brErr } = await sb
  .from('branches').select('id, code, name, area_code')
  .eq('is_active', true).order('sort_order');

if (brErr) showNote('note', 'Gagal memuat daftar cabang: ' + brErr.message, 'err');

const allowed = isAdmin ? (branches ?? []) : (branches ?? []).filter(b => b.id === profile.branch_id);

if (!allowed.length) {
  el.weeklyWrap.innerHTML = '<div class="skeleton">Akun Anda belum dihubungkan ke cabang mana pun. ' +
                             'Hubungi admin head office.</div>';
  document.getElementById('monthly-section').style.display = 'none';
  el.btnSaveAll.disabled = true;
} else {
  el.branch.innerHTML = allowed.map(b =>
    `<option value="${b.id}">${escapeHtml(b.code)} — ${escapeHtml(b.name)}</option>`).join('');
  el.branch.disabled = !isAdmin;
  state.branchId = allowed[0].id;
  state.branchName = allowed[0].name;
  await load();
}

el.branch.addEventListener('change', () => {
  state.branchId = el.branch.value;
  state.branchName = allowed.find(b => b.id === state.branchId)?.name ?? '';
  load();
});
el.btnSaveAll.addEventListener('click', saveAll);

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
  refreshDirtyCount();
  el.band.innerHTML = '';
  el.monthlyWrap.innerHTML = '<div class="skeleton">Memuat…</div>';
  el.weeklyWrap.innerHTML = '<div class="skeleton">Memuat data…</div>';
  showNote('note', '');

  const { year, month } = state.active;
  const prev = prevPeriod(year, month);

  const [{ data: salesmen, error: e1 }, { data: entries, error: e2 }, { data: prevEntries }] = await Promise.all([
    sb.from('salesmen').select('id, name, sort_order')
      .eq('branch_id', state.branchId).eq('is_active', true).order('sort_order'),
    sb.from('mos_entries').select('*')
      .eq('branch_id', state.branchId)
      .eq('period_year', year).eq('period_month', month),
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
    el.monthlyWrap.innerHTML = '';
    el.weeklyWrap.innerHTML = '<div class="skeleton">Cabang ini belum punya salesman terdaftar.</div>';
    return;
  }

  renderBand();
  renderMonthlyGrid();
  renderWeeklyGrid();
}

function blankRow(salesmanId) {
  const r = { salesman_id: salesmanId, branch_id: state.branchId,
              period_year: state.active.year, period_month: state.active.month };
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
    <span>Periode</span> <b>${MONTHS[state.active.month - 1]} ${state.active.year}</b>
    <span class="sep">·</span>
    <span>Minggu</span> <b>${state.week}</b>
    <span class="progress">${filled} dari ${state.salesmen.length} sudah diisi</span>
  `;
}

/* ---------- Pembanding minggu lalu & kunci ------------------------------ */
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

function rowHasAnomaly(row, sid) {
  return Object.entries(WEEK_FIELDS).some(([base, tpl]) => {
    const key = tpl(state.week);
    return isAnomaly(row[key], prevValue(base, row, sid));
  });
}

/** Minggu ini sudah disubmit & terkunci untuk cabang? (admin selalu bebas) */
function isWeekLocked(row) {
  return !isAdmin && !!row[`w${state.week}_submitted`];
}

/* ---------- Tabel: Data bulanan ----------------------------------------- */
function renderMonthlyGrid() {
  const cols = MONTHLY_FIELDS.map(k => COL.get(k));

  let html = '<table class="mos"><thead><tr><th class="sticky-only">SALESMAN</th>';
  for (const c of cols) html += `<th>${escapeHtml(c.path[c.path.length - 1])}</th>`;
  html += '</tr></thead><tbody>';

  for (const s of state.salesmen) {
    const row = state.rows.get(s.id);
    html += `<tr data-sid="${s.id}"><td class="sticky-only">${escapeHtml(s.name)}</td>`;
    for (const c of cols) {
      const v = row[c.key] ?? (c.type === 'text' ? '' : 0);
      html += c.type === 'text'
        ? `<td class="txt"><input type="text" data-key="${c.key}" value="${escapeHtml(v)}"></td>`
        : `<td><input type="number" step="any" inputmode="decimal" data-key="${c.key}" value="${v}"></td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  el.monthlyWrap.innerHTML = html;

  el.monthlyWrap.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => onGridEdit(inp));
  });
}

/* ---------- Tabel: Data minggu ini --------------------------------------- */
function renderWeeklyGrid() {
  const w = state.week;
  const inputCols = weeklyInputCols(w);
  const showPrev = el.showPrev.checked;
  const calcLabels = {
    total_ol_prtm: 'Total OL PRTM', balance_prtm: 'Balance PRTM',
    total_po: 'Total PO', total_po_outlook: 'Total PO Outlook',
  };

  let html = '<table class="mos"><thead><tr><th class="sticky-only">SALESMAN</th>';
  for (const c of inputCols) html += `<th class="live">${escapeHtml(c.label)}</th>`;
  for (const k of WEEKLY_CALC) html += `<th>${escapeHtml(calcLabels[k])}</th>`;
  html += '<th>STATUS</th></tr></thead><tbody>';

  for (const s of state.salesmen) {
    const row = state.rows.get(s.id);
    const calc = computeRow(row, w);
    const locked = isWeekLocked(row);
    const anomaly = rowHasAnomaly(row, s.id);
    const statusCls = state.dirty.has(s.id) ? 'pending' : locked ? 'locked' : (row.id || hasAnyData(row)) ? 'saved' : '';
    const statusTxt = state.dirty.has(s.id) ? 'Belum disimpan' : locked ? '🔒 Terkunci' : row.id ? 'Tersimpan' : 'Kosong';

    html += `<tr data-sid="${s.id}" class="${locked ? 'locked-row' : ''}">` +
            `<td class="sticky-only">${escapeHtml(s.name)}${anomaly ? ' <span class="warnflag" title="Ada angka beda jauh dari minggu lalu">!</span>' : ''}</td>`;
    for (const c of inputCols) {
      const v = row[c.key] ?? 0;
      const anom = isAnomaly(v, prevValue(c.base, row, s.id));
      html += `<td class="${anom ? 'anomaly' : ''}"><input type="number" step="any" inputmode="decimal" data-key="${c.key}" data-base="${c.base}" value="${v}"${locked ? ' disabled' : ''}></td>`;
    }
    for (const k of WEEKLY_CALC) {
      const v = calc[k];
      html += `<td class="calc ${v < 0 ? 'neg' : ''}">${fmt(v, COL.get(k))}</td>`;
    }
    html += `<td class="stat ${statusCls}"><span class="dot"></span><span class="stat-label">${statusTxt}</span></td></tr>`;

    if (showPrev) {
      html += `<tr class="prevrow"><td class="sticky-only">↳ minggu ${state.week > 1 ? state.week - 1 : '4 (bln lalu)'}</td>`;
      for (const c of inputCols) {
        const pv = prevValue(c.base, row, s.id);
        html += `<td>${pv === null ? '—' : fmt(pv, COL.get(c.key))}</td>`;
      }
      html += `<td colspan="${WEEKLY_CALC.length + 1}"></td></tr>`;
    }
  }
  html += '</tbody></table>';
  el.weeklyWrap.innerHTML = html;

  el.weeklyWrap.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => onGridEdit(inp));
  });
  el.weeklyWrap.addEventListener('paste', onPaste);
}

/* ---------- Edit sel (perbarui kalkulasi tanpa render ulang tabel) -------- */
function onGridEdit(inp) {
  const tr = inp.closest('tr[data-sid]');
  const sid = tr.dataset.sid;
  const row = state.rows.get(sid);
  const key = inp.dataset.key;
  const c = COL.get(key);
  row[key] = c.type === 'text' ? inp.value : (parseFloat(inp.value) || 0);
  state.dirty.add(sid);
  refreshDirtyCount();

  const statCell = tr.querySelector('td.stat');
  if (statCell) {
    statCell.className = 'stat pending';
    statCell.innerHTML = '<span class="dot"></span><span class="stat-label">Belum disimpan</span>';
  }

  if (!inp.closest('#weeklywrap')) return; // field bulanan: cukup tandai dirty, tidak ada kalkulasi di tabel ini

  const w = state.week;
  const calc = computeRow(row, w);
  const calcCells = tr.querySelectorAll('td.calc');
  WEEKLY_CALC.forEach((k, i) => {
    const v = calc[k];
    calcCells[i].textContent = fmt(v, COL.get(k));
    calcCells[i].classList.toggle('neg', v < 0);
  });

  const base = inp.dataset.base;
  if (base) {
    inp.closest('td').classList.toggle('anomaly', isAnomaly(row[key], prevValue(base, row, sid)));
  }
}

function refreshDirtyCount() {
  const n = document.getElementById('dirty-count');
  if (n) n.textContent = state.dirty.size;
}

/* ---------- Tempel blok dari Excel ---------------------------------------- */
function onPaste(e) {
  const start = e.target;
  if (!start.matches('input')) return;
  const text = e.clipboardData.getData('text/plain');
  if (!text.includes('\t') && !text.includes('\n')) return;
  e.preventDefault();

  const matrix = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(l => l.split('\t'));
  const rows = [...el.weeklyWrap.querySelectorAll('tbody tr[data-sid]')];
  const r0 = rows.indexOf(start.closest('tr'));
  const inputsOf = tr => [...tr.querySelectorAll('input')];
  const c0 = inputsOf(rows[r0]).indexOf(start);

  matrix.forEach((line, i) => {
    const tr = rows[r0 + i];
    if (!tr) return;
    const inputs = inputsOf(tr);
    line.forEach((cell, j) => {
      const inp = inputs[c0 + j];
      if (!inp || inp.disabled) return;
      inp.value = parseFloat(String(cell).replace(/\./g, '').replace(',', '.')) || 0;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  showNote('note', `${matrix.length} baris ditempel. Periksa dulu, lalu klik Simpan Semua.`, 'info');
}

/* ---------- Menyimpan ---------------------------------------------------- */
function toPayload(sid) {
  const r = state.rows.get(sid);
  const out = { period_year: state.active.year, period_month: state.active.month,
                branch_id: state.branchId, salesman_id: sid };
  for (const c of STORED) out[c.key] = c.type === 'text' ? (r[c.key] || null) : (Number(r[c.key]) || 0);

  // Kunci minggu ini hanya kalau angka mingguannya benar-benar diisi (bukan nol semua),
  // supaya menyimpan perubahan field bulanan saja tidak ikut mengunci minggu ini.
  const w = state.week;
  const touchedWeek = weekFieldKeysFor(w).some(k => Number(r[k]) !== 0);
  if (touchedWeek) out[`w${w}_submitted`] = true;

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
  refreshDirtyCount();
  return true;
}

async function saveAll() {
  if (!state.dirty.size) { showNote('note', 'Tidak ada perubahan untuk disimpan.', 'info'); return; }

  const w = state.week;
  const firstTimeCount = [...state.dirty].filter(sid => {
    const r = state.rows.get(sid);
    const touchedWeek = weekFieldKeysFor(w).some(k => Number(r[k]) !== 0);
    return !isAdmin && touchedWeek && !r[`w${w}_submitted`];
  }).length;

  if (firstTimeCount > 0) {
    const proceed = confirm(
      `Menyimpan akan mengunci data minggu ${w} untuk ${firstTimeCount} salesman yang baru pertama kali ` +
      `disubmit minggu ini — tidak bisa diubah lagi kecuali oleh admin head office. Lanjutkan?`);
    if (!proceed) return;
  }

  showNote('note', '');
  el.btnSaveAll.disabled = true;
  const ok = await persist([...state.dirty]);
  el.btnSaveAll.disabled = false;

  if (ok) {
    showNote('note', 'Semua perubahan tersimpan.', 'ok');
    renderBand();
    renderMonthlyGrid();
    renderWeeklyGrid();
  }
}
