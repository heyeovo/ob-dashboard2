import SubpageBackButton from '@/app/components/SubpageBackButton'
import ContextAuditPanel from '../ContextAuditPanel'

export default function ContextPage() {
  return <main className="mx-auto min-h-screen max-w-2xl px-4 pb-28 pt-3"><SubpageBackButton label="返回工作台" href="/workbench" /><h1 className="mb-5 mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold">上下文审计</h1><ContextAuditPanel /></main>
}
