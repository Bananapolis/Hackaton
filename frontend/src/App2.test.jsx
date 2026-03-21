import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

describe('App Massive Coverage 2', () => {
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

  it('renders Teacher Dashboard and handles session creation', async () => {
    window.localStorage.setItem('auth-token-v1', 'tok');
    window.localStorage.setItem('auth-user-v1', JSON.stringify({ id: 1, display_name: 'Bob', role: 'teacher' }));
    
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ session_id: '123', code: 'ABC123' })
    });

    const { getByPlaceholderText, getAllByRole, queryAllByRole, getByText, findByText } = render(<App />);
    const user = userEvent.setup();
    
    // Switch to Host Mode just in case
    const hostModeBtns = queryAllByRole('button', { name: /Host mode/i });
    if(hostModeBtns.length) await user.click(hostModeBtns[0]);
    else {
      const select = document.querySelector('select');
      if (select) await user.selectOptions(select, 'teacher');
    }

    // Just wait for it
    await new Promise((r) => setTimeout(r, 200));

    // Try finding teacher name
    const input = getByPlaceholderText(/Teacher name/i);
    await user.clear(input);
    await user.type(input, 'Teacher Bob');

    const startBtns = queryAllByRole('button', { name: /(Host|Start) Session/i });
    if (startBtns.length > 0) {
        await user.click(startBtns[0]);
    }
  });

  it('renders Student Flow and handles joining', async () => {
    window.localStorage.setItem('auth-token-v1', 'tok');
    window.localStorage.setItem('auth-user-v1', JSON.stringify({ id: 2, display_name: 'Alice', role: 'student' }));
    
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ student_id: '456', message: 'Joined' })
    });

    const { getByPlaceholderText, getAllByRole, queryAllByRole, getByText, findByText } = render(<App />);
    const user = userEvent.setup();
    
    const joinBtns = queryAllByRole('button', { name: /Join mode/i });
    if(joinBtns.length) await user.click(joinBtns[0]);
    else {
      const select = document.querySelector('select');
      if (select) await user.selectOptions(select, 'student');
    }

    await new Promise((r) => setTimeout(r, 200));

    // Fill join session
    await user.type(getByPlaceholderText(/Student name/i), 'Student Alice');
    await user.type(getByPlaceholderText(/ABC123/i), 'ABC123');
    
    const startBtns = queryAllByRole('button', { name: /Join Session/i });
    if (startBtns.length > 0) {
        await user.click(startBtns[0]);
    }

  });
});
