import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Agent SDK 会 spawn claude code 子进程并读取自带的平台二进制，
  // 不能被打包进 server bundle，否则子进程找不到可执行文件。
  serverExternalPackages: ['@anthropic-ai/claude-agent-sdk'],
  async rewrites() {
    return [
      { source: '/chat-app', destination: '/chat-app/index.html' },
    ]
  },
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
