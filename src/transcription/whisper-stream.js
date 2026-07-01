const { spawn } = require('child_process')
const path = require('path')

const ANSI_RE      = /\x1b\[[0-9;]*[a-zA-Z]/g   // ESC[2K, ESC[0m, etc.
const TIMESTAMP_RE = /^\[[\d:.,]+ --> [\d:.,]+\]\s*/

function filterLine(raw) {
  // Strip ANSI escape codes (whisper-stream uses them for terminal live display)
  const clean = raw.replace(ANSI_RE, '').replace(/\r/g, '')
  const line  = clean.replace(TIMESTAMP_RE, '').trim()
  if (!line) return null
  // Whisper noise markers: [BLANK_AUDIO] [Música] (Música) (Aplausos) etc.
  if (/^\[.*\]$/.test(line)) return null
  if (/^\(.*\)$/.test(line)) return null
  return line
}

function createWhisperStream(binaryPath, modelPath, _spawn = null) {
  const spawnFn = _spawn || spawn
  let proc = null

  return {
    start({ language = 'es', onText, onError, onDebug } = {}) {
      const args = [
        '-m', modelPath,
        '-l', language,
        '--step',      '3000',
        '--length',    '12000',
        '--vad-thold', '0.2',   // low threshold — 0.60 filtered speech, 0.0 hallucinates silence
        '-t', '4',
      ]

      // Shared libs (libggml, libwhisper) live next to the binary — add to LD_LIBRARY_PATH
      const libDir = path.dirname(binaryPath)
      const existingLdPath = process.env.LD_LIBRARY_PATH || ''
      const env = {
        ...process.env,
        LD_LIBRARY_PATH: existingLdPath ? `${libDir}:${existingLdPath}` : libDir
      }

      proc = spawnFn(binaryPath, args, { env })

      // whisper-stream uses \r (not \n) to overwrite the terminal with live
      // partial text, then \n only when a segment is fully committed.
      // readline only fires on \n — so we'd miss most output.
      // Raw data reading splits on both \r and \n to capture live updates.
      let rawBuf  = ''
      let lastOut = ''

      proc.stdout.on('data', (chunk) => {
        const raw = chunk.toString()
        onDebug?.(`[stdout] ${JSON.stringify(raw.slice(0, 120))}`)
        rawBuf += raw
        let pos
        while ((pos = rawBuf.search(/[\r\n]/)) !== -1) {
          const seg = rawBuf.slice(0, pos)
          const sep = rawBuf[pos]
          rawBuf = rawBuf.slice(pos + 1)

          const text = filterLine(seg)
          onDebug?.(`[seg] ${JSON.stringify(seg.slice(0,80))} → ${JSON.stringify(text)}`)
          if (!text || text === lastOut) continue

          if (sep === '\n') {
            const newPart = text.startsWith(lastOut)
              ? text.slice(lastOut.length).trim()
              : text
            if (newPart) { onDebug?.(`[emit-nl] ${newPart}`); onText?.(newPart) }
            lastOut = ''
          } else {
            const newPart = text.startsWith(lastOut)
              ? text.slice(lastOut.length).trim()
              : text
            if (newPart) { onDebug?.(`[emit-cr] ${newPart}`); onText?.(newPart) }
            lastOut = text
          }
        }
      })

      proc.stderr?.on('data', (data) => {
        const msg = data.toString().replace(/\n/g, ' ').trim()
        if (msg) onDebug?.(`[stderr] ${msg.slice(0, 200)}`)
      })

      proc.on('error', (err) => {
        onError?.(err)
      })

      proc.on('close', (code) => {
        proc = null
        if (code !== 0 && code !== null) {
          onError?.(new Error(`whisper-stream exited with code ${code}`))
        }
      })
    },

    stop() {
      if (proc) {
        proc.kill('SIGTERM')
        proc = null
      }
    }
  }
}

module.exports = { createWhisperStream, filterLine }