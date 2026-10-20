import type { Metadata } from 'next'
import { InviteFlow } from '@/components/invite-flow'

export const metadata: Metadata = {
  title: '解锁进厂配额 · TAPECAT',
  description: '做任务解锁 $BEM 配额，在流片窗口内锁定份额。',
}

export default function InvitePage() {
  return <InviteFlow />
}
