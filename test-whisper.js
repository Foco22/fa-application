#!/usr/bin/env node
// Test script: records 20s from mic → sends to OpenAI/Groq Whisper → prints result
// Usage: node test-whisper.js [openai|groq]

const { execSync } = require('child_process')
const fs   = require('fs')
const path = require('path')
const OpenAI = require('openai')

// Load .env
const envPath = path.join(__dirname, '.env')
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=')
    if (k && v.length) process.env[k.trim()] = v.join('=').trim()
  })
}

async function main() {
    const provider = process.argv[2] || 'openai'
  const apiKey   = process.argv[3]
    || (provider === 'groq'      ? process.env.GROQ_API_KEY     : null)
    || (provider === 'deepseek'  ? process.env.DEEPSEEK_API_KEY : null)
    || process.env.OPENAI_API_KEY

  if (!apiKey) {
    console.error(`Uso: node test-whisper.js <openai|groq|deepseek> [API_KEY]`)
    process.exit(1)
  }

  const wavFile = '/tmp/test-whisper.wav'
  const SECONDS = 20

  console.log(`\nGrabando ${SECONDS} segundos... HABLA AHORA\n`)

  // Record with arecord, apply gain 4× via sox if available
  try {
    execSync(`arecord -D default -f S16_LE -r 16000 -c 1 -d ${SECONDS} ${wavFile}`, { stdio: 'inherit' })
  } catch (e) {
    console.error('Error grabando:', e.message)
    process.exit(1)
  }

  const stat = fs.statSync(wavFile)
  console.log(`\nArchivo grabado: ${(stat.size / 1024).toFixed(0)} KB`)

  // Medir nivel del audio grabado
  const levelOut = execSync(`ffmpeg -i ${wavFile} -af volumedetect -f null /dev/null 2>&1`).toString()
  const maxDb  = (levelOut.match(/max_volume:\s*([-\d.]+)/)  || [])[1]
  const meanDb = (levelOut.match(/mean_volume:\s*([-\d.]+)/) || [])[1]
  console.log(`Nivel audio → max: ${maxDb} dB  media: ${meanDb} dB`)
  if (maxDb && parseFloat(maxDb) < -40) {
    console.log('⚠  Audio demasiado silencioso — el micrófono no captura voz')
  }

  // Groq funciona mejor con raw — OpenAI necesita amplificación
  const ampFile = '/tmp/test-whisper-amp.wav'
  if (provider !== 'groq') {
    execSync(`ffmpeg -y -i ${wavFile} -af "volume=12dB" ${ampFile} 2>/dev/null`)
    console.log('Amplificado 12dB con ffmpeg')
  } else {
    fs.copyFileSync(wavFile, ampFile)
    console.log('Audio sin procesar')
  }

  const baseURL = provider === 'groq' ? 'https://api.groq.com/openai/v1' : undefined
  const model   = provider === 'groq' ? 'whisper-large-v3-turbo' : 'gpt-4o-mini-transcribe'

  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })

  console.log(`\nEnviando a ${provider} (${model})...`)
  try {
    const result = await client.audio.transcriptions.create({
      file:     fs.createReadStream(ampFile),
      model,
      language: 'es',
    })
    console.log(`\n✅ Transcripción:\n"${result.text}"`)
  } catch (err) {
    console.error(`\n❌ Error API: ${err.message}`)
  }

  fs.unlinkSync(wavFile)
  try { fs.unlinkSync(ampFile) } catch {}
}

main()
