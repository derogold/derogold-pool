var api = 'https://api.derogold.online/apimine'

var api_blockexplorer = 'https://api.derogold.online/apimine'

var poolHost = 'pool.derogold.online'

var stratumHost = poolHost

var email = 'support@poolhost.com'

var cryptonatorWidget = ['', '{symbol}-USD', '{symbol}-EUR']

var easyminerDownload = 'https://github.com/uPlexa/xmrig-upx/releases/tag/v0.2.0'

var blockchainExplorer = 'https://explorer.derogold.online/block/{id}'

var transactionExplorer = 'https://explorer.derogold.online/tx/{id}'

var childExplorers = {
  WRKZ: {
    block: 'https://explorer.wrkz.work/#/block/{id}',
    tx: 'https://explorer.wrkz.work/#/tx/{id}'
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
