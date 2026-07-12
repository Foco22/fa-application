const { registerSettingsHandlers } = require('./settings')
const { registerPapersHandlers, runFetch } = require('./papers')
const { registerLearningHandlers } = require('./learning')
const { registerReferenceHandlers } = require('./reference')
const { registerClassHandlers } = require('./class')
const { registerLearningStatsHandlers } = require('./learning-stats')

function registerHandlers({ ipcMain, db, deps, mainWindow }) {
  registerSettingsHandlers({ ipcMain, db })
  registerPapersHandlers({ ipcMain, db, deps, mainWindow })
  registerLearningHandlers({ ipcMain, db, deps, mainWindow })
  registerReferenceHandlers({ ipcMain, db, deps })
  registerClassHandlers({ ipcMain, db, deps, mainWindow })
  registerLearningStatsHandlers({ ipcMain, db })

  return { runFetch: () => runFetch({ db, deps, mainWindow }) }
}

module.exports = { registerHandlers }