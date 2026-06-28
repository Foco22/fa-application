const DAY_MAP = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6
}

function buildCronExpression(day, hour) {
  const dayIndex = DAY_MAP[day.toLowerCase()]
  if (dayIndex === undefined) throw new Error(`Unrecognised day: ${day}`)

  const [h, m] = hour.split(':')
  return `${parseInt(m)} ${parseInt(h)} * * ${dayIndex}`
}

function createScheduler(settings, onFetch, cron) {
  const categoryList = (settings.categoryList || '').trim()
  const authorList   = (settings.authorList   || '').trim()
  const fetchDay     = settings.fetchDay  || 'monday'
  const fetchHour    = settings.fetchHour || '09:00'

  if (!categoryList && !authorList) return null

  const expr = buildCronExpression(fetchDay, fetchHour)
  const task = cron.schedule(expr, () => onFetch(), { scheduled: true })

  return { stop: () => task.stop() }
}

module.exports = { buildCronExpression, createScheduler }
