import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { LoginPage } from './LoginPage';

// Mock navigate so tests don't break on pushState
vi.mock('./navigate', () => ({ navigate: vi.fn() }));

describe('App Component - Authentication Flow', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    global.fetch = vi.fn();
    global.Notification = vi.fn();
    global.Notification.permission = 'default';
    global.Notification.requestPermission = vi.fn().mockResolvedValue('granted');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders auth and toggles', async () => {
    const { getByPlaceholderText, getAllByRole } = render(<LoginPage />);
    const user = userEvent.setup();

    // Switch to register
    await user.click(getAllByRole('button', { name: /Register/i })[0]);
    expect(getByPlaceholderText(/display name/i)).toBeInTheDocument();

    // Switch to login
    await user.click(getAllByRole('button', { name: /^Sign in$/i })[0]);
    expect(getByPlaceholderText(/email/i)).toBeInTheDocument();
  });

  it('displays an error message when login fails', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      text: async () => 'Invalid credentials'
    });
    const { getByPlaceholderText, findByText } = render(<LoginPage />);
    const user = userEvent.setup();
    await user.type(getByPlaceholderText(/email/i), 'wrong@t.com');
    await user.type(getByPlaceholderText(/password/i), 'wrong');
    // The submit button is the last "Sign in" button (the tab is the first)
    const signInBtns = screen.getAllByRole('button', { name: /^sign in$/i });
    await user.click(signInBtns[signInBtns.length - 1]);

    await findByText(/Invalid credentials/i);
  });

  it('successfully logs in and stores token in localStorage', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'tk', user: { id: 1, email: 't@t.com', display_name: 'T', role: 'teacher' } })
    });
    const { getByPlaceholderText } = render(<LoginPage />);
    const user = userEvent.setup();
    await user.type(getByPlaceholderText(/email/i), 't@t.com');
    await user.type(getByPlaceholderText(/password/i), 'pwd');
    const signInBtns = screen.getAllByRole('button', { name: /^sign in$/i });
    await user.click(signInBtns[signInBtns.length - 1]);

    await waitFor(() => {
      expect(window.localStorage.getItem('auth-token-v1')).toBe('tk');
    });
  });

  it('successfully registers a user and stores token in localStorage', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'tk', user: { id: 1, email: 't@t.com', display_name: 'T', role: 'teacher' } })
    });
    const { getByPlaceholderText } = render(<LoginPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Register$/i }));

    await user.type(getByPlaceholderText(/display name/i), 'Ana');
    await user.type(getByPlaceholderText(/email/i), 'ana@t.com');
    await user.type(getByPlaceholderText(/password/i), 'pwd');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(window.localStorage.getItem('auth-token-v1')).toBe('tk');
    });
  });

  it('logs out and clears localStorage', async () => {
    window.localStorage.setItem('auth-token-v1', 'tok');
    window.localStorage.setItem('auth-user-v1', JSON.stringify({ id: 1, display_name: 'Bob', role: 'teacher' }));

    const { getByRole } = render(<App />);
    const user = userEvent.setup();

    const logoutBtn = getByRole('button', { name: /sign out/i });
    await user.click(logoutBtn);

    await waitFor(() => {
      expect(window.localStorage.getItem('auth-token-v1')).toBeNull();
    });
  });
});
