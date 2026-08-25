import { execFile } from 'node:child_process'

function run(repoPath: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd: repoPath, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf-8' },
      (err, stdout, stderr) => {
        let code = 0
        if (err) {
          const raw = (err as NodeJS.ErrnoException & { code?: unknown }).code
          code = typeof raw === 'number' ? raw : 1
        }
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' })
      },
    )
  })
}

export async function gitStatus(repoPath: string) {
  const branch = (await run(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim() || '(无分支)'
  const porcelain = await run(repoPath, ['status', '--porcelain', '-z'])
  const dirtyCount = porcelain.stdout.split('\0').filter((s) => s.trim().length > 0).length
  let ahead = 0
  let behind = 0
  const lr = await run(repoPath, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
  if (lr.code === 0) {
    const m = lr.stdout.trim().split(/\s+/)
    ahead = Number(m[0] ?? 0)
    behind = Number(m[1] ?? 0)
  }
  return { branch, dirtyCount, ahead, behind }
}

export async function gitPull(repoPath: string) {
  const r = await run(repoPath, ['pull', '--ff-only'])
  if (r.code !== 0) {
    return { ok: false, changed: false, message: (r.stderr || r.stdout).trim().slice(0, 500) }
  }
  const out = r.stdout.trim()
  const changed = !/Already up.to.date/i.test(out)
  return { ok: true, changed, message: changed ? '已拉取最新文档' : '已是最新' }
}

/** add-all + commit + push;无变更时仅 push 未推送的提交 */
export async function gitSync(repoPath: string, message: string) {
  const st = await gitStatus(repoPath)
  if (st.dirtyCount > 0) {
    await run(repoPath, ['add', '-A'])
    const c = await run(repoPath, ['commit', '-m', message])
    if (c.code !== 0) return { ok: false, changed: false, message: (c.stderr || c.stdout).trim().slice(0, 500) }
  }
  let p = await run(repoPath, ['push'])
  if (p.code !== 0) {
    // 远端领先:rebase 后重推
    const rb = await run(repoPath, ['pull', '--rebase'])
    if (rb.code !== 0) {
      await run(repoPath, ['rebase', '--abort'])
      return { ok: false, changed: false, message: '存在冲突,请选择保留方式:' + (rb.stderr || rb.stdout).trim().slice(0, 300) }
    }
    p = await run(repoPath, ['push'])
    if (p.code !== 0) return { ok: false, changed: false, message: (p.stderr || p.stdout).trim().slice(0, 500) }
  }
  return { ok: true, changed: true, message: '已提交并推送' }
}
