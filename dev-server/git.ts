import { execFile } from 'node:child_process'

export function run(repoPath: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
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
  const parts = porcelain.stdout.split('\0')
  const changes: { path: string; kind: string }[] = []
  let total = 0
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (!entry || entry.length < 4) continue
    total++
    const xy = entry.slice(0, 2)
    const p = entry.slice(3)
    let kind = 'modified'
    if (xy === '??') kind = 'untracked'
    else if (xy.includes('D')) kind = 'deleted'
    else if (xy.includes('R') || xy.includes('C')) {
      kind = 'renamed'
      i++ // -z 模式下重命名的旧路径占下一段,跳过
    } else if (xy.includes('A')) kind = 'added'
    if (changes.length < 500) changes.push({ path: p, kind })
  }
  let ahead = 0
  let behind = 0
  const lr = await run(repoPath, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
  if (lr.code === 0) {
    const m = lr.stdout.trim().split(/\s+/)
    ahead = Number(m[0] ?? 0)
    behind = Number(m[1] ?? 0)
  }
  return { branch, dirtyCount: total, changes, ahead, behind }
}

export async function gitPull(repoPath: string) {
  const r = await run(repoPath, ['pull', '--ff-only'])
  if (r.code !== 0) {
    const err = (r.stderr || r.stdout).trim()
    // 本地未提交修改会被覆盖 / 本地提交与远端分叉 → 提示可强制覆盖
    const divergent = /overwritten by merge|would be lost|Not possible to fast-forward|divergent|unstaged changes|uncommitted changes/i.test(err)
    return {
      ok: false,
      changed: false,
      divergent,
      message: divergent ? '本地有未同步的修改,阻碍了拉取' : err.slice(0, 500),
    }
  }
  const out = r.stdout.trim()
  const changed = !/Already up.to.date/i.test(out)
  return { ok: true, changed, message: changed ? '已拉取最新文档' : '已是最新' }
}

/** 放弃本地未推送内容,强制与远端一致(fetch + reset --hard 上游;未跟踪文件保留) */
export async function gitPullForce(repoPath: string) {
  const f = await run(repoPath, ['fetch'])
  if (f.code !== 0) return { ok: false, changed: false, message: (f.stderr || f.stdout).trim().slice(0, 500) }
  const r = await run(repoPath, ['reset', '--hard', '@{upstream}'])
  if (r.code !== 0) return { ok: false, changed: false, message: (r.stderr || r.stdout).trim().slice(0, 500) }
  return { ok: true, changed: true, message: '已放弃本地修改并与远端保持一致' }
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
      return {
        ok: false,
        changed: false,
        conflict: true,
        message: '本地与远端存在冲突,请选择保留方式',
      }
    }
    p = await run(repoPath, ['push'])
    if (p.code !== 0) return { ok: false, changed: false, message: (p.stderr || p.stdout).trim().slice(0, 500) }
  }
  return { ok: true, changed: true, message: '已提交并推送' }
}

// 注:墨阅不代做合并 —— rebase 真冲突时 gitSync 返回 conflict 提示,由用户用外部 git 工具处理。
