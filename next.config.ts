import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Agent SDK 会 spawn claude code 子进程并读取自带的平台二进制，
  // 不能被打包进 server bundle，否则子进程找不到可执行文件。
  serverExternalPackages: ['@anthropic-ai/claude-agent-sdk'],
  // 手机从内网 IP 访问 dev 服务器（`npm run dev:lan`）时必须放行。
  //
  // Next 默认只让 localhost 请求 dev 资源，别的来源算跨源，那些 `/_next/*` 的 JS
  // 会被挡掉 —— 症状很迷惑：**页面显示得出来（HTML 是服务端渲染的），但所有按钮
  // 都是死的**（底部 5 个 Tab 是 `router.push`，纯靠 JS）。别往组件里找 bug。
  //
  // 只影响 dev，生产构建不看这个键。列的是家用内网的三个私有段。
  // ⚠️ 改了这里必须重启 dev 服务器才生效。
  allowedDevOrigins: [
    '192.168.*.*',
    '10.*.*.*',
    '172.16.*.*',
    '172.17.*.*',
    '172.18.*.*',
    '172.19.*.*',
    '172.2*.*.*',
    '172.30.*.*',
    '172.31.*.*',
  ],
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'Cache-Control', value: 'no-cache' },
        ],
      },
    ]
  },
};

export default nextConfig;
