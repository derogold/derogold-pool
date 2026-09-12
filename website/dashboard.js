(function () {
  'use strict'

  var state = {
    stats: null,
    market: null,
    route: 'overview',
    activeBlockCoin: '',
    activePaymentCoin: '',
    adminPassword: ''
  }

  var storageKeys = {
    minerAddress: 'derogoldPool.dashboard.minerAddress',
    adminPassword: 'derogoldPool.dashboard.adminPassword'
  }

  var queryParams = new URLSearchParams(window.location.search)
  var dashboardConfig = window.poolDashboardConfig || {}
  var apiBase = stripTrailingSlash(queryParams.get('api') || dashboardConfig.apiBase || dashboardConfig.api || window.api || '')
  var configuredPoolHost = queryParams.get('stratumHost') ||
    queryParams.get('miningHost') ||
    dashboardConfig.stratumHost ||
    dashboardConfig.miningHost ||
    dashboardConfig.poolHost ||
    window.stratumHost ||
    window.miningHost ||
    window.poolHost ||
    window.location.hostname
  var parentExplorer = dashboardConfig.blockchainExplorer || window.blockchainExplorer || ''
  var parentTransactionExplorer = dashboardConfig.transactionExplorer || window.transactionExplorer || ''
  var childExplorers = dashboardConfig.childExplorers || window.childExplorers || {}
  var configuredChildCoinUnits = dashboardConfig.childCoinUnits || window.childCoinUnits || {}

  var titles = {
    overview: ['Overview', 'Live pool, network, merged-mining, and payout state.'],
    miner: ['Miner', 'Balances, payments, payout address, and hashrate for a DEGO mining address.'],
    blocks: ['Blocks', 'Confirmed, pending, orphaned, and child submitted blocks.'],
    payments: ['Payments', 'Pool payment history by coin.'],
    connect: ['Connect', 'Current ports and miner command templates.'],
    admin: ['Admin', 'Operator-only pool accounting and service checks.']
  }

  function $(id) {
    return document.getElementById(id)
  }

  function stripTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '')
  }

  function apiUrl(path, params) {
    var query = ''
    if (params) {
      query = Object.keys(params)
        .filter(function (key) { return params[key] !== undefined && params[key] !== null && params[key] !== '' })
        .map(function (key) { return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]) })
        .join('&')
    }
    return apiBase + path + (query ? '?' + query : '')
  }

  function fetchJson(path, params) {
    return window.fetch(apiUrl(path, params), { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
  }

  function setText(id, value) {
    var node = $(id)
    if (node) node.textContent = value
  }

  function loadSavedValue(key) {
    try {
      return window.localStorage.getItem(key) || ''
    } catch (error) {
      return ''
    }
  }

  function saveValue(key, value) {
    try {
      if (value) {
        window.localStorage.setItem(key, value)
      } else {
        window.localStorage.removeItem(key)
      }
    } catch (error) {}
  }

  function saveRememberedInputs() {
    saveValue(storageKeys.minerAddress, $('minerAddress').value.trim())
    state.adminPassword = $('adminPassword').value.trim()
    saveValue(storageKeys.adminPassword, state.adminPassword)
  }

  function setStatus(kind, text) {
    var node = $('apiStatus')
    node.className = 'status-chip ' + kind
    node.textContent = text
  }

  function formatNumber(value) {
    var number = Number(value)
    if (!isFinite(number)) return '-'
    return new Intl.NumberFormat('en-US').format(number)
  }

  function formatHashrate(value) {
    var number = Number(value)
    if (!isFinite(number)) return '-'
    var units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s']
    var index = 0
    while (number >= 1000 && index < units.length - 1) {
      number = number / 1000
      index++
    }
    return number.toFixed(number >= 100 ? 0 : 2) + ' ' + units[index]
  }

  function coinUnits(symbol) {
    var config = state.stats && state.stats.config ? state.stats.config : {}
    if (symbol === config.symbol) return Number(config.coinUnits || 1)
    if (configuredChildCoinUnits[symbol]) return Number(configuredChildCoinUnits[symbol])
    var coin = state.stats && state.stats.coins && state.stats.coins[symbol]
    var coinUnits = coin && coin.pool && coin.pool.coinUnits
    if (coinUnits) return Number(coinUnits)
    return Number(config.coinUnits || 1)
  }

  function formatCoins(value, symbol) {
    var number = Number(value)
    var units = coinUnits(symbol)
    if (!isFinite(number) || !units) return '-'
    var decimals = 2
    return (number / units).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }) + ' ' + symbol
  }

  function formatPercent(value) {
    var number = Number(value)
    if (!isFinite(number)) return '-'
    return number.toFixed(2) + '%'
  }

  function formatUsd(value) {
    var number = Number(value)
    if (!isFinite(number)) return '-'
    return number.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  }

  function formatDate(value) {
    var number = Number(value)
    if (!isFinite(number) || number <= 0) return '-'
    return new Date(number * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC')
  }

  function shortHash(value) {
    if (!value) return '-'
    var text = String(value)
    if (text.length <= 18) return text
    return text.slice(0, 10) + '...' + text.slice(-8)
  }

  function explorerUrl(symbol, type, id) {
    var template = symbol === state.stats.config.symbol
      ? (type === 'tx' ? parentTransactionExplorer : parentExplorer)
      : childExplorers[symbol] && childExplorers[symbol][type]

    if (!template) return ''
    return template.replace('{symbol}', String(symbol).toLowerCase()).replace('{id}', id)
  }

  function linkHash(symbol, type, id) {
    var href = explorerUrl(symbol, type, id)
    if (!href) return escapeHtml(shortHash(id))
    return '<a class="hash" target="_blank" rel="noopener" href="' + escapeAttr(href) + '">' + escapeHtml(shortHash(id)) + '</a>'
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  function escapeAttr(value) {
    return escapeHtml(value)
  }

  function coinEntries() {
    var coins = state.stats && state.stats.coins
    if (!coins) return []
    return Object.keys(coins).map(function (symbol) {
      return {
        symbol: symbol,
        data: coins[symbol]
      }
    })
  }

  function render() {
    if (!state.stats) return
    if (!state.activeBlockCoin) state.activeBlockCoin = state.stats.config.symbol
    if (!state.activePaymentCoin) state.activePaymentCoin = state.stats.config.symbol
    renderRoute()
    renderOverview()
    renderBlocks()
    renderPayments()
    renderConnect()
  }

  function renderRoute() {
    var meta = titles[state.route] || titles.overview
    setText('pageTitle', meta[0])
    setText('pageSubtitle', meta[1])
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (view) {
      view.classList.toggle('active', view.id === 'view-' + state.route)
    })
    Array.prototype.forEach.call(document.querySelectorAll('[data-route]'), function (link) {
      link.classList.toggle('active', link.getAttribute('data-route') === state.route)
    })
  }

  function renderOverview() {
    var root = $('coinOverview')
    root.innerHTML = coinEntries().map(function (entry) {
      var coin = entry.data
      var pool = coin.pool || {}
      var network = coin.network || {}
      var blocks = coin.blocks || {}
      return '<section class="coin-panel">' +
        '<div class="coin-header">' +
          '<div><h3>' + escapeHtml(entry.symbol) + '</h3><div class="coin-role">' + escapeHtml(coin.role || '') + '</div></div>' +
          '<span class="badge ' + healthClass(network.height) + '">height ' + escapeHtml(formatNumber(network.height)) + '</span>' +
        '</div>' +
        '<div class="metric-grid">' +
          metric('Pool Hashrate', formatHashrate(pool.hashrate)) +
          metric('Network Hashrate', formatHashrate(network.hashrate)) +
          metric('Difficulty', formatNumber(network.difficulty)) +
          metric('Reward', formatCoins(network.reward, entry.symbol)) +
          metric('Blocks Found', formatNumber(blocks.found)) +
          metric('Current Effort', formatPercent(blocks.currentEffortPercent)) +
          metric('Miners', formatNumber(pool.miners)) +
          metric('Pool Fee', formatPercent(pool.fee)) +
          metric('Min Payout', formatCoins(pool.minimumPayout, entry.symbol)) +
          metric('Unlock Depth', formatNumber(pool.unlockDepth)) +
        '</div>' +
      '</section>'
    }).join('')

    renderRecentBlocks()
    renderMarket()
    renderPoolTrends()
  }

  function renderPoolTrends() {
    var charts = state.stats.charts || {}
    var trends = [
      { key: 'difficulty', title: 'Difficulty' },
      { key: 'hashrate', title: 'Pool Hashrate' },
      { key: 'workers', title: 'Miners' }
    ]

    $('poolTrendGrid').innerHTML = trends.map(function (trend) {
      var points = chartPoints(charts[trend.key])
      return '<section class="trend-card">' +
        '<div class="trend-header">' +
          '<div><h3>' + escapeHtml(trend.title) + '</h3><span>' + escapeHtml(chartPeriodLabel(points)) + '</span></div>' +
        '</div>' +
        (points.length > 1
          ? '<canvas class="trend-chart" data-chart-key="' + escapeAttr(trend.key) + '" width="320" height="92"></canvas>'
          : '<div class="trend-empty">Collecting history</div>') +
      '</section>'
    }).join('')

    trends.forEach(function (trend) {
      drawTrendChart(document.querySelector('[data-chart-key="' + trend.key + '"]'), chartPoints(charts[trend.key]))
    })
  }

  function chartPoints(raw) {
    if (!Array.isArray(raw)) return []
    return raw.map(function (point) {
      return {
        time: Number(point && point[0]),
        value: Number(point && point[1])
      }
    }).filter(function (point) {
      return isFinite(point.time) && isFinite(point.value)
    })
  }

  function chartPeriodLabel(points) {
    if (!points.length) return 'waiting for data'
    var first = points[0].time
    var last = points[points.length - 1].time
    var hours = Math.max(0, (last - first) / 3600)
    if (hours >= 24) return Math.round(hours / 24) + 'd snapshot'
    if (hours >= 1) return Math.round(hours) + 'h snapshot'
    return 'recent snapshot'
  }

  function drawTrendChart(canvas, points) {
    if (!canvas || points.length < 2) return
    var context = canvas.getContext('2d')
    var width = canvas.width
    var height = canvas.height
    var padding = 8
    var values = points.map(function (point) { return point.value })
    var min = Math.min.apply(Math, values)
    var max = Math.max.apply(Math, values)
    var range = max - min || 1

    context.clearRect(0, 0, width, height)
    context.lineWidth = 2
    context.strokeStyle = '#0f766e'
    context.fillStyle = 'rgba(15, 118, 110, 0.12)'
    context.beginPath()
    points.forEach(function (point, index) {
      var x = padding + (index / (points.length - 1)) * (width - padding * 2)
      var y = height - padding - ((point.value - min) / range) * (height - padding * 2)
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    context.stroke()
    context.lineTo(width - padding, height - padding)
    context.lineTo(padding, height - padding)
    context.closePath()
    context.fill()
  }

  function renderMarket() {
    var market = state.market || {}
    var prices = market.prices || {}
    var dego = prices.DEGO || {}
    var wrkz = prices.WRKZ || {}
    var degoDisplayAmount = Number(dego.displayAmount || 1000000000)
    var wrkzDisplayAmount = Number(wrkz.displayAmount || 1000000)

    setText('degoMarketPrice', dego.displayUsd !== null && dego.displayUsd !== undefined ? formatUsd(dego.displayUsd) : 'Unavailable')
    setText('wrkzMarketPrice', wrkz.displayUsd !== null && wrkz.displayUsd !== undefined ? formatUsd(wrkz.displayUsd) : 'Unavailable')
    setText('marketUpdated', market.updated ? formatDate(market.updated) : '-')

    var panel = $('degoMarketPanel')
    if (panel) {
      panel.classList.toggle('is-stale', !!market.stale)
      var primaryLabel = panel.querySelector('.market-value.primary span')
      var wrkzLabel = panel.querySelector('.market-value:not(.primary) span')
      if (primaryLabel) primaryLabel.textContent = formatCompactCoinAmount(degoDisplayAmount) + ' DEGO'
      if (wrkzLabel) wrkzLabel.textContent = formatCompactCoinAmount(wrkzDisplayAmount) + ' WRKZ'
    }
  }

  function formatCompactCoinAmount(value) {
    var number = Number(value)
    if (!isFinite(number)) return '1M'
    if (number >= 1000000000 && number % 1000000000 === 0) return (number / 1000000000) + 'B'
    if (number >= 1000000 && number % 1000000 === 0) return (number / 1000000) + 'M'
    if (number >= 1000 && number % 1000 === 0) return (number / 1000) + 'K'
    return formatNumber(number)
  }

  function metric(label, value) {
    return '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>'
  }

  function healthClass(value) {
    return value ? 'ok' : 'warn'
  }

  function renderRecentBlocks() {
    var rows = []
    coinEntries().forEach(function (entry) {
      var blocks = entry.data.blocks || {}
      mergedBlockRows(blocks).slice(0, 5).forEach(function (block) {
        rows.push({
          symbol: entry.symbol,
          height: block.height,
          status: blockStatus(block),
          effort: blockEffort(block),
          time: block.timestamp || block.time
        })
      })
    })
    $('recentBlocksRows').innerHTML = rows.length ? rows.map(function (row) {
      return '<tr class="' + blockRowClass(row.status) + '"><td>' + escapeHtml(row.symbol) + '</td><td>' + escapeHtml(formatNumber(row.height)) + '</td><td>' + statusBadge(row.status) + '</td><td>' + escapeHtml(row.effort) + '</td><td>' + escapeHtml(formatDate(row.time)) + '</td></tr>'
    }).join('') : emptyRow(5)
  }

  function mergedBlockRows(blocks) {
    var latest = (blocks && blocks.latest) || []
    var matured = (blocks && blocks.maturedLatest) || []
    var maturedByKey = {}

    matured.forEach(function (block) {
      maturedByKey[blockKey(block)] = block
    })

    return latest.map(function (block) {
      var maturedBlock = maturedByKey[blockKey(block)]
      if (!maturedBlock) return block
      var merged = {}
      Object.keys(block).forEach(function (key) { merged[key] = block[key] })
      Object.keys(maturedBlock).forEach(function (key) { merged[key] = maturedBlock[key] })
      return merged
    })
  }

  function blockKey(block) {
    return String(block.hash || '') + ':' + String(block.height || '')
  }

  function blockStatus(block) {
    if (block.orphaned === true) return 'orphaned'
    if (block.orphaned === false) return 'confirmed'
    if (block.status === 'OK') return 'submitted'
    return block.status || 'pending'
  }

  function statusBadge(status) {
    var type = status === 'confirmed' ? 'ok' : status === 'orphaned' ? 'fail' : 'warn'
    return '<span class="badge ' + type + '">' + escapeHtml(status) + '</span>'
  }

  function blockRowClass(status) {
    return status === 'orphaned' ? 'block-row-orphaned' : ''
  }

  function blockEffort(block) {
    if (block.effortPercent !== undefined && block.effortPercent !== null) return formatPercent(block.effortPercent)
    var work = block.shareDifficulty || block.shares
    return work && block.difficulty ? formatPercent((work / block.difficulty) * 100) : '-'
  }

  function renderBlocks() {
    renderCoinTabs('blocksTabs', 'data-block-coin', state.activeBlockCoin)
    var entry = coinEntries().filter(function (item) { return item.symbol === state.activeBlockCoin })[0] || coinEntries()[0]
    var blocks = entry && entry.data.blocks ? mergedBlockRows(entry.data.blocks) : []
    $('blocksRows').innerHTML = blocks.length ? blocks.map(function (block) {
      var status = blockStatus(block)
      return '<tr class="' + blockRowClass(status) + '">' +
        '<td>' + escapeHtml(formatNumber(block.height)) + '</td>' +
        '<td>' + statusBadge(status) + '</td>' +
        '<td>' + escapeHtml(formatNumber(block.difficulty)) + '</td>' +
        '<td>' + escapeHtml(formatNumber(block.shareDifficulty)) + '</td>' +
        '<td>' + escapeHtml(blockEffort(block)) + '</td>' +
        '<td>' + linkHash(entry.symbol, 'block', block.hash) + '</td>' +
        '<td>' + escapeHtml(formatDate(block.timestamp || block.time)) + '</td>' +
      '</tr>'
    }).join('') : emptyRow(7)
  }

  function parsePayment(time, raw) {
    var parts = String(raw || '').split(':')
    return {
      time: Number(time),
      hash: parts[0],
      amount: Number(parts[1]),
      fee: Number(parts[2]),
      mixin: parts[3],
      recipients: parts[4]
    }
  }

  function paymentRows(results, symbol) {
    var rows = []
    for (var i = 0; i < results.length; i += 2) {
      rows.push(parsePayment(results[i + 1], results[i]))
    }
    return rows.map(function (payment) {
      return '<tr>' +
        '<td>' + escapeHtml(formatDate(payment.time)) + '</td>' +
        '<td>' + linkHash(symbol, 'tx', payment.hash) + '</td>' +
        '<td>' + escapeHtml(formatCoins(payment.amount, symbol)) + '</td>' +
        '<td>' + escapeHtml(formatCoins(payment.fee, symbol)) + '</td>' +
        '<td>' + escapeHtml(payment.mixin || '-') + '</td>' +
        '<td>' + escapeHtml(payment.recipients || '-') + '</td>' +
      '</tr>'
    }).join('')
  }

  function renderPayments() {
    renderCoinTabs('paymentsTabs', 'data-payment-coin', state.activePaymentCoin)
    var symbol = state.activePaymentCoin
    var parent = state.stats.config.symbol
    var source = symbol === parent ? state.stats.pool.payments || [] : []
    $('paymentsRows').innerHTML = source.length ? paymentRows(source, symbol) : emptyRow(6)
    if (symbol !== parent) loadPayments(symbol)
  }

  function renderCoinTabs(targetId, attributeName, activeSymbol) {
    $(targetId).innerHTML = coinEntries().map(function (entry) {
      var activeClass = entry.symbol === activeSymbol ? ' active' : ''
      return '<button class="tab' + activeClass + '" type="button" ' + attributeName + '="' + escapeAttr(entry.symbol) + '">' + escapeHtml(entry.symbol) + '</button>'
    }).join('')
  }

  function renderConnect() {
    var ports = state.stats.config.ports || []
    $('portsRows').innerHTML = ports.length ? ports.map(function (port) {
      return '<tr>' +
        '<td class="mono">' + escapeHtml(configuredPoolHost) + '</td>' +
        '<td>' + escapeHtml(port.port) + '</td>' +
        '<td>' + escapeHtml(formatNumber(port.difficulty)) + '</td>' +
        '<td>' + escapeHtml(connectPortDescription(port)) + '</td>' +
      '</tr>'
    }).join('') : emptyRow(4)

    var firstPort = ports[0] && ports[0].port ? ports[0].port : 3333
    var child = coinEntries().filter(function (entry) { return entry.data.role === 'child' })[0]
    var childPass = child ? '<WRKZ_ADDRESS>' : 'x'
    $('commandList').innerHTML =
      '<section class="command-card">' +
        '<h3>XMRig CPU</h3>' +
        '<code>xmrig -o ' + escapeHtml(configuredPoolHost) + ':' + escapeHtml(firstPort) + ' -u &lt;DEGO_ADDRESS&gt; -p ' + escapeHtml(childPass) + ' -a cryptonight-upx/2 --donate-level 0</code>' +
      '</section>' +
      '<section class="command-card">' +
        '<h3>XMRig GPU</h3>' +
        '<p>Use OpenCL for AMD GPUs; NVIDIA CUDA needs the official CUDA plugin.</p>' +
        '<code>xmrig -o ' + escapeHtml(configuredPoolHost) + ':' + escapeHtml(firstPort) + ' -u &lt;DEGO_ADDRESS&gt; -p ' + escapeHtml(childPass) + ' -a cryptonight-upx/2 --opencl --donate-level 0</code>' +
      '</section>' +
      '<section class="command-card">' +
        '<h3>TeamRedMiner AMD</h3>' +
        '<p>For AMD rigs that support the Cryptonight v8 UPX2 algorithm.</p>' +
        '<code>teamredminer -a cnv8_upx2 -o stratum+tcp://' + escapeHtml(configuredPoolHost) + ':' + escapeHtml(firstPort) + ' -u &lt;DEGO_ADDRESS&gt; -p ' + escapeHtml(childPass) + '</code>' +
      '</section>' +
      '<section class="command-card">' +
        '<h3>Fixed Difficulty</h3>' +
        '<code>xmrig -o ' + escapeHtml(configuredPoolHost) + ':' + escapeHtml(firstPort) + ' -u &lt;DEGO_ADDRESS&gt;.500000 -p ' + escapeHtml(childPass) + ' -a cryptonight-upx/2 --donate-level 0</code>' +
      '</section>' +
      '<section class="command-card command-card-link">' +
        '<div>' +
          '<h3>Miner Downloads</h3>' +
          '<p>XMRig is unified for CPU and AMD OpenCL; NVIDIA uses the official CUDA plugin.</p>' +
        '</div>' +
        '<div class="button-row">' +
          '<a class="button secondary" target="_blank" rel="noopener" href="https://github.com/xmrig/xmrig/releases/latest">XMRig Releases</a>' +
          '<a class="button secondary" target="_blank" rel="noopener" href="https://github.com/xmrig/xmrig-cuda/releases/latest">CUDA Plugin</a>' +
          '<a class="button secondary" target="_blank" rel="noopener" href="https://github.com/todxx/teamredminer/releases/latest">TeamRedMiner</a>' +
        '</div>' +
      '</section>'
  }

  function connectPortDescription(port) {
    var configured = String(port.desc || '').trim()
    if (configured && !/test|dev|local|payment/i.test(configured)) return configured

    var difficulty = Number(port.difficulty || 0)
    if (difficulty >= 1000000) return 'High hashrate miners and rented hash'
    if (difficulty >= 300000) return 'Recommended for modern CPU miners'
    if (difficulty >= 100000) return 'Balanced starting port'
    return 'Light miners and first connection tests'
  }

  function renderMiner(data) {
    if (data.error) {
      $('minerResult').innerHTML = '<section class="panel"><p class="empty">' + escapeHtml(data.error) + '</p></section>'
      return
    }
    var coins = data.coins || {}
    $('minerResult').innerHTML = Object.keys(coins).map(function (symbol) {
      var coin = coins[symbol]
      var stats = coin.stats || {}
      return '<section class="panel">' +
        '<div class="panel-header"><h3>' + escapeHtml(symbol) + '</h3><span class="badge">' + escapeHtml(coin.role) + '</span></div>' +
        '<div class="balance-grid">' +
          balance('Hashrate', coin.hashrate || stats.hashrate || '0 H') +
          balance('Hashes', formatNumber(stats.hashes)) +
          balance('Pending', formatCoins(stats.balance, symbol)) +
          balance('Paid', formatCoins(stats.paid, symbol)) +
          balance('Last Share', formatDate(stats.lastShare)) +
          balance('Pool Fee', formatPercent(coin.poolFee)) +
          balance('Min Payout', formatCoins(coin.effectiveMinimumPayout || coin.minimumPayout, symbol)) +
        '</div>' +
        (coin.payoutAddress ? '<p class="mono">WRKZ payout: ' + escapeHtml(coin.payoutAddress) + '</p>' : '') +
        '<div class="table-wrap"><table><thead><tr><th>Time</th><th>Transaction</th><th>Amount</th><th>Fee</th><th>Mixin</th><th>Payees</th></tr></thead><tbody>' +
          (coin.payments && coin.payments.length ? paymentRows(coin.payments, symbol) : emptyRow(6)) +
        '</tbody></table></div>' +
      '</section>'
    }).join('')
  }

  function balance(label, value) {
    return '<div class="balance-item"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>'
  }

  function renderAdminStats(data) {
    if (!data || data.error) {
      $('adminStats').innerHTML = '<p class="empty">' + escapeHtml(data && data.error ? data.error : 'No admin data loaded.') + '</p>'
      return
    }
    var coins = data.coins || {}
    var symbols = Object.keys(coins)
    if (!symbols.length) {
      var fallbackSymbol = getParentSymbol()
      symbols = [fallbackSymbol]
      coins[fallbackSymbol] = data
    }
    $('adminStats').innerHTML = symbols.map(function (symbol) {
      return '<section class="admin-coin">' +
        '<div class="admin-coin-header">' +
          '<h4>' + escapeHtml(symbol) + '</h4>' +
          '<span class="badge">' + escapeHtml(adminCoinRole(symbol)) + '</span>' +
        '</div>' +
        '<div class="admin-stats">' +
          renderAdminCoinStats(coins[symbol], symbol) +
        '</div>' +
      '</section>'
    }).join('')
  }

  function renderAdminCoinStats(data, symbol) {
    return adminMetric('Total Owed', formatCoins(data.totalOwed, symbol)) +
      adminMetric('Total Paid', formatCoins(data.totalPaid, symbol)) +
      adminMetric('Total Mined', formatCoins(data.totalRevenue, symbol)) +
      adminMetric('Profit', formatCoins(Number(data.totalRevenue || 0) - Number(data.totalOwed || 0) - Number(data.totalPaid || 0), symbol)) +
      adminMetric('Orphan Percent', formatPercent(adminOrphanPercent(data))) +
      adminMetric('Workers', formatNumber(data.totalWorkers))
  }

  function adminCoinRole(symbol) {
    return symbol === getParentSymbol() ? 'parent' : 'child'
  }

  function getParentSymbol() {
    return state.stats && state.stats.config && state.stats.config.symbol
      ? state.stats.config.symbol
      : 'DEGO'
  }

  function adminOrphanPercent(data) {
    var orphaned = Number(data.blocksOrphaned || 0)
    var unlocked = Number(data.blocksUnlocked || 0)
    var total = orphaned + unlocked
    if (!total) return 0
    return (orphaned / total) * 100
  }

  function adminMetric(label, value) {
    return '<div class="admin-item"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>'
  }

  function renderHealth(data, targetId) {
    var monitoring = data && data.monitoring ? data.monitoring : data
    var keys = monitoring ? Object.keys(monitoring) : []
    $(targetId).innerHTML = keys.length ? keys.map(function (key) {
      var item = monitoring[key] || {}
      return '<div class="health-row">' +
        '<div><strong>' + escapeHtml(healthName(key)) + '</strong><small>' + escapeHtml(formatHealthMeta(item)) + '</small><small>' + escapeHtml(formatHealthResponse(item.lastResponse)) + '</small></div>' +
        '<span class="badge ' + (item.lastStatus === 'ok' ? 'ok' : 'fail') + '">' + escapeHtml(item.lastStatus || 'unknown') + '</span>' +
      '</div>'
    }).join('') : '<p class="empty">No monitoring data available.</p>'
  }

  function healthName(key) {
    return String(key)
      .replace('mergedMining:', '')
      .replace(':', ' ')
  }

  function formatHealthMeta(item) {
    var checked = item.lastCheck ? 'checked ' + formatDate(item.lastCheck) : 'not checked'
    if (item.lastFail) checked += ' | last fail ' + formatDate(item.lastFail)
    return checked
  }

  function formatHealthResponse(response) {
    if (!response) return '-'
    try {
      var parsed = JSON.parse(response)
      var parts = []
      if (parsed.status) parts.push('status ' + parsed.status)
      if (parsed.count) parts.push('height ' + formatNumber(parsed.count))
      if (parsed.localDaemonBlockCount) parts.push('daemon ' + formatNumber(parsed.localDaemonBlockCount))
      if (parsed.networkBlockCount) parts.push('network ' + formatNumber(parsed.networkBlockCount))
      if (parsed.walletBlockCount) parts.push('wallet ' + formatNumber(parsed.walletBlockCount))
      if (parsed.peerCount !== undefined) parts.push('peers ' + formatNumber(parsed.peerCount))
      if (parsed.hashrate !== undefined) parts.push('hashrate ' + formatHashrate(parsed.hashrate))
      return parts.length ? parts.join(' | ') : response
    } catch (error) {
      return response
    }
  }

  function emptyRow(colspan) {
    return '<tr><td colspan="' + colspan + '" class="empty-cell">No data available.</td></tr>'
  }

  function loadStats() {
    setStatus('warn', 'Updating')
    return fetchJson('/stats')
      .then(function (stats) {
        state.stats = stats
        state.activePaymentCoin = state.activePaymentCoin || stats.config.symbol
        setStatus('ok', 'Live')
        setText('lastUpdated', 'Updated ' + new Date().toLocaleTimeString())
        render()
      })
      .catch(function (error) {
        setStatus('fail', 'Offline')
        setText('lastUpdated', error.message)
      })
  }

  function loadMarketPrices() {
    return fetchJson('/market_prices')
      .then(function (market) {
        state.market = market
        renderMarket()
      })
      .catch(function () {
        state.market = { prices: {} }
        renderMarket()
      })
  }

  function loadPayments(symbol) {
    fetchJson('/get_payments', { coin: symbol, time: 9999999999 })
      .then(function (payments) {
        if (state.activePaymentCoin !== symbol) return
        $('paymentsRows').innerHTML = payments.length ? paymentRows(payments, symbol) : emptyRow(6)
      })
      .catch(function () {
        if (state.activePaymentCoin === symbol) $('paymentsRows').innerHTML = '<tr><td colspan="6" class="empty-cell">Could not load payments.</td></tr>'
      })
  }

  function loadHealth() {
    return fetchJson('/health')
      .then(renderPublicHealth)
      .catch(function (error) {
        $('healthList').innerHTML = '<p class="empty">' + escapeHtml(error.message) + '</p>'
      })
  }

  function renderPublicHealth(data) {
    var services = data && data.services ? data.services : {}
    var keys = Object.keys(services)
    $('healthList').innerHTML = keys.length ? keys.map(function (key) {
      var service = services[key] || {}
      return '<div class="health-row">' +
        '<div><strong>' + escapeHtml(service.label || key) + '</strong><small>' + escapeHtml(service.lastCheck ? 'checked ' + formatDate(service.lastCheck) : 'not checked') + '</small></div>' +
        serviceStatusBadge(service.status) +
      '</div>'
    }).join('') : '<p class="empty">No public service status available.</p>'
  }

  function serviceStatusBadge(status) {
    var type = status === 'ok' ? 'ok' : status === 'fail' ? 'fail' : status === 'disabled' ? 'disabled' : 'warn'
    return '<span class="badge ' + type + '">' + escapeHtml(status || 'unknown') + '</span>'
  }

  function bindEvents() {
    var savedMinerAddress = loadSavedValue(storageKeys.minerAddress)
    var savedAdminPassword = loadSavedValue(storageKeys.adminPassword)
    if (savedMinerAddress) $('minerAddress').value = savedMinerAddress
    if (savedAdminPassword) {
      state.adminPassword = savedAdminPassword
      $('adminPassword').value = savedAdminPassword
    }

    window.addEventListener('hashchange', routeFromHash)
    $('refreshButton').addEventListener('click', function () {
      loadStats()
      loadMarketPrices()
    })
    Array.prototype.forEach.call(['input', 'change', 'blur'], function (eventName) {
      $('minerAddress').addEventListener(eventName, saveRememberedInputs)
      $('adminPassword').addEventListener(eventName, saveRememberedInputs)
    })
    window.addEventListener('pagehide', saveRememberedInputs)
    $('minerForm').addEventListener('submit', function (event) {
      event.preventDefault()
      var address = $('minerAddress').value.trim()
      if (!address) return
      saveRememberedInputs()
      fetchJson('/stats_address', { address: address }).then(renderMiner).catch(function (error) {
        $('minerResult').innerHTML = '<section class="panel"><p class="empty">' + escapeHtml(error.message) + '</p></section>'
      })
    })
    $('adminForm').addEventListener('submit', function (event) {
      event.preventDefault()
      saveRememberedInputs()
      fetchJson('/admin_stats', { password: state.adminPassword }).then(renderAdminStats).catch(function (error) {
        renderAdminStats({ error: error.message })
      })
      fetchJson('/admin_monitoring', { password: state.adminPassword }).then(function (data) { renderHealth(data, 'adminHealthList') }).catch(function (error) {
        $('adminHealthList').innerHTML = '<p class="empty">' + escapeHtml(error.message) + '</p>'
      })
    })
    Array.prototype.forEach.call(document.querySelectorAll('[data-route]'), function (link) {
      link.addEventListener('click', function () {
        state.route = link.getAttribute('data-route')
        renderRoute()
      })
    })
    $('blocksTabs').addEventListener('click', function (event) {
      var button = event.target.closest('[data-block-coin]')
      if (button) {
        state.activeBlockCoin = button.getAttribute('data-block-coin')
        setActive(button, '[data-block-coin]')
        renderBlocks()
      }
    })
    $('paymentsTabs').addEventListener('click', function (event) {
      var button = event.target.closest('[data-payment-coin]')
      if (button) {
        state.activePaymentCoin = button.getAttribute('data-payment-coin')
        setActive(button, '[data-payment-coin]')
        renderPayments()
      }
    })
  }

  function setActive(activeNode, selector) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), function (node) {
      node.classList.toggle('active', node === activeNode)
    })
  }

  function routeFromHash() {
    var route = (window.location.hash || '#overview').replace('#', '')
    state.route = titles[route] ? route : 'overview'
    renderRoute()
  }

  bindEvents()
  routeFromHash()
  loadStats()
  loadHealth()
  loadMarketPrices()
  window.setInterval(loadStats, 30000)
  window.setInterval(loadHealth, 60000)
  window.setInterval(loadMarketPrices, 300000)
})()
