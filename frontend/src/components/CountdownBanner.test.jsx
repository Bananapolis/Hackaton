import { render, screen } from '@testing-library/react'
import { CountdownBanner } from './CountdownBanner'

describe('CountdownBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing when break is inactive', () => {
    const { container } = render(<CountdownBanner endTimeEpoch={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows countdown and return time for active break', () => {
    const endTimeEpoch = Math.floor(Date.now() / 1000) + 125
    render(<CountdownBanner endTimeEpoch={endTimeEpoch} />)

    expect(screen.getByText(/break active/i)).toBeInTheDocument()
    expect(screen.getByText(/resuming in 2:05/i)).toBeInTheDocument()
    expect(screen.getByText(/be back at/i)).toBeInTheDocument()
  })
})
