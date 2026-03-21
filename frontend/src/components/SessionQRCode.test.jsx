import { render, screen, waitFor } from '@testing-library/react'
import QRCode from 'qrcode'
import { SessionQRCode } from './SessionQRCode'

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(),
  },
}))

describe('SessionQRCode', () => {
  it('renders nothing without value', () => {
    const { container } = render(<SessionQRCode value="" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders generated qr image on success', async () => {
    QRCode.toDataURL.mockResolvedValueOnce('data:image/png;base64,abc')

    render(<SessionQRCode value="https://example.com/join" />)

    await waitFor(() => {
      expect(screen.getByAltText('Session join QR code')).toHaveAttribute('src', 'data:image/png;base64,abc')
    })
  })

  it('stays hidden when generation fails', async () => {
    QRCode.toDataURL.mockRejectedValueOnce(new Error('failed'))

    const { container } = render(<SessionQRCode value="https://example.com/join" />)

    await waitFor(() => {
      expect(container.querySelector('img')).toBeNull()
    })
  })
})
