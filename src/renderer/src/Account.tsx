/**
 * The account in the window (decisions §17, §39): the lock screen that
 * replaces the workspace when Titan117 may not be used, the reminder before
 * the offline lease runs out, and the account box in the sidebar. The device
 * token never reaches this page; the shell keeps it.
 */
import { useState } from 'react'

import type { AccountView } from '../../preload/index.d'
import { Eyes } from './ui'

const PLAN_NAME: Record<string, string> = {
  starter: 'Starter',
  pro: 'Pro',
  max: 'Max',
  team: 'Team seat',
  agency: 'Agency seat',
  custom: 'Custom'
}

function day(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
}

export function LockScreen({ view }: { view: AccountView }): React.JSX.Element {
  const [busy, setBusy] = useState(false)

  async function signIn(): Promise<void> {
    setBusy(true)
    try {
      await window.titan117.account.signIn()
    } finally {
      setBusy(false)
    }
  }

  const text =
    view.reason === 'noPlan'
      ? {
          title: 'Choose a plan to keep using Titan117',
          body: 'Your account has no active plan. Choose one on your account page; this window unlocks as soon as it’s active.'
        }
      : view.reason === 'expired'
        ? {
            title: 'Connect to the internet',
            body: 'Titan117 works offline for 14 days at a time. Connect once so it can check your plan, and you can carry on.'
          }
        : {
            title: 'Sign in to Titan117',
            body: 'Sign in with your Titan117 account. Your browser opens; confirm there and come back.'
          }

  return (
    <main className="boot lock">
      <Eyes state={busy ? 'working' : 'idle'} size="large" />
      <h1>{text.title}</h1>
      <p>{text.body}</p>
      {view.problem && (
        <p className="lock-problem" role="alert">
          {view.problem}
        </p>
      )}
      <div className="lock-actions">
        {view.reason === 'signedOut' &&
          (busy ? (
            <>
              <button className="btn" disabled>
                Waiting for your browser…
              </button>
              <button className="btn" onClick={() => void window.titan117.account.cancelSignIn()}>
                Cancel
              </button>
            </>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => void signIn()}
              disabled={!view.configured}
            >
              Sign in
            </button>
          ))}
        {view.reason === 'noPlan' && (
          <>
            <button
              className="btn btn-primary"
              onClick={() => void window.titan117.account.openPage()}
            >
              Open my account page
            </button>
            <button className="btn" onClick={() => void window.titan117.account.refresh()}>
              I’ve chosen a plan
            </button>
          </>
        )}
        {view.reason === 'expired' && (
          <button
            className="btn btn-primary"
            onClick={() => void window.titan117.account.refresh()}
          >
            Try again
          </button>
        )}
      </div>
      {view.signedIn && (
        <button className="text-btn" onClick={() => void window.titan117.account.signOut()}>
          Sign out of this computer
        </button>
      )}
      <p className="faint lock-note">
        Your files, documents and project folders stay on this computer and remain yours while
        Titan117 is locked.
      </p>
    </main>
  )
}

/** The reminder in the last days before the offline lease runs out. */
export function LeaseWarning({ view }: { view: AccountView }): React.JSX.Element | null {
  if (!view.warn || !view.expiresAt) return null
  return (
    <div className="lease-warning" role="status">
      Connect to the internet to keep using Titan117 after {day(view.expiresAt)}.
    </div>
  )
}

/** Bottom of the sidebar: who's signed in, with a way to the account page. */
export function AccountBox({ view }: { view: AccountView }): React.JSX.Element | null {
  if (!view.enforced && !view.signedIn) return null
  return (
    <div className="account-box">
      <span className="account-plan">{view.plan ? PLAN_NAME[view.plan] : 'No plan'}</span>
      <button className="text-btn" onClick={() => void window.titan117.account.openPage()}>
        Account
      </button>
      <button className="text-btn" onClick={() => void window.titan117.account.signOut()}>
        Sign out
      </button>
    </div>
  )
}
