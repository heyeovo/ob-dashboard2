import SubpageBackButton from '@/app/components/SubpageBackButton'
import CcWorkbenchPanel from '../CcWorkbenchPanel'

export default function SessionPage() {
  return <main className="mx-auto min-h-screen max-w-2xl px-4 pb-28 pt-3"><SubpageBackButton label="返回工作台" href="/workbench" /><h1 className="mb-5 mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold">当前工作窗口</h1><CcWorkbenchPanel /></main>
}
