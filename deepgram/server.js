const http = require("node:http")
const { parse } = require("node:url")

const next = require("next")
const { WebSocketServer, WebSocket } = require("ws")
const { normalizeCloseCode, resolveStreamingModel } = require("./lib/streaming")

const dev = process.env.NODE_ENV !== "production"
const hostname = process.env.HOST || "localhost"
const port = Number(process.env.PORT || 3000)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

function createDeepgramWsUrl(req) {
  const requestUrl = new URL(req.url || "/api/stream", `http://${req.headers.host || `${hostname}:${port}`}`)
  const requestedModel = requestUrl.searchParams.get("model") || "nova-2"
  const language = requestUrl.searchParams.get("language") || "zh-CN"
  const model = resolveStreamingModel({ model: requestedModel, language })

  const params = new URLSearchParams({
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    punctuate: "true",
    smart_format: "true",
    interim_results: "true",
    endpointing: "300",
    model,
    language,
  })

  return {
    url: `wss://api.deepgram.com/v1/listen?${params.toString()}`,
    requestedModel,
    model,
    language,
  }
}

function sendClientError(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ error: message }))
  }
}

function formatDeepgramHandshakeError(statusCode, body) {
  if (!body) {
    return `Deepgram 握手失败（HTTP ${statusCode}）`
  }

  try {
    const payload = JSON.parse(body)
    const reason = payload.err_msg || payload.error || body
    return `Deepgram 握手失败（HTTP ${statusCode}）：${reason}`
  } catch {
    return `Deepgram 握手失败（HTTP ${statusCode}）：${body}`
  }
}

app
  .prepare()
  .then(() => {
    const server = http.createServer((req, res) => {
      const parsedUrl = parse(req.url || "", true)
      handle(req, res, parsedUrl)
    })

    const wss = new WebSocketServer({ noServer: true })

    server.on("upgrade", (req, socket, head) => {
      const { pathname } = new URL(req.url || "/", `http://${req.headers.host || `${hostname}:${port}`}`)

      if (pathname !== "/api/stream") {
        socket.destroy()
        return
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req)
      })
    })

    wss.on("connection", (clientWs, req) => {
      const apiKey = process.env.DEEPGRAM_API_KEY

      if (!apiKey) {
        sendClientError(clientWs, "服务端未配置 DEEPGRAM_API_KEY")
        clientWs.close(1011)
        return
      }

      const streamConfig = createDeepgramWsUrl(req)
      const dgWs = new WebSocket(streamConfig.url, {
        headers: {
          Authorization: `Token ${apiKey}`,
        },
      })

      const keepAliveTimer = setInterval(() => {
        if (dgWs.readyState === WebSocket.OPEN) {
          dgWs.send(JSON.stringify({ type: "KeepAlive" }))
        }
      }, 8000)

      dgWs.on("open", () => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(
            JSON.stringify({
              type: "connected",
              model: streamConfig.model,
              language: streamConfig.language,
              fallback:
                streamConfig.requestedModel === streamConfig.model
                  ? null
                  : {
                      requested: streamConfig.requestedModel,
                      effective: streamConfig.model,
                    },
            }),
          )
        }
      })

      dgWs.on("message", (payload, isBinary) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(payload, { binary: isBinary })
        }
      })

      dgWs.on("error", (error) => {
        sendClientError(clientWs, error.message || "Deepgram 连接失败")
      })

      dgWs.on("unexpected-response", (_request, response) => {
        let body = ""
        response.on("data", (chunk) => {
          body += chunk.toString()
        })
        response.on("end", () => {
          const message = formatDeepgramHandshakeError(response.statusCode || 400, body)
          sendClientError(clientWs, message)
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(1011)
          }
        })
      })

      dgWs.on("close", (code, reason) => {
        clearInterval(keepAliveTimer)
        if (clientWs.readyState === WebSocket.OPEN) {
          const safeCode = normalizeCloseCode(code, 1011)
          const closeReason = reason ? reason.toString().slice(0, 80) : undefined
          clientWs.close(safeCode, closeReason)
        }
      })

      clientWs.on("message", (payload, isBinary) => {
        if (dgWs.readyState !== WebSocket.OPEN) {
          return
        }

        if (isBinary || Buffer.isBuffer(payload)) {
          dgWs.send(payload, { binary: true })
          return
        }

        dgWs.send(payload.toString())
      })

      clientWs.on("close", () => {
        clearInterval(keepAliveTimer)

        if (dgWs.readyState === WebSocket.OPEN) {
          dgWs.send(JSON.stringify({ type: "CloseStream" }))
        }

        dgWs.close()
      })

      clientWs.on("error", () => {
        clearInterval(keepAliveTimer)
        dgWs.close()
      })
    })

    server.listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`)
      console.log(`> File transcription: http://${hostname}:${port}`)
      console.log(`> Streaming demo: http://${hostname}:${port}/streaming`)
    })
  })
  .catch((error) => {
    console.error("Failed to start server", error)
    process.exit(1)
  })
