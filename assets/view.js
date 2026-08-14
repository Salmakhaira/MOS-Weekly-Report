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

import { sb, requireSession, renderShell, showNote, escapeHtml, closeFilterDropdownsOnOutsideClick } from './app.js';
import { COLUMNS, MONTHS, WEEKS, computeRow, aggregate, buildHeaderMatrix, fmt } from './schema.js';

const { profile } = await requireSession();
renderShell(profile, 'view');

const TREND_METRICS = [
  { key: 'total_ol_prtm',    label: 'Total OL PRTM',    short: 'OL PRTM' },
  { key: 'balance_prtm',     label: 'Balance PRTM',     short: 'Balance' },
  { key: 'total_po',         label: 'Total PO',         short: 'PO' },
  { key: 'total_po_outlook', label: 'Total PO Outlook', short: 'Outlook' },
];
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

const el = {
  ddYear: document.getElementById('dd-year'),
  panelYear: document.getElementById('panel-year'),
  lblYear: document.getElementById('lbl-year'),
  ddMonth: document.getElementById('dd-month'),
  panelMonth: document.getElementById('panel-month'),
  lblMonth: document.getElementById('lbl-month'),
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
const ALL_MONTHS = MONTHS.map((_, i) => i + 1);

const state = {
  years: new Set([thisYear]),
  months: new Set([new Date().getMonth() + 1]),
  week: Math.min(4, Math.ceil(new Date().getDate() / 7)),
  branchFilter: '',
  areas: [], branches: [], salesmen: [], entries: [],
  isSingle: true,
  trendMetric: 'total_ol_prtm',
  expandedYears: new Set(),
};

/* ---------- Checklist Tahun & Bulan (multi-pilih) ----------------------- */
function updateYearLabel() {
  const n = state.years.size;
  el.lblYear.textContent = n === YEAR_RANGE.length ? 'Semua tahun'
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
    ${YEAR_RANGE.map(y => `<label><input type="checkbox" value="${y}" ${state.years.has(y) ? 'checked' : ''}> ${y}</label>`).join('')}
  `;
  el.panelYear.querySelector('#cb-year-all').checked = state.years.size === YEAR_RANGE.length;
  el.panelYear.querySelectorAll('input[type=checkbox]:not(#cb-year-all)').forEach(cb => {
    cb.addEventListener('change', () => {
      const y = +cb.value;
      if (cb.checked) state.years.add(y);
      else if (state.years.size > 1) state.years.delete(y);
      else cb.checked = true;
      el.panelYear.querySelector('#cb-year-all').checked = state.years.size === YEAR_RANGE.length;
      updateYearLabel();
      load();
    });
  });
  el.panelYear.querySelector('#cb-year-all').addEventListener('change', (e) => {
    state.years = new Set(e.target.checked ? YEAR_RANGE : [thisYear]);
    renderYearPanel();
    load();
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
      updateMonthLabel();
      load();
    });
  });
  el.panelMonth.querySelector('#cb-month-all').addEventListener('change', (e) => {
    state.months = new Set(e.target.checked ? ALL_MONTHS : [new Date().getMonth() + 1]);
    renderMonthPanel();
    load();
  });
  updateMonthLabel();
}

renderYearPanel();
renderMonthPanel();
closeFilterDropdownsOnOutsideClick();
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
  state.isSingle = state.years.size === 1 && state.months.size === 1;

  let query = sb.from('mos_entries').select('*');
  if (state.isSingle) {
    const [y] = state.years, [m] = state.months;
    query = query.eq('period_year', y).eq('period_month', m);
  } else {
    // Mode tren: ambil semua bulan (bukan cuma yang dicentang di filter bulan,
    // karena kolom tahun bisa dibuka jadi 12 bulan kapan saja), plus 1 tahun
    // sebelum tahun paling awal yang dipilih, supaya badge %perubahan tahun
    // pertama tetap punya pembanding.
    const years = [...state.years];
    const minY = Math.min(...years) - 1;
    const maxY = Math.max(...years);
    const range = [];
    for (let y = minY; y <= maxY; y++) range.push(y);
    query = query.in('period_year', range);
  }

  const { data, error } = await query;
  if (error) { showNote('note', 'Gagal memuat data: ' + error.message, 'err'); return; }
  state.entries = data ?? [];
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

/* ---------- Mode TREN (lebih dari satu periode) — kolom tahun bisa dibuka -- */
function trendRowsSpec() {
  if (state.branchFilter) {
    const b = state.branches.find(x => x.id === state.branchFilter);
    return [{ label: b?.name ?? '', branchIds: [state.branchFilter], kind: 'branch' }];
  }
  const rows = state.branches.map(b => ({ label: b.name, branchIds: [b.id], kind: 'branch' }));
  rows.push({ label: 'GRAND TOTAL', branchIds: state.branches.map(b => b.id), kind: 'grand' });
  return rows;
}

/** Jumlahkan data satu tahun penuh (month=null) atau satu bulan tertentu,
    untuk kumpulan cabang tertentu, lalu hitung rumus (pakai minggu terpilih). */
function aggFor(branchIds, year, month) {
  const salesmenIds = new Set(state.salesmen.filter(s => branchIds.includes(s.branch_id)).map(s => s.id));
  const raws = state.entries.filter(e =>
    e.period_year === year && (month ? e.period_month === month : true) && salesmenIds.has(e.salesman_id));
  return aggregate(raws, state.week);
}

function pctBadge(curr, prev) {
  const c = Number(curr) || 0, p = Number(prev) || 0;
  // Kalau salah satu periode masih kosong (belum ada data sama sekali),
  // jangan tampilkan badge — itu bukan perbandingan yang bermakna
  // ("turun ke nol" vs "memang belum diisi" adalah dua hal berbeda).
  if (!p || !c) return '';
  const pct = ((c - p) / Math.abs(p)) * 100;
  const cls = pct >= 0 ? 'up' : 'down';
  const arrow = pct >= 0 ? '▲' : '▼';
  return `<span class="pct ${cls}">${arrow} ${Math.abs(pct).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%</span>`;
}

/** Sel "Total" untuk tahun yang TERTUTUP: tampilkan keempat metrik sekaligus,
    metrik yang sedang aktif (dipilih di dropdown) ditebalkan + diberi badge. */
function collapsedYearCell(branchIds, y) {
  const rows = TREND_METRICS.map(m => {
    const total = aggFor(branchIds, y, null)[m.key];
    const prevTotal = aggFor(branchIds, y - 1, null)[m.key];
    const active = m.key === state.trendMetric;
    const col = COLUMNS.find(c => c.key === m.key);
    return `<div class="mm-row${active ? ' active' : ''}">
      <span class="mm-label">${escapeHtml(m.short)}</span>
      <span class="mm-val ${Number(total) < 0 ? 'neg' : ''}">${escapeHtml(fmt(total, col))}</span>
      ${active ? pctBadge(total, prevTotal) : ''}
    </div>`;
  }).join('');
  return `<td class="multimetric">${rows}</td>`;
}

function drawTrendExpandable() {
  const years = [...state.years].sort((a, b) => a - b);
  const metricCol = COLUMNS.find(c => c.key === state.trendMetric);
  const rows = trendRowsSpec();

  let head1 = '<th class="sticky-only" rowspan="2">CABANG</th>';
  let head2 = '';
  for (const y of years) {
    const open = state.expandedYears.has(y);
    if (open) {
      head1 += `<th colspan="13" class="year-toggle" data-year="${y}"><span class="yr-icon">−</span>${y}</th>`;
      MONTH_ABBR.forEach(m => head2 += `<th>${m}</th>`);
      head2 += `<th>Total (${escapeHtml(metricCol.path[metricCol.path.length - 1])})</th>`;
    } else {
      head1 += `<th rowspan="2" class="year-toggle" data-year="${y}"><span class="yr-icon">+</span>${y}</th>`;
    }
  }

  let body = '';
  for (const row of rows) {
    body += `<tr class="${row.kind}"><td class="sticky-only">${escapeHtml(row.label)}</td>`;
    for (const y of years) {
      if (state.expandedYears.has(y)) {
        for (let m = 1; m <= 12; m++) {
          const v = aggFor(row.branchIds, y, m)[state.trendMetric];
          body += `<td class="${Number(v) < 0 ? 'neg' : ''}">${escapeHtml(fmt(v, metricCol))}</td>`;
        }
        const total = aggFor(row.branchIds, y, null)[state.trendMetric];
        const prevTotal = aggFor(row.branchIds, y - 1, null)[state.trendMetric];
        body += `<td class="${Number(total) < 0 ? 'neg' : ''}">${escapeHtml(fmt(total, metricCol))}${pctBadge(total, prevTotal)}</td>`;
      } else {
        body += collapsedYearCell(row.branchIds, y);
      }
    }
    body += '</tr>';
  }

  const scope = state.branchFilter
    ? state.branches.find(b => b.id === state.branchFilter)?.name ?? ''
    : 'semua cabang';

  el.wrap.innerHTML = `
    <div class="trendtoolbar">
      <label>Metrik aktif (dipakai saat tahun dibuka):
        <select id="trend-metric">
          ${TREND_METRICS.map(m => `<option value="${m.key}" ${m.key === state.trendMetric ? 'selected' : ''}>${m.label}</option>`).join('')}
        </select>
      </label>
      <span class="hint">
        Menampilkan <b>${escapeHtml(scope)}</b>. Kolom tahun tertutup menampilkan keempat metrik sekaligus;
        klik nama tahun untuk buka rincian per bulan (fokus ke metrik aktif saja).
        Total tiap tahun = jumlah angka minggu ${state.week} dari tiap bulan yang ada datanya.
      </span>
    </div>
    <table class="trendtable"><thead><tr>${head1}</tr><tr>${head2}</tr></thead><tbody>${body}</tbody></table>`;

  document.getElementById('trend-metric').addEventListener('change', (e) => {
    state.trendMetric = e.target.value;
    drawTrendExpandable();
  });
  el.wrap.querySelectorAll('.year-toggle').forEach(th => {
    th.addEventListener('click', () => {
      const y = +th.dataset.year;
      if (state.expandedYears.has(y)) state.expandedYears.delete(y); else state.expandedYears.add(y);
      drawTrendExpandable();
    });
  });
}

function draw() {
  el.legend.style.display = state.isSingle ? '' : 'none';
  if (state.isSingle) drawDetail(); else drawTrendExpandable();
}

/* ---------- Ekspor Excel (rapi: judul, header tebal, lebar kolom, beku) --- */
const FILL_TITLE  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12211F' } };
const FILL_HEAD   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EEEC' } };
const FILL_BRANCH = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF4F2' } };
const FILL_AREA   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDFE8E5' } };
const FILL_TOTAL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF243935' } };
const FILL_GRAND  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F6E64' } };
const THIN_BORDER = { style: 'thin', color: { argb: 'FFD9E0DC' } };
const NUMFMT = '#,##0.######';

function styleTitleRow(ws, rowNum, text, size, lastCol) {
  ws.mergeCells(rowNum, 1, rowNum, lastCol);
  const cell = ws.getCell(rowNum, 1);
  cell.value = text;
  cell.font = { bold: true, size, color: { argb: size >= 14 ? 'FFFFFFFF' : 'FF12211F' } };
  cell.alignment = { vertical: 'middle', horizontal: 'left' };
  if (size >= 14) {
    for (let c = 1; c <= lastCol; c++) ws.getCell(rowNum, c).fill = FILL_TITLE;
  }
}

function writeHeaderRow(ws, rowNum, labels) {
  labels.forEach((label, i) => {
    const cell = ws.getCell(rowNum, i + 1);
    cell.value = label;
    cell.font = { bold: true, size: 10 };
    cell.fill = FILL_HEAD;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER };
  });
  ws.getRow(rowNum).height = 46;
}

function writeDataCell(ws, r, c, value, isText, negative) {
  const cell = ws.getCell(r, c);
  if (isText) {
    cell.value = value ?? '';
  } else {
    cell.value = Number(value) || 0;
    cell.numFmt = NUMFMT;
    if (negative) cell.font = { color: { argb: 'FFA32B2B' } };
  }
  cell.border = { bottom: { style: 'hair', color: { argb: 'FFEEF1EF' } } };
}

async function buildDetailSheet(wb) {
  const [year] = state.years, [month] = state.months;
  const cols = COLUMNS;
  const lastCol = 3 + cols.length;
  const ws = wb.addWorksheet(`MOS ${MONTHS[month - 1]} ${year} W${state.week}`.slice(0, 31));

  styleTitleRow(ws, 1, 'WEEKLY REPORT MOS NASIONAL', 14, lastCol);
  styleTitleRow(ws, 2, `${MONTHS[month - 1]} ${year} · Minggu ${state.week}${state.branchFilter ? ' · ' + (state.branches.find(b => b.id === state.branchFilter)?.name ?? '') : ''}`, 11, lastCol);
  styleTitleRow(ws, 3, `Diekspor: ${new Date().toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' })}`, 9, lastCol);
  ws.getRow(3).font = { italic: true, size: 9, color: { argb: 'FF74837F' } };

  const headerRow = 5;
  const labels = ['NO', 'PLANT', 'BRANCH', ...cols.map(c => c.path.join(' — '))];
  writeHeaderRow(ws, headerRow, labels);

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 10;
  ws.getColumn(3).width = 24;
  for (let i = 0; i < cols.length; i++) ws.getColumn(4 + i).width = 15;

  let r = headerRow + 1;
  for (const row of buildDetailModel(year, month)) {
    if (row.kind === 'spacer') { r++; continue; }
    writeDataCell(ws, r, 1, row.no, true);
    writeDataCell(ws, r, 2, row.plant, true);
    writeDataCell(ws, r, 3, row.name, true);
    cols.forEach((c, i) => {
      const v = row.data?.[c.key];
      writeDataCell(ws, r, 4 + i, v, c.type === 'text', Number(v) < 0);
    });
    const fill = { branch: FILL_BRANCH, area: FILL_AREA, total: FILL_TOTAL, grand: FILL_GRAND }[row.kind];
    if (fill) {
      const bold = row.kind === 'total' || row.kind === 'grand';
      const white = row.kind === 'total' || row.kind === 'grand';
      for (let c = 1; c <= lastCol; c++) {
        const cell = ws.getCell(r, c);
        cell.fill = fill;
        if (bold) cell.font = { ...(cell.font ?? {}), bold: true, color: { argb: white ? 'FFFFFFFF' : cell.font?.color?.argb } };
      }
    }
    r++;
  }

  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: headerRow }];
}

async function buildTrendSheet(wb) {
  const years = [...state.years].sort((a, b) => a - b);
  const metricCol = COLUMNS.find(c => c.key === state.trendMetric);
  const rows = trendRowsSpec();
  const lastCol = 1 + years.length * 13;
  const ws = wb.addWorksheet(`Tren ${metricCol.path[metricCol.path.length - 1]} ${years.join('-')}`.slice(0, 31));

  const scope = state.branchFilter
    ? state.branches.find(b => b.id === state.branchFilter)?.name ?? '' : 'Semua cabang';
  styleTitleRow(ws, 1, 'WEEKLY REPORT MOS NASIONAL — TREN', 14, lastCol);
  styleTitleRow(ws, 2, `${metricCol.path[metricCol.path.length - 1]} · ${scope} · Minggu ${state.week}`, 11, lastCol);
  styleTitleRow(ws, 3, `Diekspor: ${new Date().toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' })}. Total tahun = jumlah angka minggu ${state.week} tiap bulan.`, 9, lastCol);
  ws.getRow(3).font = { italic: true, size: 9, color: { argb: 'FF74837F' } };

  const headerRow = 5;
  const labels = ['Cabang'];
  years.forEach(y => { MONTH_ABBR.forEach(m => labels.push(`${m} ${y}`)); labels.push(`Total ${y}`); });
  writeHeaderRow(ws, headerRow, labels);

  ws.getColumn(1).width = 22;
  for (let i = 2; i <= lastCol; i++) ws.getColumn(i).width = 12;

  let r = headerRow + 1;
  for (const row of rows) {
    writeDataCell(ws, r, 1, row.label, true);
    let c = 2;
    for (const y of years) {
      for (let m = 1; m <= 12; m++) {
        const v = aggFor(row.branchIds, y, m)[state.trendMetric];
        writeDataCell(ws, r, c++, v, false, Number(v) < 0);
      }
      const total = aggFor(row.branchIds, y, null)[state.trendMetric];
      writeDataCell(ws, r, c++, total, false, Number(total) < 0);
    }
    if (row.kind === 'grand') {
      for (let cc = 1; cc <= lastCol; cc++) {
        const cell = ws.getCell(r, cc);
        cell.fill = FILL_GRAND;
        cell.font = { ...(cell.font ?? {}), bold: true, color: { argb: 'FFFFFFFF' } };
      }
    }
    r++;
  }

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: headerRow }];
}

async function exportFile() {
  el.export.disabled = true;
  try {
    const mod = await import('https://esm.sh/exceljs@4.4.0');
    const ExcelJS = mod.default ?? mod;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Weekly Report MOS';
    wb.created = new Date();

    if (state.isSingle) await buildDetailSheet(wb); else await buildTrendSheet(wb);

    const buf = await wb.xlsx.writeBuffer();
    const [year] = state.years, [month] = state.months;
    const metricCol = COLUMNS.find(c => c.key === state.trendMetric);
    const name = state.isSingle
      ? `MOS ${MONTHS[month - 1]} ${year} W${state.week}`
      : `Tren ${metricCol.path[metricCol.path.length - 1]} ${[...state.years].sort((a, b) => a - b).join('-')}`;
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name + '.xlsx' });
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
    showNote('note', 'Gagal membuat file Excel: ' + (err.message || err), 'err');
  } finally {
    el.export.disabled = false;
  }
}
