import { auditCSV, periodReturn } from './analysis.js';

const $ = id => document.getElementById(id);
const state = { audit: null, selected: null };
const fmt = n => new Intl.NumberFormat('ja-JP').format(n);
const today = new Date();
$('todayLabel').textContent = today.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

function route() {
  const page = ['overview','stocks','validation','sources'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  document.querySelectorAll('.page').forEach(x => x.classList.toggle('active', x.id === page));
  document.querySelectorAll('.nav-item').forEach(x => x.classList.toggle('active', x.dataset.nav === page));
  if (['upload','method'].includes(location.hash.slice(1))) requestAnimationFrame(() => $(location.hash.slice(1)).scrollIntoView());
  else window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route); route();

$('csvFile').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  const box = $('auditMessage'); box.className = 'message';
  if (file.size > 10 * 1024 * 1024) { box.className += ' error'; box.textContent = '10 MB 以下の CSV を選択してください。'; return; }
  try {
    const audit = auditCSV(await file.text());
    if (!audit.rowCount) throw new Error('有効な株価行がありません。');
    state.audit = audit; state.selected = null;
    $('stockCount').textContent = fmt(audit.stocks.length);
    $('rowCount').textContent = fmt(audit.rowCount);
    $('lastDate').textContent = audit.lastDate;
    $('freshness').textContent = audit.ageDays === 0 ? '今日のデータ' : `${audit.ageDays} 日前のデータ`;
    const issues = Object.entries(audit.issues).filter(([,v])=>v).map(([k,v])=>`${({invalidDate:'日付不正',invalidPrice:'価格不正',duplicate:'重複',future:'未来日',shortRow:'列不足',invalidVolume:'出来高不正'})[k]} ${v} 件`);
    box.className += ' success';
    box.textContent = `${file.name}：${fmt(audit.stocks.length)} 銘柄、${fmt(audit.rowCount)} 行を読み込みました。${issues.length ? `除外・注意：${issues.join('、')}。` : '形式上の異常は検出されませんでした。'} 利用権限・株式分割補正・配当の正しさは自動確認できません。`;
    renderList();
    location.hash = '#stocks';
  } catch (error) { box.className += ' error'; box.textContent = error.message; }
  event.target.value = '';
});

$('search').addEventListener('input', renderList);
function renderList() {
  const list = $('stockList'); list.replaceChildren();
  const stocks = state.audit?.stocks ?? [];
  const q = $('search').value.trim().toLocaleLowerCase('ja');
  const found = stocks.filter(s => `${s.code} ${s.name}`.toLocaleLowerCase('ja').includes(q));
  $('resultCount').textContent = `${fmt(found.length)} 件`;
  if (!found.length) { list.className = 'stock-list empty-list'; list.textContent = stocks.length ? '該当する銘柄がありません。' : 'CSV を読み込んでください。'; return; }
  list.className = 'stock-list';
  for (const stock of found.slice(0, 300)) {
    const button = document.createElement('button'); button.className = `stock-item${state.selected === stock.code ? ' active' : ''}`;
    const left = document.createElement('span'), name = document.createElement('strong'), code = document.createElement('small'), date = document.createElement('time');
    name.textContent = stock.name; code.textContent = stock.code; date.textContent = stock.rows.at(-1).date;
    left.append(name, code); button.append(left,date);
    button.addEventListener('click', () => { state.selected = stock.code; renderList(); renderDetail(stock); });
    list.append(button);
  }
  if (found.length > 300) { const more=document.createElement('p'); more.className='empty-list'; more.textContent='最初の300件を表示中。検索で絞り込んでください。'; list.append(more); }
}

function chartSVG(rows) {
  const sample = rows.filter((_,i)=>i % Math.max(1,Math.ceil(rows.length/120))===0 || i===rows.length-1);
  const values=sample.map(r=>r.adjusted ?? r.close), min=Math.min(...values), max=Math.max(...values), spread=Math.max(max-min,1);
  const pts=values.map((v,i)=>`${(i/Math.max(values.length-1,1)*100).toFixed(2)},${(100-(v-min)/spread*84-8).toFixed(2)}`).join(' ');
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="読み込んだ期間の株価推移"><line x1="0" y1="50" x2="100" y2="50" stroke="#c9c8c0" stroke-width=".6"/><polyline points="${pts}" fill="none" stroke="#b53d2e" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>`;
}
function renderDetail(stock) {
  const node=$('detail'); node.className='detail-panel'; node.replaceChildren();
  const wrap=document.createElement('div'); wrap.className='detail-content';
  const header=document.createElement('div'); header.className='detail-header';
  const title=document.createElement('div'); title.innerHTML='<h2></h2><p></p>';
  title.querySelector('h2').textContent=stock.name; title.querySelector('p').textContent=`${stock.code} · ${fmt(stock.rows.length)} 観測日`;
  const badge=document.createElement('span'); badge.className='data-badge'; badge.textContent=`${stock.rows[0].date}〜${stock.rows.at(-1).date}`; header.append(title,badge); wrap.append(header);
  const end=stock.rows.at(-1), price=document.createElement('div'); price.className='detail-price';
  const priceValue=document.createElement('strong'); priceValue.textContent=`¥${fmt(end.close)}`;
  const priceLabel=document.createElement('span'); priceLabel.textContent='最終の実績終値'; price.append(priceValue,priceLabel); wrap.append(price);
  const sub=document.createElement('div'); sub.className='detail-sub'; sub.textContent=`データ日：${end.date} ｜ 将来価格ではありません`; wrap.append(sub);
  const chart=document.createElement('div'); chart.className='chart'; chart.innerHTML=chartSVG(stock.rows); wrap.append(chart);
  const h=document.createElement('div'); h.className='returns-head'; h.textContent='過去の期間別リターン'; wrap.append(h);
  const returns=document.createElement('div'); returns.className='returns';
  for(const m of [1,3,6,12]) {
    const r=periodReturn(stock.rows,m), card=document.createElement('div'); card.className='return-card';
    const label=document.createElement('span'), value=document.createElement('strong'), foot=document.createElement('small');
    label.textContent=`${m}か月`; value.textContent=r ? `${r.value>=0?'+':''}${(r.value*100).toFixed(1)}%` : '—';
    if(r?.value<0) value.className='negative'; foot.textContent=r ? `${r.from} → ${r.to}` : '観測期間不足';
    card.append(label,value,foot); returns.append(card);
  } wrap.append(returns);
  const warn=document.createElement('div'); warn.className='detail-warnings';
  const missing=stock.rows.filter(r=>r.adjusted===null).length;
  warn.textContent=`注意：${missing ? `調整済み終値が ${fmt(missing)} 行で欠けています。株式分割・併合の影響を確認してください。` : '調整済み終値を使用しています。補正方法は提供元に確認してください。'} 配当・手数料・税は含みません。売買候補や将来収益の予測ではありません。`;
  wrap.append(warn); node.append(wrap);
}

$('resultFile').addEventListener('change', async event => {
  const file=event.target.files?.[0]; if(!file) return;
  const root=$('validationResult'); root.replaceChildren();
  try {
    if(file.size>2*1024*1024) throw new Error('2 MB 以下の JSON を選択してください。');
    const result=JSON.parse(await file.text());
    if(result.schema_version!==1 || result.kind!=='historical_validation' || !Array.isArray(result.models) || !result.train_period || !result.test_period) throw new Error('検証 JSON の形式が正しくありません。');
    const panel=document.createElement('div'); panel.className='panel';
    const h=document.createElement('h2'); h.textContent='読み込んだ時間外検証'; panel.append(h);
    const p=document.createElement('p'); p.textContent=`学習：${result.train_period} ｜ 最終評価：${result.test_period} ｜ 対象 ${result.stock_count ?? '不明'} 銘柄 ｜ 予測幅 ${result.horizon_days ?? '不明'} 営業日`; panel.append(p);
    const table=document.createElement('table'); const thead=document.createElement('thead'); thead.innerHTML='<tr><th>手法</th><th>MAE</th><th>方向一致率</th><th>評価件数</th></tr>'; table.append(thead);
    const body=document.createElement('tbody');
    for(const model of result.models) {
      const row=document.createElement('tr');
      for(const val of [model.name, Number.isFinite(model.mae)?`${(model.mae*100).toFixed(2)}%`:'—',Number.isFinite(model.direction_accuracy)?`${(model.direction_accuracy*100).toFixed(1)}%`:'—',model.test_count ?? '—']) { const td=document.createElement('td'); td.textContent=String(val ?? '—'); row.append(td); }
      body.append(row);
    } table.append(body); panel.append(table);
    const caveat=document.createElement('p'); caveat.textContent='これは利用者が読み込んだ JSON の履歴検証値です。付属スクリプトは取引コスト・配当・税を計上していません。サイト側では元データの権利、時点整合、価格補正、JSON の作成方法を独立検証できないため、買い候補は表示しません。'; panel.append(caveat); root.append(panel);
    $('validationState').textContent='結果を読込';
  } catch(error) { const p=document.createElement('div'); p.className='message error'; p.textContent=error.message; root.append(p); }
  event.target.value='';
});
