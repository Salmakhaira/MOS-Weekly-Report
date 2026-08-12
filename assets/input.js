/* =====================================================================
   input.js (versi Upload) — ketua cabang unggah file Excel bulanan,
   sistem membaca isinya otomatis, menyimpan ke database yang sama
   dengan versi form, lalu menampilkan ringkasan di halaman ini.

   Cara membaca file:
   1. Cari sheet yang namanya cocok dengan "BULAN TAHUN" (mis. "AGUSTUS
      2026") sesuai periode yang dipilih di atas — persis pola nama
      sheet di file bulanan yang sudah biasa dipakai.
   2. Baris SALESMAN dicari dengan mencocokkan teks di kolom C terhadap
      daftar nama salesman yang sudah terdaftar untuk cabang itu di
      database — bukan menebak nomor baris, supaya tetap jalan walau
      urutan barisnya sedikit berbeda antar cabang.
   3. Baris total cabang (yang isinya rumus SUM) otomatis terlewat
      karena namanya tidak akan cocok dengan nama salesman mana pun.
   4. Kolom D sampai AK dibaca sesuai huruf kolom yang sama dengan yang
      dipakai di assets/schema.js.
   ===================================================================== */

import { sb, requireSession, renderShell, showNote, escapeHtml } from './app.js';
import { COLUMNS, MONTHS, STORED, computeRow, buildHeaderMatrix, fmt } from './schema.js';

const { profile } = await requireSession();
renderShell(profile, 'input');

const isAdmin = profile.role === 'admin';
const COL = new Map(COLUMNS.map(c => [c.key, c]));

/* Kolom yang ditampilkan di ringkasan: isian D..AK + hasil hitung dari blok itu. */
const CALC_IN_FORM = ['lq_total', 'total_ol_prtm', 'balance_prtm', 'total_po', 'total_po_outlook'];
const PREVIEW_COLUMNS = COLUMNS.filter(c => c.input || CALC_IN_FORM.includes(c.key));

const el = {
  year: document.getElementById('f-year'),
  month: document.getElementById('f-month'),
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
  branchId: null,
  branchName: '',
  file: null,
  previewWeek: 1,
};

/* ---------- Pemilih periode & cabang ----------------------------------- */
const thisYear = now.getFullYear();
for (let y = thisYear - 2; y <= thisYear + 1; y++) {
  el.year.insertAdjacentHTML('beforeend', `<option value="${y}"${y === state.year ? ' selected' : ''}>${y}</option>`);
}
MONTHS.forEach((m, i) => el.month.insertAdjacentHTML('beforeend',
  `<option value="${i + 1}"${i + 1 === state.month ? ' selected' : ''}>${m}</option>`));

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
    const { data: salesmen, error: e1 } = await sb
      .from('salesmen').select('id, name, sort_order')
      .eq('branch_id', state.branchId).eq('is_active', true).order('sort_order');
    if (e1) throw e1;

    const matched = [];
    const unmatched = [];
    for (const s of (salesmen ?? [])) {
      const rowIdx = rows.findIndex(r => normalize(r?.[nameCol]) === normalize(s.name));
      if (rowIdx === -1) { unmatched.push(s); continue; }
      const raw = { salesman_id: s.id, branch_id: state.branchId,
                    period_year: state.year, period_month: state.month };
      for (const c of STORED) {
        const v = rows[rowIdx][colIdx(c.col)];
        raw[c.key] = c.type === 'text' ? String(v ?? '').trim() : toNum(v);
      }
      matched.push({ salesman: s, row: raw });
    }

    if (!matched.length) {
      el.status.textContent = '';
      el.btnProcess.disabled = false;
      showNote('note',
        'Tidak ada satu pun nama salesman di file ini yang cocok dengan daftar salesman ' +
        `cabang ${state.branchName} di sistem. Periksa penulisan nama di kolom C sheet "${sheetName}".`, 'err');
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
    showNote('note', `Berhasil: ${matched.length} dari ${(salesmen ?? []).length} salesman terbaca dari sheet "${sheetName}" dan tersimpan.`, 'ok');
    state.previewWeek = guessWeek(matched);
    renderSummary(sheetName, matched, unmatched);
  } catch (err) {
    el.status.textContent = '';
    showNote('note', 'Gagal memproses file: ' + (err.message || err), 'err');
  } finally {
    el.btnProcess.disabled = false;
  }
}

/** Tebak minggu mana yang paling relevan ditampilkan, berdasar kolom mana yang terisi. */
function guessWeek(matched) {
  for (let w = 4; w >= 1; w--) {
    const filled = matched.some(m =>
      Number(m.row[`lq_tm_w${w}`]) > 0 || Number(m.row[`act_prtm_w${w}`]) > 0);
    if (filled) return w;
  }
  return 1;
}

/* ---------- Ringkasan ----------------------------------------------------- */
function renderSummary(sheetName, matched, unmatched) {
  const listHtml = [
    ...matched.map(m => `<li class="ok">✓ ${escapeHtml(m.salesman.name)} — terbaca &amp; tersimpan</li>`),
    ...unmatched.map(s => `<li class="warn">! ${escapeHtml(s.name)} — tidak ditemukan di sheet, dilewati</li>`),
  ].join('');

  el.summary.innerHTML = `
    <div class="summary-card">
      <p class="subhead" style="margin-top:0">Ringkasan dari sheet "${escapeHtml(sheetName)}"</p>
      <ul class="matchlist">${listHtml}</ul>

      <p class="subhead">Pratinjau data tersimpan</p>
      <div class="weekpick" id="preview-week" style="margin-bottom:12px"></div>
      <div class="tablewrap" id="preview-table"></div>
    </div>`;

  const wpick = document.getElementById('preview-week');
  wpick.innerHTML = [1, 2, 3, 4].map(w =>
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
