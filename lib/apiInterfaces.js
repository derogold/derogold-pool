var http = require('http')
var https = require('https')

function restRequest (host, port, method, path, data, callback, apiKey) {
  var bodyStr = data ? JSON.stringify(data) : ''
  var options = {
    hostname: host,
    port: port,
    path: path,
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  }
  if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr)
  if (apiKey) options.headers['X-API-KEY'] = apiKey

  var req = (port === 443 ? https : http).request(options, function (res) {
    var replyData = ''
    res.setEncoding('utf8')
    res.on('data', function (chunk) { replyData += chunk })
    res.on('end', function () {
      var replyJson
      try {
        replyJson = JSON.parse(replyData)
      } catch (e) {
        callback(e)
        return
      }
      if (replyJson.error) {
        callback(replyJson.error)
        return
      }
      callback(null, replyJson)
    })
  })
  req.on('error', function (e) { callback(e) })
  if (bodyStr) req.write(bodyStr)
  req.end()
}

function jsonHttpRequest (host, port, data, callback, path) {
  path = path || '/json_rpc'

  var options = {
    hostname: host,
    port: port,
    path: path,
    method: data ? 'POST' : 'GET',
    headers: {
      'Content-Length': data.length,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  }

  var req = (port === 443 ? https : http).request(options, function (res) {
    var replyData = ''
    res.setEncoding('utf8')
    res.on('data', function (chunk) {
      replyData += chunk
    })
    res.on('end', function () {
      var replyJson
      try {
        replyJson = JSON.parse(replyData)
      } catch (e) {
        callback(e)
        return
      }
      callback(null, replyJson)
    })
  })

  req.on('error', function (e) {
    callback(e)
  })

  req.end(data)
}

function rpc (host, port, method, params, callback, password) {
  var request = {
    id: '0',
    jsonrpc: '2.0',
    method: method,
    params: params
  }
  if (password !== undefined) {
    request['password'] = password
  }
  var data = JSON.stringify(request)
  jsonHttpRequest(host, port, data, function (error, replyJson) {
    if (error) {
      callback(error)
      return
    }
    callback(replyJson.error, replyJson.result)
  })
}

module.exports = function (daemonConfig, walletConfig, poolApiConfig) {
  return {
    rpcDaemon: function (method, params, callback) {
      rpc(daemonConfig.host, daemonConfig.port, method, params, callback)
    },
    rpcWallet: function (method, params, callback) {
      rpc(walletConfig.host, walletConfig.port, method, params, callback,
        walletConfig.password)
    },
    restWallet: function (method, path, params, callback) {
      restRequest(walletConfig.host, walletConfig.port, method, path, params, callback, walletConfig.password)
    },
    pool: function (method, callback) {
      if (poolApiConfig.host === undefined) {
        poolApiConfig.host = '127.0.0.1'
      }
      jsonHttpRequest(poolApiConfig.host, poolApiConfig.port, '', callback, method)
    },
    jsonHttpRequest: jsonHttpRequest
  }
}
