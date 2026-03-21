import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

describe('App Massive Coverage', () => {
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
    const { getByPlaceholderText, getAllByRole, getByText } = render(<App />);
    const user = userEvent.setup();
    
    // Switch to register
    await user.click(getAllByRole('button', { name: /Register/i })[0]);
    expect(getByPlaceholderText(/display name/i)).toBeInTheDocument();
    
    // Switch to login
    await user.click(getAllByRole('button', { name: /^Login$/i })[0]);
    expect(getByPlaceholderText(/email/i)).toBeInTheDocument();
  });

  it('login fail', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      text: async () => 'Invalid credentials'
    });
    const { getByPlaceholderText, getAllByRole, findByText } = render(<App />);
    const user = userEvent.setup();
    await user.type(getByPlaceholderText(/email/i), 'wrong@t.com');
    await user.type(getByPlaceholderText(/password/i), 'wrong');
    await user.click(getAllByRole('button', { name: /^Login$/i })[1]);
    
    await findByText(/Invalid credentials/i);
  });

  it('login success', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'tk', user: { id: 1, email: 't@t.com', display_name: 'T', role: 'teacher' } })
    });
    const { getByPlaceholderText, getAllByRole, findByText } = render(<App />);
    const user = userEvent.setup();
    await user.type(getByPlaceholderText(/email/i), 't@t.com');
    await user.type(getByPlaceholderText(/password/i), 'pwd');
    await user.click(getAllByRole('button', { name: /^Login$/i })[1]);
    
    await findByText(/host a new session/i);
  });
  
  it('register success', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'tk', user: { id: 1, email: 't@t.com', display_name: 'T', role: 'teacher' } })
    });
    const { getByPlaceholderText, getAllByRole, findByText } = render(<App />);
    const user = userEvent.setup();
    await user.click(getAllByRole('button', { name: /^Register$/i })[0]);
    
    await user.type(getByPlaceholderText(/display name/i), 'Ana');
    await user.type(getByPlaceholderText(/email/i), 'ana@t.com');
    await user.type(getByPlaceholderText(/password/i), 'pwd');
    await user.click(getAllByRole('button', { name: /create account/i })[0]);
    
    await findByText(/host a new session/i);
  });

  it('logs out and clears localStorage', async () => {
    window.localStorage.setItem('auth-token-v1', 'tok');
    window.localStorage.setItem('auth-user-v1', JSON.stringify({ id: 1, display_name: 'Bob', role: 'teacher' }));
    
    const { getByRole, findByPlaceholderText } = render(<App />);
    const user = userEvent.setup();
    
    const logoutBtn = getByRole('button', { name: /sign out/i });
    await user.click(logoutBtn);
    
    await findByPlaceholderText(/email/i);
    expect(window.localStorage.getItem('auth-token-v1')).toBeNull();
  });
});
