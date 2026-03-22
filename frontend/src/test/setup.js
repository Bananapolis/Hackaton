import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

vi.mock('@react-oauth/google', () => ({
  GoogleOAuthProvider: ({ children }) => children,
  useGoogleLogin: () => vi.fn(),
}))
