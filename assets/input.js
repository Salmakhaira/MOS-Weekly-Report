/* =====================================================================
   input.js (versi Upload) — ketua cabang unggah file Excel SETIAP
   MINGGU (bukan sekali per bulan). Sistem hanya membaca kolom minggu
   yang dipilih dari file, menyimpan ke database yang sama dengan
   versi form, lalu menampilkan ringkasan di halaman ini.

   Begitu satu minggu untuk satu salesman berhasil disimpan, minggu itu
   otomatis terkunci (w{n}_submitted = true) — tidak bisa diunggah ulang
   oleh cabang, hanya admin head office yang bisa mengubahnya. Penguncian
   sesungguhnya terjadi di database (trigger enforce_week_lock, lihat
   supabase/04_week_submission_lock.sql); pengecekan di sini cuma supaya
   ketua cabang dapat pesan yang jelas SEBELUM mengunggah, bukan baru
   gagal di tengah proses.

   Cara membaca file:
   1. Cari sheet yang namanya cocok dengan "BULAN TAHUN" (mis. "AGUSTUS
      2026") — sama seperti sebelumnya.
   2. Cocokkan nama di kolom C terhadap daftar salesman cabang di database.
   3. HANYA kolom minggu yang dipilih di atas yang dibaca & disimpan
      (mis. pilih W2 -> hanya kolom TM W2, Act PRTM W2, Quot Confidence
      W2 yang diambil dari file). Minggu lain yang sudah tersimpan
      sebelumnya tidak disentuh.
   4. Field yang bukan per-minggu (Market Size, Plan Sales Master, MS
      Teams Schedule, Kemampuan PO, PO Non SAP, OL Min PRTM, PO Bulan
      Lalu) selalu disegarkan dari file, karena field itu tidak
      dikunci per-minggu.
   ===================================================================== */

import { sb, requireSession, renderShell, showNote, escapeHtml } from './app.js';
import { COLUMNS, MONTHS, WEEKS, STORED, computeRow, buildHeaderMatrix, fmt } from './schema.js';

const { profile } = await requireSession();
renderShell(profile, 'input');

const isAdmin = profile.role === 'admin';
const COL = new Map(COLUMNS.map(c => [c.key, c]));

/* Kolom yang ditampilkan di ringkasan/pratinjau: isian D..AK + hasil hitung. */
const CALC_IN_FORM = ['total_ol_prtm', 'balance_prtm', 'total_po', 'total_po_outlook'];
const PREVIEW_COLUMNS = COLUMNS.filter(c => c.input || CALC_IN_FORM.includes(c.key));

/* Kolom mana yang termasuk "milik minggu ke-N". */
const weekFieldKeys = (w) => [`act_prtm_w${w}`, `qc_w${w}_gt80`, `qc_w${w}_50_80`, `qc_w${w}_lt50`];
const ALL_WEEK_KEYS = new Set(WEEKS.flatMap(weekFieldKeys));
const MONTH_LEVEL_KEYS = new Set(STORED.filter(c => !ALL_WEEK_KEYS.has(c.key)).map(c => c.key));

const el = {
  year: document.getElementById('f-year'),
  month: document.getElementById('f-month'),
  week: document.getElementById('f-week'),
  branch: document.getElementById('f-branch'),
  drop: document.getElementById('dropzone'),
  fileInput: document.getElementById('f-file'),
  filename: document.getElementById('filename'),
  btnProcess: document.getElementById('btn-process'),
  btnClear: document.getElementById('btn-clear'),
  status: document.getElementById('status'),
  summary: document.getElementById('summary'),
};

const now = new Date();
const state = {
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  week: Math.min(4, Math.ceil(now.getDate() / 7)),
  branchId: null,
  branchName: '',
  file: null,
  previewWeek: 1,
};

/* ---------- Pemilih periode, minggu & cabang ---------------------------- */
const thisYear = now.getFullYear();
for (let y = thisYear - 2; y <= thisYear + 1; y++) {
  el.year.insertAdjacentHTML('beforeend', `<option value="${y}"${y === state.year ? ' selected' : ''}>${y}</option>`);
}
MONTHS.forEach((m, i) => el.month.insertAdjacentHTML('beforeend',
  `<option value="${i + 1}"${i + 1 === state.month ? ' selected' : ''}>${m}</option>`));
el.week.innerHTML = WEEKS.map(w =>
  `<button type="button" data-week="${w}" aria-pressed="${w === state.week}">W${w}</button>`).join('');
el.week.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-week]');
  if (!b) return;
  state.week = +b.dataset.week;
  [...el.week.children].forEach(x => x.setAttribute('aria-pressed', x === b));
});

const { data: branches, error: brErr } = await sb
  .from('branches').select('id, code, name, area_code')
  .eq('is_active', true).order('sort_order');
if (brErr) showNote('note', 'Gagal memuat daftar cabang: ' + brErr.message, 'err');

const allowed = isAdmin ? (branches ?? []) : (branches ?? []).filter(b => b.id === profile.branch_id);
if (!allowed.length) {
  el.drop.style.display = 'none';
  document.querySelector('.formbar').style.display = 'none';
  showNote('note', 'Akun Anda belum dihubungkan ke cabang mana pun. Hubungi admin head office.', 'err');
} else {
  el.branch.innerHTML = allowed.map(b =>
    `<option value="${b.id}">${escapeHtml(b.code)} — ${escapeHtml(b.name)}</option>`).join('');
  el.branch.disabled = !isAdmin;
  state.branchId = allowed[0].id;
  state.branchName = allowed[0].name;
}

el.year.addEventListener('change', () => { state.year = +el.year.value; });
el.month.addEventListener('change', () => { state.month = +el.month.value; });
el.branch.addEventListener('change', () => {
  state.branchId = el.branch.value;
  state.branchName = allowed.find(b => b.id === state.branchId)?.name ?? '';
});

/* ---------- Dropzone ----------------------------------------------------- */
el.drop.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => setFile(el.fileInput.files[0]));

['dragenter', 'dragover'].forEach(evt =>
  el.drop.addEventListener(evt, (e) => { e.preventDefault(); el.drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach(evt =>
  el.drop.addEventListener(evt, (e) => { e.preventDefault(); el.drop.classList.remove('drag'); }));
el.drop.addEventListener('drop', (e) => setFile(e.dataTransfer.files[0]));

function setFile(file) {
  if (!file) return;
  if (!/\.xlsx$/i.test(file.name)) {
    showNote('note', 'File harus berformat .xlsx.', 'err');
    return;
  }
  state.file = file;
  el.drop.classList.add('has-file');
  el.filename.textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
  el.btnProcess.disabled = false;
  showNote('note', '');
  el.summary.innerHTML = '';
}

el.btnClear.addEventListener('click', () => {
  state.file = null;
  el.fileInput.value = '';
  el.drop.classList.remove('has-file');
  el.filename.textContent = '';
  el.btnProcess.disabled = true;
  el.status.textContent = '';
  el.summary.innerHTML = '';
  showNote('note', '');
});

/* ---------- Proses & simpan ---------------------------------------------- */
el.btnProcess.addEventListener('click', processFile);

function normalize(s) { return String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' '); }
function toNum(v) { return typeof v === 'number' ? v : (parseFloat(v) || 0); }

async function processFile() {
  if (!isAdmin) {
    const proceed = confirm(
      `Setelah diproses, data minggu ${state.week} untuk cabang ${state.branchName} akan terkunci — ` +
      `tidak bisa diunggah ulang kecuali oleh admin head office. Lanjutkan?`);
    if (!proceed) return;
  }

  el.btnProcess.disabled = true;
  el.status.textContent = 'Membaca file…';
  showNote('note', '');
  el.summary.innerHTML = '';

  try {
    const mod = await import('https://esm.sh/xlsx@0.18.5');
    const XLSX = mod.utils ? mod : mod.default;

    const buf = await state.file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });

    const targetName = normalize(`${MONTHS[state.month - 1]} ${state.year}`);
    const sheetName = wb.SheetNames.find(n => normalize(n) === targetName);

    if (!sheetName) {
      el.status.textContent = '';
      el.btnProcess.disabled = false;
      showNote('note',
        `Sheet "${MONTHS[state.month - 1]} ${state.year}" tidak ditemukan di file ini. ` +
        `Sheet yang ada: ${wb.SheetNames.slice(0, 8).join(', ')}${wb.SheetNames.length > 8 ? ', …' : ''}. ` +
        `Periksa apakah Tahun/Bulan di atas sudah sesuai dengan isi file.`, 'err');
      return;
    }

    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null, raw: true });
    const colIdx = (letter) => XLSX.utils.decode_col(letter);
    const nameCol = colIdx('C');

    el.status.textContent = 'Mencocokkan data salesman…';
    const [{ data: salesmen, error: e1 }, { data: existing, error: e0 }] = await Promise.all([
      sb.from('salesmen').select('id, name, sort_order')
        .eq('branch_id', state.branchId).eq('is_active', true).order('sort_order'),
      sb.from('mos_entries').select('*')
        .eq('branch_id', state.branchId)
        .eq('period_year', state.year).eq('period_month', state.month),
    ]);
    if (e1) throw e1;
    if (e0) throw e0;

    const existingByS = new Map((existing ?? []).map(r => [r.salesman_id, r]));
    const w = state.week;
    const weekKeys = new Set(weekFieldKeys(w));

    const matched = [];
    const locked = [];
    const unmatched = [];

    for (const s of (salesmen ?? [])) {
      const rowIdx = rows.findIndex(r => normalize(r?.[nameCol]) === normalize(s.name));
      if (rowIdx === -1) { unmatched.push(s); continue; }

      const prior = existingByS.get(s.id) ?? {};
      if (!isAdmin && prior[`w${w}_submitted`]) { locked.push(s); continue; }

      const out = { period_year: state.year, period_month: state.month,
                    branch_id: state.branchId, salesman_id: s.id };
      if (prior.id) out.id = prior.id;

      for (const c of STORED) {
        if (weekKeys.has(c.key) || MONTH_LEVEL_KEYS.has(c.key)) {
          const v = rows[rowIdx][colIdx(c.col)];
          out[c.key] = c.type === 'text' ? String(v ?? '').trim() : toNum(v);
        } else {
          // Kolom minggu lain: jangan sentuh, pertahankan nilai yang sudah tersimpan.
          out[c.key] = c.type === 'text' ? (prior[c.key] ?? '') : (Number(prior[c.key]) || 0);
        }
      }
      out[`w${w}_submitted`] = true;

      matched.push({ salesman: s, row: out });
    }

    if (!matched.length) {
      el.status.textContent = '';
      el.btnProcess.disabled = false;
      const reason = locked.length && !unmatched.length
        ? `Semua salesman cabang ${state.branchName} sudah pernah submit minggu ${w}.`
        : `Tidak ada nama salesman di file ini yang cocok dengan daftar salesman cabang ${state.branchName}.`;
      showNote('note', reason + ` Periksa penulisan nama di kolom C sheet "${sheetName}".`, 'err');
      return;
    }

    el.status.textContent = 'Menyimpan ke database…';
    const { data: saved, error: e2 } = await sb
      .from('mos_entries')
      .upsert(matched.map(m => m.row), { onConflict: 'period_year,period_month,salesman_id' })
      .select('id, salesman_id, updated_at');
    if (e2) {
      if (e2.code === '42501') throw new Error(
        'Anda tidak punya izin menulis untuk cabang ini. Data hanya bisa diisi oleh cabang ' +
        'bersangkutan atau admin head office — periksa cabang yang dipilih di atas.');
      throw e2;
    }

    for (const m of matched) {
      const d = saved.find(x => x.salesman_id === m.salesman.id);
      if (d) { m.row.id = d.id; m.row.updated_at = d.updated_at; }
    }

    el.status.textContent = 'Tersimpan ' + new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    showNote('note',
      `Berhasil: ${matched.length} salesman untuk minggu ${w} tersimpan dari sheet "${sheetName}".` +
      (locked.length ? ` ${locked.length} salesman dilewati karena minggu ${w} sudah pernah disubmit.` : ''),
      'ok');
    state.previewWeek = w;
    renderSummary(sheetName, matched, locked, unmatched);
  } catch (err) {
    el.status.textContent = '';
    showNote('note', 'Gagal memproses file: ' + (err.message || err), 'err');
  } finally {
    el.btnProcess.disabled = false;
  }
}

/* ---------- Ringkasan ----------------------------------------------------- */
function renderSummary(sheetName, matched, locked, unmatched) {
  const listHtml = [
    ...matched.map(m => `<li class="ok">✓ ${escapeHtml(m.salesman.name)} — minggu ${state.week} tersimpan &amp; terkunci</li>`),
    ...locked.map(s => `<li class="warn">🔒 ${escapeHtml(s.name)} — minggu ${state.week} sudah pernah disubmit, dilewati</li>`),
    ...unmatched.map(s => `<li class="warn">! ${escapeHtml(s.name)} — tidak ditemukan di sheet, dilewati</li>`),
  ].join('');

  el.summary.innerHTML = `
    <div class="summary-card">
      <p class="subhead" style="margin-top:0">Ringkasan dari sheet "${escapeHtml(sheetName)}"</p>
      <ul class="matchlist">${listHtml}</ul>

      <p class="subhead">Pratinjau data tersimpan (semua minggu, termasuk yang sebelumnya)</p>
      <div class="weekpick" id="preview-week" style="margin-bottom:12px"></div>
      <div class="tablewrap" id="preview-table"></div>
    </div>`;

  const wpick = document.getElementById('preview-week');
  wpick.innerHTML = WEEKS.map(w =>
    `<button type="button" data-week="${w}" aria-pressed="${w === state.previewWeek}">W${w}</button>`).join('');
  wpick.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-week]');
    if (!b) return;
    state.previewWeek = +b.dataset.week;
    [...wpick.children].forEach(x => x.setAttribute('aria-pressed', x === b));
    drawPreview(matched);
  });

  drawPreview(matched);
}

function drawPreview(matched) {
  const cols = PREVIEW_COLUMNS;
  const head = buildHeaderMatrix(cols);
  const w = state.previewWeek;
  const mark = new RegExp('W' + w + '$');

  let thead = '<thead>';
  for (let lvl = 0; lvl < 3; lvl++) {
    thead += '<tr>';
    if (lvl === 0) thead += '<th class="sticky-only" rowspan="3">SALESMAN</th>';
    for (const c of head[lvl]) {
      const live = mark.test(c.label.trim()) ? ' class="live"' : '';
      thead += `<th colspan="${c.colspan}" rowspan="${c.rowspan}"${live}>${escapeHtml(c.label)}</th>`;
    }
    thead += '</tr>';
  }
  thead += '</thead>';

  let tbody = '<tbody>';
  for (const m of matched) {
    const calc = computeRow(m.row, w);
    tbody += `<tr><td class="sticky-only">${escapeHtml(m.salesman.name)}</td>`;
    for (const c of cols) {
      const v = calc[c.key];
      const neg = c.type !== 'text' && Number(v) < 0 ? ' neg' : '';
      const txt = c.type === 'text' ? ' txt' : '';
      tbody += `<td class="${neg}${txt}">${escapeHtml(fmt(v, c))}</td>`;
    }
    tbody += '</tr>';
  }
  tbody += '</tbody>';

  document.getElementById('preview-table').innerHTML = `<table class="mos">${thead}${tbody}</table>`;
}
