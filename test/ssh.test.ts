/**
 * The user's own servers over SSH (3.15): SSH never prompts, never trusts
 * an unknown host, never forwards the user's agent, and a server's name and
 * address can't smuggle in options.
 */
import { describe, expect, it } from 'vitest'

import { checkServer, runOnServer, sshArgs } from '../src/engine/lib/ssh'

describe('servers over SSH', () => {
  it('accepts plain names and addresses and refuses anything that could be an option', () => {
    expect(checkServer({ name: 'web', target: 'deploy@example.com', port: 2222 })).toEqual({
      name: 'web',
      target: 'deploy@example.com',
      port: 2222
    })
    expect(checkServer({ name: 'box', target: 'my-alias' })).toEqual({
      name: 'box',
      target: 'my-alias'
    })
    for (const target of ['-oProxyCommand=calc', 'a b', 'host;rm', 'user@host$(x)', ''])
      expect(() => checkServer({ name: 'x', target })).toThrow()
    expect(() => checkServer({ name: '', target: 'h' })).toThrow()
    expect(() => checkServer({ name: 'x', target: 'h', port: 70000 })).toThrow()
  })

  it('never prompts, never trusts an unknown host, never forwards the agent', () => {
    const args = sshArgs({ name: 'web', target: 'deploy@example.com', port: 22 }, 'uptime', 120)
    expect(args).toEqual(
      expect.arrayContaining(['BatchMode=yes', 'StrictHostKeyChecking=yes', '-a', '-x', '-T'])
    )
    expect(args.slice(-3)).toEqual(['deploy@example.com', '--', 'uptime'])
    expect(args).toContain('ConnectTimeout=30')
  })

  it('says plainly when SSH isn’t installed', async () => {
    await expect(
      runOnServer({ name: 'web', target: 'h' }, 'ls', {
        timeoutMs: 5000,
        program: 'definitely-not-ssh-117'
      })
    ).rejects.toThrow(/SSH isn’t installed/)
  })
})
