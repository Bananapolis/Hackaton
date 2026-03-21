import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuizOverlay } from './QuizOverlay'

const quiz = {
  question: 'What is 2+2?',
  options: [
    { id: 'A', text: '3' },
    { id: 'B', text: '4' },
    { id: 'C', text: '5' },
    { id: 'D', text: '22' },
  ],
}

describe('QuizOverlay', () => {
  it('returns null when quiz is missing', () => {
    const { container } = render(<QuizOverlay quiz={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('calls onAnswer when clicking an option', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()

    render(<QuizOverlay quiz={quiz} onAnswer={onAnswer} />)

    await user.click(screen.getByRole('button', { name: /b\. 4/i }))
    expect(onAnswer).toHaveBeenCalledWith('B')
  })

  it('locks answers when readonly or already selected', () => {
    render(<QuizOverlay quiz={quiz} readonly selectedOptionId="A" votingClosed />)

    const buttons = screen.getAllByRole('button')
    expect(buttons.every((btn) => btn.hasAttribute('disabled'))).toBe(true)
    expect(screen.getByText(/answer submitted: a/i)).toBeInTheDocument()
    expect(screen.getByText(/voting is currently closed/i)).toBeInTheDocument()
  })
})
