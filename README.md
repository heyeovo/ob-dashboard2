This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### iPhone UI preview

On the development computer, run `npm run dev:iphone`. The command prints the
LAN URL to open in iPhone Safari on the same Wi-Fi. It binds to that LAN IP,
connects to the VPS Haven HTTPS endpoint, and blocks writes to Dashboard API
routes while previewing live data and the uploaded appearance image. Edits
refresh through Next.js development mode. The computer and command must remain
running during preview. If several LAN adapters exist, pass the desired IP as
`npm run dev:iphone -- 192.168.1.7`. The login secret and Haven credentials
remain in the local, ignored `.env.local`; do not put them in the command line.
The default Haven preview URL can be overridden with
`DASHBOARD_PREVIEW_HAVEN_URL` in the launching environment if the VPS hostname
changes.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deployment

Production runs on the VPS through Coolify. Pushing `main` triggers an automatic deployment; after each push, confirm that the latest deployment uses the expected commit and passes its healthcheck. Use `Actions → Redeploy` only when the automatic deployment does not start or fails.
