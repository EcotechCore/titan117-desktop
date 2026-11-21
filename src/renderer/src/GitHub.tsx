// Sign in with GitHub (decisions §25, §55): pull requests opened as you,
// through our GitHub App's device flow on GitHub's own page. The token is
// kept in this laptop's keychain only.
import { useCallback, useEffect, useState } from 'react'

type Status = Awaited<ReturnType<typeof window.titan117.github.status>>

export function GitHubSection({
  onProblem
}: {
  onProblem(error: unknown): void
}): React.JSX.Element {
  const [status, setStatus] = useState<Status | null>(null)

  const load = useCallback(() => {
    window.titan117.github.status().then(setStatus).catch(onProblem)
  }, [onProblem])

  useEffect(() => {
    load()
    window.titan117.github.onChange(load)
  }, [load])

  if (!status) return <></>
  return (
    <>
      <h2 className="section">GitHub</h2>
      {!status.configured ? (
        <p className="muted">
          One-click “Sign in with GitHub” comes once Titan117’s GitHub App is registered. Until
          then, pull requests open through GitHub’s own command-line tool when it’s signed in on
          this laptop, or on GitHub’s own page, filled in, where you press Create.
        </p>
      ) : status.signedIn ? (
        <div className="row">
          <div className="row-main">
            <p className="row-title">
              Signed in to GitHub{status.login ? ` as ${status.login}` : ''}
            </p>
            <p className="muted">
              Pull requests open as you. The sign-in stays in this laptop’s keychain; you can also
              revoke it on GitHub at any time.
            </p>
          </div>
          <button
            className="btn"
            onClick={() => window.titan117.github.signOut().then(setStatus).catch(onProblem)}
          >
            Sign out
          </button>
        </div>
      ) : status.pending ? (
        <div className="row row-tint">
          <div className="row-main">
            <p className="row-title">
              Enter this code on GitHub:{' '}
              <code className="code-user">{status.pending.userCode}</code>
            </p>
            <p className="muted">
              GitHub’s page is open in your browser ({status.pending.verificationUri}). Approve
              Titan117 there and choose which repositories it may use.
            </p>
          </div>
          <button
            className="btn"
            onClick={() => window.titan117.github.cancel().then(setStatus).catch(onProblem)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="row">
          <div className="row-main">
            <p className="row-title">Open pull requests as you</p>
            <p className="muted">
              Sign in on GitHub’s own page; Titan117 never sees your GitHub password.
              {status.problem ? ` ${status.problem}` : ''}
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => window.titan117.github.signIn().then(setStatus).catch(onProblem)}
          >
            Sign in with GitHub
          </button>
        </div>
      )}
    </>
  )
}
