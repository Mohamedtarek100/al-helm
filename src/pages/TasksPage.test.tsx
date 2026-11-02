import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { Task } from '../types'
import type { NewTask, WriteResult } from '../services/store'
import { I18nProvider } from '../i18n/I18nProvider'
import { ToastProvider } from '../components/Toast'
import { todayKey } from '../services/date'
import { TasksPage } from './TasksPage'

const taskStore = vi.hoisted(() => ({
  tasks: [] as Task[],
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  setTaskCompleted: vi.fn(),
}))

vi.mock('../services/store', () => ({
  useAppData: () => ({ tasks: taskStore.tasks, subjects: [] }),
  useSettings: () => ({ language: 'en' }),
  createTask: taskStore.createTask,
  updateTask: taskStore.updateTask,
  deleteTask: taskStore.deleteTask,
  setTaskCompleted: taskStore.setTaskCompleted,
}))

function renderPage() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <TasksPage />
      </ToastProvider>
    </I18nProvider>,
  )
}

function openTaskForm() {
  fireEvent.click(screen.getAllByRole('button', { name: 'New task' })[0])
  return screen.getByRole('dialog')
}

function savedTask(input: NewTask, id: string, writeResult: WriteResult = 'cloud'): Task & { writeResult: WriteResult } {
  const stamp = new Date().toISOString()
  return {
    ...input,
    id,
    completed: false,
    completedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    writeResult,
  }
}

beforeEach(() => {
  taskStore.tasks.splice(0)
  taskStore.createTask.mockReset()
  taskStore.updateTask.mockReset()
  taskStore.deleteTask.mockReset()
  taskStore.setTaskCompleted.mockReset()
  taskStore.createTask.mockImplementation(async (input: NewTask) => {
    const task = savedTask(input, 'task-created')
    taskStore.tasks.push(task)
    return task
  })
})

describe('TasksPage task creation', () => {
  it('creates a task using the default due date and makes it visible', async () => {
    renderPage()
    const dialog = openTaskForm()
    const form = dialog.querySelector('form')
    expect(form).not.toBeNull()
    expect((dialog.querySelector('input[type="date"]') as HTMLInputElement).value).toBe(todayKey())

    fireEvent.change(within(dialog).getByLabelText(/Task title/), { target: { value: 'Review biology' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'New task' }))

    expect(await screen.findByRole('heading', { name: 'Review biology' })).toBeTruthy()
    expect(taskStore.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Review biology',
      dueDate: todayKey(),
    }))
  }, 10_000)

  it('submits with an explicit due date through the form-associated Save button', async () => {
    renderPage()
    const dialog = openTaskForm()
    const form = dialog.querySelector('form') as HTMLFormElement
    const saveButton = within(dialog).getByRole('button', { name: 'New task' }) as HTMLButtonElement
    expect(saveButton.type).toBe('submit')
    expect(saveButton.form).toBe(form)

    fireEvent.change(within(dialog).getByLabelText(/Task title/), { target: { value: 'Prepare notes' } })
    fireEvent.change(dialog.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: '2026-11-18' } })
    await act(async () => { form.requestSubmit(saveButton) })

    expect(await screen.findByRole('heading', { name: 'Prepare notes' })).toBeTruthy()
    expect(taskStore.createTask).toHaveBeenCalledWith(expect.objectContaining({ dueDate: '2026-11-18' }))
  })

  it('prevents a second submit while the first save is pending', async () => {
    let finishSave!: (task: Task & { writeResult: WriteResult }) => void
    taskStore.createTask.mockImplementationOnce((input: NewTask) => new Promise((resolve) => {
      finishSave = resolve
      void input
    }))
    renderPage()
    const dialog = openTaskForm()
    const form = dialog.querySelector('form') as HTMLFormElement
    const saveButton = within(dialog).getByRole('button', { name: 'New task' }) as HTMLButtonElement
    fireEvent.change(within(dialog).getByLabelText(/Task title/), { target: { value: 'Only once' } })

    act(() => {
      form.requestSubmit(saveButton)
      form.requestSubmit(saveButton)
    })

    expect(taskStore.createTask).toHaveBeenCalledTimes(1)
    await act(async () => {
      const task = savedTask({
        title: 'Only once',
        description: '',
        subjectId: null,
        dueDate: todayKey(),
        dueTime: '',
        priority: 'medium',
        category: 'study',
        estimatedMinutes: 30,
      }, 'task-once')
      taskStore.tasks.push(task)
      finishSave(task)
    })
    expect(await screen.findByRole('heading', { name: 'Only once' })).toBeTruthy()
  })

  it('keeps entered content in the open form and shows the actual persistence failure', async () => {
    taskStore.createTask.mockRejectedValueOnce(new Error('Local storage quota exceeded'))
    renderPage()
    const dialog = openTaskForm()
    const title = within(dialog).getByLabelText(/Task title/) as HTMLInputElement
    fireEvent.change(title, { target: { value: 'Do not lose this draft' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'New task' }))

    expect(await screen.findByText('Local storage quota exceeded')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(title.value).toBe('Do not lose this draft')
    expect(taskStore.tasks).toHaveLength(0)
  })

  it('reports a local-only cloud write without claiming cloud success', async () => {
    taskStore.createTask.mockImplementationOnce(async (input: NewTask) => {
      const task = savedTask(input, 'task-local-only', 'local-only')
      taskStore.tasks.push(task)
      return task
    })
    renderPage()
    const dialog = openTaskForm()
    fireEvent.change(within(dialog).getByLabelText(/Task title/), { target: { value: 'Saved offline' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'New task' }))

    expect(await screen.findByText(/Saved on this device/)).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Saved offline' })).toBeTruthy()
  })

  it('does not claim a temporary guest task was saved durably', async () => {
    taskStore.createTask.mockImplementationOnce(async (input: NewTask) => {
      const task = savedTask(input, 'task-session-only', 'session-only')
      taskStore.tasks.push(task)
      return task
    })
    renderPage()
    const dialog = openTaskForm()
    fireEvent.change(within(dialog).getByLabelText(/Task title/), { target: { value: 'Temporary guest task' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'New task' }))

    expect(await screen.findByText(/This task is temporary/)).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Temporary guest task' })).toBeTruthy()
  })

  it('clears filters so the newly created task cannot be hidden', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: 'an old query' } })
    fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'art' } })
    const dialog = openTaskForm()
    fireEvent.change(within(dialog).getByLabelText(/Task title/), { target: { value: 'Visible after save' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'New task' }))

    expect(await screen.findByRole('heading', { name: 'Visible after save' })).toBeTruthy()
    expect((screen.getByLabelText('Search tasks') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Filter by category') as HTMLSelectElement).value).toBe('all')
  })
})
