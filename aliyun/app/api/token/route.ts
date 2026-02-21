const { handleTokenRequest } = require('../../../lib/server/token-handler')

export async function GET(req: Request) {
  return handleTokenRequest(req)
}

export async function POST(req: Request) {
  return handleTokenRequest(req)
}
