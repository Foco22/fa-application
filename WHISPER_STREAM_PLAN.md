# Plan: Transcripción en tiempo real con whisper.cpp stream

## Objetivo
Agregar whisper.cpp en modo stream como **opción adicional** (local, gratis, ~1s de lag,
sin internet), sin reemplazar ni romper el flujo existente con OpenAI API (`gpt-4o-mini-transcribe`).

El usuario podrá elegir el backend de transcripción en Settings:
- `openai` (por defecto, pagado, requiere internet)
- `whisper-local` (gratis, sin internet, requiere compilar whisper.cpp)

---

## Estado actual

- Frontend graba audio en chunks de 2s con MediaRecorder
- Manda bytes al IPC `class-transcribe-audio`
- Main process llama a OpenAI API (`gpt-4o-mini-transcribe`)
- Retorna texto al renderer

## Estado objetivo

- Main process lanza `./stream -m base.bin -l es` como subprocess
- El binario captura el micrófono directamente (ALSA/SDL2)
- Cada vez que detecta habla → imprime línea por stdout
- Main process lee stdout línea por línea → emite evento IPC al renderer
- Renderer muestra texto en tiempo real
- Frontend ya NO usa MediaRecorder para transcripción

---

## Pasos

### 1. Instalar SDL2 dev headers
```bash
sudo apt install libsdl2-dev
```
SDL2 runtime ya está instalado — solo faltan los headers para compilar.

### 2. Clonar y compilar whisper.cpp
```bash
# Dentro del proyecto, carpeta tools/
mkdir -p tools && cd tools
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
make stream -j4
```
Genera el binario `tools/whisper.cpp/stream`.

### 3. Descargar modelo base
```bash
cd tools/whisper.cpp
bash models/download-ggml-model.sh base
# → models/ggml-base.bin (~74MB)
```
`base` = buen balance velocidad/calidad en español.
`tiny` = más rápido, menos preciso (39MB).

### 4. Crear `src/transcription/whisper-stream.js`
Módulo Node.js que:
- Expone `start(modelPath, language, onText, onError)`
- Lanza `stream` como `child_process.spawn`
- Lee stdout línea por línea con `readline`
- Filtra líneas vacías y alucinaciones conocidas
- Expone `stop()` que mata el proceso limpiamente

```javascript
// interfaz esperada
const ws = createWhisperStream(binaryPath, modelPath)
ws.start({ language: 'es', onText: (t) => { ... } })
ws.stop()
```

### 5. Modificar `src/ipc/class.js`
Agregar dos handlers nuevos **sin tocar `class-transcribe-audio`** (OpenAI sigue intacto):

| Channel | Descripción |
|---|---|
| `class-start-stream` | Lanza whisper stream; texto llega vía evento `class-stream-text` |
| `class-stop-stream` | Detiene el subprocess |

`class-transcribe-audio` (OpenAI chunked) **no se modifica** — sigue siendo el path por defecto.

`class-stream-text` es un evento main→renderer (igual que `summary-chunk`).

### 6. Modificar `preload.js`
Exponer los nuevos canales:
```javascript
classStartStream: (opts) => ipcRenderer.invoke('class-start-stream', opts),
classStopStream:  ()     => ipcRenderer.invoke('class-stop-stream'),
onStreamText: (cb) => ipcRenderer.on('class-stream-text', (_e, text) => cb(text)),
```

### 7. Modificar `renderer/modules/class.js`
Agregar detección del setting `transcriptionBackend`:
- Si `whisper-local` → llama `window.api.classStartStream({ language })` y escucha `onStreamText`
- Si `openai` (default) → comportamiento actual con MediaRecorder + `class-transcribe-audio` sin cambios
- `stopSpeechRecognition()` llama el stop correcto según el backend activo
- MediaRecorder y AudioContext VAD se **mantienen** (son el path OpenAI)

### 8. Agregar paths en `main.js` / `deps`
```javascript
const WHISPER_STREAM_BIN   = path.join(__dirname, 'tools/whisper.cpp/build/bin/whisper-stream')
const WHISPER_MODEL_PATH   = path.join(__dirname, 'tools/whisper.cpp/models/ggml-base.bin')
```
Nota: el binario se compila con `cmake --build build --target whisper-stream`, no con `make stream`.
Inyectar en `deps` para que `class.js` los use sin hardcodear paths.

---

## Para distribución futura

Al empaquetar la app con `electron-builder`:
- Incluir `tools/whisper.cpp/stream` (binario compilado Linux x64)
- Incluir `tools/whisper.cpp/models/ggml-base.bin`
- En `package.json` → `extraResources` apuntando a `tools/`
- En runtime usar `process.resourcesPath` para resolver los paths

---

## Orden de implementación (TDD)

1. Tests `tests/unit/transcription/whisper-stream.test.js` (mockear spawn)
2. `src/transcription/whisper-stream.js`
3. Tests `tests/unit/ipc/class.test.js` — nuevos handlers
4. Modificar `src/ipc/class.js`
5. Modificar `preload.js`
6. Modificar `renderer/modules/class.js`
7. Probar en app real con `npm start`

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| SDL2-dev no instalado | Paso 1 lo resuelve |
| Compilación falla | Verificar `make stream` output antes de continuar |
| Modelo no detecta español bien | Probar con `tiny` primero, subir a `small` si hace falta |
| Conflicto mic entre stream y browser | Stream captura ALSA directo — renderer ya no usa MediaRecorder |
| Paths rotos en distribución | Usar `process.resourcesPath` en producción |
