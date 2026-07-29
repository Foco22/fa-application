// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderGreeting } from '../../../renderer/modules/topbar.js'
import { applyLanguage } from '../../../renderer/i18n.js'

describe('renderGreeting', () => {
  beforeEach(() => {
    document.body.innerHTML = '<span id="user-greeting" class="user-greeting"></span>'
    applyLanguage('en')
  })

  it('saluda "Good morning" antes del mediodía', () => {
    renderGreeting('Francisco', new Date('2026-07-29T08:00:00'))
    expect(document.getElementById('user-greeting').textContent).toBe('Good morning, Francisco')
  })

  it('saluda "Good afternoon" entre el mediodía y las 18:00', () => {
    renderGreeting('Francisco', new Date('2026-07-29T14:30:00'))
    expect(document.getElementById('user-greeting').textContent).toBe('Good afternoon, Francisco')
  })

  it('saluda "Good evening" desde las 18:00', () => {
    renderGreeting('Francisco', new Date('2026-07-29T20:00:00'))
    expect(document.getElementById('user-greeting').textContent).toBe('Good evening, Francisco')
  })

  it('respeta los límites exactos del rango (11:59 vs 12:00 vs 17:59 vs 18:00)', () => {
    renderGreeting('Francisco', new Date('2026-07-29T11:59:00'))
    expect(document.getElementById('user-greeting').textContent).toBe('Good morning, Francisco')

    renderGreeting('Francisco', new Date('2026-07-29T12:00:00'))
    expect(document.getElementById('user-greeting').textContent).toBe('Good afternoon, Francisco')

    renderGreeting('Francisco', new Date('2026-07-29T17:59:00'))
    expect(document.getElementById('user-greeting').textContent).toBe('Good afternoon, Francisco')

    renderGreeting('Francisco', new Date('2026-07-29T18:00:00'))
    expect(document.getElementById('user-greeting').textContent).toBe('Good evening, Francisco')
  })

  it('traduce el saludo en español', () => {
    applyLanguage('es')
    renderGreeting('Francisco', new Date('2026-07-29T08:00:00'))
    expect(document.getElementById('user-greeting').textContent).toBe('Buenos días, Francisco')
  })

  it('no muestra nada sin nombre de usuario', () => {
    renderGreeting('', new Date('2026-07-29T08:00:00'))
    expect(document.getElementById('user-greeting').textContent).toBe('')
  })

  it('usa la hora actual por defecto cuando no se pasa una', () => {
    expect(() => renderGreeting('Francisco')).not.toThrow()
  })
})
