import PromptEditor from '../../../PromptEditor'

export default async function Page({ params }: { params: Promise<{ id: string; moduleId: string }> }) {
  const { id, moduleId } = await params
  return <PromptEditor id={id} moduleId={moduleId} />
}
