/** The account as the shell reports it (decisions §39); updates when it changes. */
import { useEffect, useState } from 'react'

import type { AccountView } from '../../preload/index.d'

export function useAccount(): AccountView | null {
  const [view, setView] = useState<AccountView | null>(null)
  useEffect(() => {
    void window.titan117.account.status().then(setView)
    window.titan117.account.onChange(setView)
  }, [])
  return view
}
