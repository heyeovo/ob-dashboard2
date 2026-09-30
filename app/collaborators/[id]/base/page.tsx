import PromptEditor from '../../PromptEditor'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PromptEditor id={id} />
}
