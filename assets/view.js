/* =====================================================================
   view.js — menyusun ulang tampilan Weekly Report dari data mentah.

   Ada dua bentuk tabel tergantung filter:
   - Tepat 1 bulan + 1 tahun dipilih -> tabel DETAIL, persis Excel
     (kolom A sampai BX, per cabang & salesman).
   - Lebih dari satu bulan/tahun (atau "semua") dipilih -> tabel TREN:
     satu baris per periode, hanya 4 angka kunci per baris. Kolom A-BX
     dipaksakan ke banyak bulan sekaligus akan jadi ratusan kolom dan
     tidak terbaca, jadi bentuknya sengaja diringkas untuk melihat
     perkembangan dari waktu ke waktu.
   ===================================================================== */

import { sb, requireSession, renderShell, showNote, escapeHtml } from './app.js';
import { COLUMNS, MONTHS, WEEKS, computeRow, aggregate, buildHeaderMatrix, fmt } from './schema.js';

const { profile } = await requireSession();
renderShell(profile, 'view');

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const TREND_KEYS = ['total_ol_prtm', 'balance_prtm', 'total_po', 'total_po_outlook'];

const el = {
  years: document.getElementById('f-years'),
  months: document.getElementById('f-months'),
  week: document.getElementById('f-week'),
  branch: document.getElementById('f-branch'),
  detailWrap: document.getElementById('detail-toggle-wrap'),
  detail: document.getElementById('f-detail'),
  wrap: document.getElementById('tablewrap'),
  export: document.getElementById('btn-export'),
  legend: document.getElementById('legend-detail'),
  lblWeek: document.getElementById('lbl-week'),
};

const thisYear = new Date().getFullYear();
const YEAR_RANGE = [thisYear - 2, thisYear - 1, thisYear, thisYear + 1];

const state = {
  years: new Set([thisYear]),
  months: new Set([new Date().getMonth() + 1]),
  week: Math.min(4, Math.ceil(new Date().getDate() / 7)),
  branchFilter: '',
  areas: [], branches: [], salesmen: [], entries: [],
  isSingle: true,
};

/* ---------- Pill tahun & bulan (multi-pilih) --------------------------- */
function renderYearPills() {
  const allOn = YEAR_RANGE.every(y => state.years.has(y));
  el.years.innerHTML =
    `<button type="button" class="all" data-all aria-pressed="${allOn}">Semua</button>` +
    YEAR_RANGE.map(y =>
      `<button type="button" data-y="${y}" aria-pressed="${state.years.has(y)}">${y}</button>`).join('');

  el.years.querySelector('[data-all]').addEventListener('click', () => {
    state.years = allOn ? new Set([thisYear]) : new Set(YEAR_RANGE);
    renderYearPills(); load();
  });
  el.years.querySelectorAll('[data-y]').forEach(btn => {
    btn.addEventListener('click', () => {
      const y = +btn.dataset.y;
      if (state.years.has(y)) { if (state.years.size > 1) state.years.delete(y); }
      else state.years.add(y);
      renderYearPills(); load();
    });
  });
}

function renderMonthPills() {
  const allOn = state.months.size === 12;
  el.months.innerHTML =
    `<button type="button" class="all" data-all aria-pressed="${allOn}">Semua</button>` +
    MONTH_SHORT.map((m, i) => {
      const n = i + 1;
      return `<button type="button" data-m="${n}" aria-pressed="${state.months.has(n)}">${m}</button>`;
    }).join('');

  el.months.querySelector('[data-all]').addEventListener('click', () => {
    state.months = allOn ? new Set([new Date().getMonth() + 1]) : new Set(MONTH_SHORT.map((_, i) => i + 1));
    renderMonthPills(); load();
  });
  el.months.querySelectorAll('[data-m]').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = +btn.dataset.m;
      if (state.months.has(m)) { if (state.months.size > 1) state.months.delete(m); }
      else state.months.add(m);
      renderMonthPills(); load();
    });
  });
}

renderYearPills();
renderMonthPills();
el.week.innerHTML = WEEKS.map(w =>
  `<button type="button" data-week="${w}" aria-pressed="${w === state.week}">W${w}</button>`).join('');
el.lblWeek.textContent = state.week;
el.week.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-week]');
  if (!b) return;
  state.week = +b.dataset.week;
  el.lblWeek.textContent = state.week;
  [...el.week.children].forEach(x => x.setAttribute('aria-pressed', x === b));
  draw();
});

el.branch.addEventListener('change', () => { state.branchFilter = el.branch.value; draw(); });
el.detail.addEventListener('change', draw);
el.export.addEventListener('click', exportFile);

await loadMasters();
await load();

async function loadMasters() {
  const [{ data: areas }, { data: branches }, { data: salesmen }] = await Promise.all([
    sb.from('areas').select('code, name, sort_order').order('sort_order'),
    sb.from('branches').select('id, code, name, area_code, sort_order').eq('is_active', true).order('sort_order'),
    sb.from('salesmen').select('id, branch_id, name, sort_order').eq('is_active', true).order('sort_order'),
  ]);
  state.areas = areas ?? [];
  state.branches = branches ?? [];
  state.salesmen = salesmen ?? [];
  el.branch.insertAdjacentHTML('beforeend', state.branches.map(b =>
    `<option value="${b.id}">${escapeHtml(b.code)} — ${escapeHtml(b.name)}</option>`).join(''));
}

async function load() {
  el.wrap.innerHTML = '<div class="skeleton">Memuat data…</div>';
  const { data, error } = await sb.from('mos_entries').select('*')
    .in('period_year', [...state.years]).in('period_month', [...state.months]);
  if (error) { showNote('note', 'Gagal memuat data: ' + error.message, 'err'); return; }
  state.entries = data ?? [];
  state.isSingle = state.years.size === 1 && state.months.size === 1;
  showNote('note', state.entries.length ? '' : 'Belum ada data untuk periode yang dipilih.', 'info');
  el.detailWrap.style.display = state.isSingle ? '' : 'none';
  draw();
}

/* ---------- Mode DETAIL (satu periode) ---------------------------------- */
function buildDetailModel(year, month) {
  const byId = new Map(
    state.entries.filter(e => e.period_year === year && e.period_month === month)
      .map(e => [e.salesman_id, e]));
  const branches = state.branchFilter
    ? state.branches.filter(b => b.id === state.branchFilter)
    : state.branches;

  const model = [];
  const branchAgg = new Map();
  let no = 0;

  for (const b of branches) {
    const people = state.salesmen.filter(s => s.branch_id === b.id);
    const raws = people.map(s => byId.get(s.id) ?? {});
    const agg = aggregate(raws, state.week);
    branchAgg.set(b.id, { branch: b, raws });
    no++;

    model.push({ kind: 'branch', no, plant: b.code, name: b.name, data: agg });
    if (el.detail.checked) {
      people.forEach(s => model.push({
        kind: 'sales', no: '', plant: '', name: s.name,
        data: computeRow(byId.get(s.id) ?? {}, state.week),
      }));
    }
    model.push({ kind: 'spacer' });
  }

  const allRaws = [...branchAgg.values()].flatMap(x => x.raws);
  model.push({ kind: 'total', no: 'TOTAL', plant: '', name: '', data: aggregate(allRaws, state.week) });
  model.push({ kind: 'spacer' });

  for (const a of state.areas) {
    const raws = [...branchAgg.values()]
      .filter(x => x.branch.area_code === a.code).flatMap(x => x.raws);
    model.push({ kind: 'area', no: '', plant: '', name: a.name, data: aggregate(raws, state.week) });
  }
  model.push({ kind: 'grand', no: '', plant: '', name: 'GRAND TOTAL', data: aggregate(allRaws, state.week) });

  return model;
}

function drawDetail() {
  const [year] = state.years;
  const [month] = state.months;
  const cols = COLUMNS;
  const head = buildHeaderMatrix(cols);
  const mark = new RegExp('W' + state.week + '$');

  let html = '<table class="mos"><thead>';
  for (let lvl = 0; lvl < 3; lvl++) {
    html += '<tr>';
    if (lvl === 0) {
      html += '<th class="sticky-1" rowspan="3">NO</th>' +
              '<th class="sticky-2" rowspan="3">PLANT</th>' +
              '<th class="sticky-3" rowspan="3">BRANCH</th>';
    }
    for (const c of head[lvl]) {
      const live = mark.test(c.label.trim()) ? ' class="live"' : '';
      html += `<th colspan="${c.colspan}" rowspan="${c.rowspan}"${live}>${escapeHtml(c.label)}</th>`;
    }
    html += '</tr>';
  }
  html += '</thead><tbody>';

  for (const row of buildDetailModel(year, month)) {
    if (row.kind === 'spacer') {
      html += `<tr class="spacer"><td colspan="${cols.length + 3}"></td></tr>`;
      continue;
    }
    html += `<tr class="${row.kind}">` +
            `<td class="sticky-1">${escapeHtml(row.no)}</td>` +
            `<td class="sticky-2">${escapeHtml(row.plant)}</td>` +
            `<td class="sticky-3">${escapeHtml(row.name)}</td>`;
    for (const c of cols) {
      const v = row.data?.[c.key];
      const neg = c.type !== 'text' && Number(v) < 0 ? ' neg' : '';
      const txt = c.type === 'text' ? ' txt' : '';
      html += `<td class="${neg}${txt}">${escapeHtml(fmt(v, c))}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  el.wrap.innerHTML = html;
}

/* ---------- Mode TREN (lebih dari satu periode) -------------------------- */
function periodCombos() {
  const combos = [];
  for (const y of [...state.years].sort((a, b) => a - b)) {
    for (const m of [...state.months].sort((a, b) => a - b)) combos.push({ year: y, month: m });
  }
  return combos;
}

function buildTrendModel() {
  const branchIds = state.branchFilter
    ? [state.branchFilter]
    : state.branches.map(b => b.id);
  const salesmenIds = new Set(state.salesmen.filter(s => branchIds.includes(s.branch_id)).map(s => s.id));

  return periodCombos().map(({ year, month }) => {
    const raws = state.entries.filter(e =>
      e.period_year === year && e.period_month === month && salesmenIds.has(e.salesman_id));
    return { year, month, data: aggregate(raws, state.week) };
  });
}

function drawTrend() {
  const scope = state.branchFilter
    ? state.branches.find(b => b.id === state.branchFilter)?.name ?? ''
    : 'Nasional (semua cabang)';

  const cols = TREND_KEYS.map(k => COLUMNS.find(c => c.key === k));

  let html = `
    <table class="trendtable">
      <thead><tr>
        <th>Periode</th>
        ${cols.map(c => `<th>${escapeHtml(c.path[c.path.length - 1])}</th>`).join('')}
      </tr></thead>
      <tbody>`;

  for (const row of buildTrendModel()) {
    html += `<tr><td>${MONTHS[row.month - 1]} ${row.year}</td>`;
    for (const c of cols) {
      const v = row.data[c.key];
      html += `<td class="${Number(v) < 0 ? 'neg' : ''}">${escapeHtml(fmt(v, c))}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';

  el.wrap.innerHTML = `
    <p class="hint" style="margin:0 0 10px">
      Menampilkan tren <b>${escapeHtml(scope)}</b>, minggu ${state.week}, dijumlah per periode
      (bukan tabel detail — pilih 1 bulan &amp; 1 tahun saja untuk melihat rincian per cabang/salesman).
    </p>
    ${html}`;
}

function draw() {
  el.legend.style.display = state.isSingle ? '' : 'none';
  if (state.isSingle) drawDetail(); else drawTrend();
}

/* ---------- Ekspor ---------------------------------------------------- */
function toDetailMatrix() {
  const [year] = state.years;
  const [month] = state.months;
  const cols = COLUMNS;
  const head = buildHeaderMatrix(cols);
  const rows = [];

  for (let lvl = 0; lvl < 3; lvl++) {
    const line = lvl === 0 ? ['NO', 'PLANT', 'BRANCH'] : ['', '', ''];
    for (const c of cols) line.push(c.path[lvl] ?? '');
    rows.push(line);
  }

  for (const r of buildDetailModel(year, month)) {
    if (r.kind === 'spacer') { rows.push([]); continue; }
    const line = [r.no, r.plant, r.name];
    for (const c of cols) {
      const v = r.data?.[c.key];
      line.push(c.type === 'text' ? (v ?? '') : (Number(v) || 0));
    }
    rows.push(line);
  }
  return { name: `MOS ${MONTHS[month - 1]} ${year} W${state.week}`, rows };
}

function toTrendMatrix() {
  const cols = TREND_KEYS.map(k => COLUMNS.find(c => c.key === k));
  const rows = [['Periode', ...cols.map(c => c.path[c.path.length - 1])]];
  for (const r of buildTrendModel()) {
    rows.push([`${MONTHS[r.month - 1]} ${r.year}`, ...cols.map(c => Number(r.data[c.key]) || 0)]);
  }
  return { name: `Tren MOS ${[...state.years].join('-')}`, rows };
}

async function exportFile() {
  const { name, rows: matrix } = state.isSingle ? toDetailMatrix() : toTrendMatrix();
  el.export.disabled = true;
  try {
    const mod = await import('https://esm.sh/xlsx@0.18.5');
    const XLSX = mod.utils ? mod : mod.default;
    const ws = XLSX.utils.aoa_to_sheet(matrix);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    XLSX.writeFile(wb, name + '.xlsx');
  } catch {
    const csv = matrix.map(line => line
      .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name + '.csv' });
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    el.export.disabled = false;
  }
}
