/* =====================================================================
   schema.js — Sumber kebenaran tunggal untuk struktur kolom MOS.
   Dipakai bersama oleh form Input Data dan tabel View Data.

   path : hirarki header (baris 3 / 4 / 5 di Excel)
   input: true  -> muncul sebagai isian di form
   calc : true  -> dihitung otomatis, tidak pernah disimpan mentah
   ===================================================================== */

export const MONTHS = [
  'JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
  'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER',
];

export const WEEKS = [1, 2, 3, 4];

const OP = 'OUTLOOK PRTM';
const ORT = 'OUTLOOK REVENUE TM';
const ORTA = 'OUTLOOK REVENUE TM ADDITIONAL';
const AS_ = 'ACTUAL SALES';
const BO = 'BACK ORDER & ETA NM';

/* Setiap entri: [kolomExcel, key, path[], flags] */
export const COLUMNS = [
  // --- N..AK : bagian yang diisi lewat form -----------------------------
  { col: 'N',  key: 'plan_sales_master', path: ['PLAN SALES MASTER'], input: true },

  { col: 'O',  key: 'act_prtm_w1', path: [OP, 'ACT PRTM by SO SAP W1'], input: true, week: 1 },
  { col: 'P',  key: 'act_prtm_w2', path: [OP, 'ACT PRTM by SO SAP W2'], input: true, week: 2 },
  { col: 'Q',  key: 'act_prtm_w3', path: [OP, 'ACT PRTM by SO SAP W3'], input: true, week: 3 },
  { col: 'R',  key: 'act_prtm_w4', path: [OP, 'ACT PRTM by SO SAP W4'], input: true, week: 4 },

  { col: 'S',  key: 'qc_w1_gt80',  path: [OP, 'QUOT CONFIDENCE W1', '>80%'],     input: true, week: 1 },
  { col: 'T',  key: 'qc_w1_50_80', path: [OP, 'QUOT CONFIDENCE W1', '>50%-80%'], input: true, week: 1 },
  { col: 'U',  key: 'qc_w1_lt50',  path: [OP, 'QUOT CONFIDENCE W1', '<50%'],     input: true, week: 1 },
  { col: 'V',  key: 'qc_w2_gt80',  path: [OP, 'QUOT CONFIDENCE W2', '>80%'],     input: true, week: 2 },
  { col: 'W',  key: 'qc_w2_50_80', path: [OP, 'QUOT CONFIDENCE W2', '>50%-80%'], input: true, week: 2 },
  { col: 'X',  key: 'qc_w2_lt50',  path: [OP, 'QUOT CONFIDENCE W2', '<50%'],     input: true, week: 2 },
  { col: 'Y',  key: 'qc_w3_gt80',  path: [OP, 'QUOT CONFIDENCE W3', '>80%'],     input: true, week: 3 },
  { col: 'Z',  key: 'qc_w3_50_80', path: [OP, 'QUOT CONFIDENCE W3', '>50%-80%'], input: true, week: 3 },
  { col: 'AA', key: 'qc_w3_lt50',  path: [OP, 'QUOT CONFIDENCE W3', '<50%'],     input: true, week: 3 },
  { col: 'AB', key: 'qc_w4_gt80',  path: [OP, 'QUOT CONFIDENCE W4', '>80%'],     input: true, week: 4 },
  { col: 'AC', key: 'qc_w4_50_80', path: [OP, 'QUOT CONFIDENCE W4', '>50%-80%'], input: true, week: 4 },
  { col: 'AD', key: 'qc_w4_lt50',  path: [OP, 'QUOT CONFIDENCE W4', '<50%'],     input: true, week: 4 },

  { col: 'AE', key: 'po_non_sap',      path: [OP, 'PO NON SAP'],   input: true },
  { col: 'AF', key: 'total_ol_prtm',   path: [OP, 'TOTAL OL PRTM'], calc: true },
  { col: 'AG', key: 'ol_min_prtm',     path: [OP, 'OL MIN PRTM'],  input: true },
  { col: 'AH', key: 'balance_prtm',    path: [OP, 'BALANCE PRTM (OL - PLAN PRTM)'], calc: true },
  { col: 'AI', key: 'po_last_month',   path: [OP, 'PO LAST MONTH by SAP'], input: true },
  { col: 'AJ', key: 'total_po',        path: [OP, 'TOTAL PO (POCO+PRTM)'], calc: true },
  { col: 'AK', key: 'total_po_outlook',path: [OP, 'TOTAL PO OUTLOOK'], calc: true },

  // --- AL..BX : tampil di View Data, belum dibuka di form (lihat README) --
  { col: 'AL', key: 'poco_not_active', path: [ORT, 'POCO', 'NOT ACTIVE'], stage2: true },
  { col: 'AM', key: 'poco_plafond',    path: [ORT, 'POCO', 'PLAFOND'],    stage2: true },
  { col: 'AN', key: 'poco_internal',   path: [ORT, 'POCO', 'INTERNAL'],   stage2: true },
  { col: 'AO', key: 'poco_external',   path: [ORT, 'POCO', 'EXTERNAL'],   stage2: true },
  { col: 'AP', key: 'prtm_not_active', path: [ORT, 'PRTM', 'NOT ACTIVE'], stage2: true },
  { col: 'AQ', key: 'prtm_plafond',    path: [ORT, 'PRTM', 'PLAFOND'],    stage2: true },
  { col: 'AR', key: 'prtm_internal',   path: [ORT, 'PRTM', 'INTERNAL'],   stage2: true },
  { col: 'AS', key: 'prtm_external',   path: [ORT, 'PRTM', 'EXTERNAL'],   stage2: true },

  { col: 'AT', key: 'ol_revenue_poco_prtm',   path: [ORT, 'OL REVENUE (POCO+PRTM)'], calc: true },
  { col: 'AU', key: 'qc_gt80_ready',          path: [ORT, 'QUOT CONF >80% READY'],      stage2: true },
  { col: 'AV', key: 'qc_50_80_ready',         path: [ORT, 'QUOT CONF >50%-80% READY'],  stage2: true },
  { col: 'AW', key: 'po_non_sap_ready',       path: [ORT, 'PO NON SAP READY'],          stage2: true },
  { col: 'AX', key: 'extra_efforts',          path: [ORT, 'EXTRA EFFORTS'],             stage2: true },
  { col: 'AY', key: 'total_ol_rev_this_week', path: [ORT, 'TOTAL OL REVENUE THIS WEEK'], calc: true },
  { col: 'AZ', key: 'total_ol_rev_last_week', path: [ORT, 'TOTAL OL REVENUE LAST WEEK'], stage2: true },
  { col: 'BA', key: 'deficit_from_last_week', path: [ORT, 'DEFICIT FROM LAST WEEK'],     calc: true },
  { col: 'BB', key: 'ol_min_revenue_hdo',     path: [ORT, 'OL MINIMUM REVENUE HDO (NMM)'], calc: true },
  { col: 'BC', key: 'ol1',                    path: [ORT, 'OL1'],           stage2: true },
  { col: 'BD', key: 'ratio_ol_po',            path: [ORT, 'RATIO OL/PO'],   calc: true, format: 'percent' },
  { col: 'BE', key: 'balance_ol',             path: [ORT, 'BALANCE'],       calc: true },

  { col: 'BF', key: 'qc_gt80_dfo_proposed',      path: [ORTA, 'QUOT CONF >80% INDENT', 'DFO PROPOSED'], stage2: true },
  { col: 'BG', key: 'qc_gt80_dfo_approved',      path: [ORTA, 'QUOT CONF >80% INDENT', 'DFO APPROVED'], stage2: true },
  { col: 'BH', key: 'qc_gt80_dfo_eta_tm',        path: [ORTA, 'QUOT CONF >80% INDENT', 'DFO ETA TM'],   stage2: true },
  { col: 'BI', key: 'po_non_sap_dfo_proposed',   path: [ORTA, 'PO NON SAP INDENT', 'DFO PROPOSED'],     stage2: true },
  { col: 'BJ', key: 'po_non_sap_dfo_approved',   path: [ORTA, 'PO NON SAP INDENT', 'DFO APPROVED'],     stage2: true },
  { col: 'BK', key: 'po_non_sap_dfo_eta_tm',     path: [ORTA, 'PO NON SAP INDENT', 'DFO ETA TM'],       stage2: true },

  { col: 'BL', key: 'ol_revenue_final',    path: ['OUTLOOK REVENUE FINAL'], calc: true },
  { col: 'BM', key: 'actual_sales_amount', path: [AS_, 'AMOUNT'], stage2: true },
  { col: 'BN', key: 'actual_sales_ratio',  path: [AS_, 'RATIO'],  calc: true, format: 'percent' },

  { col: 'BO', key: 'bo_poco_main_prod', path: [BO, 'POCO', 'MAIN PROD'],      stage2: true },
  { col: 'BP', key: 'bo_poco_ikd',       path: [BO, 'POCO', 'IKD/TRELLEBORG'], stage2: true },
  { col: 'BQ', key: 'bo_poco_bkt',       path: [BO, 'POCO', 'BKT'],            stage2: true },
  { col: 'BR', key: 'bo_poco_total',     path: [BO, 'POCO', 'TOTAL'],          calc: true },
  { col: 'BS', key: 'bo_prtm_main_prod', path: [BO, 'PRTM', 'MAIN PROD'],      stage2: true },
  { col: 'BT', key: 'bo_prtm_ikd',       path: [BO, 'PRTM', 'IKD/TRELLEBORG'], stage2: true },
  { col: 'BU', key: 'bo_prtm_bkt',       path: [BO, 'PRTM', 'BKT'],            stage2: true },
  { col: 'BV', key: 'bo_prtm_total',     path: [BO, 'PRTM', 'TOTAL'],          calc: true },
  { col: 'BW', key: 'total_bo_eta_nm',   path: [BO, 'TOTAL BO & ETA NM'],      calc: true },
  { col: 'BX', key: 'balance_bo',        path: [BO, 'BALANCE'],                calc: true },
];

/** Kolom yang benar-benar disimpan ke tabel mos_entries. */
export const STORED = COLUMNS.filter(c => !c.calc);
/** Kolom yang muncul di form Input Data (batas kolom AK). */
export const FORM_COLUMNS = COLUMNS.filter(c => c.input);
/** Kolom teks (bukan angka) — tidak ikut dijumlahkan. */
export const TEXT_KEYS = COLUMNS.filter(c => c.type === 'text').map(c => c.key);
/** Kolom angka yang disimpan. */
export const NUMERIC_KEYS = STORED.filter(c => c.type !== 'text').map(c => c.key);

const num = v => (typeof v === 'number' ? v : parseFloat(v)) || 0;

/**
 * Terapkan seluruh rumus Excel. `week` menentukan kolom minggu mana
 * yang dipakai rumus berjalan (di Excel ini diubah manual tiap minggu).
 */
export function computeRow(r, week) {
  const w = WEEKS.includes(Number(week)) ? Number(week) : 1;
  const act   = num(r[`act_prtm_w${w}`]);
  const qc80  = num(r[`qc_w${w}_gt80`]);
  const o = { ...r };

  o.total_ol_prtm    = act + qc80 + num(r.po_non_sap);             // AF
  o.balance_prtm     = o.total_ol_prtm - num(r.ol_min_prtm);       // AH = AF - AG
  o.total_po         = act + num(r.po_last_month);                 // AJ
  o.total_po_outlook = o.total_ol_prtm + num(r.po_last_month);     // AK = AF + AI

  o.ol_revenue_poco_prtm =                                          // AT = SUM(AL:AS)
      num(r.poco_not_active) + num(r.poco_plafond) + num(r.poco_internal) + num(r.poco_external)
    + num(r.prtm_not_active) + num(r.prtm_plafond) + num(r.prtm_internal) + num(r.prtm_external);

  o.total_ol_rev_this_week =                                        // AY = SUM(AT:AX)
      o.ol_revenue_poco_prtm + num(r.qc_gt80_ready) + num(r.qc_50_80_ready)
    + num(r.po_non_sap_ready) + num(r.extra_efforts);

  o.deficit_from_last_week = o.total_ol_rev_this_week - num(r.total_ol_rev_last_week); // BA
  o.ol_min_revenue_hdo     = num(r.plan_sales_master);                                 // BB = N
  o.ratio_ol_po            = o.total_po ? o.total_ol_rev_this_week / o.total_po : 0;    // BD
  o.balance_ol             = o.total_ol_rev_this_week - num(r.ol1);                     // BE
  o.ol_revenue_final       = o.total_ol_rev_this_week                                   // BL
                           + num(r.qc_gt80_dfo_eta_tm) + num(r.po_non_sap_dfo_eta_tm);
  o.actual_sales_ratio     = num(r.ol1) ? num(r.actual_sales_amount) / num(r.ol1) : 0;  // BN

  o.bo_poco_total   = num(r.bo_poco_main_prod) + num(r.bo_poco_ikd) + num(r.bo_poco_bkt); // BR
  o.bo_prtm_total   = num(r.bo_prtm_main_prod) + num(r.bo_prtm_ikd) + num(r.bo_prtm_bkt); // BV
  o.total_bo_eta_nm = o.bo_poco_total + o.bo_prtm_total;                                  // BW
  o.balance_bo      = o.total_po - (o.total_bo_eta_nm + o.ol_revenue_poco_prtm);           // BX
  return o;
}

/** Jumlahkan beberapa baris mentah, lalu hitung ulang rumusnya. */
export function aggregate(rows, week) {
  const sum = {};
  for (const k of NUMERIC_KEYS) sum[k] = 0;
  for (const r of rows) for (const k of NUMERIC_KEYS) sum[k] += num(r[k]);
  return computeRow(sum, week);
}

/** Susun struktur header 3 baris dengan colspan/rowspan yang benar. */
export function buildHeaderMatrix(cols) {
  const levels = [[], [], []];
  for (let lvl = 0; lvl < 3; lvl++) {
    let i = 0;
    while (i < cols.length) {
      const c = cols[i];
      if (c.path.length <= lvl) { i++; continue; }
      const label = c.path[lvl];
      const parentKey = c.path.slice(0, lvl).join('\u0000');
      let j = i;
      while (
        j + 1 < cols.length &&
        cols[j + 1].path.length > lvl &&
        cols[j + 1].path[lvl] === label &&
        cols[j + 1].path.slice(0, lvl).join('\u0000') === parentKey
      ) j++;
      const group = cols.slice(i, j + 1);
      const deepest = Math.max(...group.map(g => g.path.length));
      levels[lvl].push({ label, colspan: group.length, rowspan: deepest === lvl + 1 ? 3 - lvl : 1 });
      i = j + 1;
    }
  }
  return levels;
}

export function fmt(value, col) {
  if (value === null || value === undefined || value === '') return '';
  if (col?.type === 'text') return String(value);
  const n = num(value);
  if (col?.format === 'percent') return (n * 100).toFixed(1) + '%';
  if (n === 0) return '-';
  return n.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
