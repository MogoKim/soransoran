// 두 회차가 같은 죽은 소유자를 읽을 수 있다. 회수용 파일은 지우지 않아 모든 회차가
// 같은 inode에서 신원 확인과 제거를 직렬화한다. 프로세스가 끝나면 커널 잠금은 풀린다.
import { spawnSync } from 'node:child_process'

export function recoverMagazineLock({ fs, path, observed, pidAlive }) {
  const fd = fs.openSync(path + '.recovery', 'a+', 0o600)
  try {
    const darwin = process.platform === 'darwin'
    const result = spawnSync(darwin ? '/usr/bin/lockf' : '/usr/bin/flock', darwin ? ['-s', '-t', '0', '3'] : ['-n', '3'], {
      stdio: ['ignore', 'ignore', 'ignore', fd],
    })
    if (result.error) throw result.error
    if (result.status === (darwin ? 75 : 1)) return false
    if (result.status !== 0) throw new Error('잠금 회수용 커널 잠금을 확인할 수 없다')
    const current = JSON.parse(fs.readFileSync(path, 'utf8'))
    if (current.pid !== observed.pid || current.token !== observed.token || pidAlive(current.pid)) return false
    fs.unlinkSync(path)
    return true
  } finally {
    fs.closeSync(fd)
  }
}
