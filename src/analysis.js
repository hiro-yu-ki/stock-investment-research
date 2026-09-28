export function parseCSV(text) {
  const rows = []; let row = [], field = '', quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); if (row.some(x => x.trim())) rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (quoted) throw new Error('CSV の引用符が閉じていません。');
  row.push(field.replace(/\r$/, ''));
  if (row.some(x => x.trim())) rows.push(row);
  return rows;
}

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function auditCSV(text, today = new Date()) {
  const raw = parseCSV(text);
  if (raw.length < 2) throw new Error('ヘッダーと株価行が必要です。');
  if (raw.length > 100001) throw new Error('100,000 行を超えています。');
  const head = raw[0].map(x => x.trim().toLowerCase());
  for (const key of ['date', 'code', 'close']) if (!head.includes(key)) throw new Error(`必須列 ${key} がありません。`);
  const at = Object.fromEntries(head.map((h, i) => [h, i]));
  const stocks = new Map(), seen = new Set();
  const issues = { invalidDate: 0, invalidPrice: 0, duplicate: 0, future: 0, shortRow: 0, invalidVolume: 0 };
  const todayString = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0,10);
  for (const cells of raw.slice(1)) {
    if (cells.length < head.length) { issues.shortRow++; continue; }
    const date = cells[at.date]?.trim(), code = cells[at.code]?.trim();
    const close = Number(cells[at.close]?.trim());
    if (!validDate(date)) { issues.invalidDate++; continue; }
    if (date > todayString) { issues.future++; continue; }
    if (!code || !Number.isFinite(close) || close <= 0) { issues.invalidPrice++; continue; }
    const key = `${code}\0${date}`;
    if (seen.has(key)) { issues.duplicate++; continue; }
    seen.add(key);
    const adjustedRaw = at.adjusted_close === undefined ? '' : cells[at.adjusted_close]?.trim();
    const adjusted = adjustedRaw ? Number(adjustedRaw) : null;
    if (adjustedRaw && (!Number.isFinite(adjusted) || adjusted <= 0)) { issues.invalidPrice++; continue; }
    const volumeRaw = at.volume === undefined ? '' : cells[at.volume]?.trim();
    const volume = volumeRaw ? Number(volumeRaw) : null;
    if (volumeRaw && (!Number.isFinite(volume) || volume < 0)) issues.invalidVolume++;
    const name = at.name === undefined ? code : (cells[at.name]?.trim() || code);
    if (!stocks.has(code)) stocks.set(code, { code, name, rows: [] });
    stocks.get(code).rows.push({ date, close, adjusted, volume: Number.isFinite(volume) ? volume : null });
  }
  for (const stock of stocks.values()) stock.rows.sort((a,b) => a.date.localeCompare(b.date));
  const list = [...stocks.values()].sort((a,b) => a.code.localeCompare(b.code, 'ja'));
  const lastDate = list.reduce((v,s) => s.rows.at(-1).date > v ? s.rows.at(-1).date : v, '');
  const ageDays = lastDate ? Math.floor((Date.parse(todayString) - Date.parse(lastDate)) / 86400000) : null;
  return { stocks: list, issues, rowCount: list.reduce((n,s) => n+s.rows.length,0), lastDate, ageDays, hasAdjusted: at.adjusted_close !== undefined };
}

export function periodReturn(rows, months) {
  if (!rows.length) return null;
  const end = rows.at(-1);
  const d = new Date(`${end.date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  const target = d.toISOString().slice(0,10);
  const start = rows.find(r => r.date >= target);
  if (!start || start.date === end.date || (Date.parse(start.date) - Date.parse(target)) > 10 * 86400000) return null;
  const price = r => r.adjusted ?? r.close;
  return { value: price(end) / price(start) - 1, from: start.date, to: end.date, adjusted: start.adjusted !== null && end.adjusted !== null };
}
