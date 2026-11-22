var api = 'https://your-pool-api.example.com/apimine'

var api_blockexplorer = 'https://your-pool-api.example.com/apimine'

var poolHost = 'your-pool.example.com'

var stratumHost = 'mining.your-pool.example.com'

var email = 'support@poolhost.com'

var cryptonatorWidget = ['', '{symbol}-USD', '{symbol}-EUR']

var easyminerDownload = 'https://github.com/uPlexa/xmrig-upx/releases/tag/v0.2.0'

var blockchainExplorer = 'https://your-derogold-explorer.example.com/block/{id}'

var transactionExplorer = 'https://your-derogold-explorer.example.com/tx/{id}'

var childExplorers = {
  WRKZ: {
    block: 'https://your-wrkz-explorer.example.com/#/block/{id}',
    tx: 'https://your-wrkz-explorer.example.com/#/tx/{id}'
  }
}

var childCoinUnits = {
  WRKZ: 100
}

var themeCss = 'themes/default-theme.css'

var networkStat = {
  'bcn': [
    ['bcn.mypool.online', 'http://bcn.mypool.online:8084'],
    ['democats.org', 'http://pool.democats.org:7603']
  ]
}

window.poolDashboardConfig = {
  apiBase: api,
  stratumHost: stratumHost,
  blockchainExplorer: blockchainExplorer,
  transactionExplorer: transactionExplorer,
  childExplorers: childExplorers,
  childCoinUnits: childCoinUnits
}
