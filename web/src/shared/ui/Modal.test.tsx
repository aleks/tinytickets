import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Modal } from './Modal'

test('focuses the first input, traps Tab, and restores the trigger on unmount', () => {
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  const { unmount } = render(
    <Modal className="modal" labelledBy="title" saving={false} changed={false} close={vi.fn()}>
      {(requestClose) => (
        <>
          <h2 id="title">Editor</h2>
          <button onClick={requestClose}>Close</button>
          <input aria-label="Title" />
          <button>Save</button>
        </>
      )}
    </Modal>,
  )
  expect(screen.getByRole('textbox')).toHaveFocus()
  screen.getByRole('button', { name: 'Save' }).focus()
  fireEvent.keyDown(document, { key: 'Tab' })
  expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
  expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
  unmount()
  expect(trigger).toHaveFocus()
  trigger.remove()
})

test('uses current dirty and saving state for Escape and backdrop closing', () => {
  const close = vi.fn()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const modal = (changed: boolean, saving: boolean) => (
    <Modal className="modal" labelledBy="title" saving={saving} changed={changed} close={close}>
      {(requestClose) => (
        <>
          <h2 id="title">Editor</h2>
          <input aria-label="Title" />
          <button onClick={requestClose}>Close</button>
        </>
      )}
    </Modal>
  )
  const { rerender } = render(modal(false, false))
  rerender(modal(true, false))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(confirm).toHaveBeenCalledWith('Discard unsaved changes?')
  expect(close).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.mouseDown(screen.getByRole('dialog'))
  expect(close).not.toHaveBeenCalled()
  fireEvent.mouseDown(screen.getByRole('presentation'))
  expect(close).toHaveBeenCalledTimes(1)
  rerender(modal(true, true))
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(close).toHaveBeenCalledTimes(1)
})
