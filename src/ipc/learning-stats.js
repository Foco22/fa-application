function registerLearningStatsHandlers({ ipcMain, db }) {
  ipcMain.handle('get-weekly-class-counts', (_e, { from, to } = {}) => db.getClassSessionsByWeek(from, to))

  ipcMain.handle('get-class-performance-trend', (_e, { from, to } = {}) => db.getClassPerformanceTrend(from, to))

  ipcMain.handle('get-quiz-performance-trend', (_e, { from, to } = {}) => db.getQuizPerformanceTrend(from, to))

  ipcMain.handle('get-weekly-streak', () => db.getWeeklyStreak())
}

module.exports = { registerLearningStatsHandlers }
