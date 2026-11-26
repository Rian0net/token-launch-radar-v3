// Launch Radar dashboard — plain script, no framework, no network.
// Reads window.RADAR from ../data.js, which main.ts writes from the board.
(function () {
  const R = window.RADAR;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const state = {
    seg: params.get('seg') || 'all',
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    chain: params.get('chain') || '',
    sort: params.get('sort') || 'rank',
    selected: params.get('select') || null,
  };

  const money = (n) => {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  };
  const pct = (v) => (v === null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%');
  const age = (d) => (d === null ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + ' yrs' : d + ' days');

  // Header stats ------------------------------------------------------------
  $('stats').innerHTML = [
    [R.scanned, 'protocols scanned'],
    [R.rows.length, 'pre-token ranked'],
    [R.watchlist_size + ' / ' + R.watchlist_size, 'watchlist covered'],
    [R.early_size, 'early finds'],
    [R.live_size, 'already launched'],
  ].map(([v, l]) => '<div class="stat"><b>' + v + '</b><span>' + l + '</span></div>').join('');
  $('asOf').textContent = R.as_of;
  $('globalMedian').textContent = R.global_median.toFixed(3);

  // Filters -----------------------------------------------------------------
  const cats = [...new Set(R.rows.map((r) => r.category))].sort();
  $('categoryFilter').innerHTML += cats.map((c) => '<option>' + c + '</option>').join('');
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  $('chainFilter').innerHTML += chains.map((c) => '<option>' + c + '</option>').join('');

  $('segmentTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.seg = b.dataset.seg;
    document.querySelectorAll('#segmentTabs button').forEach((x) => x.classList.toggle('on', x === b));
    render();
  });
  // Deep links (?seg=early&select=<slug>&cat=…&chain=…&q=…) restore the view.
  document.querySelectorAll('#segmentTabs button').forEach((x) => x.classList.toggle('on', x.dataset.seg === state.seg));
  $('search').value = state.q;
  $('categoryFilter').value = state.cat;
  $('chainFilter').value = state.chain;
  $('sortSel').value = state.sort;
  state.q = state.q.toLowerCase();
  $('search').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); render(); });
  $('categoryFilter').addEventListener('change', (e) => { state.cat = e.target.value; render(); });
  $('chainFilter').addEventListener('change', (e) => { state.chain = e.target.value; render(); });
  $('sortSel').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
  document.querySelectorAll('#board th[data-k]').forEach((th) => {
    th.addEventListener('click', () => { state.sort = th.dataset.k; $('sortSel').value = state.sort === 'rank' ? 'rank' : state.sort; render(); });
  });

  function visible() {
    let rows = R.rows;
    if (state.seg === 'watchlist' || state.seg === 'early') rows = rows.filter((r) => r.segment === state.seg);
    if (state.cat) rows = rows.filter((r) => r.category === state.cat);
    if (state.chain) rows = rows.filter((r) => r.chains.includes(state.chain));
    if (state.q) rows = rows.filter((r) => (r.name + ' ' + r.slug + ' ' + r.chains.join(' ')).toLowerCase().includes(state.q));
    const by = {
      rank: (a, b) => a.rank - b.rank,
      tvl: (a, b) => b.tvl_usd - a.tvl_usd,
      growth: (a, b) => (b.change_7d ?? -1e9) - (a.change_7d ?? -1e9),
      age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...rows].sort(by[state.sort] || by.rank);
  }

  // Board -------------------------------------------------------------------
  function render() {
    const liveMode = state.seg === 'live';
    $('board').hidden = liveMode;
    $('liveBoard').hidden = !liveMode;
    if (liveMode) { renderLive(); return; }
    const rows = visible();
    $('rows').innerHTML = rows.map((r) =>
      '<tr data-slug="' + r.slug + '"' + (state.selected === r.slug ? ' class="sel"' : '') + '>' +
      '<td>' + r.rank + '</td>' +
      '<td class="name"><b>' + r.name + '<span class="pill' + (r.segment === 'early' ? ' early' : '') + '">' +
        (r.segment === 'watchlist' ? 'watchlist' : 'early') + '</span></b><span>' + r.slug + ' · ' + r.chains.slice(0, 3).join(', ') + '</span></td>' +
      '<td>' + r.category + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</td>' +
      '<td class="num">' + age(r.age_days) + '</td>' +
      '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
      '<td class="num band">' + money(r.band_low_usd) + ' – ' + money(r.band_high_usd) + '</td></tr>'
    ).join('');
    $('rowCount').textContent = rows.length + ' protocols shown — click any row for its detail and farm plan.';
    if (!rows.some((r) => r.slug === state.selected)) state.selected = rows.length ? rows[0].slug : null;
    renderDetail();
  }

  function renderLive() {
    let rows = R.live;
    if (state.cat) rows = rows.filter((r) => r.category === state.cat);
    if (state.q) rows = rows.filter((r) => (r.name + ' ' + r.slug).toLowerCase().includes(state.q));
    $('liveRows').innerHTML = rows.map((r, i) =>
      '<tr><td>' + (i + 1) + '</td><td class="name"><b>' + r.name + '</b><span>' + r.slug + '</span></td>' +
      '<td>' + r.category + '</td><td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num"><b>' + money(r.mcap_usd) + '</b></td><td class="num">' + r.ratio.toFixed(3) + '×</td></tr>'
    ).join('');
    $('rowCount').textContent = rows.length + ' launched protocols — these are the calibration set, shown at recorded market value and never ranked.';
    $('detail').innerHTML = '<h2>Already launched</h2><p class="slug">Calibration set</p>' +
      '<p>These protocols record a token in the snapshot, so the radar never ranks them. Their median market-cap/TVL per category is exactly what prices the pre-token board — pick a category in the filter to see its launched peers.</p>';
  }

  // Detail ------------------------------------------------------------------
  $('rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    state.selected = tr.dataset.slug;
    render();
  });

  function bar(label, v, max) {
    return '<dt>' + label + '</dt><dd>×' + v.toFixed(3) + '</dd>' +
      '<div class="bar" style="grid-column:1/-1"><i style="width:' + Math.min(100, (v / max) * 100) + '%"></i></div>';
  }

  function renderDetail() {
    const r = R.rows.find((x) => x.slug === state.selected);
    if (!r) { $('detail').innerHTML = '<p>No protocol selected.</p>'; return; }
    document.querySelectorAll('#rows tr').forEach((tr) => tr.classList.toggle('sel', tr.dataset.slug === r.slug));
    $('detail').innerHTML =
      '<h2>' + r.name + '</h2><div class="slug">' + r.slug + ' · rank #' + r.rank + ' · ' +
        (r.segment === 'watchlist' ? 'on the snapshot watchlist' : 'early find, below the watchlist floor') + '</div>' +
      '<div class="big">' + money(r.implied_value_usd) + '</div>' +
      '<div class="band">plausible band ' + money(r.band_low_usd) + ' – ' + money(r.band_high_usd) + '</div>' +
      '<dl class="kv">' +
      '<dt>Category</dt><dd>' + r.category + '</dd>' +
      '<dt>Chains</dt><dd>' + r.chains.join(', ') + '</dd>' +
      '<dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd>' +
      '<dt>7d change</dt><dd>' + pct(r.change_7d) + '</dd>' +
      '<dt>Age with no token</dt><dd>' + age(r.age_days) + '</dd>' +
      bar('Category multiple', r.multiple, 1.6) +
      bar('Growth factor', r.growth, 1.55) +
      bar('Maturity factor', r.maturity, 1.27) +
      bar('Breadth factor', r.breadth, 1.18) +
      '</dl>' +
      '<p>Implied = ' + money(r.tvl_usd) + ' × ' + r.multiple.toFixed(3) + ' × ' + r.growth.toFixed(3) +
      ' × ' + r.maturity.toFixed(3) + ' × ' + r.breadth.toFixed(3) + '.</p>' +
      '<h3>Farm plan</h3><ol class="plan">' + r.farm_steps.map((s) => '<li>' + s + '</li>').join('') + '</ol>';
  }

  // Calibration table ---------------------------------------------------------
  $('calRows').innerHTML = R.calibration.map((c) =>
    '<tr><td>' + c.category + '</td><td class="num">' + c.launched + '</td>' +
    '<td class="num">' + c.median_ratio.toFixed(3) + '×</td><td class="num"><b>' + c.multiple.toFixed(3) + '×</b></td></tr>'
  ).join('');

  render();
})();
