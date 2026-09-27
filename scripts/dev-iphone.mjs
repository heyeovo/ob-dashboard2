import { spawn } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { resolve } from 'node:path'

const DEFAULT_HAVEN_URL = 'https://ygao2jdgxlqzxfoasmjpvxcf.23.95.136.46.sslip.io'

function isPrivateIPv4(address) {
  return address.startsWith('192.168.')
    || address.startsWith('10.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(address)
}

function lanAddress() {
  const addresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries || [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal && isPrivateIPv4(entry.address))
    .map((entry) => entry.address)
  return addresses.find((address) => address.startsWith('192.168.')) || addresses[0]
}

const specifiedHost = process.argv[2]
const host = specifiedHost || lanAddress()
if (!host) {
  console.error('没有找到局域网 IPv4 地址。可运行 npm run dev:iphone -- 192.168.1.7')
  process.exit(1)
}

const havenUrl = process.env.DASHBOARD_PREVIEW_HAVEN_URL || DEFAULT_HAVEN_URL
if (!havenUrl.startsWith('https://')) {
  console.error('开发预览的 Haven 地址必须使用 HTTPS。')
  process.exit(1)
}

console.log(`iPhone 预览（只读）：http://${host}:3000`)
const child = spawn(
  process.execPath,
  [resolve('node_modules/next/dist/bin/next'), 'dev', '-H', host],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      HAVEN_GATEWAY_URL: havenUrl,
      DASHBOARD_PREVIEW_READ_ONLY: '1',
    },
  },
)

child.on('exit', (code) => process.exit(code ?? 0))
