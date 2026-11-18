// Token Radar's dashboard. It renders window.RADAR — written beside dashboard/ by main.ts — as a
// ranked board with search and filters, a live-token view set apart from the ranking, a plain
// statement of the model, and a detail dialog per protocol with the model's own inputs and a farm
// plan. No network and no framework: every byte it shows comes from data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var root = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  // ---------- small DOM and format helpers ----------

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var key in attrs) {
        var value = attrs[key];
        if (value === null || value === undefined) continue;
        if (key === 'text') node.textContent = value;
        else if (key === 'class') node.className = value;
        else if (key.slice(0, 2) === 'on' && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function fmtUsd(v) {
    if (v === null || v === undefined) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v;
  }

  function fmtPct(v) {
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  function fmtFloor(v) {
    if (v >= 1e9) return '$' + Math.round(v / 1e9) + 'B';
    if (v >= 1e6) return '$' + Math.round(v / 1e6) + 'M';
    return '$' + v;
  }

  // ---------- the model, recomputed in the page ----------

  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var multiple = row.base_multiple === null || row.base_multiple === undefined ? model.base_multiple : row.base_multiple;
    return Math.max(1, Math.round(row.tvl_usd * multiple * growthMult * maturity));
  }

  // ---------- farm plans, derived in the page exactly as the model derives them ----------

  function chainOf(row) {
    return row.chains && row.chains.length ? row.chains[0] : 'Ethereum';
  }

  function capitalFor(row) {
    if (row.tvl_usd >= 500000000) return 150;
    if (row.tvl_usd >= 50000000) return 100;
    if (row.tvl_usd >= 5000000) return 50;
    return 25;
  }

  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 730) return 30;
    return 21;
  }

  function actionFor(row, capital, chain) {
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    if (c.indexOf('risk curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) {
      return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    }
    if (c.indexOf('lending') >= 0 || c.indexOf('collateral') >= 0) {
      return 'Supply $' + capital + ' of collateral to ' + name + ' on ' + chain + ' and borrow a small amount against it.';
    }
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged') >= 0) {
      return "Provide $" + capital + " of liquidity to " + name + "'s main pool on " + chain + ' and keep the position open.';
    }
    if (c.indexOf('bridge') >= 0 || c.indexOf('chain') >= 0) {
      return 'Bridge $' + capital + ' to ' + chain + ' through ' + name + ' and make one transfer back a week later.';
    }
    if (c.indexOf('cdp') >= 0 || c.indexOf('stablecoin') >= 0) {
      return 'Deposit $' + capital + ' of collateral with ' + name + ' on ' + chain + ' and mint a small amount of its stablecoin.';
    }
    if (c.indexOf('staking') >= 0) {
      return 'Stake $' + capital + ' through ' + name + ' on ' + chain + ' and hold the receipt token in the same wallet.';
    }
    if (c.indexOf('rwa') >= 0) {
      return 'Buy $' + capital + ' of a ' + name + ' tokenised asset on ' + chain + ' and hold it in the farming wallet.';
    }
    if (c.indexOf('payments') >= 0) {
      return 'Route a $' + capital + ' payment through ' + name + ' on ' + chain + ' so the wallet has real payment history.';
    }
    if (c.indexOf('insurance') >= 0) {
      return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' for a position you actually hold.';
    }
    return 'Deposit $' + capital + ' into ' + name + ' on ' + chain + ' through its own interface and keep the position open.';
  }

  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s += " Hold the position and check the protocol's own page.";
    return s;
  }

  function farmSteps(row) {
    var chain = chainOf(row);
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(row, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
    ].map(stepText);
  }

  // ---------- filtering and sorting ----------

  function categories() {
    var seen = {};
    var list = [];
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Other';
      if (!seen[c]) { seen[c] = true; list.push(c); }
    });
    return list.sort();
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var list = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      var hay = (r.name + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    var dir = state.dir;
    list.sort(function (a, b) {
      var av, bv;
      if (state.sort === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (state.sort === 'growth') { av = a.change_7d || 0; bv = b.change_7d || 0; }
      else if (state.sort === 'age') { av = a.age_days || 0; bv = b.age_days || 0; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      return (av - bv) * dir || a.rank - b.rank;
    });
    return list;
  }

  // ---------- hash routing ----------

  function writeHash() {
    var parts = [];
    if (state.category !== 'all') parts.push('category=' + encodeURIComponent(state.category));
    if (state.tab !== 'pre-token') parts.push('tab=' + state.tab);
    if (state.selected) parts.push('p=' + encodeURIComponent(state.selected));
    var hash = parts.length ? '#' + parts.join('&') : '#board';
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash || hash === 'board') return;
    hash.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv.length !== 2) return;
      var key = kv[0];
      var value = decodeURIComponent(kv[1]);
      if (key === 'category') state.category = value;
      if (key === 'tab') state.tab = value;
      if (key === 'p') state.selected = value;
    });
  }

  // ---------- rendering ----------

  function header() {
    return el('header', { class: 'masthead' },
      el('div', { class: 'brand' },
        el('span', { class: 'dot', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name', text: 'Token Radar' })
      ),
      el('p', { class: 'snapshot-line', text: 'Snapshot ' + DATA.as_of + '  ·  DefiLlama protocol index  ·  ' + DATA.model_version + ' model' })
    );
  }

  function stats() {
    function row(label, value) {
      return el('div', { class: 'stat' }, el('span', { text: label }), el('b', { class: 'num', text: value }));
    }
    return el('section', { class: 'panel stats', 'aria-label': 'Coverage' },
      row('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size),
      row('Pre-token rows scored', String(DATA.board_size)),
      row('Early rows below the floor', String(DATA.early_size)),
      row('Live-token protocols set aside', String(DATA.live_size))
    );
  }

  function controls() {
    var search = el('input', {
      type: 'search', value: state.q, placeholder: 'Search name, category or chain', 'aria-label': 'Search',
      oninput: function (e) { state.q = e.target.value; renderBoard(); },
    });
    var select = el('select', { 'aria-label': 'Category', onchange: function (e) { state.category = e.target.value; writeHash(); renderBoard(); } },
      el('option', { value: 'all', text: 'All categories' })
    );
    categories().forEach(function (c) {
      var opt = el('option', { value: c, text: c });
      if (state.category === c) opt.setAttribute('selected', '');
      select.appendChild(opt);
    });
    function tabButton(tab, label) {
      return el('button', {
        type: 'button', class: state.tab === tab ? 'seg active' : 'seg', 'aria-pressed': state.tab === tab ? 'true' : 'false',
        onclick: function () { state.tab = tab; writeHash(); render(); },
        text: label,
      });
    }
    return el('section', { class: 'controls' },
      el('label', { class: 'field' }, el('span', { text: 'Search' }), search),
      el('label', { class: 'field' }, el('span', { text: 'Category' }), select),
      el('div', { class: 'field' },
        el('span', { text: 'Token status' }),
        el('div', { class: 'segmented' }, tabButton('pre-token', 'Pre-token'), tabButton('live', 'Live token'))
      )
    );
  }

  function sortHeader(key, label) {
    var arrow = state.sort === key ? (state.dir === -1 ? ' v' : ' ^') : '';
    return el('th', null, el('button', {
      type: 'button', class: 'sort',
      onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = -1; }
        renderBoard();
      },
      text: label + arrow,
    }));
  }

  function boardTable() {
    var list = visibleRows();
    var max = list.length && state.sort === 'implied' ? Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) : (DATA.rows[0] ? DATA.rows[0].implied_value_usd : 1);
    var table = el('table', { class: 'board' },
      el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
      el('thead', null, el('tr', null,
        sortHeader('implied', 'Rank'),
        el('th', { text: 'Protocol' }),
        sortHeader('tvl', 'TVL'),
        sortHeader('growth', '7d'),
        sortHeader('age', 'Age'),
        sortHeader('implied', 'Implied value'),
        el('th', { text: 'Token' })
      )),
      el('tbody', null)
    );
    var body = table.querySelector('tbody');
    list.forEach(function (r) {
      body.appendChild(el('tr', { class: 'rowlink', tabindex: '0', onclick: function () { openDetail(r.slug); } },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null,
          el('div', { class: 'pname', text: r.name }),
          el('div', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        ),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / (max || 1)) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'token-none' }, el('span', { class: 'dot small', 'aria-hidden': 'true' }), ' no token'))
      ));
    });
    return el('div', null,
      el('p', { class: 'shown num', text: list.length + ' rows shown' }),
      table
    );
  }

  function liveTable() {
    var table = el('table', { class: 'board' },
      el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
      el('thead', null, el('tr', null,
        el('th', { text: 'Protocol' }), el('th', { text: 'TVL' }), el('th', { text: '7d' }), el('th', { text: 'Market cap' })
      )),
      el('tbody', null)
    );
    var body = table.querySelector('tbody');
    DATA.live.forEach(function (r) {
      body.appendChild(el('tr', null,
        el('td', null,
          el('div', { class: 'pname', text: r.name }),
          el('div', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        ),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) })
      ));
    });
    return el('div', null, el('p', { class: 'shown num', text: DATA.live.length + ' rows shown' }), table);
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x multiple(category) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      el('p', { class: 'sub', text: 'The multiple is the market\u2019s own pricing of comparable protocols, read from this snapshot: for each category, the median market-cap / TVL of the protocols that already have a token, shrunk toward the global median (' + m.base_multiple + ') by sample size so a thin category borrows the market\u2019s overall level. A category with no tokenised peer is priced at the global median outright. Each row\u2019s detail view shows the exact multiple it was priced with.' }),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  // ---------- the detail dialog ----------

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Peer multiple (' + (row.category || 'global') + ')' }), el('b', { class: 'num', text: String(row.base_multiple === null || row.base_multiple === undefined ? DATA.model.base_multiple : row.base_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') dialog.showModal();
  }

  // ---------- page assembly ----------

  var boardHost = el('div', { id: 'board-host' });

  function renderBoard() {
    var fresh = state.tab === 'live' ? liveTable() : boardTable();
    boardHost.replaceChildren(fresh);
    var shown = boardHost.querySelector('.shown');
    var controlsShown = root.querySelector('.controls-shown');
    if (shown && controlsShown) controlsShown.textContent = shown.textContent;
    if (shown) shown.remove();
  }

  function render() {
    root.textContent = '';
    root.appendChild(header());
    root.appendChild(el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }));
    root.appendChild(el('p', { class: 'lede', text: 'The watchlist is the floor: every protocol with at least ' + fmtFloor(DATA.floor_usd) + ' of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' }));
    root.appendChild(stats());
    var controlsNode = controls();
    controlsNode.appendChild(el('p', { class: 'controls-shown shown num', text: '' }));
    root.appendChild(controlsNode);
    root.appendChild(boardHost);
    root.appendChild(modelPanel());
    root.appendChild(dialog);
    renderBoard();
    root.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
})();
