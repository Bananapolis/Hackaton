import { render, screen } from '@testing-library/react'
import { StatCard } from './StatCard'

describe('StatCard', () => {
  it('renders label, value and optional help text', () => {
    render(<StatCard label="Students" value="42" help="Connected now" />)

    expect(screen.getByText('Students')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('Connected now')).toBeInTheDocument()
  })

  it('hides help block when help is missing', () => {
    render(<StatCard label="Break votes" value="3" />)

    expect(screen.getByText('Break votes')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.queryByText('Connected now')).not.toBeInTheDocument()
  })
})
