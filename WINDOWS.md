# Correr Paper Learning en Windows

## Requisitos

- [Node.js 18+](https://nodejs.org) — descargar el instalador `.msi` (LTS), o instalar con `winget install --id OpenJS.NodeJS.LTS`
- [Git](https://git-scm.com/download/win)
- **Python 3** — lo necesita `node-gyp` para compilar `better-sqlite3` desde el código fuente. `winget install --id Python.Python.3.12`
- **Visual Studio Build Tools 2022** con:
  - El workload **"Desktop development with C++"**
  - El componente opcional **"C++ Clang Compiler for Windows"** (`Microsoft.VisualStudio.Component.VC.Llvm.Clang`) — Node.js en Windows a veces exige compilar con el toolset Clang/LLVM en vez de MSVC puro; sin este componente la compilación falla con `MSB8020: No se pueden encontrar las herramientas de compilación para ClangCL`.

  Instalación rápida vía winget (Build Tools + workload C++, sin abrir el instalador visual):
  ```powershell
  winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  ```
  Si ya tienes Build Tools instalado y solo falta Clang, agrégalo así (requiere sesión de PowerShell **como administrador**):
  ```powershell
  & "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vs_installer.exe" modify --installPath "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools" --add Microsoft.VisualStudio.Component.VC.Llvm.Clang --add Microsoft.VisualStudio.Component.VC.Llvm.ClangToolset --passive --norestart
  ```

> **Importante:** después de instalar Node.js, Python o Visual Studio, **cierra y vuelve a abrir la terminal** (o reinicia la PC). Una terminal ya abierta no ve el PATH actualizado, así que `node`/`npm`/`python` van a seguir apareciendo como "no reconocido" hasta que abras una ventana nueva.

## Instalación

```bash
git clone https://github.com/Foco22/fa-application.git
cd fa-application
npm install
npm start
```

Al abrir por primera vez aparece el wizard de configuración — completa los 4 pasos.

Este repo ya incluye en `package.json` un `overrides` que fuerza una versión reciente de `node-gyp` (`^11.0.0`). Es necesario porque la versión vieja que trae `electron-rebuild` (9.4.x) tiene un bug conocido: al compilar con el toolset ClangCL, genera una bandera de enlazado (`/LTCG:INCREMENTAL`) que `llvm-lib.exe` no reconoce y falla con `MSB6006`. Si por algún motivo ese override se pierde o `npm install` sigue fallando en el paso de enlazado de `better-sqlite3` con ese error, verifica que siga presente en `package.json`.

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

### `better-sqlite3` falla al instalar

Node.js no publica binarios precompilados de `better-sqlite3` para todas las versiones de Node, así que en Windows casi siempre hay que compilarlo desde el código fuente. Sigue este orden de diagnóstico según el mensaje de error exacto:

| Error | Causa | Solución |
|---|---|---|
| `npm` no reconocido | Terminal abierta antes de instalar Node | Cierra y abre una terminal nueva |
| `ModuleNotFoundError: No module named 'distutils'` | Python 3.12+ removió `distutils` de la librería estándar | `python -m pip install setuptools` |
| `Could not find any Visual Studio installation` | Falta Visual Studio Build Tools | Instala Build Tools con el workload "Desktop development with C++" (ver Requisitos) |
| `MSB8020: No se pueden encontrar las herramientas de compilación para ClangCL` | Falta el componente Clang/LLVM en Build Tools | Agrega `Microsoft.VisualStudio.Component.VC.Llvm.Clang` y `...ClangToolset` (ver Requisitos) — requiere PowerShell como administrador |
| `MSB6006: "llvm-lib.exe" salió con el código 1` junto a `/LTCG:INCREMENTAL: no such file or directory` | Bug de compatibilidad en `node-gyp` viejo (9.x) con el toolset ClangCL | Ya solucionado en este repo vía `overrides.node-gyp` en `package.json` (fuerza `node-gyp@^11`) — si reaparece, revisa que ese override siga en el `package.json` |
| Cualquier `ECONNRESET` / timeout durante la descarga | Red inestable (muy común con las descargas grandes de Visual Studio/npm) | Reintenta `npm install`; si persiste, prueba desde otra red |

Como último recurso, forzar la compilación desde el código fuente:
```bash
npm install --build-from-source
```

### La ventana no abre / pantalla en negro
Abre DevTools con `Ctrl+Shift+I` y revisa la consola por errores de API key o base de datos.

### `npm start` no muestra nada / parece colgado en PowerShell
Si rediriges la salida con `2>&1` (por ejemplo `npm start 2>&1 | Tee-Object ...`), PowerShell 5.1 puede tratar cualquier línea que `electron-rebuild` escriba a stderr (como su spinner de progreso) como un error fatal y cortar el pipeline antes de que `electron .` llegue a ejecutarse — sin mostrar ningún error real. Corre `npm start` sin redirigir stderr.

### Micrófono no detectado en clase
Windows puede bloquear el acceso al micrófono para apps de escritorio. Ve a:
`Configuración → Privacidad → Micrófono` y activa el acceso para apps de escritorio.