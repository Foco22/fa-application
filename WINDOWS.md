# Correr Paper Learning en Windows

## Requisitos

- [Node.js 18+](https://nodejs.org) — descargar el instalador `.msi` (LTS)
- [Git](https://git-scm.com/download/win)

## Instalación

```bash
git clone https://github.com/Foco22/fa-application.git
cd fa-application
npm install
npm start
```

Al abrir por primera vez aparece el wizard de configuración — completa los 4 pasos.

## API Keys

Configura las keys desde la UI en **Settings**, o crea un archivo `.env` en la raíz:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
DEEPSEEK_API_KEY=sk-...
GROQ_API_KEY=gsk_...
```

## Transcripción en clase (Groq o OpenAI)

La transcripción usa el micrófono del navegador vía `MediaRecorder` — funciona igual en Windows.

En la vista de preparación de clase, selecciona:
- **Compañía transcripción**: Groq (recomendado) o OpenAI
- **Modelo**: `whisper-large-v3-turbo` (Groq) o `gpt-4o-mini-transcribe` (OpenAI)

Si la transcripción sale vacía, revisa el nivel del micrófono en:
`Panel de control → Sonido → Grabación → Propiedades → Niveles`

## Lo que NO funciona en Windows

| Feature | Estado |
|---|---|
| Transcripción API (Groq/OpenAI) | ✅ Funciona |
| Papers, quiz, resumen, chat | ✅ Funciona |
| Clase (preguntas estudiantes) | ✅ Funciona |
| `test-whisper.js` | ❌ Usa `arecord` (Linux only) |
| Whisper local (`whisper.cpp`) | ❌ Binario compilado para Linux |

## Errores comunes

**`better-sqlite3` falla al instalar**
```bash
npm install --build-from-source
```
O instala las [Build Tools de Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) y vuelve a correr `npm install`.

**La ventana no abre / pantalla en negro**
Abre DevTools con `Ctrl+Shift+I` y revisa la consola por errores de API key o base de datos.

**Micrófono no detectado en clase**
Windows puede bloquear el acceso al micrófono para apps de escritorio. Ve a:
`Configuración → Privacidad → Micrófono` y activa el acceso para apps de escritorio.