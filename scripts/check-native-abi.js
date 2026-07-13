// ¿Puede el runtime que ejecuta este script cargar el binario nativo de
// better-sqlite3 tal como está compilado ahora mismo?
//
// better-sqlite3 es un módulo nativo y solo puede estar compilado para UN ABI a
// la vez: `npm test` lo deja en el de Node (via `npm rebuild`) y `npm start` en
// el de Electron (via electron-rebuild). Si el acceso directo abre Electron con
// el binario en ABI de Node, el proceso muere al iniciar.
//
// Ojo: un `require('better-sqlite3')` NO alcanza como chequeo — el .node se
// carga recién al instanciar la base, así que el require pasa incluso con el
// binario equivocado.
//
// Uso (desde launch-app.bat, con ELECTRON_RUN_AS_NODE=1):
//   electron scripts/check-native-abi.js   → exit 0 = puede cargarlo
//                                            exit 1 = hay que recompilar
const path = require('path')
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'))

try {
  new Database(':memory:').close()
  process.exit(0)
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
